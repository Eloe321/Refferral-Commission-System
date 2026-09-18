import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { partners, tenantColumns, timestamps, users } from "./identity.js";
import { earnings } from "./conversions.js";

export const deliveryChannel = pgEnum("delivery_channel", ["sms", "email"]);
export const otpStatus = pgEnum("otp_status", [
  "pending",
  "verified",
  "used",
  "expired",
  "blocked",
]);
export const claimStatus = pgEnum("claim_status", ["created", "processing", "settled", "failed"]);
export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "accrual",
  "payout",
  "reversal",
  "adjustment",
]);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    ...tenantColumns(),
    actorId: uuid("actor_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    claimDraftHash: text("claim_draft_hash").notNull(),
    codeDigest: text("code_digest").notNull(),
    channel: deliveryChannel("channel").notNull(),
    status: otpStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resendAfter: timestamp("resend_after", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("otp_challenges_org_id_unique").on(t.organizationId, t.id),
    foreignKey({
      name: "otp_org_actor_fk",
      columns: [t.organizationId, t.actorId],
      foreignColumns: [users.organizationId, users.id],
    }),
    foreignKey({
      name: "otp_org_partner_fk",
      columns: [t.organizationId, t.partnerId],
      foreignColumns: [partners.organizationId, partners.id],
    }),
    check("otp_attempts_check", sql`${t.attempts} >= 0`),
    check(
      "otp_dates_check",
      sql`${t.expiresAt} > ${t.createdAt} AND ${t.resendAfter} >= ${t.createdAt} AND ${t.resendAfter} <= ${t.expiresAt}`,
    ),
    index("otp_actor_status_expiry_idx").on(t.actorId, t.status, t.expiresAt),
    index("otp_partner_status_resend_idx").on(
      t.organizationId,
      t.partnerId,
      t.status,
      t.resendAfter,
    ),
  ],
);

export const claims = pgTable(
  "claims",
  {
    ...tenantColumns(),
    partnerId: uuid("partner_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    otpChallengeId: uuid("otp_challenge_id"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    status: claimStatus("status").notNull().default("created"),
    idempotencyKey: text("idempotency_key").notNull(),
    selectionHash: text("selection_hash").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("claims_org_id_unique").on(t.organizationId, t.id),
    unique("claims_org_partner_idempotency_unique").on(
      t.organizationId,
      t.partnerId,
      t.idempotencyKey,
    ),
    foreignKey({
      name: "claims_org_partner_fk",
      columns: [t.organizationId, t.partnerId],
      foreignColumns: [partners.organizationId, partners.id],
    }),
    foreignKey({
      name: "claims_org_actor_fk",
      columns: [t.organizationId, t.actorId],
      foreignColumns: [users.organizationId, users.id],
    }),
    foreignKey({
      name: "claims_org_otp_challenge_fk",
      columns: [t.organizationId, t.otpChallengeId],
      foreignColumns: [otpChallenges.organizationId, otpChallenges.id],
    }),
    check("claims_amount_check", sql`${t.amountMinor} >= 0`),
    check("claims_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const claimItems = pgTable(
  "claim_items",
  {
    ...tenantColumns(),
    claimId: uuid("claim_id").notNull(),
    earningId: uuid("earning_id").notNull(),
    earningAmountMinor: bigint("earning_amount_minor", { mode: "bigint" }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  },
  (t) => [
    unique("claim_items_org_id_unique").on(t.organizationId, t.id),
    unique("claim_items_org_claim_earning_unique").on(t.organizationId, t.claimId, t.earningId),
    foreignKey({
      name: "claim_items_org_claim_fk",
      columns: [t.organizationId, t.claimId],
      foreignColumns: [claims.organizationId, claims.id],
    }),
    foreignKey({
      name: "claim_items_org_earning_fk",
      columns: [t.organizationId, t.earningId],
      foreignColumns: [earnings.organizationId, earnings.id],
    }),
    check("claim_items_amount_check", sql`${t.amountMinor} >= 0`),
    check(
      "claim_items_earning_amount_check",
      sql`${t.earningAmountMinor} >= 0 AND ${t.amountMinor} <= ${t.earningAmountMinor}`,
    ),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    ...tenantColumns(),
    partnerId: uuid("partner_id").notNull(),
    earningId: uuid("earning_id"),
    claimId: uuid("claim_id"),
    entryType: ledgerEntryType("entry_type").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_entries_org_id_unique").on(t.organizationId, t.id),
    foreignKey({
      name: "ledger_org_partner_fk",
      columns: [t.organizationId, t.partnerId],
      foreignColumns: [partners.organizationId, partners.id],
    }),
    foreignKey({
      name: "ledger_org_earning_fk",
      columns: [t.organizationId, t.earningId],
      foreignColumns: [earnings.organizationId, earnings.id],
    }),
    foreignKey({
      name: "ledger_org_claim_fk",
      columns: [t.organizationId, t.claimId],
      foreignColumns: [claims.organizationId, claims.id],
    }),
    check("ledger_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);
