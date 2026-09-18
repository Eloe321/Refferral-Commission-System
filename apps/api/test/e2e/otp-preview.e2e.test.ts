import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NORTHSTAR_IDS as ids,
  createDatabaseClient,
} from "../../../../packages/database/src/index.js";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";
import {
  otpChallengeResponseSchema,
  conversionSchema,
  earningListSchema,
} from "@referral-sandbox/contracts";
import { createClaimDraftHash } from "../../src/domain/claim-draft.js";
import { OtpPolicy, OtpService } from "../../src/otp/otp.service.js";
import { createSessionCookie } from "../../src/auth/sandbox-session.guard.js";
import { NotificationsService } from "../../src/notifications/notifications.service.js";
import { OutboxRepository } from "../../src/notifications/outbox.repository.js";

describe("OTP secure preview", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;
  let owner: Awaited<ReturnType<typeof ownerAgent>>;
  let partner: Awaited<ReturnType<typeof partnerAgent>>;
  const selection = [ids.earnings.scheduledPlumbing, ids.earnings.scheduledElectrical];
  let now = new Date();
  beforeAll(async () => {
    app = await createApiTestApp();
    db = createDatabaseClient(app.databaseUrl);
    vi.spyOn(app.app.get(OtpPolicy), "now").mockImplementation(() => now);
    owner = await ownerAgent(app);
    partner = await partnerAgent(app);
    await owner
      .post(`/conversions/${ids.conversions.scheduled}/complete`)
      .set("Idempotency-Key", "otp-complete-seeded")
      .expect(201);
  });
  beforeEach(() => {
    now = new Date(now.getTime() + 600_000);
  });
  afterAll(async () => {
    await db.sql.end();
    await app.close();
  });
  const create = () =>
    partner.post("/otp/challenges").send({ earningIds: selection, channel: "sms" });
  it("creates and verifies a preview through the approved hyphenated route", async () => {
    const challenge = otpChallengeResponseSchema.parse(
      (
        await partner
          .post("/otp-challenges")
          .send({ earningIds: selection, channel: "sms" })
          .expect(201)
      ).body,
    );
    if (challenge.delivery.mode !== "preview") throw new Error("Expected preview");
    await partner
      .post(`/otp-challenges/${challenge.id}/verify`)
      .send({ code: challenge.delivery.preview.code })
      .expect(201)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({ id: challenge.id, status: "verified" });
      });
  });
  it("accepts an uppercase challenge path with its original code without consuming an attempt", async () => {
    const challenge = otpChallengeResponseSchema.parse((await create().expect(201)).body);
    if (challenge.delivery.mode !== "preview") throw new Error("Expected preview");
    expect(challenge.id.toUpperCase()).not.toBe(challenge.id);
    await partner
      .post(`/otp/challenges/${challenge.id.toUpperCase()}/verify`)
      .send({ code: challenge.delivery.preview.code })
      .expect(201)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({
          id: challenge.id,
          attempts: 0,
          attemptsRemaining: 5,
          status: "verified",
        });
      });
    const [row] = await db.sql`select attempts,status from otp_challenges where id=${challenge.id}`;
    expect(row).toEqual({ attempts: 0, status: "verified" });
  });
  it("resends through uppercase paths using the canonical challenge identity throughout", async () => {
    const challenge = otpChallengeResponseSchema.parse((await create().expect(201)).body);
    if (challenge.delivery.mode !== "preview") throw new Error("Expected preview");
    await db.sql`update otp_challenges set created_at=created_at-interval '2 minutes',resend_after=resend_after-interval '2 minutes' where id=${challenge.id}`;
    const resent = otpChallengeResponseSchema.parse(
      (
        await partner
          .post(`/otp/challenges/${challenge.id.toUpperCase()}/resend`)
          .send({})
          .expect(201)
      ).body,
    );
    if (resent.delivery.mode !== "preview") throw new Error("Expected preview");
    expect(resent.id).toBe(challenge.id);
    await partner
      .post(`/otp/challenges/${resent.id}/verify`)
      .send({ code: challenge.delivery.preview.code })
      .expect(400);
    await partner
      .post(`/otp/challenges/${resent.id}/verify`)
      .send({ code: resent.delivery.preview.code })
      .expect(201);
    const outbox = await db.sql<
      { dedupe_key: string; otp_challenge_id: string }[]
    >`select dedupe_key,otp_challenge_id from notification_outbox where otp_challenge_id=${challenge.id}`;
    expect(outbox).toHaveLength(2);
    for (const row of outbox) {
      expect(row.otp_challenge_id).toBe(challenge.id);
      expect(row.dedupe_key).toMatch(new RegExp(`^otp:${challenge.id}:`));
    }
    const audit =
      await db.sql`select aggregate_id,metadata from audit_events where aggregate_id=${challenge.id}`;
    for (const row of audit)
      expect(row).toMatchObject({
        aggregate_id: challenge.id,
        metadata: { challengeId: challenge.id },
      });
  });
  it("binds uppercase earning selections to database identities and rejects mixed-case duplicates atomically", async () => {
    const ref = crypto.randomUUID();
    const conversion = conversionSchema.parse(
      (
        await owner
          .post("/conversions")
          .send({
            idempotencyKey: ref,
            externalRef: ref,
            programId: ids.program,
            referralCode: "JAMIE12",
            currency: "USD",
            items: [{ externalRef: ref, category: "plumbing", grossAmountMinor: "10000" }],
          })
          .expect(201)
      ).body,
    );
    await owner
      .post(`/conversions/${conversion.id}/complete`)
      .set("Idempotency-Key", `complete-${ref}`)
      .expect(201);
    const earning = earningListSchema.parse(
      (await partner.get(`/earnings?conversionId=${conversion.id}`).expect(200)).body,
    ).items[0];
    if (!earning) throw new Error("Missing fixture earning");
    expect(earning.id.toUpperCase()).not.toBe(earning.id);
    const challenge = otpChallengeResponseSchema.parse(
      (
        await partner
          .post("/otp/challenges")
          .send({ earningIds: [earning.id.toUpperCase()], channel: "sms" })
          .expect(201)
      ).body,
    );
    if (challenge.delivery.mode !== "preview") throw new Error("Expected preview");
    const actor = {
      organizationId: ids.organization,
      actorId: ids.partnerUsers.jamie,
      partnerId: ids.partners.jamie,
      role: "partner" as const,
      displayName: "Jamie",
      sandboxVersion: 1,
    };
    const expectedHash = createClaimDraftHash({
      ...actor,
      earningIds: [earning.id],
      amountMinor: earning.amount.amountMinor,
      currency: earning.amount.currency,
    });
    const [row] =
      await db.sql`select claim_draft_hash from otp_challenges where id=${challenge.id}`;
    expect(row?.claim_draft_hash).toBe(expectedHash);
    await expect(
      app.app
        .get(OtpService)
        .verify(actor, challenge.id, challenge.delivery.preview.code, expectedHash),
    ).resolves.toMatchObject({ status: "verified", attempts: 0 });
    const before =
      await db.sql`select (select count(*)::int from otp_challenges) challenges,(select count(*)::int from notification_outbox) outbox,(select count(*)::int from audit_events) audit`;
    await partner
      .post("/otp/challenges")
      .send({ earningIds: [earning.id, earning.id.toUpperCase()], channel: "sms" })
      .expect(400);
    expect(
      await db.sql`select (select count(*)::int from otp_challenges) challenges,(select count(*)::int from notification_outbox) outbox,(select count(*)::int from audit_events) audit`,
    ).toEqual(before);
  });
  it("returns a one-time masked preview, persists only a digest and redacted outbox, verifies once", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      const response = await create().expect(201);
      const body = response.body as {
        id: string;
        delivery: { mode: string; preview: { code: string; recipientMasked: string } };
      };
      expect(body.delivery.mode).toBe("preview");
      expect(body.delivery.preview.code).toMatch(/^\d{6}$/);
      const [contact] = await db.sql<
        { phone_e164: string }[]
      >`select phone_e164 from partners where id=${ids.partners.jamie}`;
      expect(JSON.stringify(body)).not.toContain(contact?.phone_e164);
      const [row] = await db.sql`select * from otp_challenges where id=${body.id}`;
      expect(row?.code_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(row).not.toHaveProperty("code");
      const [outbox] =
        await db.sql`select * from notification_outbox where otp_challenge_id=${body.id}`;
      expect(outbox).toMatchObject({
        status: "previewed",
        content: null,
        recipient: body.delivery.preview.recipientMasked,
      });
      const audit = await db.sql`select metadata from audit_events where aggregate_id=${body.id}`;
      expect(audit).toMatchObject([{ metadata: { channel: "sms", challengeId: body.id } }]);
      await partner
        .post(`/otp/challenges/${body.id}/verify`)
        .send({ code: body.delivery.preview.code })
        .expect(201)
        .expect(({ body: verified }: { body: Record<string, unknown> }) => {
          expect(verified).toMatchObject({ status: "verified" });
          expect(verified).not.toHaveProperty("delivery");
        });
      await partner
        .post(`/otp/challenges/${body.id}/verify`)
        .send({ code: body.delivery.preview.code })
        .expect(409);
      await partner.get(`/otp/challenges/${body.id}`).expect(404);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it("atomically counts wrong attempts and blocks the fifth under concurrency", async () => {
    const { body } = (await create().expect(201)) as {
      body: { id: string; delivery: { preview: { code: string } } };
    };
    const wrong = body.delivery.preview.code === "000000" ? "111111" : "000000";
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        partner.post(`/otp/challenges/${body.id}/verify`).send({ code: wrong }),
      ),
    );
    expect(
      responses.map((r) => (r.body as { attemptsRemaining: number }).attemptsRemaining).sort(),
    ).toEqual([0, 1, 2, 3, 4]);
    const [row] = await db.sql`select status,attempts from otp_challenges where id=${body.id}`;
    expect(row).toEqual({ status: "blocked", attempts: 5 });
    await partner
      .post(`/otp/challenges/${body.id}/verify`)
      .send({ code: body.delivery.preview.code })
      .expect(409);
  });
  it("enforces cooldown, rotates old code, checks expiry and rejects malformed requests", async () => {
    const { body } = (await create().expect(201)) as {
      body: { id: string; delivery: { preview: { code: string } } };
    };
    await partner.post(`/otp/challenges/${body.id}/resend`).send({}).expect(429);
    const wrong = body.delivery.preview.code === "000000" ? "111111" : "000000";
    await partner.post(`/otp/challenges/${body.id}/verify`).send({ code: wrong }).expect(400);
    await db.sql`update otp_challenges set created_at=created_at-interval '2 minutes',resend_after=resend_after-interval '2 minutes' where id=${body.id}`;
    const resend = await partner.post(`/otp/challenges/${body.id}/resend`).send({}).expect(201);
    expect((resend.body as { delivery: { mode: string } }).delivery.mode).toBe("preview");
    expect(resend.body).toMatchObject({ attempts: 0, attemptsRemaining: 5 });
    expect(
      await db.sql`select id from audit_events where aggregate_id=${body.id} and action='otp.resent'`,
    ).toHaveLength(1);
    await partner
      .post(`/otp/challenges/${body.id}/verify`)
      .send({ code: body.delivery.preview.code })
      .expect(400);
    await db.sql`update otp_challenges set created_at=created_at-interval '10 minutes',expires_at=expires_at-interval '10 minutes',resend_after=resend_after-interval '10 minutes' where id=${body.id}`;
    await partner.post(`/otp/challenges/${body.id}/verify`).send({ code: "123456" }).expect(410);
    await partner.post("/otp/challenges/not-uuid/verify").send({ code: "123456" }).expect(400);
    for (const input of [{ code: "123" }, { code: 123456 }, { code: "123456", amount: "1" }])
      await partner.post(`/otp/challenges/${body.id}/verify`).send(input).expect(400);
  });
  it("rejects owner, foreign partner, held, mixed currency and duplicate selections without writes", async () => {
    const before = await db.sql`select id from otp_challenges order by id`;
    await owner.post("/otp/challenges").send({ earningIds: selection, channel: "sms" }).expect(403);
    for (const earningIds of [
      [selection[0], selection[0]],
      [ids.earnings.held],
      [ids.earnings.eligible],
      [crypto.randomUUID()],
      [],
    ])
      await partner
        .post("/otp/challenges")
        .send({ earningIds, channel: "sms" })
        .expect((r) => {
          expect([400, 404, 409]).toContain(r.status);
        });
    await db.sql`update earnings set currency='PHP' where id=${selection[0] ?? ""}`;
    await create().expect(409);
    await db.sql`update earnings set currency='USD' where id=${selection[0] ?? ""}`;
    expect(await db.sql`select id from otp_challenges order by id`).toEqual(before);
  });
  it("rejects overflow and unexpected delivery failures atomically with neutral errors", async () => {
    const before = await db.sql`select id from otp_challenges order by id`;
    const beforeOutbox = await db.sql`select id from notification_outbox order by id`;
    const beforeAudit = await db.sql`select id from audit_events order by id`;
    const [original] = await db.sql<
      { amount: string }[]
    >`select amount_minor::text amount from earnings where id=${ids.earnings.scheduledPlumbing}`;
    if (!original) throw new Error("Missing fixture");
    await db.sql`update earnings set amount_minor=9223372036854775807 where id=${ids.earnings.scheduledPlumbing}`;
    await create().expect(409).expect({ status: "invalid_claim_total" });
    await db.sql`update earnings set amount_minor=${original.amount} where id=${ids.earnings.scheduledPlumbing}`;
    const queue = vi
      .spyOn(app.app.get(NotificationsService), "queue")
      .mockRejectedValue(new Error("Sensitive provider failure"));
    try {
      await create().expect(500).expect({ status: "internal_error" });
    } finally {
      queue.mockRestore();
    }
    expect(await db.sql`select id from otp_challenges order by id`).toEqual(before);
    expect(await db.sql`select id from notification_outbox order by id`).toEqual(beforeOutbox);
    expect(await db.sql`select id from audit_events order by id`).toEqual(beforeAudit);
  });
  it("binds actor, partner and recomputed draft, rejects suspended sessions, and serializes correct verification", async () => {
    const body = otpChallengeResponseSchema.parse((await create().expect(201)).body);
    if (body.delivery.mode !== "preview") throw new Error("Expected preview");
    const actor = {
      organizationId: ids.organization,
      actorId: ids.partnerUsers.jamie,
      partnerId: ids.partners.jamie,
      role: "partner" as const,
      displayName: "Jamie",
      sandboxVersion: 1,
    };
    const service = app.app.get(OtpService);
    await expect(
      service.verify(actor, body.id, body.delivery.preview.code, "changed-draft"),
    ).rejects.toThrow();
    await expect(
      service.verify(
        { ...actor, actorId: ids.partnerUsers.riley, partnerId: ids.partners.riley },
        body.id,
        body.delivery.preview.code,
      ),
    ).rejects.toThrow();
    const [unchanged] =
      await db.sql`select attempts,status from otp_challenges where id=${body.id}`;
    expect(unchanged).toEqual({ attempts: 0, status: "pending" });
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        partner
          .post(`/otp/challenges/${body.id}/verify`)
          .send({ code: body.delivery.mode === "preview" ? body.delivery.preview.code : "" }),
      ),
    );
    expect(concurrent.map((r) => r.status).sort()).toEqual([201, 409]);
    await owner
      .post(`/partners/${ids.partners.jamie}/suspend`)
      .send({ reason: "OTP suspension check" })
      .expect(201);
    await create().expect(401);
    await owner
      .post(`/partners/${ids.partners.jamie}/reactivate`)
      .send({ reason: "OTP suspension cleared" })
      .expect(201);
  });
});

