import { sql } from "drizzle-orm";
import {
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

export const actorRole = pgEnum("actor_role", ["owner", "partner"]);
export const partnerStatus = pgEnum("partner_status", ["active", "suspended"]);

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    sandboxVersion: integer("sandbox_version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    check("organizations_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("organizations_version_check", sql`${t.sandboxVersion} >= 0`),
  ],
);

export const tenantColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
});

export const users = pgTable(
  "users",
  {
    ...tenantColumns(),
    displayName: text("display_name").notNull(),
    role: actorRole("role").notNull(),
    ...timestamps(),
  },
  (t) => [unique("users_org_id_unique").on(t.organizationId, t.id)],
);

export const partners = pgTable(
  "partners",
  {
    ...tenantColumns(),
    userId: uuid("user_id").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    phoneE164: text("phone_e164").notNull(),
    status: partnerStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    unique("partners_org_id_unique").on(t.organizationId, t.id),
    unique("partners_org_user_unique").on(t.organizationId, t.userId),
    foreignKey({
      name: "partners_org_user_fk",
      columns: [t.organizationId, t.userId],
      foreignColumns: [users.organizationId, users.id],
    }),
  ],
);
