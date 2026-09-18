import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseClient } from "../../../../packages/database/src/index.js";
import { createApiTestApp, type ApiTestApp } from "../support/http.js";
import { countClaimsForEarnings, seedEligibleClaimFixture } from "../support/database.js";
import { ClaimsService } from "../../src/claims/claims.service.js";
import { ClaimRepository } from "../../src/claims/claim.repository.js";

describe("atomic claim transactions", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;
  beforeAll(async () => {
    app = await createApiTestApp();
    db = createDatabaseClient(app.databaseUrl, { max: 4 });
  });
  afterAll(async () => {
    await db.sql.end();
    await app.close();
  });
  async function fixture(organizationId?: string) {
    const f = await seedEligibleClaimFixture(db, organizationId);
    const actor = {
      organizationId: f.organizationId,
      actorId: f.partnerUserId,
      partnerId: f.partnerId,
      role: "partner" as const,
      displayName: "Claim partner",
      sandboxVersion: 1,
    };
    return {
      ...f,
      actor,
      create: (
        key: string,
        challengeId = f.verifiedChallengeId,
        earningIds: string[] = f.earningIds,
      ) => app.app.get(ClaimsService).create(actor, { challengeId, earningIds }, key),
    };
  }
  it("serializes identical replays and competing earning selections", async () => {
    const f = await fixture();
    const replay = await Promise.all([f.create("same-claim-key"), f.create("same-claim-key")]);
    expect(replay.map((r) => r.status)).toEqual(["created", "created"]);
    expect(replay[0]).toEqual(replay[1]);
    expect(await countClaimsForEarnings(db, f.earningIds)).toBe(1);
    await expect(
      f.create("same-claim-key", f.verifiedChallengeId, [f.earningIds[0]]),
    ).rejects.toMatchObject({ status: 409, response: { status: "idempotency_conflict" } });
    const g = await fixture();
    const extra = crypto.randomUUID();
    await db.sql`insert into otp_challenges (id,organization_id,actor_id,partner_id,claim_draft_hash,code_digest,channel,status,expires_at,resend_after) select ${extra},organization_id,actor_id,partner_id,claim_draft_hash,code_digest,channel,status,expires_at,resend_after from otp_challenges where id=${g.verifiedChallengeId}`;
    const race = await Promise.allSettled([
      g.create("competing-one"),
      g.create("competing-two", extra),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await countClaimsForEarnings(db, g.earningIds)).toBe(1);
  });
  it.each(["pending", "blocked", "used", "expired"] as const)(
    "rejects a %s challenge without reservations",
    async (status) => {
      const f = await fixture();
      await db.sql`update otp_challenges set status=${status} where organization_id=${f.organizationId} and id=${f.verifiedChallengeId}`;
      await expect(f.create(`status-${status}`)).rejects.toMatchObject({
        status: status === "expired" ? 410 : 409,
      });
      expect(await countClaimsForEarnings(db, f.earningIds)).toBe(0);
      expect(
        await db.sql`select status from earnings where organization_id=${f.organizationId}`,
      ).toEqual([{ status: "eligible" }, { status: "eligible" }]);
    },
  );
  it("binds the challenge to its actor, partner, tenant and authoritative totals", async () => {
    const f = await fixture(),
      g = await fixture();
    await expect(f.create("foreign-challenge", g.verifiedChallengeId)).rejects.toMatchObject({
      status: 404,
    });
    await db.sql`update otp_challenges set actor_id=${f.partnerUserId} where id=${f.verifiedChallengeId}`;
    const otherActor = crypto.randomUUID(),
      otherPartner = crypto.randomUUID();
    await db.sql`insert into users(id,organization_id,display_name,role) values(${otherActor},${f.organizationId},'Other partner','partner')`;
    await db.sql`insert into partners(id,organization_id,user_id,display_name,email,phone_e164) values(${otherPartner},${f.organizationId},${otherActor},'Other partner','other@example.invalid','+12025550131')`;
    await db.sql`update otp_challenges set actor_id=${otherActor} where id=${f.verifiedChallengeId}`;
    await expect(f.create("wrong-actor")).rejects.toMatchObject({ status: 404 });
    await db.sql`update otp_challenges set actor_id=${f.partnerUserId},partner_id=${otherPartner} where id=${f.verifiedChallengeId}`;
    await expect(f.create("wrong-partner")).rejects.toMatchObject({ status: 404 });
    await db.sql`update otp_challenges set partner_id=${f.partnerId} where id=${f.verifiedChallengeId}`;
    await db.sql`update earnings set amount_minor=1001 where id=${f.earningIds[0]}`;
    await expect(f.create("changed-total")).rejects.toMatchObject({
      status: 409,
      response: { status: "claim_draft_changed" },
    });
    await db.sql`update earnings set amount_minor=1000 where id=${f.earningIds[0]}`;
    await db.sql`update earnings set currency='PHP' where organization_id=${f.organizationId}`;
    await expect(f.create("changed-currency")).rejects.toMatchObject({
      status: 409,
      response: { status: "claim_draft_changed" },
    });
    await db.sql`update earnings set currency='USD' where organization_id=${f.organizationId}`;
    const original = await f.create("tenant-replay-key");
    await expect(
      app.app
        .get(ClaimsService)
        .create(
          { ...f.actor, actorId: otherActor, partnerId: otherPartner },
          { challengeId: f.verifiedChallengeId, earningIds: f.earningIds },
          "tenant-replay-key",
        ),
    ).rejects.toMatchObject({ status: 404, response: { status: "not_found" } });
    await db.sql`update earnings set amount_minor=1001 where id=${f.earningIds[0]}`;
    await expect(f.create("tenant-replay-key")).rejects.toMatchObject({
      status: 409,
      response: { status: "idempotency_conflict" },
    });
    await db.sql`update earnings set amount_minor=1000,currency='PHP' where organization_id=${f.organizationId}`;
    await expect(f.create("tenant-replay-key")).rejects.toMatchObject({
      status: 409,
      response: { status: "idempotency_conflict" },
    });
    await db.sql`update earnings set currency='USD' where organization_id=${f.organizationId}`;
    await db.sql`update claims set actor_id=${otherActor} where id=${original.id}`;
    await expect(f.create("tenant-replay-key")).rejects.toMatchObject({
      status: 409,
      response: { status: "idempotency_conflict" },
    });
    expect(await countClaimsForEarnings(db, f.earningIds)).toBe(1);
  });
  it("rejects held, mixed-currency, suspended and overflowing selections atomically", async () => {
    const f = await fixture();
    await db.sql`insert into earning_holds(organization_id,earning_id,previous_status,reason,placed_by) values (${f.organizationId},${f.earningIds[0]},'eligible','Claim test hold',${f.partnerUserId})`;
    await expect(f.create("active-hold")).rejects.toMatchObject({ status: 409 });
    await db.sql`update earning_holds set released_at=clock_timestamp(),released_by=${f.partnerUserId} where organization_id=${f.organizationId}`;
    await db.sql`update earnings set currency='PHP' where id=${f.earningIds[0]}`;
    await expect(f.create("mixed-currency")).rejects.toMatchObject({ status: 409 });
    await db.sql`update earnings set currency='USD',amount_minor=9223372036854775807 where id=${f.earningIds[0]}`;
    await expect(f.create("overflow-total")).rejects.toMatchObject({
      status: 409,
      response: { status: "invalid_claim_total" },
    });
    await db.sql`update partners set status='suspended' where id=${f.partnerId}`;
    await expect(f.create("suspended-partner")).rejects.toMatchObject({ status: 403 });
    expect(await countClaimsForEarnings(db, f.earningIds)).toBe(0);
  });
  it("settles once under concurrency and preserves an existing accrual", async () => {
    const f = await fixture(),
      service = app.app.get(ClaimsService);
    await db.sql`insert into ledger_entries(organization_id,partner_id,earning_id,entry_type,amount_minor,currency,reason) values(${f.organizationId},${f.partnerId},${f.earningIds[0]},'accrual',1000,'USD','Prior accrual')`;
    const claim = await f.create("prior-accrual");
    const results = await Promise.all([
      service.simulate(f.actor, claim.id, "success"),
      service.simulate(f.actor, claim.id, "success"),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].status).toBe("settled");
    const totals =
      await db.sql`select earning_id,sum(amount_minor)::text total,count(*)::int count from ledger_entries where organization_id=${f.organizationId} group by earning_id order by earning_id`;
    expect(totals).toEqual(
      [...f.earningIds].sort().map((earning_id) => ({ earning_id, total: "0", count: 2 })),
    );
    const replay = await f.create(
      "prior-accrual",
      crypto.randomUUID(),
      [...f.earningIds].reverse().map((id) => id.toUpperCase()),
    );
    expect(replay).toEqual(results[0]);
    const outbox =
      await db.sql`select status,recipient,content from notification_outbox where organization_id=${f.organizationId}`;
    expect(outbox).toHaveLength(2);
    expect(outbox[0]).toMatchObject({ status: "failed", content: null });
    expect(outbox[0]?.recipient).not.toBe("claim@example.invalid");
  });
  it("lets two partners independently reuse a key within one tenant", async () => {
    const f = await fixture(),
      g = await fixture(f.organizationId);
    const [one, two] = await Promise.all([
      f.create("shared-partner-key"),
      g.create("shared-partner-key"),
    ]);
    expect(one.id).not.toBe(two.id);
    expect(one.partnerId).toBe(f.partnerId);
    expect(two.partnerId).toBe(g.partnerId);
    expect(await f.create("shared-partner-key")).toEqual(one);
    expect(await g.create("shared-partner-key")).toEqual(two);
  });
  it("loads history items as a batch without exposing another partner or tenant", async () => {
    const f = await fixture(),
      g = await fixture(f.organizationId),
      foreign = await fixture();
    const one = await f.create("history-own");
    await g.create("history-other");
    await foreign.create("history-foreign");
    const repository = app.app.get(ClaimRepository);
    const perClaim = vi.spyOn(repository, "items");
    try {
      const history = await app.app.get(ClaimsService).list(f.actor);
      expect(history.items).toEqual([one]);
      expect(perClaim).not.toHaveBeenCalled();
    } finally {
      perClaim.mockRestore();
    }
  });
  it.each(["success", "failure"] as const)(
    "rolls back %s after terminal outbox insertion and queues exactly once on retry",
    async (outcome) => {
      const f = await fixture(),
        service = app.app.get(ClaimsService);
      const claim = await f.create(`rollback-payout-${outcome}`);
      const snapshot = async () => {
        const result: Record<string, unknown> = {};
        for (const table of [
          "claims",
          "claim_items",
          "earnings",
          "ledger_entries",
          "audit_events",
          "notification_outbox",
        ])
          result[table] = await db.sql.unsafe(
            `select * from ${table} where organization_id=$1 order by id`,
            [f.organizationId],
          );
        return result;
      };
      const before = await snapshot();
      const terminal = outcome === "success" ? "settled" : "failed";
      await db.sql.unsafe(
        `create function payout_test_failure() returns trigger language plpgsql as $$ begin if new.dedupe_key='claim:${claim.id}:${terminal}' then raise exception 'private payout failure'; end if; return new; end $$`,
      );
      await db.sql.unsafe(
        "create trigger payout_test_failure after insert on notification_outbox for each row execute function payout_test_failure()",
      );
      try {
        await expect(service.simulate(f.actor, claim.id, outcome)).rejects.toMatchObject({
          status: 500,
          response: { status: "internal_error" },
        });
        expect(await snapshot()).toEqual(before);
      } finally {
        await db.sql.unsafe("drop trigger payout_test_failure on notification_outbox");
        await db.sql.unsafe("drop function payout_test_failure()");
      }
      const completed = await service.simulate(f.actor, claim.id, outcome);
      expect(completed.status).toBe(terminal);
      const after = await snapshot();
      expect(await service.simulate(f.actor, claim.id, outcome)).toEqual(completed);
      expect(await snapshot()).toEqual(after);
      const outbox =
        await db.sql`select dedupe_key,status,content from notification_outbox where organization_id=${f.organizationId} order by dedupe_key`;
      expect(outbox).toEqual(
        [
          { dedupe_key: `claim:${claim.id}:created`, status: "failed", content: null },
          { dedupe_key: `claim:${claim.id}:${terminal}`, status: "failed", content: null },
        ].sort((a, b) => a.dedupe_key.localeCompare(b.dedupe_key)),
      );
    },
  );
  it("rolls back every write on a failure after inserting claim items", async () => {
    const f = await fixture();
    await db.sql.unsafe(
      `create function claim_test_failure() returns trigger language plpgsql as $$ begin if new.organization_id='${f.organizationId}'::uuid then raise exception 'private failure detail'; end if; return new; end $$`,
    );
    // A row trigger runs after the item was inserted and forces the entire transaction to abort.
    await db.sql.unsafe(
      "create trigger claim_test_failure after insert on claim_items for each row execute function claim_test_failure()",
    );
    try {
      await expect(f.create("rollback-claim")).rejects.toMatchObject({
        status: 500,
        response: { status: "internal_error" },
      });
    } finally {
      await db.sql.unsafe("drop trigger claim_test_failure on claim_items");
      await db.sql.unsafe("drop function claim_test_failure()");
    }
    for (const table of [
      "claims",
      "claim_items",
      "audit_events",
      "notification_outbox",
      "ledger_entries",
      "idempotency_records",
    ]) {
      const rows = await db.sql.unsafe(`select id from ${table} where organization_id=$1`, [
        f.organizationId,
      ]);
      expect(rows, table).toHaveLength(0);
    }
    expect(
      await db.sql`select status from earnings where organization_id=${f.organizationId}`,
    ).toEqual([{ status: "eligible" }, { status: "eligible" }]);
    expect(
      await db.sql`select status from otp_challenges where id=${f.verifiedChallengeId}`,
    ).toEqual([{ status: "verified" }]);
    await expect(f.create("rollback-claim")).resolves.toMatchObject({ status: "created" });
  });
});