describe("partner-wide OTP issuance budget", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;
  let partner: Awaited<ReturnType<typeof partnerAgent>>;
  let now: Date;
  const selection = [ids.earnings.scheduledPlumbing, ids.earnings.scheduledElectrical];
  beforeEach(async () => {
    app = await createApiTestApp({
      deliveryEnv: {
        SMS_DELIVERY_MODE: "unisms",
        EMAIL_DELIVERY_MODE: "mailpit",
        SMTP_HOST: "mailpit",
        SMTP_PORT: 1025,
        UNISMS_API_KEY: "fictional-never-used",
        UNISMS_SENDER_ID: "FICTIONAL",
      },
    });
    db = createDatabaseClient(app.databaseUrl);
    now = new Date("2026-09-16T12:00:00Z");
    vi.spyOn(app.app.get(OtpPolicy), "now").mockImplementation(() => now);
    const owner = await ownerAgent(app);
    partner = await partnerAgent(app);
    await owner
      .post(`/conversions/${ids.conversions.scheduled}/complete`)
      .set("Idempotency-Key", "issuance-budget-fixture")
      .expect(201);
  });
  afterEach(async () => {
    await db.sql.end();
    await app.close();
  });
  const issue = (channel: "sms" | "email" = "sms", earningIds: string[] = selection) =>
    partner.post("/otp/challenges").send({ earningIds, channel });
  const advance = () => {
    now = new Date(now.getTime() + 60_000);
  };
  it("indexes partner status and issuance deadline for bounded lookup and supersession", async () => {
    const [index] = await db.sql<
      { indexdef: string }[]
    >`select indexdef from pg_indexes where tablename='otp_challenges' and indexname='otp_partner_status_resend_idx'`;
    expect(index?.indexdef).toContain("(organization_id, partner_id, status, resend_after)");
  });
  async function code(id: string) {
    const [row] = await db.sql<
      { content: string }[]
    >`select content from notification_outbox where otp_challenge_id=${id} and status='pending'`;
    const code = row?.content.match(/\d{6}/)?.[0];
    if (!code) throw new Error("Missing test OTP");
    return code;
  }
  it("admits one of twelve concurrent creates and shares its cooldown across selections and channels", async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => issue()));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(11);
    for (const response of responses.filter((r) => r.status === 429))
      expect(response.body).toEqual({
        status: "issuance_cooldown",
        resendAfter: "2026-09-16T12:01:00.000Z",
      });
    await issue("sms", [ids.earnings.scheduledPlumbing]).expect(429);
    await issue("email").expect(429);
    expect(await db.sql`select id from otp_challenges where status='pending'`).toHaveLength(1);
    expect(await db.sql`select id from notification_outbox`).toHaveLength(1);
  });
  it("cannot reset a blocked challenge budget by creating another challenge before cooldown", async () => {
    const challenge = otpChallengeResponseSchema.parse((await issue().expect(201)).body);
    const wrong = (await code(challenge.id)) === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt++)
      await partner
        .post(`/otp/challenges/${challenge.id}/verify`)
        .send({ code: wrong })
        .expect(400);
    await issue().expect(429);
    await issue("email", [ids.earnings.scheduledElectrical]).expect(429);
    const [blocked] =
      await db.sql`select status,attempts from otp_challenges where id=${challenge.id}`;
    expect(blocked).toEqual({ status: "blocked", attempts: 5 });
    advance();
    await issue().expect(201);
    expect(await db.sql`select id from otp_challenges`).toHaveLength(2);
    expect(await db.sql`select id from otp_challenges where status='pending'`).toHaveLength(1);
  });
  it("supersedes older pending challenges and redacts queued content after the shared cooldown", async () => {
    const original = otpChallengeResponseSchema.parse((await issue().expect(201)).body);
    const oldCode = await code(original.id);
    advance();
    const replacement = otpChallengeResponseSchema.parse((await issue("email").expect(201)).body);
    const [expired] = await db.sql`select status from otp_challenges where id=${original.id}`;
    expect(expired).toEqual({ status: "expired" });
    const [outbox] =
      await db.sql`select status,content from notification_outbox where otp_challenge_id=${original.id}`;
    expect(outbox).toEqual({ status: "failed", content: null });
    await partner.post(`/otp/challenges/${original.id}/verify`).send({ code: oldCode }).expect(410);
    advance();
    await partner.post(`/otp/challenges/${original.id.toUpperCase()}/resend`).send({}).expect(410);
    const [pending] = await db.sql`select id from otp_challenges where status='pending'`;
    expect(pending?.id).toBe(replacement.id);
  });
  it("terminalizes an accepted processing generation and ignores its in-flight terminal result", async () => {
    const original = otpChallengeResponseSchema.parse((await issue().expect(201)).body);
    const oldCode = await code(original.id);
    const [oldOutbox] = await db.sql<{ id: string }[]>`update notification_outbox
      set status='processing',provider_reference='stale-provider-reference',content=null,recipient='***0101'
      where otp_challenge_id=${original.id} returning id`;
    if (!oldOutbox) throw new Error("Missing stale outbox fixture");
    advance();

    await issue("email").expect(201);
    expect(
      await db.sql`select status,content,recipient from notification_outbox where id=${oldOutbox.id}`,
    ).toEqual([{ status: "failed", content: null, recipient: "***0101" }]);
    await expect(
      app.app.get(OutboxRepository).applyWebhook({
        provider: "unisms",
        providerEventId: "stale-provider-terminal",
        providerReference: "stale-provider-reference",
        outboxId: oldOutbox.id,
        eventType: "message.sent",
      }),
    ).resolves.toBe("processed");
    expect(
      await db.sql`select status,content from notification_outbox where id=${oldOutbox.id}`,
    ).toEqual([{ status: "failed", content: null }]);
    await partner.post(`/otp/challenges/${original.id}/verify`).send({ code: oldCode }).expect(410);
    expect(
      await db.sql`select id from notification_outbox where otp_challenge_id=${original.id} and status in ('pending','processing')`,
    ).toHaveLength(0);
  });
  it("does not resurrect a legacy pending challenge older than the latest issuance", async () => {
    const old = otpChallengeResponseSchema.parse((await issue().expect(201)).body);
    advance();
    const latest = otpChallengeResponseSchema.parse((await issue().expect(201)).body);
    // Simulate duplicate pending history produced before the shared issuance policy.
    await db.sql`update otp_challenges set status='pending' where id=${old.id}`;
    advance();
    await partner.post(`/otp/challenges/${old.id}/resend`).send({}).expect(409);
    const [row] = await db.sql`select status from otp_challenges where id=${latest.id}`;
    expect(row?.status).toBe("pending");
  });
  it("serializes concurrent create versus resend into one new issuance", async () => {
    const original = otpChallengeResponseSchema.parse((await issue().expect(201)).body);
    advance();
    const responses = await Promise.all([
      issue("email"),
      partner.post(`/otp/challenges/${original.id.toUpperCase()}/resend`).send({}),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 429]);
    expect(await db.sql`select id from otp_challenges where status='pending'`).toHaveLength(1);
    expect(await db.sql`select id from notification_outbox`).toHaveLength(2);
    expect(
      await db.sql`select id from notification_outbox where status='pending' and content is not null`,
    ).toHaveLength(1);
  });
  it.each(["verified", "used"] as const)(
    "preserves %s history when issuing a replacement",
    async (status) => {
      const original = otpChallengeResponseSchema.parse((await issue().expect(201)).body);
      await partner
        .post(`/otp/challenges/${original.id}/verify`)
        .send({ code: await code(original.id) })
        .expect(201);
      if (status === "used")
        await db.sql`update otp_challenges set status='used' where id=${original.id}`;
      advance();
      await issue().expect(201);
      const [row] = await db.sql`select status from otp_challenges where id=${original.id}`;
      expect(row?.status).toBe(status);
    },
  );
  it("allows fresh creation after natural expiry without reviving the expired code", async () => {
    const expired = otpChallengeResponseSchema.parse((await issue().expect(201)).body);
    now = new Date(now.getTime() + 300_000);
    await issue().expect(201);
    const [row] = await db.sql`select status from otp_challenges where id=${expired.id}`;
    expect(row?.status).toBe("expired");
  });
  it("rolls back supersession and issuance deadlines on delivery failure", async () => {
    const original = otpChallengeResponseSchema.parse((await issue().expect(201)).body);
    advance();
    const queue = vi
      .spyOn(app.app.get(NotificationsService), "queue")
      .mockRejectedValueOnce(new Error("Fictional queue failure"));
    try {
      await issue().expect(500);
    } finally {
      queue.mockRestore();
    }
    const [row] = await db.sql`select status from otp_challenges where id=${original.id}`;
    expect(row?.status).toBe("pending");
    expect(
      await db.sql`select id from notification_outbox where status='pending' and content is not null`,
    ).toHaveLength(1);
    await issue().expect(201);
  });
});

