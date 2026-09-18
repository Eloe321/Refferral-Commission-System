CREATE TYPE "public"."actor_role" AS ENUM('owner', 'partner');--> statement-breakpoint
CREATE TYPE "public"."partner_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."rule_type" AS ENUM('flat', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."conversion_status" AS ENUM('attributed', 'scheduled', 'completed', 'cancelled', 'no_show', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."earning_status" AS ENUM('needs_rule', 'pending', 'eligible', 'held', 'reserved', 'settled', 'voided', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('created', 'processing', 'settled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delivery_channel" AS ENUM('sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('accrual', 'payout', 'reversal', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."otp_status" AS ENUM('pending', 'verified', 'used', 'expired', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'previewed');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"sandbox_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_currency_check" CHECK ("organizations"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "organizations_version_check" CHECK ("organizations"."sandbox_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"phone_e164" text NOT NULL,
	"status" "partner_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "partners_org_user_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"role" "actor_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"partner_id" uuid,
	"category" text,
	"rule_type" "rule_type" NOT NULL,
	"flat_amount_minor" bigint,
	"basis_points" integer,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "commission_rules_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "commission_rules_shape_check" CHECK (("commission_rules"."rule_type" = 'flat' AND "commission_rules"."flat_amount_minor" IS NOT NULL AND "commission_rules"."basis_points" IS NULL) OR ("commission_rules"."rule_type" = 'percentage' AND "commission_rules"."flat_amount_minor" IS NULL AND "commission_rules"."basis_points" IS NOT NULL AND "commission_rules"."basis_points" BETWEEN 1 AND 10000)),
	CONSTRAINT "commission_rules_amount_check" CHECK ("commission_rules"."flat_amount_minor" IS NULL OR "commission_rules"."flat_amount_minor" >= 0),
	CONSTRAINT "commission_rules_dates_check" CHECK ("commission_rules"."effective_to" IS NULL OR "commission_rules"."effective_to" > "commission_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "program_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "referral_codes_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "referral_codes_org_code_unique" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "conversion_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversion_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"category" text NOT NULL,
	"gross_amount_minor" bigint NOT NULL,
	"refunded_base_minor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "conversion_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "conversion_items_org_conversion_ref_unique" UNIQUE("organization_id","conversion_id","external_ref"),
	CONSTRAINT "conversion_items_amounts_check" CHECK ("conversion_items"."gross_amount_minor" >= 0 AND "conversion_items"."refunded_base_minor" >= 0 AND "conversion_items"."refunded_base_minor" <= "conversion_items"."gross_amount_minor")
);
--> statement-breakpoint
CREATE TABLE "conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"referral_code_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"currency" text NOT NULL,
	"status" "conversion_status" DEFAULT 'attributed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversions_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "conversions_org_program_external_ref_unique" UNIQUE("organization_id","program_id","external_ref"),
	CONSTRAINT "conversions_currency_check" CHECK ("conversions"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "earning_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"earning_id" uuid NOT NULL,
	"previous_status" "earning_status" NOT NULL,
	"reason" text NOT NULL,
	"placed_by" uuid NOT NULL,
	"released_by" uuid,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "earning_holds_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "earning_holds_reason_check" CHECK (length(trim("earning_holds"."reason")) BETWEEN 3 AND 240),
	CONSTRAINT "earning_holds_previous_status_check" CHECK ("earning_holds"."previous_status" IN ('pending', 'eligible', 'reserved')),
	CONSTRAINT "earning_holds_release_check" CHECK (("earning_holds"."released_at" IS NULL AND "earning_holds"."released_by" IS NULL) OR ("earning_holds"."released_at" IS NOT NULL AND "earning_holds"."released_by" IS NOT NULL AND "earning_holds"."released_at" >= "earning_holds"."placed_at"))
);
--> statement-breakpoint
CREATE TABLE "earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversion_item_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"rule_id" uuid,
	"amount_minor" bigint NOT NULL,
	"reversed_amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"status" "earning_status" DEFAULT 'needs_rule' NOT NULL,
	"rule_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earnings_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "earnings_org_item_unique" UNIQUE("organization_id","conversion_item_id"),
	CONSTRAINT "earnings_amounts_check" CHECK ("earnings"."amount_minor" >= 0 AND "earnings"."reversed_amount_minor" >= 0 AND "earnings"."reversed_amount_minor" <= "earnings"."amount_minor"),
	CONSTRAINT "earnings_currency_check" CHECK ("earnings"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "claim_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"earning_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "claim_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "claim_items_org_claim_earning_unique" UNIQUE("organization_id","claim_id","earning_id"),
	CONSTRAINT "claim_items_amount_check" CHECK ("claim_items"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "claim_status" DEFAULT 'created' NOT NULL,
	"idempotency_key" text NOT NULL,
	"selection_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "claims_org_partner_idempotency_unique" UNIQUE("organization_id","partner_id","idempotency_key"),
	CONSTRAINT "claims_amount_check" CHECK ("claims"."amount_minor" >= 0),
	CONSTRAINT "claims_currency_check" CHECK ("claims"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"earning_id" uuid,
	"claim_id" uuid,
	"entry_type" "ledger_entry_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "ledger_currency_check" CHECK ("ledger_entries"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"claim_draft_hash" text NOT NULL,
	"code_digest" text NOT NULL,
	"channel" "delivery_channel" NOT NULL,
	"status" "otp_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resend_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_challenges_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "otp_attempts_check" CHECK ("otp_challenges"."attempts" >= 0),
	CONSTRAINT "otp_dates_check" CHECK ("otp_challenges"."expires_at" > "otp_challenges"."created_at" AND "otp_challenges"."resend_after" >= "otp_challenges"."created_at" AND "otp_challenges"."resend_after" <= "otp_challenges"."expires_at")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"actor_id" uuid,
	"is_system_event" boolean DEFAULT false NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "audit_events_org_event_key_unique" UNIQUE("organization_id","event_key"),
	CONSTRAINT "audit_events_actor_check" CHECK (("audit_events"."is_system_event" AND "audit_events"."actor_id" IS NULL) OR (NOT "audit_events"."is_system_event" AND "audit_events"."actor_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "demo_scenario_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"sandbox_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_scenario_runs_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "demo_scenario_runs_org_stage_version_unique" UNIQUE("organization_id","stage","sandbox_version"),
	CONSTRAINT "demo_scenario_runs_version_check" CHECK ("demo_scenario_runs"."sandbox_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"channel" "delivery_channel" NOT NULL,
	"provider" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"recipient" text NOT NULL,
	"content" text,
	"provider_reference" text,
	"otp_challenge_id" uuid,
	"claim_id" uuid,
	"earning_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "notification_outbox_org_dedupe_unique" UNIQUE("organization_id","dedupe_key"),
	CONSTRAINT "outbox_attempts_check" CHECK ("notification_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "webhook_events_provider_event_unique" UNIQUE("provider","provider_event_id")
);
--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_org_user_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."users"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "rules_org_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "rules_org_partner_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."partners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "codes_org_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "codes_org_partner_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."partners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_items" ADD CONSTRAINT "conversion_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_items" ADD CONSTRAINT "items_org_conversion_fk" FOREIGN KEY ("organization_id","conversion_id") REFERENCES "public"."conversions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_org_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_org_partner_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."partners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_org_code_fk" FOREIGN KEY ("organization_id","referral_code_id") REFERENCES "public"."referral_codes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_holds" ADD CONSTRAINT "earning_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_holds" ADD CONSTRAINT "holds_org_earning_fk" FOREIGN KEY ("organization_id","earning_id") REFERENCES "public"."earnings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_holds" ADD CONSTRAINT "holds_org_placed_by_fk" FOREIGN KEY ("organization_id","placed_by") REFERENCES "public"."users"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_holds" ADD CONSTRAINT "holds_org_released_by_fk" FOREIGN KEY ("organization_id","released_by") REFERENCES "public"."users"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_org_item_fk" FOREIGN KEY ("organization_id","conversion_item_id") REFERENCES "public"."conversion_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_org_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_org_partner_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."partners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_org_rule_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."commission_rules"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_org_claim_fk" FOREIGN KEY ("organization_id","claim_id") REFERENCES "public"."claims"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_org_earning_fk" FOREIGN KEY ("organization_id","earning_id") REFERENCES "public"."earnings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_org_partner_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."partners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_org_actor_fk" FOREIGN KEY ("organization_id","actor_id") REFERENCES "public"."users"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_org_partner_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."partners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_org_earning_fk" FOREIGN KEY ("organization_id","earning_id") REFERENCES "public"."earnings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_org_claim_fk" FOREIGN KEY ("organization_id","claim_id") REFERENCES "public"."claims"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_org_actor_fk" FOREIGN KEY ("organization_id","actor_id") REFERENCES "public"."users"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_org_partner_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."partners"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_org_actor_fk" FOREIGN KEY ("organization_id","actor_id") REFERENCES "public"."users"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_scenario_runs" ADD CONSTRAINT "demo_scenario_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "outbox_org_otp_fk" FOREIGN KEY ("organization_id","otp_challenge_id") REFERENCES "public"."otp_challenges"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "outbox_org_claim_fk" FOREIGN KEY ("organization_id","claim_id") REFERENCES "public"."claims"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "outbox_org_earning_fk" FOREIGN KEY ("organization_id","earning_id") REFERENCES "public"."earnings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_webhook_events" ADD CONSTRAINT "notification_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "earning_holds_one_active_idx" ON "earning_holds" USING btree ("organization_id","earning_id") WHERE "earning_holds"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "earnings_partner_status_idx" ON "earnings" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "otp_actor_status_expiry_idx" ON "otp_challenges" USING btree ("actor_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_status_available_idx" ON "notification_outbox" USING btree ("status","available_at");