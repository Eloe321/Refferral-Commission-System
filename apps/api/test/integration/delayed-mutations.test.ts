import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseClient, NORTHSTAR_IDS } from "../../../../packages/database/src/index.js";
import type { TransactionSql } from "postgres";
import { AuditService } from "../../src/common/audit.service.js";
import { ClaimReservationsService } from "../../src/common/claim-reservations.service.js";
import { IdempotencyService } from "../../src/common/idempotency.service.js";
import { EarningsService } from "../../src/earnings/earnings.service.js";
import { ConversionsService } from "../../src/conversions/conversions.service.js";
import { ProgramsService } from "../../src/programs/programs.service.js";
import { createApiTestApp, type ApiTestApp } from "../support/http.js";

const actor = {
  actorId: NORTHSTAR_IDS.ownerUser,
  organizationId: NORTHSTAR_IDS.organization,
  role: "owner" as const,
  partnerId: null,
  displayName: "Test owner",
  sandboxVersion: 1,
};

function barrier<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("mutations delayed behind locks", () => {
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

  it.each(["release", "void", "cancel", "no_show"] as const)(
    "closes a newer hold when an older %s transaction resumes",
    async (action) => {
      const conversion = crypto.randomUUID();
      const item = crypto.randomUUID();
      const earning = crypto.randomUUID();
      await db.sql`insert into conversions (id,organization_id,program_id,partner_id,referral_code_id,external_ref,currency,status) values (${conversion},${actor.organizationId},${NORTHSTAR_IDS.program},${NORTHSTAR_IDS.partners.jamie},${NORTHSTAR_IDS.referralCodes.jamie},${conversion},'USD','scheduled')`;
      await db.sql`insert into conversion_items (id,organization_id,conversion_id,external_ref,category,position,gross_amount_minor) values (${item},${actor.organizationId},${conversion},${item},'test',0,10000)`;
      await db.sql`insert into earnings (id,organization_id,conversion_item_id,program_id,partner_id,amount_minor,currency,status,rule_snapshot) values (${earning},${actor.organizationId},${item},${NORTHSTAR_IDS.program},${NORTHSTAR_IDS.partners.jamie},1000,'USD','pending','{}')`;
      const entered = barrier<string>();
      const resume = barrier();
      class DelayedReservations extends ClaimReservationsService {
        override async lock(sql: TransactionSql, organizationId: string) {
          const [row] = await sql<
            { started: string }[]
          >`select transaction_timestamp()::text started`;
          if (!row) throw new Error("Missing transaction clock");
          entered.resolve(row.started);
          await resume.promise;
          await super.lock(sql, organizationId);
        }
      }
      const audit = new AuditService(db);
      const delayed = new DelayedReservations();
      const earnings = new EarningsService(db, audit, delayed);
      const conversions = new ConversionsService(db, new IdempotencyService(), audit, delayed);
      const pending =
        action === "release"
          ? earnings.release(actor, earning, "Delayed release")
          : action === "void"
            ? earnings.void(actor, earning, "Delayed void")
            : conversions.cancel(
                actor,
                conversion,
                action === "cancel" ? "cancelled" : "no_show",
                "Delayed cancellation",
              );
      // Attach a handler immediately so a failing regression cannot become an unhandled rejection.
      const outcome = pending.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        const started = await entered.promise;
        await new EarningsService(db, audit, new ClaimReservationsService()).hold(
          actor,
          earning,
          "Newer hold",
        );
        const [held] = await db.sql<
          { newer: boolean }[]
        >`select placed_at > ${started}::timestamptz newer from earning_holds where earning_id=${earning}`;
        expect(held?.newer).toBe(true);
        resume.resolve();
        expect(await outcome).toEqual({ ok: true });
        const [state] =
          await db.sql`select e.status,h.released_at >= h.placed_at valid_closure,e.updated_at >= h.placed_at valid_update,
        (select min(created_at) from audit_events where action=${action === "release" ? "earning.released" : action === "void" ? "earning.voided" : action === "cancel" ? "conversion.cancelled" : "conversion.no_show"} and aggregate_id=${action === "release" || action === "void" ? earning : conversion}) >= h.released_at valid_audit
        from earnings e join earning_holds h on h.earning_id=e.id where e.id=${earning}`;
        expect(state).toEqual({
          status: action === "release" ? "pending" : "voided",
          valid_closure: true,
          valid_update: true,
          valid_audit: true,
        });
      } finally {
        resume.resolve();
        await outcome;
      }
    },
  );

  it("freezes an omitted effectiveFrom before waiting for a program lock", async () => {
    const program = crypto.randomUUID();
    await db.sql`insert into programs (id,organization_id,name) values (${program},${actor.organizationId},'Delayed rule fixture')`;
    const held = barrier();
    const unlock = barrier();
    const blocker = db.sql.begin(async (sql) => {
      await sql`select id from programs where id=${program} for update`;
      held.resolve();
      await unlock.promise;
    });
    await held.promise;
    const namedUrl = new URL(app.databaseUrl);
    namedUrl.searchParams.set("application_name", `rule_delay_${program}`);
    const writer = createDatabaseClient(namedUrl.toString(), { max: 4 });
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    const service = new ProgramsService(writer, new AuditService(writer));
    const pending = service.createRule(actor, program, {
      type: "flat",
      flatAmountMinor: "100",
      basisPoints: null,
      category: null,
      partnerId: null,
      effectiveTo: new Date(start + 1000).toISOString(),
    });
    const outcome = pending.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      // Observe the actual blocked PostgreSQL writer before advancing the controlled clock.
      const deadline = performance.now() + 5000;
      let waiting = false;
      while (performance.now() < deadline) {
        const rows =
          await db.sql`select pid from pg_stat_activity where application_name=${`rule_delay_${program}`} and wait_event_type='Lock'`;
        if (rows.length > 0) {
          waiting = true;
          break;
        }
      }
      expect(waiting).toBe(true);
      clock.mockReturnValue(start + 2000);
      unlock.resolve();
      await blocker;
      const result = await outcome;
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value[0]?.effectiveFrom).toBe(new Date(start).toISOString());
    } finally {
      clock.mockRestore();
      unlock.resolve();
      await blocker;
      await outcome;
      await writer.sql.end();
    }
  });
});
