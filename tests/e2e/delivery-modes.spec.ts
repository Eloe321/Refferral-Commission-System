import { expect, test, type Page } from "@playwright/test";
import { NORTHSTAR_IDS as ids } from "../../packages/database/src/index.js";

import {
  createIsolatedDeliveryApi,
  type IsolatedDeliveryApi,
  type DeliveryMode,
} from "./support/isolated-delivery-api.js";

type BrowserResponse = Readonly<{ status: number; body: Record<string, unknown> }>;

async function preparePartnerSelection(page: Page, api: IsolatedDeliveryApi): Promise<void> {
  await page.route("**/*", async (route) => {
    if (route.request().url().startsWith(api.origin)) await route.continue();
    else await route.abort("blockedbyclient");
  });
  await page.goto(`${api.origin}/health`);
  const result = await page.evaluate(
    async ({ ownerId, partnerId, conversionId }) => {
      const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
        const response = await fetch(path, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        });
        return response.status;
      };
      const ownerSession = await post("/demo/session", { role: "owner", actorId: ownerId });
      const completed = await post(
        `/conversions/${conversionId}/complete`,
        {},
        { "Idempotency-Key": "delivery-browser-complete" },
      );
      const partnerSession = await post("/demo/session", { role: "partner", actorId: partnerId });
      return { ownerSession, completed, partnerSession };
    },
    {
      ownerId: ids.ownerUser,
      partnerId: ids.partnerUsers.jamie,
      conversionId: ids.conversions.scheduled,
    },
  );
  expect(result).toEqual({ ownerSession: 201, completed: 201, partnerSession: 201 });
}

async function issueSms(page: Page): Promise<BrowserResponse> {
  return page.evaluate(
    async (earningIds) => {
      const response = await fetch("/otp-challenges", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ earningIds, channel: "sms" }),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    },
    [ids.earnings.scheduledPlumbing, ids.earnings.scheduledElectrical],
  );
}

async function withMode(
  page: Page,
  mode: DeliveryMode,
  run: (api: IsolatedDeliveryApi) => Promise<void>,
): Promise<void> {
  const api = await createIsolatedDeliveryApi(mode);
  try {
    await preparePartnerSelection(page, api);
    await run(api);
  } finally {
    await api.close();
  }
}

test.describe.configure({ mode: "serial" });

test("preview returns the local code without attempting a provider request", async ({ page }) => {
  await withMode(page, "preview", async (api) => {
    const response = await issueSms(page);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ delivery: { mode: "preview" } });
    expect(JSON.stringify(response.body)).toMatch(/"code":"\d{6}"/);
    const state = await api.state();
    expect(state.providerCalls).toHaveLength(0);
    expect(state.outbox).toEqual([
      expect.objectContaining({
        provider: "preview",
        status: "previewed",
        recipient: "***0101",
        content: null,
      }),
    ]);
  });
});

test("disabled SMS fails closed without a challenge, outbox row, or network", async ({ page }) => {
  await withMode(page, "disabled", async (api) => {
    const response = await issueSms(page);
    expect(response).toEqual({
      status: 503,
      body: {
        status: "channel_unavailable",
        delivery: { mode: "disabled", status: "unavailable" },
      },
    });
    const state = await api.state();
    expect(state.providerCalls).toHaveLength(0);
    expect(state.challengeCount).toBe(0);
    expect(state.outbox).toHaveLength(0);
    const worker = await api.runWorker();
    expect(worker).toMatchObject({ count: 0, state: { providerCalls: [], outbox: [] } });
  });
});

test("mocked UniSMS receives one documented request while the browser receives no code", async ({
  page,
}) => {
  await withMode(page, "unisms", async (api) => {
    const response = await issueSms(page);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ delivery: { mode: "provider", status: "queued" } });
    const browserPayload = JSON.stringify(response.body);
    expect(browserPayload).not.toMatch(/"(code|content|message)":/);
    const challengeId = String(response.body.id);
    expect(challengeId).toMatch(/^[0-9a-f-]{36}$/i);

    const firstRun = await api.runWorker();
    expect(firstRun.count).toBe(1);
    expect(firstRun.state.providerCalls).toHaveLength(1);
    const call = firstRun.state.providerCalls[0];
    expect(call).toMatchObject({
      url: "https://unismsapi.com/api/sms",
      method: "POST",
      authorization: `Basic ${Buffer.from("fictional-browser-e2e-key:").toString("base64")}`,
      contentType: "application/json",
      body: {
        recipient: "+12025550101",
        sender_id: "NORTHSTAR",
        metadata: { outbox_id: expect.any(String), dedupe_key: expect.any(String) },
      },
    });
    const providerBody = call?.body as { content?: string };
    const deliveredCode = providerBody.content?.match(/\d{6}/)?.[0];
    if (!deliveredCode) throw new Error("Mocked UniSMS request did not contain an OTP");
    expect(deliveredCode).toMatch(/^\d{6}$/);
    expect(providerBody.content).toContain(`verification code is ${deliveredCode}`);
    expect(call?.body).toMatchObject({
      metadata: {
        outbox_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        dedupe_key: expect.stringMatching(new RegExp(`^otp:${challengeId}:[0-9a-f-]{36}$`, "i")),
      },
    });
    expect(browserPayload).not.toContain(deliveredCode);

    const secondRun = await api.runWorker();
    expect(secondRun.count).toBe(0);
    expect(secondRun.state.providerCalls).toHaveLength(1);
    expect(secondRun.state.outbox).toEqual([
      {
        provider: "unisms",
        status: "sent",
        recipient: "***0101",
        content: null,
        providerReference: "e2e-sms-ref-1",
      },
    ]);
  });
});
