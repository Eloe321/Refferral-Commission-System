import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  ensureSandboxSeeded,
  NORTHSTAR_IDS,
  resetSandbox,
  seedSandbox,
} from "../../../../packages/database/src/index.js";
import { organizations } from "../../../../packages/database/src/schema/index.js";
import { createTestDb, truncateTestDb } from "../support/database.js";

const database = createTestDb();

async function northstarCounts() {
  const organizationId = NORTHSTAR_IDS.organization;
  const [counts] = await database.sql<
    {
      organizations: number;
      partners: number;
      rules: number;
      conversions: number;
      items: number;
      earnings: number;
      holds: number;
      claims: number;
      claimItems: number;
      ledgerEntries: number;
    }[]
  >`select
    (select count(*)::int from organizations where id = ${organizationId}) as organizations,
    (select count(*)::int from partners where organization_id = ${organizationId}) as partners,
    (select count(*)::int from commission_rules where organization_id = ${organizationId}) as rules,
    (select count(*)::int from conversions where organization_id = ${organizationId}) as conversions,
    (select count(*)::int from conversion_items where organization_id = ${organizationId}) as items,
    (select count(*)::int from earnings where organization_id = ${organizationId}) as earnings,
    (select count(*)::int from earning_holds where organization_id = ${organizationId}) as holds,
    (select count(*)::int from claims where organization_id = ${organizationId}) as claims,
    (select count(*)::int from claim_items where organization_id = ${organizationId}) as "claimItems",
    (select count(*)::int from ledger_entries where organization_id = ${organizationId}) as "ledgerEntries"`;
  if (!counts) throw new Error("Northstar count query did not return a row");
  return counts;
}

afterEach(async () => {
  await resetSandbox(database.db, { appMode: "sandbox" });
});

afterAll(async () => {
  await database.sql.end();
});

