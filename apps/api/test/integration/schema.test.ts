import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  seedTwoOrganizations,
  truncateTestDb,
  type TwoOrganizationFixture,
} from "../support/database.js";
import {
  commissionRuleInput,
  createConversionInput,
  earningHoldSchema,
  moneyJsonSchema,
} from "../../../../packages/contracts/src/index.js";

describe("shared API contracts", () => {
  it.each(["settled", "voided", "reversed", "held", "needs_rule"])(
    "rejects %s as a hold restoration status in read models",
    (previousStatus) => {
      expect(earningHoldSchema.shape.previousStatus.safeParse(previousStatus).success).toBe(false);
    },
  );
  it.each(["pending", "eligible", "reserved"])(
    "accepts %s as a hold restoration status in read models",
    (previousStatus) => {
      expect(earningHoldSchema.shape.previousStatus.parse(previousStatus)).toBe(previousStatus);
    },
  );
  it("keeps signed large money as strings", () => {
    expect(
      moneyJsonSchema.parse({ amountMinor: "-9007199254740993", currency: "PHP" }).amountMinor,
    ).toBe("-9007199254740993");
    expect(moneyJsonSchema.safeParse({ amountMinor: 100, currency: "PHP" }).success).toBe(false);
  });
  it("rejects rule inputs mixing flat and percentage values", () => {
    expect(
      commissionRuleInput.safeParse({
        type: "flat",
        category: null,
        partnerId: null,
        flatAmountMinor: "100",
        basisPoints: 100,
      }).success,
    ).toBe(false);
  });
  it("rejects authoritative tenant or status fields in conversion mutations", () => {
    const body = {
      idempotencyKey: "test-key-123",
      externalRef: "test",
      programId: crypto.randomUUID(),
      referralCode: "TEST",
      currency: "PHP",
      items: [{ externalRef: "item", category: "test", grossAmountMinor: "100" }],
    };
    expect(createConversionInput.safeParse(body).success).toBe(true);
    expect(
      createConversionInput.safeParse({
        ...body,
        organizationId: crypto.randomUUID(),
        status: "completed",
      }).success,
    ).toBe(false);
  });
});

