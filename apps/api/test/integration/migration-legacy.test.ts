import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createDatabaseClient, migrateDatabase } from "../../../../packages/database/src/index.js";
import { seedTwoOrganizations } from "../support/database.js";

const PRE_RECOVERY_MIGRATIONS = [
  ["0001_conscious_katie_power.sql", 1789485562342],
  ["0002_illegal_silvermane.sql", 1789486275109],
  ["0003_magenta_mordo.sql", 1789493417015],
  ["0004_strict_hold_restoration.sql", 1789516800000],
] as const;

async function applySqlMigration(
  db: ReturnType<typeof createDatabaseClient>,
  filename: string,
  createdAt: number,
) {
  const contents = await readFile(
    new URL(`../../../../packages/database/drizzle/${filename}`, import.meta.url),
    "utf8",
  );
  await db.sql.begin(async (sql) => {
    for (const statement of contents.split("--> statement-breakpoint"))
      if (statement.trim()) await sql.unsafe(statement);
  });
  const hash = createHash("sha256").update(contents).digest("hex");
  await db.sql`insert into drizzle.__drizzle_migrations(hash,created_at) values (${hash},${createdAt})`;
}

it("tracks the post-0005 schema from the latest generated snapshot", async () => {
  const snapshots = await Promise.all(
    ["0003", "0005"].map(
      async (index) =>
        JSON.parse(
          await readFile(
            new URL(
              `../../../../packages/database/drizzle/meta/${index}_snapshot.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ) as {
          id: string;
          prevId: string;
          tables: Record<
            string,
            {
              columns: Record<string, { notNull: boolean }>;
              checkConstraints: Record<string, unknown>;
            }
          >;
        },
    ),
  );
  const [previous, latest] = snapshots;
  expect(latest?.prevId).toBe(previous?.id);
  expect(latest?.tables["public.claim_items"]?.columns.earning_amount_minor).toMatchObject({
    notNull: true,
  });
  expect(
    latest?.tables["public.claim_items"]?.checkConstraints.claim_items_earning_amount_check,
  ).toBeDefined();
});

it("tracks the outbox uncertainty and reconciliation schema from migration 0006", async () => {
  const previous = JSON.parse(
    await readFile(
      new URL("../../../../packages/database/drizzle/meta/0005_snapshot.json", import.meta.url),
      "utf8",
    ),
  ) as { id: string };
  const latest = JSON.parse(
    await readFile(
      new URL("../../../../packages/database/drizzle/meta/0006_snapshot.json", import.meta.url),
      "utf8",
    ),
  ) as {
    prevId: string;
    tables: Record<string, { columns: Record<string, { notNull: boolean }> }>;
    enums: Record<string, { values: string[] }>;
  };
  expect(latest.prevId).toBe(previous.id);
  expect(
    latest.tables["public.notification_outbox"]?.columns.reconciliation_attempts,
  ).toMatchObject({ notNull: true });
  expect(latest.enums["public.outbox_status"]?.values).toContain("unknown");
});

it.each(["legacy", "fresh"] as const)(
  "migrates %s initial identity through all forward migrations",
  async (mode) => {
    const base = process.env.DATABASE_URL_TEST;
    if (!base) throw new Error("DATABASE_URL_TEST is required");
    const name = `migration_legacy_${crypto.randomUUID().replaceAll("-", "")}`;
    const url = new URL(base);
    url.pathname = `/${name}`;
    const admin = createDatabaseClient(base, { max: 1 });
    const db = createDatabaseClient(url.toString(), { max: 1 });
    const preservedId = crypto.randomUUID();
    const legacyAcceptedOutboxId = crypto.randomUUID();
    let before: unknown;
    let legacyAllocation:
      | { organizationId: string; claimId: string; earningId: string; amountMinor: string }
      | undefined;
    try {
      await admin.sql.unsafe(`create database "${name}"`);
      if (mode === "legacy") {
        const current = await readFile(
          new URL(
            "../../../../packages/database/drizzle/0000_natural_gamma_corps.sql",
            import.meta.url,
          ),
          "utf8",
        );
        const legacy = current.replace(
          "\"previous_status\" IN ('pending', 'eligible', 'reserved')",
          "\"previous_status\" <> 'held'",
        );
        expect(legacy).not.toBe(current);
        await db.sql.begin(async (sql) => {
          for (const statement of legacy.split("--> statement-breakpoint"))
            if (statement.trim()) await sql.unsafe(statement);
        });
        await db.sql.unsafe("create schema drizzle");
        await db.sql.unsafe(
          "create table drizzle.__drizzle_migrations (id serial primary key,hash text not null,created_at bigint)",
        );
        await db.sql`insert into drizzle.__drizzle_migrations(hash,created_at) values ('07844704f31d5d483a7c85d617e0e372c10ec3f6a25aef98add2707ec6e133d5',1789479471419)`;
        await db.sql`insert into organizations(id,name,currency) values(${preservedId},'Preserved legacy tenant','USD')`;
        before = await db.sql`select * from organizations where id=${preservedId}`;
        for (const [filename, createdAt] of PRE_RECOVERY_MIGRATIONS)
          await applySqlMigration(db, filename, createdAt);
        const fixture = await seedTwoOrganizations(db);
        legacyAllocation = {
          organizationId: fixture.orgA.id,
          claimId: fixture.orgA.claim.id,
          earningId: fixture.orgA.earning.id,
          amountMinor: "777",
        };
        await db.sql`insert into claim_items(organization_id,claim_id,earning_id,amount_minor)
          values (${legacyAllocation.organizationId},${legacyAllocation.claimId},${legacyAllocation.earningId},${legacyAllocation.amountMinor})`;
        await db.sql`insert into notification_outbox
          (id,organization_id,dedupe_key,channel,provider,status,recipient,content,provider_reference)
          values (${legacyAcceptedOutboxId},${preservedId},${`legacy-accepted-${legacyAcceptedOutboxId}`},
            'sms','unisms','processing','+12025550133','Sensitive legacy OTP','legacy-reference')`;
      }
      await expect(migrateDatabase(db.db)).resolves.toBeUndefined();
      const migrations = await db.sql<
        { created_at: string }[]
      >`select created_at::text from drizzle.__drizzle_migrations order by created_at`;
      expect(migrations).toHaveLength(9);
      expect(migrations[0]?.created_at).toBe("1789479471419");
      expect(await db.sql`select to_regclass('public.booking_webhook_events') as table_name`).toEqual([{ table_name: "booking_webhook_events" }]);
      if (mode === "legacy")
        expect(await db.sql`select * from organizations where id=${preservedId}`).toEqual(before);
      if (legacyAllocation) {
        expect(
          await db.sql`select otp_challenge_id from claims
            where organization_id=${legacyAllocation.organizationId}
            and id=${legacyAllocation.claimId}`,
        ).toEqual([{ otp_challenge_id: null }]);
        expect(
          await db.sql`select amount_minor::text,earning_amount_minor::text
            from claim_items where organization_id=${legacyAllocation.organizationId}
            and claim_id=${legacyAllocation.claimId} and earning_id=${legacyAllocation.earningId}`,
        ).toEqual([
          {
            amount_minor: legacyAllocation.amountMinor,
            earning_amount_minor: legacyAllocation.amountMinor,
          },
        ]);
        await expect(
          db.sql`update claim_items set amount_minor=earning_amount_minor+1
            where organization_id=${legacyAllocation.organizationId}
            and claim_id=${legacyAllocation.claimId} and earning_id=${legacyAllocation.earningId}`,
        ).rejects.toMatchObject({
          code: "23514",
          constraint_name: "claim_items_earning_amount_check",
        });
        expect(
          await db.sql`select status,recipient,content,reconciliation_attempts
            from notification_outbox where id=${legacyAcceptedOutboxId}`,
        ).toEqual([
          {
            status: "processing",
            recipient: "***0133",
            content: null,
            reconciliation_attempts: 0,
          },
        ]);
      }
      const fixture = await seedTwoOrganizations(db);
      const [foreignClaim] = await db.sql<{ actor_id: string; partner_id: string }[]>`
        select actor_id,partner_id from claims where organization_id=${fixture.orgB.id}
        and id=${fixture.orgB.claim.id}`;
      if (!foreignClaim) throw new Error("Missing cross-tenant claim fixture");
      const foreignChallengeId = crypto.randomUUID();
      await db.sql`insert into otp_challenges
        (id,organization_id,actor_id,partner_id,claim_draft_hash,code_digest,channel,status,expires_at,resend_after)
        values (${foreignChallengeId},${fixture.orgB.id},${foreignClaim.actor_id},${foreignClaim.partner_id},
          ${"b".repeat(64)},${"c".repeat(64)},'sms','verified',clock_timestamp()+interval '5 minutes',
          clock_timestamp()+interval '1 minute')`;
      await expect(
        db.sql`update claims set otp_challenge_id=${foreignChallengeId}
          where organization_id=${fixture.orgA.id} and id=${fixture.orgA.claim.id}`,
      ).rejects.toMatchObject({
        code: "23503",
        constraint_name: "claims_org_otp_challenge_fk",
      });
      const [actor] = await db.sql<
        { id: string }[]
      >`select id from users where organization_id=${fixture.orgA.id}`;
      if (!actor) throw new Error("Missing constraint fixture actor");
      await db.sql`insert into earning_holds(organization_id,earning_id,previous_status,reason,placed_by) values (${fixture.orgA.id},${fixture.orgA.earning.id},'eligible','Migrated hold',${actor.id})`;
      for (const status of ["settled", "voided", "reversed", "held", "needs_rule"])
        await expect(
          db.sql`update earning_holds set previous_status=${status} where organization_id=${fixture.orgA.id}`,
        ).rejects.toMatchObject({
          code: "23514",
          constraint_name: "earning_holds_previous_status_check",
        });
      const [columns] = await db.sql<
        { count: number }[]
      >`select count(*)::int count from information_schema.columns where table_name='conversion_items' and column_name='position'`;
      expect(columns?.count).toBe(1);
      const [claimAllocationColumn] = await db.sql<
        { count: number }[]
      >`select count(*)::int count from information_schema.columns
        where table_name='claim_items' and column_name='earning_amount_minor' and is_nullable='NO'`;
      expect(claimAllocationColumn?.count).toBe(1);
      const [reconciliationColumn] = await db.sql<
        { count: number }[]
      >`select count(*)::int count from information_schema.columns
        where table_name='notification_outbox' and column_name='reconciliation_attempts'
        and is_nullable='NO'`;
      expect(reconciliationColumn?.count).toBe(1);
      const outboxStates = await db.sql<
        { enumlabel: string }[]
      >`select enumlabel from pg_enum join pg_type on pg_type.oid=pg_enum.enumtypid
        where typname='outbox_status' order by enumsortorder`;
      expect(outboxStates.map((row) => row.enumlabel)).toContain("unknown");
      const [index] = await db.sql<
        { count: number }[]
      >`select count(*)::int count from pg_indexes where indexname='otp_partner_status_resend_idx'`;
      expect(index?.count).toBe(1);
      await migrateDatabase(db.db);
      expect(
        await db.sql`select created_at::text from drizzle.__drizzle_migrations order by created_at`,
      ).toEqual(migrations);
    } finally {
      await db.sql.end();
      try {
        await admin.sql.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await admin.sql.end();
      }
    }
  },
);