describe("fictional Northstar sandbox seed", () => {
  it("repairs missing canonical rows at startup without resetting mutable sandbox state", async () => {
    await seedSandbox(database.db);
    await database.sql`update programs set status = 'paused' where id = ${NORTHSTAR_IDS.program}`;
    await database.sql`delete from ledger_entries where id = ${NORTHSTAR_IDS.ledgerEntries.settledPayout}`;

    await ensureSandboxSeeded(database.db);

    const [state] = await database.sql<
      { programStatus: string; sandboxVersion: number; payoutRows: number }[]
    >`select
      (select status from programs where id = ${NORTHSTAR_IDS.program}) as "programStatus",
      (select sandbox_version from organizations where id = ${NORTHSTAR_IDS.organization}) as "sandboxVersion",
      (select count(*)::int from ledger_entries where id = ${NORTHSTAR_IDS.ledgerEntries.settledPayout}) as "payoutRows"`;
    expect(state).toEqual({ programStatus: "paused", sandboxVersion: 1, payoutRows: 1 });
  });

  it("completes a sentinel-only startup seed in one idempotent transaction", async () => {
    await resetSandbox(database.db, { appMode: "sandbox" });
    await database.sql`insert into organizations (id, name, currency, sandbox_version) values (${NORTHSTAR_IDS.organization}, 'Northstar Home Services', 'USD', 7)`;

    await Promise.all([
      ensureSandboxSeeded(database.db),
      ensureSandboxSeeded(database.db),
      ensureSandboxSeeded(database.db),
    ]);

    expect(await northstarCounts()).toEqual({
      organizations: 1,
      partners: 2,
      rules: 3,
      conversions: 4,
      items: 5,
      earnings: 5,
      holds: 1,
      claims: 1,
      claimItems: 1,
      ledgerEntries: 2,
    });
    const [organization] = await database.sql<
      { sandboxVersion: number }[]
    >`select sandbox_version as "sandboxVersion" from organizations where id = ${NORTHSTAR_IDS.organization}`;
    expect(organization?.sandboxVersion).toBe(7);
  });

  it("rejects an immutable tenant relationship that startup inserts cannot safely repair", async () => {
    await seedSandbox(database.db);
    await database.sql`update partners set user_id = ${NORTHSTAR_IDS.ownerUser} where id = ${NORTHSTAR_IDS.partners.jamie}`;

    await expect(ensureSandboxSeeded(database.db)).rejects.toThrow(
      "Northstar sandbox seed structure is divergent",
    );
  });

  it("produces exactly one complete Northstar dataset after repeated seeding", async () => {
    await resetSandbox(database.db, { appMode: "sandbox" });
    await seedSandbox(database.db);
    await seedSandbox(database.db);

    expect(await northstarCounts()).toEqual({
      organizations: 1,
      partners: 2,
      rules: 3,
      conversions: 4,
      items: 5,
      earnings: 5,
      holds: 1,
      claims: 1,
      claimItems: 1,
      ledgerEntries: 2,
    });
  });

  it("rejects a divergent settled earning amount instead of accepting matching row counts", async () => {
    await seedSandbox(database.db);
    await database.sql`update earnings set amount_minor = 1 where id = ${NORTHSTAR_IDS.earnings.settled}`;

    await expect(seedSandbox(database.db)).rejects.toThrow(
      "Northstar sandbox seed state is divergent",
    );
  });

  it("rejects a divergent nested rule snapshot", async () => {
    await seedSandbox(database.db);
    await database.sql`update earnings set rule_snapshot = ${JSON.stringify({
      type: "percentage",
      basisPoints: 1,
      category: null,
      partnerId: null,
    })}::jsonb where id = ${NORTHSTAR_IDS.earnings.settled}`;

    await expect(seedSandbox(database.db)).rejects.toThrow(
      "Northstar sandbox seed state is divergent",
    );
  });

  it("rejects a divergent partner relationship", async () => {
    await seedSandbox(database.db);
    await database.sql`update partners set user_id = ${NORTHSTAR_IDS.ownerUser} where id = ${NORTHSTAR_IDS.partners.jamie}`;

    await expect(seedSandbox(database.db)).rejects.toThrow(
      "Northstar sandbox seed state is divergent",
    );
  });

  it("completes a matching canonical prefix without duplicating it", async () => {
    const ids = NORTHSTAR_IDS;
    await database.sql.begin(async (sql) => {
      await sql`insert into organizations (id, name, currency, sandbox_version) values (${ids.organization}, 'Northstar Home Services', 'USD', 1)`;
      await sql`insert into users (id, organization_id, display_name, role) values (${ids.ownerUser}, ${ids.organization}, 'Morgan Lee', 'owner'), (${ids.partnerUsers.jamie}, ${ids.organization}, 'Jamie Cruz', 'partner'), (${ids.partnerUsers.riley}, ${ids.organization}, 'Riley Park', 'partner')`;
    });

    await seedSandbox(database.db);
    expect(await northstarCounts()).toMatchObject({
      organizations: 1,
      partners: 2,
      rules: 3,
      conversions: 4,
      earnings: 5,
      ledgerEntries: 2,
    });
  });

  it("remains idempotent when clean seeds race", async () => {
    await resetSandbox(database.db, { appMode: "sandbox" });
    await Promise.all(Array.from({ length: 4 }, () => seedSandbox(database.db)));

    expect(await northstarCounts()).toMatchObject({
      organizations: 1,
      partners: 2,
      rules: 3,
      conversions: 4,
      earnings: 5,
      ledgerEntries: 2,
    });
  });

  it("refuses reset outside sandbox mode", async () => {
    await expect(resetSandbox(database.db, { appMode: "production" })).rejects.toThrow(
      "APP_MODE=sandbox",
    );
  });

  it("resets only Northstar and leaves a control organization untouched", async () => {
    const controlOrganizationId = crypto.randomUUID();
    try {
      await database.db.insert(organizations).values({
        id: controlOrganizationId,
        name: "Control Organization",
        currency: "USD",
      });
      await seedSandbox(database.db);

      await resetSandbox(database.db, { appMode: "sandbox" });

      expect(await northstarCounts()).toMatchObject({ organizations: 0, partners: 0 });
      const [control] = await database.sql<
        { count: number }[]
      >`select count(*)::int as count from organizations where id = ${controlOrganizationId}`;
      expect(control?.count).toBe(1);
    } finally {
      await truncateTestDb(database, [controlOrganizationId]);
    }
  });

  it("rolls back a constraint failure as one transaction and can be retried", async () => {
    const ids = NORTHSTAR_IDS;
    await database.sql.begin(async (sql) => {
      await sql`insert into organizations (id, name, currency, sandbox_version) values (${ids.organization}, 'Northstar Home Services', 'USD', 1)`;
      await sql`insert into users (id, organization_id, display_name, role) values (${ids.ownerUser}, ${ids.organization}, 'Morgan Lee', 'owner'), (${ids.partnerUsers.jamie}, ${ids.organization}, 'Jamie Cruz', 'partner'), (${ids.partnerUsers.riley}, ${ids.organization}, 'Riley Park', 'partner')`;
      await sql`insert into partners (id, organization_id, user_id, display_name, email, phone_e164) values (${ids.partners.jamie}, ${ids.organization}, ${ids.partnerUsers.jamie}, 'Jamie Cruz', 'jamie@example.com', '+12025550101'), (${ids.partners.riley}, ${ids.organization}, ${ids.partnerUsers.riley}, 'Riley Park', 'riley@example.com', '+12025550102')`;
      await sql`insert into programs (id, organization_id, name, status) values (${ids.program}, ${ids.organization}, 'Neighbor Rewards', 'active')`;
      await sql`insert into referral_codes (id, organization_id, program_id, partner_id, code) values (${ids.referralCodes.jamie}, ${ids.organization}, ${ids.program}, ${ids.partners.jamie}, 'JAMIE12')`;
      await sql`insert into conversions (id, organization_id, program_id, partner_id, referral_code_id, external_ref, currency, status) values (${crypto.randomUUID()}, ${ids.organization}, ${ids.program}, ${ids.partners.jamie}, ${ids.referralCodes.jamie}, 'NS-SCHEDULED-001', 'USD', 'scheduled')`;
    });

    await expect(seedSandbox(database.db)).rejects.toMatchObject({ cause: { code: "23505" } });
    expect(await northstarCounts()).toEqual({
      organizations: 1,
      partners: 2,
      rules: 0,
      conversions: 1,
      items: 0,
      earnings: 0,
      holds: 0,
      claims: 0,
      claimItems: 0,
      ledgerEntries: 0,
    });

    await resetSandbox(database.db, { appMode: "sandbox" });
    await seedSandbox(database.db);
    expect((await northstarCounts()).organizations).toBe(1);
  });

  it("uses only example.com email addresses and reserved fictional 555 phone numbers", async () => {
    await seedSandbox(database.db);
    const seededPartners = await database.sql<
      { email: string; phoneE164: string }[]
    >`select email, phone_e164 as "phoneE164" from partners where organization_id = ${NORTHSTAR_IDS.organization}`;

    expect(seededPartners).toHaveLength(2);
    for (const partner of seededPartners) {
      expect(partner.email).toMatch(/@example\.com$/);
      expect(partner.phoneE164).toMatch(/^\+120255501\d\d$/);
    }
  });

  it("keeps settled ledger, earning, and claim money internally consistent", async () => {
    await seedSandbox(database.db);
    const settledEarningId = NORTHSTAR_IDS.earnings.settled;
    const settledClaimId = NORTHSTAR_IDS.claims.settled;
    const [amounts] = await database.sql<
      {
        earning: string;
        claim: string;
        claimItem: string;
        ledgerNet: string;
      }[]
    >`select
      (select amount_minor::text from earnings where id = ${settledEarningId}) as earning,
      (select amount_minor::text from claims where id = ${settledClaimId}) as claim,
      (select amount_minor::text from claim_items where claim_id = ${settledClaimId}) as "claimItem",
      (select coalesce(sum(amount_minor), 0)::text from ledger_entries where earning_id = ${settledEarningId}) as "ledgerNet"`;
    const entries = await database.sql<
      { amount: string }[]
    >`select amount_minor::text as amount from ledger_entries where earning_id = ${settledEarningId} order by id`;

    expect(amounts).toEqual({ earning: "6000", claim: "6000", claimItem: "6000", ledgerNet: "0" });
    expect(entries.map((entry) => entry.amount)).toEqual(["6000", "-6000"]);
  });
});
