// @vitest-environment jsdom

import {
  conversionSchema,
  earningListSchema,
  ownerClaimListSchema,
  ownerClaimSchema,
  partnerDetailSchema,
  partnerSchema,
  demoScenarioId,
} from "@referral-sandbox/contracts";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import {
  changeConversionState,
  createPreviewChallenge,
  getEligibleEarnings,
  getOwnerOverview,
  retryClaim,
  advanceGuide,
  getDemoWorkspace,
  getGuideState,
  resetDemoSandbox,
} from "./api-client.js";
import { mockEligibleEarnings, mockPreviewChallenge } from "../test/mocks.js";
import { server } from "../test/setup.js";

describe("API client contracts", () => {
  const earningId = "11111111-1111-4111-8111-000000000024";

  it("uses the configured public API origin for browser requests", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://localhost:4000");
    server.use(http.get("http://localhost:4000/earnings", () => HttpResponse.json({ items: [] })));
    try {
      await expect(getEligibleEarnings()).resolves.toEqual({ items: [] });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("parses guide/workspace/reset responses and sends fresh guide mutation keys", async () => {
    const organizationId = "11111111-1111-4111-8111-000000000001";
    const guide = {
      organizationId,
      scenarioId: demoScenarioId,
      stage: "review_program",
      sandboxVersion: 1,
      completedStages: [],
      updatedAt: "2026-09-16T00:00:00.000Z",
    } as const;
    const session = {
      organizationId,
      actorId: "11111111-1111-4111-8111-000000000002",
      role: "owner",
      partnerId: null,
      displayName: "Morgan Lee",
      sandboxVersion: 2,
    } as const;
    const keys: string[] = [];
    server.use(
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () => HttpResponse.json(guide)),
      http.get("*/api/demo/workspace", () =>
        HttpResponse.json({
          role: "owner",
          organizationId,
          sandboxVersion: 1,
          conversions: [],
          auditEvents: [],
        }),
      ),
      http.post(`*/api/demo/scenarios/${demoScenarioId}/advance`, ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json({
          ...guide,
          stage: "switch_to_partner",
          completedStages: ["review_program"],
        });
      }),
      http.post("*/api/demo/reset", async ({ request }) => {
        expect(await request.json()).toEqual({ confirmation: "RESET SANDBOX" });
        return HttpResponse.json({ session, guide: { ...guide, sandboxVersion: 2 } });
      }),
    );

    await expect(getGuideState()).resolves.toEqual(guide);
    await expect(getDemoWorkspace()).resolves.toMatchObject({ role: "owner" });
    await advanceGuide();
    await advanceGuide();
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
    await expect(resetDemoSandbox()).resolves.toMatchObject({ session: { sandboxVersion: 2 } });
  });

  it("accepts a response built from the shared earning schema", async () => {
    server.use(mockEligibleEarnings());

    const result = await getEligibleEarnings();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.status).toBe("eligible");
  });

  it("rejects response drift at the client boundary", async () => {
    server.use(http.get("*/api/earnings", () => HttpResponse.json({ items: "not-a-list" })));

    await expect(getEligibleEarnings()).rejects.toThrow(/response did not match/i);
  });

  it("turns an unhandled request into a test failure instead of reaching the network", async () => {
    await expect(fetch("http://localhost/api/not-mocked")).rejects.toThrow();
  });

  it("creates preview challenges through the approved hyphenated route", async () => {
    let approvedRouteCalled = false;
    const serverDate = "Wed, 16 Sep 2026 05:00:00 GMT";
    server.use(
      http.post("*/api/otp-challenges", () => {
        approvedRouteCalled = true;
        return HttpResponse.json(
          {
            id: "22222222-2222-4222-8222-000000000001",
            status: "pending",
            channel: "sms",
            maskedRecipient: "***0101",
            attempts: 0,
            attemptsRemaining: 5,
            expiresAt: "2026-09-16T05:05:00.000Z",
            resendAfter: "2026-09-16T05:01:00.000Z",
            delivery: {
              mode: "preview",
              preview: {
                recipientMasked: "***0101",
                message: "Your sandbox verification code is 418205.",
                code: "418205",
                expiresAt: "2026-09-16T05:05:00.000Z",
              },
            },
          },
          { headers: { Date: serverDate } },
        );
      }),
    );

    const challenge = await createPreviewChallenge([earningId]);

    expect(approvedRouteCalled).toBe(true);
    expect(challenge.serverNowMs).toBe(Date.parse(serverDate));
    expect(challenge.receivedAtClientMs).toBeGreaterThan(0);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-date"],
  ] as const)(
    "falls back to a finite receipt clock when the Date header is %s",
    async (_label, dateHeader) => {
      const receiptTime = Date.parse("2026-09-16T07:30:00.000Z");
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(receiptTime);
      try {
        server.use(
          http.post("*/api/otp-challenges", () =>
            HttpResponse.json(
              {
                id: "22222222-2222-4222-8222-000000000001",
                status: "pending",
                channel: "sms",
                maskedRecipient: "***0101",
                attempts: 0,
                attemptsRemaining: 5,
                expiresAt: "2026-09-16T07:35:00.000Z",
                resendAfter: "2026-09-16T07:31:00.000Z",
                delivery: { mode: "provider", status: "queued" },
              },
              dateHeader === undefined ? {} : { headers: { Date: dateHeader } },
            ),
          ),
        );

        const challenge = await createPreviewChallenge([earningId]);

        expect(Number.isFinite(challenge.serverNowMs)).toBe(true);
        expect(challenge.serverNowMs).toBe(receiptTime);
        expect(challenge.receivedAtClientMs).toBe(receiptTime);
      } finally {
        nowSpy.mockRestore();
      }
    },
  );

  it("serves the preview mock on the approved route so client and fixtures cannot drift together", async () => {
    server.use(mockPreviewChallenge("418205"));

    const response = await fetch("/api/otp-challenges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ earningIds: [earningId], channel: "sms" }),
    });

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      delivery: { mode: "preview", preview: { code: "418205" } },
    });
  });

  it("sends credentials and a fresh idempotency key for each owner mutation", async () => {
    const conversion = conversionSchema.parse({
      id: "11111111-1111-4111-8111-000000000017",
      organizationId: "11111111-1111-4111-8111-000000000001",
      programId: "11111111-1111-4111-8111-000000000007",
      partnerId: "11111111-1111-4111-8111-000000000005",
      referralCodeId: "11111111-1111-4111-8111-000000000012",
      externalRef: "JOB-1042",
      currency: "USD",
      status: "attributed",
      items: [],
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    });
    const keys: string[] = [];
    const credentials: RequestCredentials[] = [];
    server.use(
      http.post("*/api/conversions/:id/complete", ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        credentials.push(request.credentials);
        return HttpResponse.json(conversionSchema.parse({ ...conversion, status: "completed" }));
      }),
    );

    await changeConversionState(conversion, "complete");
    await changeConversionState(conversion, "complete");

    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
    expect(credentials).toEqual(["include", "include"]);
  });

  it("loads authoritative partner balances and owner claim audit records", async () => {
    const organizationId = "11111111-1111-4111-8111-000000000001";
    const partner = partnerSchema.parse({
      id: "11111111-1111-4111-8111-000000000005",
      organizationId,
      userId: "11111111-1111-4111-8111-000000000003",
      displayName: "Jamie Rivera",
      email: "jamie@example.test",
      phoneE164: "+12025550101",
      status: "active",
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    });
    const detail = partnerDetailSchema.parse({
      ...partner,
      balances: [{ currency: "USD", ledgerMinor: "0", eligibleMinor: "2500", heldMinor: "500" }],
    });
    const ownerClaim = ownerClaimSchema.parse({
      id: "33333333-3333-4333-8333-000000000001",
      organizationId,
      partnerId: partner.id,
      actorId: partner.userId,
      amount: { amountMinor: "2500", currency: "USD" },
      status: "created",
      idempotencyKey: "claim-key",
      selectionHash: "hash",
      items: [],
      otpAudit: null,
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    });
    let detailRead = false;
    server.use(
      http.get("*/api/programs", () => HttpResponse.json([])),
      http.get("*/api/earnings", () => HttpResponse.json(earningListSchema.parse({ items: [] }))),
      http.get("*/api/partners", () => HttpResponse.json([partner])),
      http.get("*/api/partners/:id", () => {
        detailRead = true;
        return HttpResponse.json(detail);
      }),
      http.get("*/api/claims", () =>
        HttpResponse.json(ownerClaimListSchema.parse({ items: [ownerClaim] })),
      ),
    );

    const overview = await getOwnerOverview();

    expect(detailRead).toBe(true);
    expect(overview.partners[0]?.balances).toEqual(detail.balances);
    expect(overview.claims[0]?.otpAudit).toBeNull();
  });

  it("retries a failed owner payout with a fresh idempotency key", async () => {
    const keys: string[] = [];
    server.use(
      http.post("*/api/claims/:id/retry", ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json({ status: "bad fixture" }, { status: 409 });
      }),
    );

    await expect(retryClaim("33333333-3333-4333-8333-000000000001")).rejects.toThrow();
    await expect(retryClaim("33333333-3333-4333-8333-000000000001")).rejects.toThrow();
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });
});
