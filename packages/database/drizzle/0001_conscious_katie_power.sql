CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_id" uuid,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "idempotency_records_scope_key_unique" UNIQUE("organization_id","scope","idempotency_key"),
	CONSTRAINT "idempotency_records_key_check" CHECK (length(trim("idempotency_records"."idempotency_key")) BETWEEN 8 AND 120)
);
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;