describe("API test harness delivery isolation", () => {
  it("does not start the provider worker for a generic E2E app", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network denied"));
    const app = await createApiTestApp({
      deliveryEnv: {
        SMS_DELIVERY_MODE: "unisms",
        EMAIL_DELIVERY_MODE: "disabled",
        UNISMS_API_KEY: "fictional-never-used",
        UNISMS_SENDER_ID: "FICTIONAL",
      },
    });
    try {
      const owner = await ownerAgent(app);
      const partner = await partnerAgent(app);
      await owner
        .post(`/conversions/${ids.conversions.scheduled}/complete`)
        .set("Idempotency-Key", "worker-isolation-fixture")
        .expect(201);
      await partner
        .post("/otp-challenges")
        .send({
          earningIds: [ids.earnings.scheduledPlumbing, ids.earnings.scheduledElectrical],
          channel: "sms",
        })
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 1_200));

      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
      fetcher.mockRestore();
    }
  });
});

describe("OTP delivery modes", () => {
  it.each([
    "unisms",
    "mailpit",
    "smtp",
    "sms-disabled",
    "email-disabled",
    "production-preview",
  ] as const)(
    "%s keeps code and destination out of provider and unavailable responses",
    async (mode) => {
      const email = mode === "mailpit" || mode === "smtp" || mode === "email-disabled";
      const unavailable = mode.endsWith("disabled") || mode === "production-preview";
      const app = await createApiTestApp({
        appMode: mode === "production-preview" ? "production" : "sandbox",
        deliveryEnv: {
          SMS_DELIVERY_MODE:
            mode === "unisms" ? "unisms" : mode === "sms-disabled" ? "disabled" : "preview",
          EMAIL_DELIVERY_MODE: mode === "mailpit" || mode === "smtp" ? mode : "disabled",
          SMTP_HOST: "mailpit",
          SMTP_PORT: 1025,
          UNISMS_API_KEY: "fictional-never-used",
          UNISMS_SENDER_ID: "FICTIONAL",
        },
      });
      const db = createDatabaseClient(app.databaseUrl);
      const network = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Network forbidden"));
      try {
        // Production intentionally has no demo login route; generate its normal signed cookie with the same guard.
        const cookie = createSessionCookie(
          {
            organizationId: ids.organization,
            actorId: ids.partnerUsers.jamie,
            role: "partner",
            sandboxVersion: 1,
            expiresAt: Date.now() + 60_000,
          },
          "a-session-secret-that-is-long-enough-for-the-e2e-suite",
        );
        await db.sql`update earnings set status='eligible' where id=${ids.earnings.scheduledPlumbing}`;
        const response = await app.request
          .post("/otp/challenges")
          .set("Cookie", `sandbox_session=${cookie}`)
          .send({ earningIds: [ids.earnings.scheduledPlumbing], channel: email ? "email" : "sms" })
          .expect(unavailable ? 503 : 201);
        const body = response.body as Record<string, unknown>;
        const serialized = JSON.stringify(body);
        expect(serialized).not.toMatch(/"(code|content|message|recipient)":/);
        const rows =
          await db.sql`select * from notification_outbox where otp_challenge_id is not null`;
        if (unavailable) {
          expect(body).toMatchObject({
            status: "channel_unavailable",
            delivery: { mode: "disabled", status: "unavailable" },
          });
          expect(rows).toHaveLength(0);
          expect(await db.sql`select * from otp_challenges`).toHaveLength(0);
        } else {
          expect(otpChallengeResponseSchema.parse(body).delivery).toEqual({
            mode: "provider",
            status: "queued",
          });
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ status: "pending", provider: mode });
          expect(rows[0]?.content).toMatch(/\d{6}/);
          expect(serialized).not.toContain(rows[0]?.recipient);
        }
        expect(network).not.toHaveBeenCalled();
      } finally {
        network.mockRestore();
        await db.sql.end();
        await app.close();
      }
    },
  );
});
