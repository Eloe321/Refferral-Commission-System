import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./identity.js";
import { programs } from "./programs.js";

/** Sanitized provider events. The payload is limited to a fictional booking reference and event metadata. */
export const bookingWebhookEvents = pgTable(
  "booking_webhook_events",
  {
    ...tenantColumns(),
    providerEventId: text("provider_event_id").notNull(),
    programId: uuid("program_id").notNull(),
    bookingRef: text("booking_ref").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(),
    failureCode: text("failure_code"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    unique("booking_webhook_events_org_id_unique").on(t.organizationId, t.id),
    unique("booking_webhook_events_provider_id_unique").on(t.organizationId, t.providerEventId),
    foreignKey({
      name: "booking_webhook_events_org_program_fk",
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }),
    check("booking_webhook_events_status_check", sql`${t.status} IN ('pending', 'processed', 'failed', 'ignored')`),
    check("booking_webhook_events_attempts_check", sql`${t.attempts} >= 0`),
  ],
);
