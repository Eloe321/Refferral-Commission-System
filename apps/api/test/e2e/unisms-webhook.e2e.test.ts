import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { request as httpRequest, type Server as HttpServer } from "node:http";
import { createDatabaseClient, NORTHSTAR_IDS } from "../../../../packages/database/src/index.js";
import { createApiTestApp, type ApiTestApp } from "../support/http.js";

describe("UniSMS webhook", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;
  let port: number;
  let outboxId: string;

  beforeAll(async () => {
    app = await createApiTestApp({
      deliveryEnv: {
        UNISMS_WEBHOOK_SECRET: "test-webhook-secret",
        UNISMS_WEBHOOK_BODY_LIMIT_BYTES: 512,
      },
    });
    db = createDatabaseClient(app.databaseUrl, { max: 2 });
    await app.app.listen(0, "127.0.0.1");
    const address = (app.server as HttpServer).address();
    if (!address || typeof address === "string") throw new Error("Missing webhook test port");
    port = address.port;
  });

  afterAll(async () => {
    await db.sql.end();
    await app.close();
  });

  beforeEach(async () => {
    await db.sql`delete from notification_webhook_events`;
    await db.sql`delete from notification_outbox where provider='unisms'`;
    const [row] = await db.sql<{ id: string }[]>`insert into notification_outbox
      (organization_id,dedupe_key,channel,provider,status,recipient,content,provider_reference)
      values (${NORTHSTAR_IDS.organization},${crypto.randomUUID()},'sms','unisms','processing','+12025550120','Code 123456','msg-provider-1') returning id`;
    if (!row) throw new Error("Missing webhook outbox fixture");
    outboxId = row.id;
  });

  function webhookPayload() {
    return {
      id: "msg-provider-1",
      message: {
        status: "sent",
        metadata: { outbox_id: outboxId },
        content: "Code 123456",
        created: "2026-09-16T00:00:00Z",
        reference_id: "msg-provider-1",
        recipient: "+12025550120",
        fail_reason: null,
      },
      event: "message.sent",
    };
  }

  function post(body: object = webhookPayload()) {
    return app.request
      .post("/webhooks/unisms")
      .set("webhook-secret-key", "test-webhook-secret")
      .set("webhook-id", "delivery-1")
      .send(body);
  }

  function postChunked(rawBody: string, webhookId: string) {
    return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/webhooks/unisms",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "webhook-id": webhookId,
            "webhook-secret-key": "test-webhook-secret",
            "transfer-encoding": "chunked",
          },
        },
        (response) => {
          let responseBody = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            responseBody += chunk;
          });
          response.on("end", () => {
            let body: unknown = responseBody;
            try {
              body = JSON.parse(responseBody) as unknown;
            } catch {
              // Keep non-JSON framework errors opaque to the assertion below.
            }
            resolve({ status: response.statusCode ?? 0, body });
          });
        },
      );
      request.on("error", reject);
      const midpoint = Math.floor(rawBody.length / 2);
      request.write(rawBody.slice(0, midpoint));
      request.end(rawBody.slice(midpoint));
    });
  }

  it("uses webhook-id for transactional dedupe and never echoes private payload data", async () => {
    expect((await post().expect(200)).body).toEqual({ status: "processed" });
    expect((await post().expect(200)).body).toEqual({ status: "duplicate" });
    expect(
      await db.sql`select provider_event_id,event_type from notification_webhook_events`,
    ).toEqual([{ provider_event_id: "delivery-1", event_type: "message.sent" }]);
    expect(await db.sql`select status,recipient,content from notification_outbox`).toContainEqual({
      status: "sent",
      recipient: "***0120",
      content: null,
    });
  });

  it("uses validated outbox metadata to apply an early event before reference persistence", async () => {
    await db.sql`update notification_outbox set provider_reference=null where id=${outboxId}`;

    expect((await post().expect(200)).body).toEqual({ status: "processed" });
    expect(
      await db.sql`select status,provider_reference,recipient,content from notification_outbox where id=${outboxId}`,
    ).toEqual([
      {
        status: "sent",
        provider_reference: "msg-provider-1",
        recipient: "***0120",
        content: null,
      },
    ]);
  });

  it.each([
    ["message.failed", "failed"],
    ["message.retrying", "retrying"],
  ] as const)("accepts %s and records the matching provider status", async (event, status) => {
    const response = await post({
      ...webhookPayload(),
      event,
      message: { ...webhookPayload().message, status },
    }).expect(200);
    expect(response.body).toEqual({ status: "processed" });
  });

  it("rejects missing identity, wrong secrets, unsupported events, and mismatched references", async () => {
    await app.request
      .post("/webhooks/unisms")
      .set("webhook-secret-key", "test-webhook-secret")
      .send(webhookPayload())
      .expect(400);
    await app.request
      .post("/webhooks/unisms")
      .set("webhook-id", "delivery-wrong-secret")
      .set("webhook-secret-key", "wrong-secret")
      .send(webhookPayload())
      .expect(401);
    await post({ ...webhookPayload(), event: "message.pending" }).expect(400);
    await post({ ...webhookPayload(), id: "different-message" }).expect(400);
    await post({
      ...webhookPayload(),
      message: { ...webhookPayload().message, status: "failed" },
    }).expect(400);
    await post({
      ...webhookPayload(),
      message: { ...webhookPayload().message, metadata: { outbox_id: "not-a-uuid" } },
    }).expect(400);
    expect(await db.sql`select id from notification_webhook_events`).toHaveLength(0);
  });

  it("rejects webhook bodies larger than the configured limit", async () => {
    await post({
      ...webhookPayload(),
      message: { ...webhookPayload().message, metadata: { padding: "x".repeat(600) } },
    }).expect(413);
    expect(await db.sql`select id from notification_webhook_events`).toHaveLength(0);
  });

  it("enforces the raw-byte limit while streaming chunked JSON without Content-Length", async () => {
    const serialized = JSON.stringify(webhookPayload());
    const oversized = `${" ".repeat(513 - Buffer.byteLength(serialized))}${serialized}`;
    const accepted = `${" ".repeat(511 - Buffer.byteLength(serialized))}${serialized}`;
    expect(Buffer.byteLength(oversized)).toBe(513);
    expect(Buffer.byteLength(accepted)).toBe(511);

    expect(await postChunked(oversized, "delivery-chunked-over")).toMatchObject({ status: 413 });
    expect(await postChunked(accepted, "delivery-chunked-under")).toEqual({
      status: 200,
      body: { status: "processed" },
    });
    expect(
      await db.sql`select provider_event_id from notification_webhook_events order by provider_event_id`,
    ).toEqual([{ provider_event_id: "delivery-chunked-under" }]);
  });
});
