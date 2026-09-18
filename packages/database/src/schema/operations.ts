import { sql } from "drizzle-orm";
import { check, foreignKey, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./identity.js";
import { conversions } from "./conversions.js";

/** Durable, tenant-scoped replay records for mutations. Stored responses contain no contact data. */
export const idempotencyRecords = pgTable("idempotency_records", {
  ...tenantColumns(),
  scope: text("scope").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  resourceId: uuid("resource_id"),
  conversionId: uuid("conversion_id"),
  response: jsonb("response").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("idempotency_records_org_id_unique").on(t.organizationId, t.id),
  unique("idempotency_records_scope_key_unique").on(t.organizationId, t.scope, t.idempotencyKey),
  check("idempotency_records_key_check", sql`length(trim(${t.idempotencyKey})) BETWEEN 8 AND 120`),
  foreignKey({ name: "idempotency_records_org_conversion_fk", columns: [t.organizationId, t.conversionId], foreignColumns: [conversions.organizationId, conversions.id] }),
]);
