import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import {
  claimSchema,
  claimListSchema,
  ownerClaimListSchema,
  ownerClaimSchema,
  partnerDetailSchema,
  conversionSchema,
  earningListSchema,
  otpChallengeResponseSchema,
} from "@referral-sandbox/contracts";
import {
  createDatabaseClient,
  NORTHSTAR_IDS as ids,
} from "../../../../packages/database/src/index.js";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";
import { seedTwoOrganizations } from "../support/database.js";

describe("partner claims", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;
  let owner: Awaited<ReturnType<typeof ownerAgent>>;
  let partner: Awaited<ReturnType<typeof partnerAgent>>;
  beforeAll(async () => {
    app = await createApiTestApp({
      deliveryEnv: { EMAIL_DELIVERY_MODE: "mailpit", SMTP_HOST: "mailpit", SMTP_PORT: 1025 },
    });
    db = createDatabaseClient(app.databaseUrl);
  });
  beforeEach(async () => {
    owner = await ownerAgent(app);
    partner = await partnerAgent(app);
  });
  afterAll(async () => {
    await db.sql.end();
    await app.close();
  });
  async function draft() {
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
            items: [
              { externalRef: `${ref}-a`, category: "plumbing", grossAmountMinor: "10000" },
              { externalRef: `${ref}-b`, category: "electrical", grossAmountMinor: "20000" },
            ],
          })
          .expect(201)
      ).body,
    );
    await owner
      .post(`/conversions/${conversion.id}/complete`)
      .set("Idempotency-Key", `complete-${ref}`)
      .expect(201);
    const earnings = earningListSchema.parse(
      (await partner.get(`/earnings?conversionId=${conversion.id}`).expect(200)).body,
    ).items;
    await db.sql`update otp_challenges set created_at=created_at-interval '10 minutes',resend_after=resend_after-interval '10 minutes',expires_at=expires_at-interval '10 minutes' where organization_id=${ids.organization} and partner_id=${ids.partners.jamie}`;
    const earningIds = earnings.map((e) => e.id);
    const challenge = otpChallengeResponseSchema.parse(
      (await partner.post("/otp/challenges").send({ earningIds, channel: "sms" }).expect(201)).body,
    );
    if (challenge.delivery.mode !== "preview") throw new Error("Expected preview");
    return {
      earningIds,
      challengeId: challenge.id,
      code: challenge.delivery.preview.code,
      key: ref,
    };
  }
  const claim = (d: Awaited<ReturnType<typeof draft>>) =>
    partner
      .post("/claims")
      .set("Idempotency-Key", d.key)
      .send({ challengeId: d.challengeId, earningIds: d.earningIds });
  const verify = (d: Awaited<ReturnType<typeof draft>>) =>
    partner.post(`/otp/challenges/${d.challengeId}/verify`).send({ code: d.code }).expect(201);
  it.each(["success", "failure"] as const)(
    "creates, replays, reads and simulates %s atomically",
    async (outcome) => {
      const d = await draft();
      await verify(d);
      const before = partnerDetailSchema
        .parse((await partner.get(`/partners/${ids.partners.jamie}`).expect(200)).body)
        .balances.find((b) => b.currency === "USD");
      if (!before) throw new Error("Missing USD balance");
      const created = claimSchema.parse(
        (
          await claim({
            ...d,
            challengeId: d.challengeId.toUpperCase(),
            earningIds: d.earningIds.map((id) => id.toUpperCase()),
          }).expect(201)
        ).body,
      );
      expect(created.status).toBe("created");
      expect(created.items.map((i) => i.earningId)).toEqual([...d.earningIds].sort());
      expect((await claim(d).expect(201)).body).toEqual(created);
      expect((await partner.get(`/claims/${created.id}`).expect(200)).body).toEqual(created);
      const terminal = claimSchema.parse(
        (await partner.post(`/claims/${created.id}/simulate-${outcome}`).send({}).expect(201)).body,
      );
      expect(terminal.status).toBe(outcome === "success" ? "settled" : "failed");
      expect(
        (await partner.post(`/claims/${created.id}/simulate`).send({ outcome }).expect(201)).body,
      ).toEqual(terminal);
      expect(
        (await partner.post(`/claims/${created.id}/simulate-${outcome}`).send({}).expect(201)).body,
      ).toEqual(terminal);
      await partner
        .post(`/claims/${created.id}/simulate`)
        .send({ outcome: outcome === "success" ? "failure" : "success" })
        .expect(409);
      const earnings =
        await db.sql`select status from earnings where id in ${db.sql(d.earningIds)}`;
      expect(earnings).toEqual([
        { status: outcome === "success" ? "settled" : "eligible" },
        { status: outcome === "success" ? "settled" : "eligible" },
      ]);
      const ledger = await db.sql<
        { earning_id: string; entry_type: string; amount: string }[]
      >`select earning_id,entry_type,amount_minor::text amount from ledger_entries where organization_id=${ids.organization} and earning_id in ${db.sql(d.earningIds)} order by earning_id,entry_type`;
      expect(ledger).toEqual(
        outcome === "failure"
          ? []
          : created.items.flatMap((i) => [
              { earning_id: i.earningId, entry_type: "accrual", amount: i.amount.amountMinor },
              {
                earning_id: i.earningId,
                entry_type: "payout",
                amount: (-BigInt(i.amount.amountMinor)).toString(),
              },
            ]),
      );
      const audit = await db.sql<
        { action: string; actor_id: string; reason: string; metadata: unknown }[]
      >`select action,actor_id,reason,metadata from audit_events where aggregate_id=${created.id} order by created_at,id`;
      expect(audit.map((a) => a.action)).toEqual([
        "claim.created",
        "claim.processing",
        `claim.${terminal.status}`,
      ]);
      expect(audit.every((a) => a.actor_id === ids.partnerUsers.jamie)).toBe(true);
      const outbox = await db.sql<
        { dedupe_key: string; status: string; provider: string; content: string }[]
      >`select dedupe_key,status,provider,content from notification_outbox where claim_id=${created.id} order by dedupe_key`;
      expect(outbox).toHaveLength(2);
      expect(outbox.every((row) => row.status === "pending" && row.provider === "mailpit")).toBe(
        true,
      );
      const notification = outbox.find(
        (row) => row.dedupe_key === `claim:${created.id}:${terminal.status}`,
      );
      expect(notification?.content).toContain(terminal.status);
      expect(notification?.content).not.toMatch(/mailpit|smtp|otp|digest|secret/i);
      expect(JSON.stringify({ audit, outbox })).not.toContain(d.code);
      const listed = await partner.get("/claims").expect(200);
      const list = claimListSchema.parse(listed.body);
      expect(list.items.some((c) => c.id === created.id)).toBe(true);
      expect(list.items.map((c) => `${c.createdAt}:${c.id}`)).toEqual(
        list.items
          .map((c) => `${c.createdAt}:${c.id}`)
          .sort()
          .reverse(),
      );
      const after = partnerDetailSchema
        .parse((await partner.get(`/partners/${ids.partners.jamie}`).expect(200)).body)
        .balances.find((b) => b.currency === "USD");
      expect(after).toEqual({
        ...before,
        eligibleMinor: (
          BigInt(before.eligibleMinor) -
          (outcome === "success" ? BigInt(created.amount.amountMinor) : 0n)
        ).toString(),
      });
    },
  );
  it("allows Jamie and Riley to claim separate earnings with the same idempotency key", async () => {
    const d = await draft();
    await verify(d);
    const jamie = claimSchema.parse((await claim(d).expect(201)).body);
    const riley = supertest.agent(app.server);
    await riley
      .post("/demo/session")
      .send({ role: "partner", actorId: ids.partnerUsers.riley })
      .expect(201);
    const challenge = otpChallengeResponseSchema.parse(
      (
        await riley
          .post("/otp/challenges")
          .send({ earningIds: [ids.earnings.eligible], channel: "sms" })
          .expect(201)
      ).body,
    );
    if (challenge.delivery.mode !== "preview") throw new Error("Expected Riley preview");
    await riley
      .post(`/otp/challenges/${challenge.id}/verify`)
      .send({ code: challenge.delivery.preview.code })
      .expect(201);
    const request = () =>
      riley
        .post("/claims")
        .set("Idempotency-Key", d.key)
        .send({ challengeId: challenge.id, earningIds: [ids.earnings.eligible] });
    const second = claimSchema.parse((await request().expect(201)).body);
    expect(second.id).not.toBe(jamie.id);
    expect(second.partnerId).toBe(ids.partners.riley);
    expect((await request().expect(201)).body).toEqual(second);
    expect((await claim(d).expect(201)).body).toEqual(jamie);
  });
  it("rejects pending, altered drafts, expired challenges and malformed inputs safely", async () => {
    const d = await draft();
    await claim(d).expect(409);
    await verify(d);
    await claim({ ...d, earningIds: [d.earningIds[0] ?? ""] }).expect(409);
    await db.sql`update otp_challenges set claim_draft_hash=${"f".repeat(64)} where id=${d.challengeId}`;
    await claim(d).expect(409).expect({ status: "claim_draft_changed" });
    await db.sql`update otp_challenges set created_at=created_at-interval '10 minutes',resend_after=resend_after-interval '10 minutes',expires_at=expires_at-interval '10 minutes' where id=${d.challengeId}`;
    await claim(d).expect(410);
    await claim({
      ...d,
      earningIds: [d.earningIds[0] ?? "", (d.earningIds[0] ?? "").toUpperCase()],
    }).expect(400);
    await partner
      .post("/claims")
      .send({ challengeId: d.challengeId, earningIds: d.earningIds })
      .expect(400);
    await partner
      .post("/claims")
      .set("Idempotency-Key", "short")
      .send({ challengeId: d.challengeId, earningIds: d.earningIds })
      .expect(400);
    await partner
      .post("/claims")
      .set("Idempotency-Key", d.key)
      .send({ challengeId: "invalid", earningIds: d.earningIds })
      .expect(400);
    await partner.get("/claims/invalid").expect(400);
    await partner
      .post(`/claims/${crypto.randomUUID()}/simulate`)
      .send({ outcome: "invalid" })
      .expect(400);
  });
  it("lets owners monitor organization claims with linked OTP audit data and simulate payouts", async () => {
    const d = await draft();
    await verify(d);
    const created = claimSchema.parse((await claim(d).expect(201)).body);

    const listed = ownerClaimListSchema.parse((await owner.get("/claims").expect(200)).body);
    const monitored = listed.items.find((candidate) => candidate.id === created.id);
    expect(monitored?.items).toEqual(created.items);
    expect(monitored?.otpAudit).toMatchObject({
      challengeId: d.challengeId,
      channel: "sms",
      status: "used",
    });
    expect(ownerClaimSchema.parse((await owner.get(`/claims/${created.id}`).expect(200)).body)).toEqual(
      monitored,
    );

    const terminal = ownerClaimSchema.parse(
      (
        await owner
          .post(`/claims/${created.id}/simulate-success`)
          .set("Idempotency-Key", `owner-sim-${crypto.randomUUID()}`)
          .send({})
          .expect(201)
      ).body,
    );
    expect(terminal.status).toBe("settled");
  });

  it("retries a failed payout idempotently after validating the reservation", async () => {
    const d = await draft();
    await verify(d);
    const created = claimSchema.parse((await claim(d).expect(201)).body);
    await owner
      .post(`/claims/${created.id}/simulate-failure`)
      .set("Idempotency-Key", `owner-fail-${crypto.randomUUID()}`)
      .send({})
      .expect(201);
    const retryKey = `claim-retry-${crypto.randomUUID()}`;
    const secondOwner = await ownerAgent(app);
    const [first, replay] = await Promise.all([
      owner.post(`/claims/${created.id}/retry`).set("Idempotency-Key", retryKey).send({}),
      secondOwner.post(`/claims/${created.id}/retry`).set("Idempotency-Key", retryKey).send({}),
    ]);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(ownerClaimSchema.parse(first.body).status).toBe("created");
    expect(
      await db.sql`select status from earnings where id in ${db.sql(d.earningIds)} order by id`,
    ).toEqual([{ status: "reserved" }, { status: "reserved" }]);
    await owner
      .post(`/claims/${created.id}/retry`)
      .set("Idempotency-Key", `different-${crypto.randomUUID()}`)
      .send({})
      .expect(409);
    const audit = await db.sql<{ action: string }[]>`
      select action from audit_events where organization_id=${ids.organization}
      and aggregate_id=${created.id} order by created_at,id`;
    expect(audit.map((event) => event.action)).toContain("claim.retried");
  });

  it("keeps owner monitoring tenant scoped, forbids foreign partners, and protects suspended claims", async () => {
    const d = await draft();
    await verify(d);
    const created = claimSchema.parse((await claim(d).expect(201)).body);
    await owner
      .post("/claims")
      .set("Idempotency-Key", d.key)
      .send({ challengeId: d.challengeId, earningIds: d.earningIds })
      .expect(403);
    const ownerClaims = ownerClaimListSchema.parse((await owner.get("/claims").expect(200)).body);
    expect(ownerClaims.items.some((candidate) => candidate.id === created.id)).toBe(true);
    await owner.get(`/claims/${created.id}`).expect(200);
    const foreign = await seedTwoOrganizations(db);
    await owner.get(`/claims/${foreign.orgB.claim.id}`).expect(404);
    await owner
      .post(`/claims/${foreign.orgB.claim.id}/simulate-success`)
      .set("Idempotency-Key", `foreign-sim-${crypto.randomUUID()}`)
      .send({})
      .expect(404);
    await owner
      .post(`/claims/${foreign.orgB.claim.id}/retry`)
      .set("Idempotency-Key", `foreign-retry-${crypto.randomUUID()}`)
      .send({})
      .expect(404);
    expect(
      ownerClaimListSchema
        .parse((await owner.get("/claims").expect(200)).body)
        .items.some((candidate) => candidate.id === foreign.orgB.claim.id),
    ).toBe(false);
    const riley = supertest.agent(app.server);
    await riley
      .post("/demo/session")
      .send({ role: "partner", actorId: ids.partnerUsers.riley })
      .expect(201);
    await riley
      .post("/claims")
      .set("Idempotency-Key", "riley-wrong-challenge")
      .send({ challengeId: d.challengeId, earningIds: d.earningIds })
      .expect(404);
    await riley.get(`/claims/${created.id}`).expect(404);
    await partner
      .post(`/claims/${created.id}/retry`)
      .set("Idempotency-Key", `partner-retry-${crypto.randomUUID()}`)
      .send({})
      .expect(403);
    await riley.post(`/claims/${created.id}/simulate`).send({ outcome: "success" }).expect(404);
    for (const outcome of ["success", "failure"]) {
      await riley.post(`/claims/${created.id}/simulate-${outcome}`).send({}).expect(404);
      await partner
        .post(`/claims/${created.id}/simulate-${outcome}`)
        .send({ extra: true })
        .expect(400);
      await partner.post(`/claims/invalid/simulate-${outcome}`).send({}).expect(400);
    }
    await partner.get(`/claims/${ids.claims.settled}`).expect(404);
    await partner
      .post(`/claims/${ids.claims.settled}/simulate`)
      .send({ outcome: "success" })
      .expect(404);
    await owner
      .post(`/partners/${ids.partners.jamie}/suspend`)
      .send({ reason: "Claim suspension test" })
      .expect(201);
    await claim(d).expect(401);
    await owner
      .post(`/partners/${ids.partners.jamie}/reactivate`)
      .send({ reason: "Claim reactivation test" })
      .expect(201);
    await partner.post(`/claims/${created.id}/simulate`).send({ outcome: "success" }).expect(409);
    const before =
      await db.sql`select id,status from earnings where id in ${db.sql(d.earningIds)} order by id`;
    await partner.post(`/claims/${created.id}/simulate`).send({ outcome: "failure" }).expect(201);
    expect(
      await db.sql`select id,status from earnings where id in ${db.sql(d.earningIds)} order by id`,
    ).toEqual(before);
    expect(
      await db.sql`select id from ledger_entries where earning_id in ${db.sql(d.earningIds)}`,
    ).toHaveLength(0);
  });
});
