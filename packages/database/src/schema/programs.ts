import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { partners, tenantColumns, timestamps } from "./identity.js";

export const programStatus = pgEnum("program_status", ["active", "paused"]);
export const ruleType = pgEnum("rule_type", ["flat", "percentage"]);

export const programs = pgTable(
  "programs",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    status: programStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [unique("programs_org_id_unique").on(t.organizationId, t.id)],
);

export const commissionRules = pgTable(
  "commission_rules",
  {
    ...tenantColumns(),
    programId: uuid("program_id").notNull(),
    partnerId: uuid("partner_id"),
    category: text("category"),
    ruleType: ruleType("rule_type").notNull(),
    flatAmountMinor: bigint("flat_amount_minor", { mode: "bigint" }),
    basisPoints: integer("basis_points"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
  },
  (t) => [
    unique("commission_rules_org_id_unique").on(t.organizationId, t.id),
    foreignKey({
      name: "rules_org_program_fk",
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }),
    foreignKey({
      name: "rules_org_partner_fk",
      columns: [t.organizationId, t.partnerId],
      foreignColumns: [partners.organizationId, partners.id],
    }),
    check(
      "commission_rules_shape_check",
      sql`(${t.ruleType} = 'flat' AND ${t.flatAmountMinor} IS NOT NULL AND ${t.basisPoints} IS NULL) OR (${t.ruleType} = 'percentage' AND ${t.flatAmountMinor} IS NULL AND ${t.basisPoints} IS NOT NULL AND ${t.basisPoints} BETWEEN 1 AND 10000)`,
    ),
    check(
      "commission_rules_amount_check",
      sql`${t.flatAmountMinor} IS NULL OR ${t.flatAmountMinor} >= 0`,
    ),
    check(
      "commission_rules_dates_check",
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

export const referralCodes = pgTable(
  "referral_codes",
  {
    ...tenantColumns(),
    programId: uuid("program_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    code: text("code").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    unique("referral_codes_org_id_unique").on(t.organizationId, t.id),
    unique("referral_codes_org_code_unique").on(t.organizationId, t.code),
    foreignKey({
      name: "codes_org_program_fk",
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }),
    foreignKey({
      name: "codes_org_partner_fk",
      columns: [t.organizationId, t.partnerId],
      foreignColumns: [partners.organizationId, partners.id],
    }),
  ],
);
