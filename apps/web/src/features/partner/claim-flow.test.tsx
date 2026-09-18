// @vitest-environment jsdom

import {
  claimSchema,
  earningViewSchema,
  otpChallengeResponseSchema,
  otpChallengeStateSchema,
  type EarningView,
} from "@referral-sandbox/contracts";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "../../test/setup.js";
import "../../test/setup.js";
import { ClaimFlow } from "./claim-flow.js";

const ids = {
  organization: "11111111-1111-4111-8111-000000000001",
  partnerUser: "11111111-1111-4111-8111-000000000003",
  partner: "11111111-1111-4111-8111-000000000005",
  program: "11111111-1111-4111-8111-000000000007",
  item: "11111111-1111-4111-8111-000000000019",
  earning: "11111111-1111-4111-8111-000000000024",
  challenge: "22222222-2222-4222-8222-000000000001",
  claim: "33333333-3333-4333-8333-000000000001",
  claimItem: "33333333-3333-4333-8333-000000000002",
} as const;

const now = new Date("2026-09-16T05:00:00.000Z");

function earning(overrides: Partial<EarningView> = {}): EarningView {
  return earningViewSchema.parse({
    id: ids.earning,
    organizationId: ids.organization,
    conversionItemId: ids.item,
    programId: ids.program,
    partnerId: ids.partner,
    ruleId: null,
    amount: { amountMinor: "2500", currency: "USD" },
    reversedAmount: { amountMinor: "0", currency: "USD" },
    status: "eligible",
    statusExplanation: "Available to claim",
    ruleSnapshot: { type: "flat", category: "plumbing", externalRef: "SERVICE-1" },
    holds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  });
}

function challenge(
  delivery:
    | {
        mode: "preview";
        preview: { recipientMasked: string; message: string; code: string; expiresAt: string };
      }
    | { mode: "provider"; status: "queued" },
  channel: "sms" | "email" = "sms",
) {
  const receivedAt = Date.now();
  return otpChallengeResponseSchema.parse({
    id: ids.challenge,
    status: "pending",
    channel,
    maskedRecipient: channel === "sms" ? "***0101" : "j***@example.invalid",
    attempts: 0,
    attemptsRemaining: 5,
    expiresAt: new Date(receivedAt + 300_000).toISOString(),
    resendAfter: new Date(receivedAt - 1_000).toISOString(),
    delivery,
  });
}

function previewChallenge(code = "418205") {
  const previewExpiresAt = new Date(Date.now() + 300_000).toISOString();
  return challenge({
    mode: "preview",
    preview: {
      recipientMasked: "***0101",
      message: `Your referral claim verification code is ${code}.`,
      code,
      expiresAt: previewExpiresAt,
    },
  });
}

function verifiedChallengeState() {
  const source = previewChallenge();
  return otpChallengeStateSchema.parse({
    id: source.id,
    status: "verified",
    channel: source.channel,
    maskedRecipient: source.maskedRecipient,
    attempts: source.attempts,
    attemptsRemaining: source.attemptsRemaining,
    expiresAt: source.expiresAt,
    resendAfter: source.resendAfter,
  });
}

