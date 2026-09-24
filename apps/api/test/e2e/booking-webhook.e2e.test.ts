import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, NORTHSTAR_IDS } from "../../../../packages/database/src/index.js";
import {
  bookingWebhookEventListSchema,
  conversionSchema,
  earningListSchema,
} from "@referral-sandbox/contracts";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";

const secret = "fictional-booking-webhook-secret-for-tests";

describe("signed booking completion webhook", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;

  beforeAll(async () => {
    app = await createApiTestApp({ deliveryEnv: {
      BOOKING_WEBHOOK_SECRET: secret,
      EMAIL_DELIVERY_MODE: "mailpit",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
    } });
    db = createDatabaseClient(app.databaseUrl, { max: 2 });
  });

  afterAll(async () => {
    await db.sql.end();
    await app.close();
  });

  async function createBooking(reference: string) {
    const owner = await ownerAgent(app);
    const created = await owner
      .post("/conversions")
      .send({
        idempotencyKey: `booking-${reference}`,
        externalRef: reference,
        programId: NORTHSTAR_IDS.program,
        referralCode: "JAMIE12",
        currency: "USD",
        items: [{ externalRef: `${reference}-service`, category: "plumbing", grossAmountMinor: "18000" }],
      })
      .expect(201);
    return { owner, conversionId: conversionSchema.parse(created.body).id };
  }

  function event(id: string, bookingRef: string): {
    id: string;
    type: "service.completed";
    programId: string;
    bookingRef: string;
    occurredAt: string;
  } {
    return {
      id,
      type: "service.completed",
      programId: NORTHSTAR_IDS.program,
      bookingRef,
      occurredAt: new Date().toISOString(),
    };
  }

  function signedPost(payload: ReturnType<typeof event>, overrideSignature?: string) {
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    return app.request
      .post("/webhooks/bookings")
      .set("Content-Type", "application/json")
      .set("X-Booking-Timestamp", timestamp)
      .set("X-Booking-Signature", `sha256=${overrideSignature ?? signature}`)
      .send(raw);
  }

  it("rejects forged events without recording them", async () => {
    await signedPost(event("forged-1", "BOOKING-FORGED"), "0".repeat(64)).expect(401);
    const events = await db.sql`select id from booking_webhook_events where provider_event_id='forged-1'`;
    expect(events).toHaveLength(0);
  });

  it("rejects expired signatures and conflicting reuse of an event identity", async () => {
    const stalePayload = event("stale-1", "BOOKING-STALE");
    const raw = JSON.stringify(stalePayload);
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    await app.request.post("/webhooks/bookings")
      .set("Content-Type", "application/json")
      .set("X-Booking-Timestamp", timestamp)
      .set("X-Booking-Signature", `sha256=${signature}`)
      .send(raw).expect(401);
    expect(await db.sql`select id from booking_webhook_events where provider_event_id='stale-1'`).toHaveLength(0);

    const first = event("identity-1", "BOOKING-NOT-THERE");
    await signedPost(first).expect(200);
    await signedPost({ ...first, bookingRef: "DIFFERENT-BOOKING" }).expect(409);
  });

  it("rejects a signed event for an unknown program without a database error", async () => {
    const payload = { ...event("unknown-program-1", "BOOKING-UNKNOWN"), programId: crypto.randomUUID() };
    await signedPost(payload).expect(404);
    expect(await db.sql`select id from booking_webhook_events where provider_event_id='unknown-program-1'`).toHaveLength(0);
  });

  it("makes a booked referral eligible once and records system provenance", async () => {
    const { owner, conversionId } = await createBooking("BOOKING-COMPLETE-1");
    const payload = event("completed-1", "BOOKING-COMPLETE-1");

    expect((await signedPost(payload).expect(200)).body).toEqual({ status: "processed" });
    expect((await signedPost(payload).expect(200)).body).toEqual({ status: "duplicate" });
    expect((await signedPost(event("completed-2", "BOOKING-COMPLETE-1")).expect(200)).body).toEqual({
      status: "ignored",
    });

    const earnings = await owner.get(`/earnings?conversionId=${conversionId}`).expect(200);
    expect(earningListSchema.parse(earnings.body).items).toMatchObject([{ status: "eligible", amount: { amountMinor: "2500" } }]);
    const audits = await db.sql`
      select actor_id,is_system_event,action,reason from audit_events
      where aggregate_id=${conversionId} and action='conversion.completed'`;
    expect(audits).toEqual([
      {
        actor_id: null,
        is_system_event: true,
        action: "conversion.completed",
        reason: "Signed service completion event accepted",
      },
    ]);
    expect(await db.sql`select provider_event_id,status from booking_webhook_events order by provider_event_id`).toContainEqual({
      provider_event_id: "completed-1",
      status: "processed",
    });
    const [confirmation] = await db.sql`select dedupe_key,status,channel,provider from notification_outbox
      where dedupe_key like 'booking-completed:%'`;
    expect(confirmation).toMatchObject({ status: "pending", channel: "email", provider: "mailpit" });
    expect(await db.sql`select action from audit_events where aggregate_id=${conversionId} and action='partner.confirmation.queued'`).toEqual([
      { action: "partner.confirmation.queued" },
    ]);
    const eventHistory = bookingWebhookEventListSchema.parse((await owner.get("/webhooks/bookings/events").expect(200)).body);
    expect(eventHistory.items.find((item) => item.providerEventId === "completed-1")?.confirmationStatus).toBe("pending");
  });

  it("shows an unknown booking as failed and lets an owner retry after the booking exists", async () => {
    const payload = event("early-1", "BOOKING-LATE-1");
    expect((await signedPost(payload).expect(200)).body).toEqual({ status: "failed" });
    const { owner, conversionId } = await createBooking("BOOKING-LATE-1");

    const listed = await owner.get("/webhooks/bookings/events").expect(200);
    expect(bookingWebhookEventListSchema.parse(listed.body).items).toContainEqual(
      expect.objectContaining({ providerEventId: "early-1", status: "failed", failureCode: "booking_not_found" }),
    );
    expect((await owner.post("/webhooks/bookings/events/early-1/retry").send({}).expect(201)).body).toEqual({
      status: "processed",
    });
    expect(earningListSchema.parse((await owner.get(`/earnings?conversionId=${conversionId}`).expect(200)).body).items[0]?.status).toBe(
      "eligible",
    );
    expect(await db.sql`select status,attempts from booking_webhook_events where provider_event_id='early-1'`).toEqual([
      { status: "processed", attempts: 2 },
    ]);
  });
  it("keeps event history and retry controls owner-only", async () => {
    const partner = await partnerAgent(app);
    await partner.get("/webhooks/bookings/events").expect(403);
    await partner.post("/webhooks/bookings/events/early-1/retry").send({}).expect(403);
    await partner.post(`/webhooks/bookings/demo/${crypto.randomUUID()}/complete`).send({}).expect(403);
  });
});
