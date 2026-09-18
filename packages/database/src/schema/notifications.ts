import { sql } from "drizzle-orm";
import {
  boolean,
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
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns, timestamps, users } from "./identity.js";
import { claims, deliveryChannel, otpChallenges } from "./claims.js";
import { earnings } from "./conversions.js";

export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "processing",
  "unknown",
  "sent",
  "failed",
  "previewed",
]);

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    ...tenantColumns(),
    dedupeKey: text("dedupe_key").notNull(),
    channel: deliveryChannel("channel").notNull(),
    provider: text("provider").notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    recipient: text("recipient").notNull(),
    content: text("content"),
    providerReference: text("provider_reference"),
    otpChallengeId: uuid("otp_challenge_id"),
    claimId: uuid("claim_id"),
    earningId: uuid("earning_id"),
    attempts: integer("attempts").notNull().default(0),
    reconciliationAttempts: integer("reconciliation_attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("notification_outbox_org_id_unique").on(t.organizationId, t.id),
    unique("notification_outbox_org_dedupe_unique").on(t.organizationId, t.dedupeKey),
    foreignKey({
      name: "outbox_org_otp_fk",
      columns: [t.organizationId, t.otpChallengeId],
      foreignColumns: [otpChallenges.organizationId, otpChallenges.id],
    }),
    foreignKey({
      name: "outbox_org_claim_fk",
      columns: [t.organizationId, t.claimId],
      foreignColumns: [claims.organizationId, claims.id],
    }),
    foreignKey({
      name: "outbox_org_earning_fk",
      columns: [t.organizationId, t.earningId],
      foreignColumns: [earnings.organizationId, earnings.id],
    }),
    check("outbox_attempts_check", sql`${t.attempts} >= 0`),
    check(
      "outbox_reconciliation_attempts_check",
      sql`${t.reconciliationAttempts} >= 0`,
    ),
    index("outbox_status_available_idx").on(t.status, t.availableAt),
  ],
);

export const notificationWebhookEvents = pgTable(
  "notification_webhook_events",
  {
    ...tenantColumns(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("webhook_events_org_id_unique").on(t.organizationId, t.id),
    unique("webhook_events_provider_event_unique").on(t.provider, t.providerEventId),
  ],
);

// aggregateType/aggregateId is an immutable historical label, not a relational FK.
// Actor ownership remains enforced even if the audited aggregate is later removed.
export const auditEvents = pgTable(
  "audit_events",
  {
    ...tenantColumns(),
    eventKey: text("event_key").notNull(),
    actorId: uuid("actor_id"),
    isSystemEvent: boolean("is_system_event").notNull().default(false),
    action: text("action").notNull(),
    reason: text("reason"),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("audit_events_org_id_unique").on(t.organizationId, t.id),
    unique("audit_events_org_event_key_unique").on(t.organizationId, t.eventKey),
    foreignKey({
      name: "audit_org_actor_fk",
      columns: [t.organizationId, t.actorId],
      foreignColumns: [users.organizationId, users.id],
    }),
    check(
      "audit_events_actor_check",
      sql`(${t.isSystemEvent} AND ${t.actorId} IS NULL) OR (NOT ${t.isSystemEvent} AND ${t.actorId} IS NOT NULL)`,
    ),
    index("audit_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

export const demoScenarioRuns = pgTable(
  "demo_scenario_runs",
  {
    ...tenantColumns(),
    stage: text("stage").notNull(),
    sandboxVersion: integer("sandbox_version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("demo_scenario_runs_org_id_unique").on(t.organizationId, t.id),
    unique("demo_scenario_runs_org_stage_version_unique").on(
      t.organizationId,
      t.stage,
      t.sandboxVersion,
    ),
    check("demo_scenario_runs_version_check", sql`${t.sandboxVersion} >= 0`),
  ],
);