describe("PostgreSQL tenant and accounting constraints", () => {
  const database = createTestDb();
  let fixture: TwoOrganizationFixture | undefined;
  beforeAll(async () => {
    fixture = await seedTwoOrganizations(database);
  });
  afterAll(async () => {
    try {
      await truncateTestDb(database, fixture ? [fixture.orgA.id, fixture.orgB.id] : []);
    } finally {
      await database.sql.end();
    }
  });
  function organizations() {
    if (!fixture) throw new Error("Fixture has not been seeded");
    return fixture;
  }

  it.each(["settled", "voided", "reversed", "held", "needs_rule"])(
    "rejects a hold with previousStatus %s",
    async (previousStatus) => {
      const { orgA } = organizations();
      const holdId = crypto.randomUUID();
      try {
        await expect(
          database.sql`insert into earning_holds (id, organization_id, earning_id, previous_status, reason, placed_by) select ${holdId}, organization_id, ${orgA.earning.id}, ${previousStatus}, 'Test hold', actor_id from claims where id = ${orgA.claim.id}`,
        ).rejects.toMatchObject({
          code: "23514",
          constraint_name: "earning_holds_previous_status_check",
        });
      } finally {
        await database.sql`delete from earning_holds where organization_id = ${orgA.id} and id = ${holdId}`;
      }
    },
  );
  it.each(["pending", "eligible", "reserved"])(
    "accepts a hold with previousStatus %s",
    async (previousStatus) => {
      const { orgA } = organizations();
      const holdId = crypto.randomUUID();
      try {
        const rows = await database.sql<
          { previous_status: string }[]
        >`insert into earning_holds (id, organization_id, earning_id, previous_status, reason, placed_by) select ${holdId}, organization_id, ${orgA.earning.id}, ${previousStatus}, 'Test hold', actor_id from claims where id = ${orgA.claim.id} returning previous_status`;
        expect(rows[0]?.previous_status).toBe(previousStatus);
      } finally {
        await database.sql`delete from earning_holds where organization_id = ${orgA.id} and id = ${holdId}`;
      }
    },
  );

  it("rejects a claim item referencing another organization's earning", async () => {
    const { orgA, orgB } = organizations();
    await expect(
      database.sql`insert into claim_items (organization_id, claim_id, earning_id, earning_amount_minor, amount_minor) values (${orgA.id}, ${orgA.claim.id}, ${orgB.earning.id}, 1000, 1000)`,
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("rejects a duplicate earning for one conversion item", async () => {
    const { orgA } = organizations();
    await expect(
      database.sql`insert into earnings (organization_id, conversion_item_id, program_id, partner_id, amount_minor, currency, rule_snapshot) select organization_id, conversion_item_id, program_id, partner_id, amount_minor, currency, rule_snapshot from earnings where id = ${orgA.earning.id}`,
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("rejects a duplicate claim idempotency key for the same organization and partner", async () => {
    const { orgA } = organizations();
    await expect(
      database.sql`insert into claims (organization_id, partner_id, actor_id, amount_minor, currency, idempotency_key, selection_hash) select organization_id, partner_id, actor_id, amount_minor, currency, idempotency_key, selection_hash from claims where id = ${orgA.claim.id}`,
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("rejects a rule with both flat amount and basis points", async () => {
    const { orgA } = organizations();
    await expect(
      database.sql`insert into commission_rules (organization_id, program_id, rule_type, flat_amount_minor, basis_points, effective_from) select organization_id, program_id, 'flat', 100, 100, now() from earnings where id = ${orgA.earning.id}`,
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects an OTP challenge referencing another organization's actor", async () => {
    const { orgA, orgB } = organizations();
    await expect(
      database.sql`insert into otp_challenges (organization_id, actor_id, partner_id, claim_draft_hash, code_digest, channel, expires_at, resend_after) select ${orgA.id}, b.actor_id, a.partner_id, 'hash', 'digest', 'email', now() + interval '5 minutes', now() + interval '1 minute' from claims a cross join claims b where a.id = ${orgA.claim.id} and b.id = ${orgB.claim.id}`,
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("rejects reversed commission exceeding the earning amount", async () => {
    const { orgA } = organizations();
    await expect(
      database.sql`update earnings set reversed_amount_minor = amount_minor + 1 where id = ${orgA.earning.id}`,
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("models redacted non-resending unknown deliveries and persistent reconciliation attempts", async () => {
    const { orgA } = organizations();
    const id = crypto.randomUUID();
    try {
      const rows = await database.sql<
        { status: string; reconciliation_attempts: number }[]
      >`insert into notification_outbox
        (id,organization_id,dedupe_key,channel,provider,status,recipient,content)
        values (${id},${orgA.id},${`unknown-${id}`},'sms','unisms','unknown','***0000',null)
        returning status,reconciliation_attempts`;
      expect(rows).toEqual([{ status: "unknown", reconciliation_attempts: 0 }]);
      await expect(
        database.sql`update notification_outbox set reconciliation_attempts=-1 where id=${id}`,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "outbox_reconciliation_attempts_check",
      });
    } finally {
      await database.sql`delete from notification_outbox where id=${id}`;
    }
  });
  it("rejects negative item amounts", async () => {
    const { orgA } = organizations();
    await expect(
      database.sql`update conversion_items set gross_amount_minor = -1 where organization_id = ${orgA.id}`,
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("accepts a same-organization claim item and preserves money beyond Number precision", async () => {
    const { orgA } = organizations();
    await database.sql`insert into claim_items (organization_id, claim_id, earning_id, earning_amount_minor, amount_minor) values (${orgA.id}, ${orgA.claim.id}, ${orgA.earning.id}, 9007199254740993, 9007199254740993)`;
    const rows = await database.sql<
      { amount: string }[]
    >`select amount_minor::text as amount from claim_items where organization_id = ${orgA.id}`;
    expect(rows[0]?.amount).toBe("9007199254740993");
    const item = await database.db.query.claimItems.findFirst({
      where: (table, { eq }) => eq(table.organizationId, orgA.id),
    });
    expect(item?.amountMinor).toBe(9007199254740993n);
  });
});
