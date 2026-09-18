import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { partners, tenantColumns, timestamps, users } from "./identity.js";
import { commissionRules, programs, referralCodes } from "./programs.js";

export const conversionStatus = pgEnum("conversion_status", [
  "attributed",
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
  "partially_refunded",
  "refunded",
]);
export const earningStatus = pgEnum("earning_status", [
  "needs_rule",
  "pending",
  "eligible",
  "held",
  "reserved",
  "settled",
  "voided",
  "reversed",
]);

export const conversions = pgTable(
  "conversions",
  {
    ...tenantColumns(),
    programId: uuid("program_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    referralCodeId: uuid("referral_code_id").notNull(),
    externalRef: text("external_ref").notNull(),
    currency: text("currency").notNull(),
    status: conversionStatus("status").notNull().default("attributed"),
    ...timestamps(),
  },
  (t) => [
    unique("conversions_org_id_unique").on(t.organizationId, t.id),
    unique("conversions_org_program_external_ref_unique").on(
      t.organizationId,
      t.programId,
      t.externalRef,
    ),
    foreignKey({
      name: "conversions_org_program_fk",
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }),
    foreignKey({
      name: "conversions_org_partner_fk",
      columns: [t.organizationId, t.partnerId],
      foreignColumns: [partners.organizationId, partners.id],
    }),
    foreignKey({
      name: "conversions_org_code_fk",
      columns: [t.organizationId, t.referralCodeId],
      foreignColumns: [referralCodes.organizationId, referralCodes.id],
    }),
    check("conversions_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const conversionItems = pgTable(
  "conversion_items",
  {
    ...tenantColumns(),
    conversionId: uuid("conversion_id").notNull(),
    externalRef: text("external_ref").notNull(),
    category: text("category").notNull(),
    position: integer("position").notNull(),
    grossAmountMinor: bigint("gross_amount_minor", { mode: "bigint" }).notNull(),
    refundedBaseMinor: bigint("refunded_base_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    unique("conversion_items_org_id_unique").on(t.organizationId, t.id),
    unique("conversion_items_org_conversion_ref_unique").on(
      t.organizationId,
      t.conversionId,
      t.externalRef,
    ),
    unique("conversion_items_org_conversion_position_unique").on(t.organizationId, t.conversionId, t.position),
    foreignKey({
      name: "items_org_conversion_fk",
      columns: [t.organizationId, t.conversionId],
      foreignColumns: [conversions.organizationId, conversions.id],
    }),
    check(
      "conversion_items_amounts_check",
      sql`${t.grossAmountMinor} >= 0 AND ${t.refundedBaseMinor} >= 0 AND ${t.refundedBaseMinor} <= ${t.grossAmountMinor}`,
    ),
    check("conversion_items_position_check", sql`${t.position} >= 0`),
  ],
);

export const earnings = pgTable(
  "earnings",
  {
    ...tenantColumns(),
    conversionItemId: uuid("conversion_item_id").notNull(),
    programId: uuid("program_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    ruleId: uuid("rule_id"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    reversedAmountMinor: bigint("reversed_amount_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    currency: text("currency").notNull(),
    status: earningStatus("status").notNull().default("needs_rule"),
    ruleSnapshot: jsonb("rule_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    unique("earnings_org_id_unique").on(t.organizationId, t.id),
    unique("earnings_org_item_unique").on(t.organizationId, t.conversionItemId),
    foreignKey({
      name: "earnings_org_item_fk",
      columns: [t.organizationId, t.conversionItemId],
      foreignColumns: [conversionItems.organizationId, conversionItems.id],
    }),
    foreignKey({
      name: "earnings_org_program_fk",
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }),
    foreignKey({
      name: "earnings_org_partner_fk",
      columns: [t.organizationId, t.partnerId],
      foreignColumns: [partners.organizationId, partners.id],
    }),
    foreignKey({
      name: "earnings_org_rule_fk",
      columns: [t.organizationId, t.ruleId],
      foreignColumns: [commissionRules.organizationId, commissionRules.id],
    }),
    check(
      "earnings_amounts_check",
      sql`${t.amountMinor} >= 0 AND ${t.reversedAmountMinor} >= 0 AND ${t.reversedAmountMinor} <= ${t.amountMinor}`,
    ),
    check("earnings_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    index("earnings_partner_status_idx").on(t.partnerId, t.status),
  ],
);

export const earningHolds = pgTable(
  "earning_holds",
  {
    ...tenantColumns(),
    earningId: uuid("earning_id").notNull(),
    previousStatus: earningStatus("previous_status").notNull(),
    reason: text("reason").notNull(),
    placedBy: uuid("placed_by").notNull(),
    releasedBy: uuid("released_by"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    unique("earning_holds_org_id_unique").on(t.organizationId, t.id),
    foreignKey({
      name: "holds_org_earning_fk",
      columns: [t.organizationId, t.earningId],
      foreignColumns: [earnings.organizationId, earnings.id],
    }),
    foreignKey({
      name: "holds_org_placed_by_fk",
      columns: [t.organizationId, t.placedBy],
      foreignColumns: [users.organizationId, users.id],
    }),
    foreignKey({
      name: "holds_org_released_by_fk",
      columns: [t.organizationId, t.releasedBy],
      foreignColumns: [users.organizationId, users.id],
    }),
    check("earning_holds_reason_check", sql`length(trim(${t.reason})) BETWEEN 3 AND 240`),
    check(
      "earning_holds_previous_status_check",
      sql`${t.previousStatus} IN ('pending', 'eligible', 'reserved')`,
    ),
    check(
      "earning_holds_release_check",
      sql`(${t.releasedAt} IS NULL AND ${t.releasedBy} IS NULL) OR (${t.releasedAt} IS NOT NULL AND ${t.releasedBy} IS NOT NULL AND ${t.releasedAt} >= ${t.placedAt})`,
    ),
    uniqueIndex("earning_holds_one_active_idx")
      .on(t.organizationId, t.earningId)
      .where(sql`${t.releasedAt} IS NULL`),
  ],
);