function claimResponse() {
  return claimSchema.parse({
    id: ids.claim,
    organizationId: ids.organization,
    partnerId: ids.partner,
    actorId: ids.partnerUser,
    amount: { amountMinor: "2500", currency: "USD" },
    status: "created",
    idempotencyKey: "claim-test-key",
    selectionHash: "selection-hash",
    items: [
      {
        id: ids.claimItem,
        organizationId: ids.organization,
        claimId: ids.claim,
        earningId: ids.earning,
        amount: { amountMinor: "2500", currency: "USD" },
      },
    ],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}

describe("ClaimFlow", () => {
  it("opens the free SMS preview, copies its code, verifies, then creates the claim", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const claimKeys: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    server.use(
      http.post("*/api/otp-challenges", () => {
        calls.push("challenge");
        return HttpResponse.json(previewChallenge());
      }),
      http.post("*/api/otp-challenges/:id/verify", async ({ request }) => {
        calls.push("verify");
        expect(await request.json()).toEqual({ code: "418205" });
        return HttpResponse.json(verifiedChallengeState());
      }),
      http.post("*/api/claims", ({ request }) => {
        calls.push("claim");
        claimKeys.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json(claimResponse());
      }),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));

    const drawer = await screen.findByRole("dialog", { name: "SMS preview" });
    expect(within(drawer).getByText("418205")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reopen SMS preview" })).not.toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Close SMS preview" }));
    await user.click(await screen.findByRole("button", { name: "Reopen SMS preview" }));
    const reopenedDrawer = await screen.findByRole("dialog", { name: "SMS preview" });
    expect(within(reopenedDrawer).getByText("418205")).toBeVisible();
    await user.click(within(reopenedDrawer).getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText(/code copied/i)).toBeVisible();
    expect(screen.getByLabelText("Verification code")).toHaveFocus();

    await user.type(screen.getByLabelText("Verification code"), "418205");
    await user.click(screen.getByRole("button", { name: "Confirm claim" }));

    expect(await screen.findByText(/claim created/i)).toBeVisible();
    expect(calls).toEqual(["challenge", "verify", "claim"]);
    expect(claimKeys[0]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("keeps exact bigint selected totals in the safe-area claim footer", async () => {
    const user = userEvent.setup();
    const first = earning({ amount: { amountMinor: "900719925474099301", currency: "USD" } });
    const second = earningViewSchema.parse({
      ...earning({
        id: "11111111-1111-4111-8111-000000000025",
        conversionItemId: "11111111-1111-4111-8111-000000000020",
        amount: { amountMinor: "9", currency: "USD" },
        ruleSnapshot: { type: "flat", category: "electrical", externalRef: "SERVICE-2" },
      }),
    });
    render(<ClaimFlow earnings={[first, second]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("checkbox", { name: /electrical referral SERVICE-2/i }));

    const footer = screen.getByTestId("claim-footer");
    expect(footer).toHaveClass("partner-claim-footer");
    expect(within(footer).getByText(/estimated selected earnings/i)).toBeVisible();
    expect(
      within(footer).getByText(/server confirms the actual payout after balance recovery/i),
    ).toBeVisible();
    expect(within(footer).getByText(/\$9,007,199,254,740,993\.10/)).toHaveAttribute(
      "data-amount-minor",
      "900719925474099310",
    );
  });

  it("routes email verification to the local Mailpit inbox without exposing a code", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/otp-challenges", () =>
        HttpResponse.json(challenge({ mode: "provider", status: "queued" }, "email")),
      ),
    );
    render(<ClaimFlow earnings={[earning()]} mailpitUrl="http://localhost:8025" />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("radio", { name: "Email" }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));

    expect(await screen.findByText(/email queued/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Mailpit inbox" })).toHaveAttribute(
      "href",
      "http://localhost:8025",
    );
    expect(screen.queryByRole("button", { name: "Reopen SMS preview" })).not.toBeInTheDocument();
    expect(screen.queryByText("418205")).not.toBeInTheDocument();
  });

  it("disables unavailable SMS and directs the partner to local email", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/otp-challenges", () =>
        HttpResponse.json(
          {
            status: "channel_unavailable",
            delivery: { mode: "disabled", status: "unavailable" },
          },
          { status: 503 },
        ),
      ),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/SMS is unavailable/i);
    expect(screen.getByRole("radio", { name: "SMS" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Email" })).toBeChecked();
    expect(screen.getByText(/use local email/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reopen SMS preview" })).not.toBeInTheDocument();
  });

  it("handles a disabled delivery response without pretending an SMS was queued", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/otp-challenges", () =>
        HttpResponse.json(
          otpChallengeResponseSchema.parse({
            ...previewChallenge(),
            delivery: { mode: "disabled", status: "unavailable" },
          }),
        ),
      ),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/SMS is unavailable/i);
    expect(screen.getByRole("radio", { name: "SMS" })).toBeDisabled();
    expect(screen.queryByText(/SMS queued for delivery/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen SMS preview" })).not.toBeInTheDocument();
  });

  it("shows provider queue status without leaking an OTP", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/otp-challenges", () =>
        HttpResponse.json(challenge({ mode: "provider", status: "queued" })),
      ),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));

    expect(await screen.findByText(/SMS queued for delivery/i)).toBeVisible();
    expect(screen.getByLabelText("Verification code")).toBeVisible();
    expect(
      within(screen.getByTestId("claim-footer")).getByRole("button", {
        name: "Confirm claim",
      }),
    ).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Confirm claim" })).toHaveLength(1);
    expect(document.body).not.toHaveTextContent("418205");
    expect(screen.queryByRole("button", { name: "Reopen SMS preview" })).not.toBeInTheDocument();
  });

  it("shows and enforces the server resend cooldown", async () => {
    const user = userEvent.setup();
    const futureResend = new Date(Date.now() + 45_000).toISOString();
    server.use(
      http.post("*/api/otp-challenges", () =>
        HttpResponse.json(
          otpChallengeResponseSchema.parse({
            ...challenge({ mode: "provider", status: "queued" }),
            resendAfter: futureResend,
          }),
        ),
      ),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));

    const resend = await screen.findByRole("button", { name: /new code available in/i });
    expect(resend).toBeDisabled();
    expect(screen.getByText(/server resend cooldown/i)).toBeVisible();
  });

  it("resends a pending challenge without creating a replacement", async () => {
    const user = userEvent.setup();
    let creates = 0;
    let resends = 0;
    server.use(
      http.post("*/api/otp-challenges", () => {
        creates += 1;
        return HttpResponse.json(challenge({ mode: "provider", status: "queued" }));
      }),
      http.post("*/api/otp-challenges/:id/resend", () => {
        resends += 1;
        return HttpResponse.json(challenge({ mode: "provider", status: "queued" }));
      }),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.click(await screen.findByRole("button", { name: "Request new code" }));

    expect(creates).toBe(1);
    expect(resends).toBe(1);
  });

  it("uses fresh issuance when a pending challenge expires while idle", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const serverNow = new Date("2026-09-16T05:00:00.000Z");
    const clientNow = new Date("2026-09-16T07:00:00.000Z");
    vi.setSystemTime(clientNow);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let creates = 0;
    let resends = 0;
    try {
      server.use(
        http.post("*/api/otp-challenges", () => {
          creates += 1;
          const response = challenge({ mode: "provider", status: "queued" });
          return HttpResponse.json(
            otpChallengeResponseSchema.parse({
              ...response,
              expiresAt:
                creates === 1
                  ? new Date(serverNow.getTime() + 1_000).toISOString()
                  : new Date(serverNow.getTime() + 300_000).toISOString(),
              resendAfter: new Date(serverNow.getTime() - 1_000).toISOString(),
            }),
            { headers: { Date: serverNow.toUTCString() } },
          );
        }),
        http.post("*/api/otp-challenges/:id/resend", () => {
          resends += 1;
          return HttpResponse.json(challenge({ mode: "provider", status: "queued" }));
        }),
      );
      render(<ClaimFlow earnings={[earning()]} />);

      await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
      await user.click(screen.getByRole("button", { name: "Verify claim" }));
      expect(await screen.findByRole("button", { name: "Request new code" })).toBeEnabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      await user.click(screen.getByRole("button", { name: "Request fresh code" }));
      expect(creates).toBe(2);
      expect(resends).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns a resend expiry race into fresh issuance and clears stale verification state", async () => {
    const user = userEvent.setup();
    let creates = 0;
    let resends = 0;
    server.use(
      http.post("*/api/otp-challenges", () => {
        creates += 1;
        return HttpResponse.json(previewChallenge(creates === 1 ? "123456" : "654321"));
      }),
      http.post("*/api/otp-challenges/:id/resend", () => {
        resends += 1;
        return HttpResponse.json({ status: "challenge_expired" }, { status: 410 });
      }),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.click(await screen.findByRole("button", { name: "Close SMS preview" }));
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Request new code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/code expired/i);
    expect(screen.getByLabelText("Verification code")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Reopen SMS preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "SMS preview" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Request fresh code" }));
    expect(
      within(await screen.findByRole("dialog", { name: "SMS preview" })).getByText("654321"),
    ).toBeVisible();
    expect(creates).toBe(2);
    expect(resends).toBe(1);
  });

  it("keeps a verified challenge for a stable-key claim retry without offering another code", async () => {
    const user = userEvent.setup();
    let verifies = 0;
    const claimKeys: string[] = [];
    server.use(
      http.post("*/api/otp-challenges", () =>
        HttpResponse.json(challenge({ mode: "provider", status: "queued" })),
      ),
      http.post("*/api/otp-challenges/:id/verify", () => {
        verifies += 1;
        return HttpResponse.json(verifiedChallengeState());
      }),
      http.post("*/api/claims", ({ request }) => {
        claimKeys.push(request.headers.get("Idempotency-Key") ?? "");
        return claimKeys.length === 1
          ? HttpResponse.json({ status: "request_failed" }, { status: 503 })
          : HttpResponse.json(claimResponse());
      }),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.type(screen.getByLabelText("Verification code"), "418205");
    await user.click(screen.getByRole("button", { name: "Confirm claim" }));

    expect(await screen.findByText(/code verified.*retry claim/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /request (new|fresh) code/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry claim" }));

    expect(await screen.findByText(/claim created/i)).toBeVisible();
    expect(verifies).toBe(1);
    expect(claimKeys).toHaveLength(2);
    expect(claimKeys[0]).toBe(claimKeys[1]);
  });

  it("reports invalid-code attempts without creating a claim", async () => {
    const user = userEvent.setup();
    let claims = 0;
    server.use(
      http.post("*/api/otp-challenges", () => HttpResponse.json(previewChallenge())),
      http.post("*/api/otp-challenges/:id/verify", () =>
        HttpResponse.json({ status: "invalid_code", attemptsRemaining: 4 }, { status: 400 }),
      ),
      http.post("*/api/claims", () => {
        claims += 1;
        return HttpResponse.json(claimResponse());
      }),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.click(await screen.findByRole("button", { name: "Close SMS preview" }));
    await user.type(screen.getByLabelText("Verification code"), "111111");
    await user.click(screen.getByRole("button", { name: "Confirm claim" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/4 attempts remaining/i);
    expect(claims).toBe(0);
  });

  it("replaces an expired challenge through fresh issuance and never resends it", async () => {
    const user = userEvent.setup();
    let creates = 0;
    let resends = 0;
    server.use(
      http.post("*/api/otp-challenges", () => {
        creates += 1;
        return HttpResponse.json(previewChallenge(creates === 1 ? "418205" : "777888"));
      }),
      http.post("*/api/otp-challenges/:id/verify", () =>
        HttpResponse.json({ status: "challenge_expired" }, { status: 410 }),
      ),
      http.post("*/api/otp-challenges/:id/resend", () => {
        resends += 1;
        return HttpResponse.json(previewChallenge("999999"));
      }),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.click(await screen.findByRole("button", { name: "Close SMS preview" }));
    await user.type(screen.getByLabelText("Verification code"), "418205");
    await user.click(screen.getByRole("button", { name: "Confirm claim" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/code expired/i);
    expect(screen.getByLabelText("Verification code")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Request fresh code" }));
    expect(
      within(await screen.findByRole("dialog", { name: "SMS preview" })).getByText("777888"),
    ).toBeVisible();
    expect(creates).toBe(2);
    expect(resends).toBe(0);
  });

  it("replaces a blocked challenge through fresh issuance and never resends it", async () => {
    const user = userEvent.setup();
    let creates = 0;
    let resends = 0;
    server.use(
      http.post("*/api/otp-challenges", () => {
        creates += 1;
        return HttpResponse.json(challenge({ mode: "provider", status: "queued" }));
      }),
      http.post("*/api/otp-challenges/:id/verify", () =>
        HttpResponse.json({ status: "challenge_blocked", attemptsRemaining: 0 }, { status: 400 }),
      ),
      http.post("*/api/otp-challenges/:id/resend", () => {
        resends += 1;
        return HttpResponse.json(challenge({ mode: "provider", status: "queued" }));
      }),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.type(screen.getByLabelText("Verification code"), "111111");
    await user.click(screen.getByRole("button", { name: "Confirm claim" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/code is blocked/i);
    expect(screen.getByLabelText("Verification code")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Request fresh code" }));
    await waitFor(() => {
      expect(creates).toBe(2);
    });
    expect(resends).toBe(0);
  });

  it("shows the issuance cooldown when a terminal challenge cannot be replaced yet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const clientNow = new Date("2026-09-16T07:00:00.000Z");
    vi.setSystemTime(clientNow);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const retryAt = new Date(now.getTime() + 2_000).toISOString();
    let creates = 0;
    let resends = 0;
    try {
      server.use(
        http.post("*/api/otp-challenges", () => {
          creates += 1;
          return creates === 1 || creates === 3
            ? HttpResponse.json(
                otpChallengeResponseSchema.parse({
                  ...challenge({ mode: "provider", status: "queued" }),
                  expiresAt: new Date(now.getTime() + 300_000).toISOString(),
                  resendAfter: new Date(now.getTime() - 1_000).toISOString(),
                }),
                { headers: { Date: now.toUTCString() } },
              )
            : HttpResponse.json(
                { status: "issuance_cooldown", resendAfter: retryAt },
                { status: 429, headers: { Date: now.toUTCString() } },
              );
        }),
        http.post("*/api/otp-challenges/:id/verify", () =>
          HttpResponse.json({ status: "challenge_expired" }, { status: 410 }),
        ),
        http.post("*/api/otp-challenges/:id/resend", () => {
          resends += 1;
          return HttpResponse.json(challenge({ mode: "provider", status: "queued" }));
        }),
      );
      render(<ClaimFlow earnings={[earning()]} />);

      await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
      await user.click(screen.getByRole("button", { name: "Verify claim" }));
      await user.type(screen.getByLabelText("Verification code"), "418205");
      await user.click(screen.getByRole("button", { name: "Confirm claim" }));
      await user.click(await screen.findByRole("button", { name: "Request fresh code" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/not ready yet/i);
      expect(screen.getByRole("button", { name: /fresh code available in 2s/i })).toBeDisabled();
      expect(screen.getByText(/server issuance cooldown/i)).toBeVisible();
      expect(creates).toBe(2);
      expect(resends).toBe(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(screen.getByRole("button", { name: "Request fresh code" })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "Request fresh code" }));
      expect(creates).toBe(3);
      expect(resends).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("locks channel controls to an active challenge", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/otp-challenges", () =>
        HttpResponse.json(challenge({ mode: "provider", status: "queued" })),
      ),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));

    expect(await screen.findByText(/channel locked to SMS/i)).toBeVisible();
    expect(screen.getByRole("radio", { name: "SMS" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Email" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Email" }));
    expect(screen.getByRole("radio", { name: "SMS" })).toBeChecked();
  });

  it("synchronously guards rapid confirm clicks and waits for the server before success", async () => {
    const user = userEvent.setup();
    const onClaimCreated = vi.fn();
    let verifyRequests = 0;
    let releaseVerify: (() => void) | undefined;
    let claimRequests = 0;
    let releaseClaim: (() => void) | undefined;
    server.use(
      http.post("*/api/otp-challenges", () => HttpResponse.json(previewChallenge())),
      http.post("*/api/otp-challenges/:id/verify", async () => {
        verifyRequests += 1;
        await new Promise<void>((resolve) => {
          releaseVerify = resolve;
        });
        return HttpResponse.json(verifiedChallengeState());
      }),
      http.post("*/api/claims", async () => {
        claimRequests += 1;
        await new Promise<void>((resolve) => {
          releaseClaim = resolve;
        });
        return HttpResponse.json(claimResponse());
      }),
    );
    render(<ClaimFlow earnings={[earning()]} onClaimCreated={onClaimCreated} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.click(await screen.findByRole("button", { name: "Close SMS preview" }));
    await user.type(screen.getByLabelText("Verification code"), "418205");
    const confirm = screen.getByRole("button", { name: "Confirm claim" });
    act(() => {
      confirm.click();
      confirm.click();
    });

    await waitFor(() => {
      expect(verifyRequests).toBe(1);
    });
    expect(confirm).toBeDisabled();
    expect(onClaimCreated).not.toHaveBeenCalled();
    releaseVerify?.();

    await waitFor(() => {
      expect(claimRequests).toBe(1);
    });
    expect(onClaimCreated).not.toHaveBeenCalled();
    expect(screen.queryByText(/claim created/i)).not.toBeInTheDocument();
    releaseClaim?.();

    expect(await screen.findByText(/claim created/i)).toBeVisible();
    expect(onClaimCreated).toHaveBeenCalledTimes(1);
  });

  it("synchronously guards rapid challenge creation", async () => {
    const user = userEvent.setup();
    let requests = 0;
    let release: (() => void) | undefined;
    server.use(
      http.post("*/api/otp-challenges", async () => {
        requests += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(challenge({ mode: "provider", status: "queued" }));
      }),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    const verify = screen.getByRole("button", { name: "Verify claim" });
    act(() => {
      verify.click();
      verify.click();
    });

    await waitFor(() => {
      expect(requests).toBe(1);
    });
    expect(screen.getByRole("button", { name: "Preparing verification…" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i })).toBeDisabled();
    release?.();
    expect(await screen.findByText(/SMS queued for delivery/i)).toBeVisible();
  });

  it("uses a fresh idempotency key for each completed claim flow", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    server.use(
      http.post("*/api/otp-challenges", () =>
        HttpResponse.json(challenge({ mode: "provider", status: "queued" })),
      ),
      http.post("*/api/otp-challenges/:id/verify", () =>
        HttpResponse.json(verifiedChallengeState()),
      ),
      http.post("*/api/claims", ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json(claimResponse());
      }),
    );
    render(<ClaimFlow earnings={[earning()]} />);

    for (let flow = 0; flow < 2; flow += 1) {
      await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
      await user.click(screen.getByRole("button", { name: "Verify claim" }));
      await user.type(await screen.findByLabelText("Verification code"), "418205");
      await user.click(screen.getByRole("button", { name: "Confirm claim" }));
      expect(await screen.findByText(/claim created/i)).toBeVisible();
    }

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(keys[1]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("announces a server-created claim before background revalidation finishes", async () => {
    const user = userEvent.setup();
    let releaseRefresh: (() => void) | undefined;
    const onClaimCreated = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseRefresh = resolve;
        }),
    );
    server.use(
      http.post("*/api/otp-challenges", () =>
        HttpResponse.json(challenge({ mode: "provider", status: "queued" })),
      ),
      http.post("*/api/otp-challenges/:id/verify", () =>
        HttpResponse.json(verifiedChallengeState()),
      ),
      http.post("*/api/claims", () => HttpResponse.json(claimResponse())),
    );
    render(<ClaimFlow earnings={[earning()]} onClaimCreated={onClaimCreated} />);

    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.type(await screen.findByLabelText("Verification code"), "418205");
    await user.click(screen.getByRole("button", { name: "Confirm claim" }));

    expect(await screen.findByText(/claim created/i)).toBeVisible();
    expect(onClaimCreated).toHaveBeenCalledTimes(1);
    releaseRefresh?.();
  });
});
