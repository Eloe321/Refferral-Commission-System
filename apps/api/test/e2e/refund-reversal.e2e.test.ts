import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import {
  claimSchema,
  conversionSchema,
  otpChallengeResponseSchema,
  partnerDetailSchema,
  type EarningStatus,
} from "@referral-sandbox/contracts";
import {
  createDatabaseClient,
  NORTHSTAR_IDS as ids,
} from "../../../../packages/database/src/index.js";
import { createApiTestApp, ownerAgent, type ApiTestApp } from "../support/http.js";

describe("refund recovery", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;
  let owner: Awaited<ReturnType<typeof ownerAgent>>;
  let partner: ReturnType<typeof supertest.agent>;

  beforeAll(async () => {
    app = await createApiTestApp();
    db = createDatabaseClient(app.databaseUrl, { max: 6 });
    owner = await ownerAgent(app);
    partner = supertest.agent(app.server);
    await partner
      .post("/demo/session")
      .send({ role: "partner", actorId: ids.partnerUsers.riley })
      .expect(201);
  });

  afterAll(async () => {
    await db.sql.end();
    await app.close();
  });

  async function fixture(
    status: EarningStatus,
    options: {
      currency?: string;
      flatAmountMinor?: string;
      amountMinor?: string;
      partnerId?: string;
      referralCodeId?: string;
    } = {},
  ) {
    const conversionId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const earningId = crypto.randomUUID();
    const currency = options.currency ?? "USD";
    const partnerId = options.partnerId ?? ids.partners.riley;
    const referralCodeId = options.referralCodeId ?? ids.referralCodes.riley;
    const snapshot = options.flatAmountMinor
      ? { type: "flat", flatAmountMinor: options.flatAmountMinor }
      : { type: "percentage", basisPoints: 1000 };
    const amount = options.amountMinor ?? options.flatAmountMinor ?? "10000";
    await db.sql`insert into conversions
      (id,organization_id,program_id,partner_id,referral_code_id,external_ref,currency,status)
      values (${conversionId},${ids.organization},${ids.program},${partnerId},${referralCodeId},${conversionId},${currency},'completed')`;
    await db.sql`insert into conversion_items
      (id,organization_id,conversion_id,external_ref,category,position,gross_amount_minor)
      values (${itemId},${ids.organization},${conversionId},${itemId},'maintenance',0,100000)`;
    await db.sql`insert into earnings
      (id,organization_id,conversion_item_id,program_id,partner_id,rule_id,amount_minor,currency,status,rule_snapshot)
      values (${earningId},${ids.organization},${itemId},${ids.program},${partnerId},${ids.rules.defaultPercentage},${amount},${currency},${status},${JSON.stringify(snapshot)}::jsonb)`;
    if (status === "settled" || status === "reversed") {
      await db.sql`insert into ledger_entries
        (organization_id,partner_id,earning_id,entry_type,amount_minor,currency,reason)
        values
        (${ids.organization},${partnerId},${earningId},'accrual',${amount},${currency},'Original accrual'),
        (${ids.organization},${partnerId},${earningId},'payout',${(-BigInt(amount)).toString()},${currency},'Original payout')`;
    }
    return { conversionId, itemId, earningId, amount, currency };
  }

  const body = (itemId: string, refundedBaseMinor: string, reason = "Customer partial refund") => ({
    reason,
    items: [{ conversionItemId: itemId, refundedBaseMinor }],
  });

  function refund(
    conversionId: string,
    requestBody: ReturnType<typeof body>,
    key = `refund-${crypto.randomUUID()}`,
  ) {
    return owner
      .post(`/conversions/${conversionId}/refund`)
      .set("Idempotency-Key", key)
      .send(requestBody);
  }

  async function claimEarnings(
    earningIds: string[],
    key: string,
    claimPartner = partner,
    partnerId: string = ids.partners.riley,
  ) {
    await db.sql`update otp_challenges set created_at=created_at-interval '10 minutes',
      resend_after=resend_after-interval '10 minutes',expires_at=expires_at-interval '10 minutes'
      where organization_id=${ids.organization} and partner_id=${partnerId}`;
    const challenge = otpChallengeResponseSchema.parse(
      (await claimPartner.post("/otp/challenges").send({ earningIds, channel: "sms" }).expect(201))
        .body,
    );
    if (challenge.delivery.mode !== "preview") throw new Error("Expected preview OTP");
    await claimPartner
      .post(`/otp/challenges/${challenge.id}/verify`)
      .send({ code: challenge.delivery.preview.code })
      .expect(201);
    return claimSchema.parse(
      (
        await claimPartner
          .post("/claims")
          .set("Idempotency-Key", key)
          .send({ challengeId: challenge.id, earningIds })
          .expect(201)
      ).body,
    );
  }

  it("voids unpaid earnings and writes no recovery ledger or provider request", async () => {
    const target = await fixture("eligible");
    const beforeOutbox = await db.sql`select id from notification_outbox order by id`;

    const response = await refund(target.conversionId, body(target.itemId, "25000")).expect(201);

    expect(conversionSchema.parse(response.body).status).toBe("partially_refunded");
    expect(
      await db.sql`select status,reversed_amount_minor::text from earnings where id=${target.earningId}`,
    ).toEqual([{ status: "voided", reversed_amount_minor: "0" }]);
    expect(
      await db.sql`select id from ledger_entries where earning_id=${target.earningId}`,
    ).toEqual([]);
    expect(await db.sql`select id from notification_outbox order by id`).toEqual(beforeOutbox);
  });

  it("preserves payout history and appends a snapshot-derived negative reversal", async () => {
    const target = await fixture("settled");
    const original = await db.sql<
      { id: string }[]
    >`select id from ledger_entries where earning_id=${target.earningId} order by id`;

    await refund(
      target.conversionId,
      body(target.itemId, "25000", "Partial service refund"),
    ).expect(201);

    const earning = await db.sql<
      { status: string; reversed_amount_minor: string }[]
    >`select status,reversed_amount_minor::text from earnings where id=${target.earningId}`;
    expect(earning).toEqual([{ status: "reversed", reversed_amount_minor: "2500" }]);
    const ledger = await db.sql<
      { entry_type: string; amount_minor: string; reason: string }[]
    >`select entry_type,amount_minor::text,reason from ledger_entries where earning_id=${target.earningId} order by entry_type`;
    expect(ledger).toEqual([
      { entry_type: "accrual", amount_minor: "10000", reason: "Original accrual" },
      { entry_type: "payout", amount_minor: "-10000", reason: "Original payout" },
      { entry_type: "reversal", amount_minor: "-2500", reason: "Partial service refund" },
    ]);
    expect(
      await db.sql`select id from ledger_entries where id in ${db.sql(original.map((entry) => entry.id))} order by id`,
    ).toEqual(original);
    const balances = partnerDetailSchema.parse(
      (await owner.get(`/partners/${ids.partners.riley}`).expect(200)).body,
    ).balances;
    const balance = balances.find((item) => item.currency === "USD");
    expect(balance).toMatchObject({ currency: "USD", ledgerMinor: "-2500" });
    expect(typeof balance?.eligibleMinor).toBe("string");
    expect(typeof balance?.heldMinor).toBe("string");
  });

  it("is idempotent for repeated cumulative refunds and caps recovery at commission", async () => {
    const target = await fixture("settled");
    const request = body(target.itemId, "25000");
    await refund(target.conversionId, request).expect(201);
    await refund(target.conversionId, request).expect(201);
    await refund(target.conversionId, body(target.itemId, "75000")).expect(201);
    await refund(target.conversionId, body(target.itemId, "100000")).expect(201);

    expect(
      await db.sql`select amount_minor::text from ledger_entries where earning_id=${target.earningId} and entry_type='reversal' order by created_at,id`,
    ).toEqual([{ amount_minor: "-2500" }, { amount_minor: "-5000" }, { amount_minor: "-2500" }]);
    expect(
      await db.sql`select status,reversed_amount_minor::text from earnings where id=${target.earningId}`,
    ).toEqual([{ status: "reversed", reversed_amount_minor: "10000" }]);
    expect(
      await db.sql`select action from audit_events where aggregate_id=${target.conversionId} order by id`,
    ).toHaveLength(3);
    await refund(target.conversionId, body(target.itemId, "100001"))
      .expect(409)
      .expect({ status: "invalid_refund" });
  });

  it("uses the original flat rule snapshot rather than current rule configuration", async () => {
    const target = await fixture("settled", { flatAmountMinor: "2500" });

    await refund(target.conversionId, body(target.itemId, "1")).expect(201);

    expect(
      await db.sql`select amount_minor::text from ledger_entries where earning_id=${target.earningId} and entry_type='reversal'`,
    ).toEqual([{ amount_minor: "-2500" }]);
  });

  it("serializes concurrent repeats without over-reversing", async () => {
    const target = await fixture("settled");
    const request = body(target.itemId, "60000");

    const firstKey = `refund-race-a-${crypto.randomUUID()}`;
    const secondKey = `refund-race-b-${crypto.randomUUID()}`;
    const responses = await Promise.all([
      refund(target.conversionId, request, firstKey),
      refund(target.conversionId, request, secondKey),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(
      await db.sql`select reversed_amount_minor::text from earnings where id=${target.earningId}`,
    ).toEqual([{ reversed_amount_minor: "6000" }]);
    expect(
      await db.sql`select amount_minor::text from ledger_entries where earning_id=${target.earningId} and entry_type='reversal'`,
    ).toEqual([{ amount_minor: "-6000" }]);
  });

  it("rolls every mutation back when reversal ledger insertion fails", async () => {
    const target = await fixture("settled");
    await db.sql
      .unsafe(`create function refund_test_failure() returns trigger language plpgsql as $$
      begin
        if NEW.entry_type = 'reversal' and NEW.earning_id = '${target.earningId}'::uuid then
          raise exception 'forced refund rollback';
        end if;
        return NEW;
      end $$`);
    await db.sql.unsafe(`create trigger refund_test_failure before insert on ledger_entries
      for each row execute function refund_test_failure()`);
    try {
      await refund(target.conversionId, body(target.itemId, "50000"), "refund-rollback-key")
        .expect(500)
        .expect({ status: "internal_error" });
      expect(await db.sql`select status from conversions where id=${target.conversionId}`).toEqual([
        { status: "completed" },
      ]);
      expect(
        await db.sql`select refunded_base_minor::text from conversion_items where id=${target.itemId}`,
      ).toEqual([{ refunded_base_minor: "0" }]);
      expect(
        await db.sql`select status,reversed_amount_minor::text from earnings where id=${target.earningId}`,
      ).toEqual([{ status: "settled", reversed_amount_minor: "0" }]);
      expect(
        await db.sql`select entry_type from ledger_entries where earning_id=${target.earningId} order by entry_type`,
      ).toEqual([{ entry_type: "accrual" }, { entry_type: "payout" }]);
      expect(
        await db.sql`select id from audit_events where aggregate_id=${target.conversionId}`,
      ).toHaveLength(0);
      expect(
        await db.sql`select id from idempotency_records where scope=${`conversion.refund:${target.conversionId}:actor:${ids.ownerUser}`} and idempotency_key='refund-rollback-key'`,
      ).toHaveLength(0);
    } finally {
      await db.sql.unsafe("drop trigger refund_test_failure on ledger_entries");
      await db.sql.unsafe("drop function refund_test_failure()");
    }
  });

  it("enforces owner, tenant, money, currency, and lifecycle boundaries", async () => {
    const target = await fixture("settled");
    await partner
      .post(`/conversions/${target.conversionId}/refund`)
      .set("Idempotency-Key", `refund-${crypto.randomUUID()}`)
      .send(body(target.itemId, "1"))
      .expect(403);
    await owner
      .post(`/conversions/not-a-uuid/refund`)
      .set("Idempotency-Key", `refund-${crypto.randomUUID()}`)
      .send(body(target.itemId, "1"))
      .expect(400);
    await refund(crypto.randomUUID(), body(target.itemId, "1")).expect(404);
    await refund(target.conversionId, body(target.itemId, "0")).expect(400);
    await owner
      .post(`/conversions/${target.conversionId}/refund`)
      .set("Idempotency-Key", `refund-${crypto.randomUUID()}`)
      .send({
        reason: "Duplicate item",
        items: [
          { conversionItemId: target.itemId, refundedBaseMinor: "1" },
          { conversionItemId: target.itemId, refundedBaseMinor: "2" },
        ],
      })
      .expect(400);
    const mismatched = await fixture("settled", { currency: "PHP" });
    await refund(mismatched.conversionId, body(mismatched.itemId, "1"))
      .expect(409)
      .expect({ status: "invalid_currency" });
    await db.sql`update conversions set status='cancelled' where id=${target.conversionId}`;
    await refund(target.conversionId, body(target.itemId, "1"))
      .expect(409)
      .expect({ status: "conversion_transition_conflict" });
  });

  it("rejects a corrupted historical rule snapshot without partial state", async () => {
    const target = await fixture("settled");
    await db.sql`update earnings set rule_snapshot='{"type":"percentage","basisPoints":0}'::jsonb where id=${target.earningId}`;

    await refund(target.conversionId, body(target.itemId, "50000"))
      .expect(409)
      .expect({ status: "invalid_rule_snapshot" });

    expect(
      await db.sql`select refunded_base_minor::text from conversion_items where id=${target.itemId}`,
    ).toEqual([{ refunded_base_minor: "0" }]);
    expect(
      await db.sql`select status,reversed_amount_minor::text from earnings where id=${target.earningId}`,
    ).toEqual([{ status: "settled", reversed_amount_minor: "0" }]);
    expect(
      await db.sql`select entry_type from ledger_entries where earning_id=${target.earningId} order by entry_type`,
    ).toEqual([{ entry_type: "accrual" }, { entry_type: "payout" }]);
  });

  it("durably scopes refund idempotency to the owner and returns the original response", async () => {
    const target = await fixture("settled");
    const key = `refund-replay-${crypto.randomUUID()}`;
    const first = conversionSchema.parse(
      (await refund(target.conversionId, body(target.itemId, "25000"), key).expect(201)).body,
    );
    await refund(target.conversionId, body(target.itemId, "75000")).expect(201);
    expect(
      (await refund(target.conversionId, body(target.itemId, "25000"), key).expect(201)).body,
    ).toEqual(first);
    await refund(target.conversionId, body(target.itemId, "50000"), key)
      .expect(409)
      .expect({ status: "idempotency_conflict" });

    const secondOwnerId = crypto.randomUUID();
    await db.sql`insert into users(id,organization_id,display_name,role)
      values(${secondOwnerId},${ids.organization},'Second test owner','owner')`;
    const secondOwner = supertest.agent(app.server);
    await secondOwner
      .post("/demo/session")
      .send({ role: "owner", actorId: secondOwnerId })
      .expect(201);
    await secondOwner
      .post(`/conversions/${target.conversionId}/refund`)
      .set("Idempotency-Key", key)
      .send(body(target.itemId, "100000"))
      .expect(201);
    expect(
      await db.sql`select scope,idempotency_key from idempotency_records
        where idempotency_key=${key} order by scope`,
    ).toHaveLength(2);
  });

  it("requires the refund idempotency key and serializes concurrent same-key requests", async () => {
    const target = await fixture("settled");
    const request = body(target.itemId, "60000");
    await owner.post(`/conversions/${target.conversionId}/refund`).send(request).expect(400);
    await refund(target.conversionId, request, "short").expect(400);
    const key = `refund-same-${crypto.randomUUID()}`;
    const responses = await Promise.all([
      refund(target.conversionId, request, key),
      refund(target.conversionId, request, key),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(
      await db.sql`select amount_minor::text from ledger_entries
        where earning_id=${target.earningId} and entry_type='reversal'`,
    ).toEqual([{ amount_minor: "-6000" }]);
    expect(
      await db.sql`select id from audit_events where aggregate_id=${target.conversionId}`,
    ).toHaveLength(1);
  });

  it("recovers debt deterministically from future claims without mutating commission history", async () => {
    const recoveryUserId = crypto.randomUUID();
    const recoveryPartnerId = crypto.randomUUID();
    const recoveryCodeId = crypto.randomUUID();
    await db.sql`insert into users(id,organization_id,display_name,role)
      values(${recoveryUserId},${ids.organization},'Recovery test partner','partner')`;
    await db.sql`insert into partners(id,organization_id,user_id,display_name,email,phone_e164)
      values(${recoveryPartnerId},${ids.organization},${recoveryUserId},'Recovery test partner','recovery@example.invalid','+12025550121')`;
    await db.sql`insert into referral_codes(id,organization_id,program_id,partner_id,code)
      values(${recoveryCodeId},${ids.organization},${ids.program},${recoveryPartnerId},${`RECOVERY-${recoveryCodeId}`})`;
    const recoveryPartner = supertest.agent(app.server);
    await recoveryPartner
      .post("/demo/session")
      .send({ role: "partner", actorId: recoveryUserId })
      .expect(201);
    const fixtureOptions = { partnerId: recoveryPartnerId, referralCodeId: recoveryCodeId };
    const historical = await fixture("settled", fixtureOptions);
    const historicalLedger = await db.sql<
      { id: string; entry_type: string; amount_minor: string }[]
    >`
      select id,entry_type,amount_minor::text from ledger_entries
      where earning_id=${historical.earningId} order by id`;
    await refund(
      historical.conversionId,
      body(historical.itemId, "25000", "Recovery debt fixture"),
      `refund-debt-${crypto.randomUUID()}`,
    ).expect(201);

    const first = await fixture("eligible", { ...fixtureOptions, amountMinor: "1000" });
    const second = await fixture("eligible", { ...fixtureOptions, amountMinor: "1000" });
    const firstClaim = await claimEarnings(
      [second.earningId, first.earningId],
      `recovery-claim-${crypto.randomUUID()}`,
      recoveryPartner,
      recoveryPartnerId,
    );
    expect(firstClaim.amount.amountMinor).toBe("0");
    expect(firstClaim.items.map((item) => item.amount.amountMinor)).toEqual(["0", "0"]);

    const third = await fixture("eligible", { ...fixtureOptions, amountMinor: "300" });
    const fourth = await fixture("eligible", { ...fixtureOptions, amountMinor: "500" });
    const secondClaim = await claimEarnings(
      [fourth.earningId, third.earningId],
      `recovery-claim-${crypto.randomUUID()}`,
      recoveryPartner,
      recoveryPartnerId,
    );
    expect(secondClaim.amount.amountMinor).toBe("300");
    const ordered = [third, fourth].sort((left, right) =>
      left.earningId.localeCompare(right.earningId),
    );
    expect(secondClaim.items.map((item) => [item.earningId, item.amount.amountMinor])).toEqual([
      [
        ordered[0]?.earningId,
        (BigInt(ordered[0]?.amount ?? "0") - 500n > 0n
          ? BigInt(ordered[0]?.amount ?? "0") - 500n
          : 0n
        ).toString(),
      ],
      [
        ordered[1]?.earningId,
        (BigInt(ordered[0]?.amount ?? "0") >= 500n
          ? BigInt(ordered[1]?.amount ?? "0")
          : BigInt(ordered[1]?.amount ?? "0") - (500n - BigInt(ordered[0]?.amount ?? "0"))
        ).toString(),
      ],
    ]);
    // Settle in reverse creation order: reserved recovery prevents both open
    // claims from consuming the same debt.
    await recoveryPartner.post(`/claims/${secondClaim.id}/simulate-success`).send({}).expect(201);
    await recoveryPartner.post(`/claims/${firstClaim.id}/simulate-success`).send({}).expect(201);
    await recoveryPartner.post(`/claims/${firstClaim.id}/simulate-success`).send({}).expect(201);

    const final = await fixture("eligible", { ...fixtureOptions, amountMinor: "400" });
    const finalClaim = await claimEarnings(
      [final.earningId],
      `recovery-claim-${crypto.randomUUID()}`,
      recoveryPartner,
      recoveryPartnerId,
    );
    expect(finalClaim.amount.amountMinor).toBe("400");
    await recoveryPartner.post(`/claims/${finalClaim.id}/simulate-success`).send({}).expect(201);

    expect(
      await db.sql`select coalesce(sum(amount_minor),0)::text balance from ledger_entries
        where organization_id=${ids.organization} and partner_id=${recoveryPartnerId} and currency='USD'`,
    ).toEqual([{ balance: "0" }]);
    expect(
      await db.sql`select earning_id,entry_type,amount_minor::text from ledger_entries
        where claim_id in ${db.sql([firstClaim.id, secondClaim.id, finalClaim.id])}
        order by claim_id,earning_id,entry_type`,
    ).toHaveLength(7);
    expect(
      await db.sql`select id,entry_type,amount_minor::text from ledger_entries
        where earning_id=${historical.earningId} and entry_type in ('accrual','payout') order by id`,
    ).toEqual(historicalLedger);
    expect(
      await db.sql`select amount_minor::text from ledger_entries
        where earning_id=${historical.earningId} and entry_type='reversal' order by id`,
    ).toEqual([{ amount_minor: "-2500" }]);
    expect(
      await db.sql`select amount_minor::text from earnings
        where id in ${db.sql([first.earningId, second.earningId, third.earningId, fourth.earningId, final.earningId])}
        order by id`,
    ).toEqual(
      [first, second, third, fourth, final]
        .sort((left, right) => left.earningId.localeCompare(right.earningId))
        .map((earning) => ({ amount_minor: earning.amount })),
    );
  });
});
