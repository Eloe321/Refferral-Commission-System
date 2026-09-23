CREATE TABLE "booking_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"program_id" uuid NOT NULL,
	"booking_ref" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"failure_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	CONSTRAINT "booking_webhook_events_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "booking_webhook_events_provider_id_unique" UNIQUE("organization_id","provider_event_id"),
	CONSTRAINT "booking_webhook_events_status_check" CHECK ("booking_webhook_events"."status" IN ('pending', 'processed', 'failed', 'ignored')),
	CONSTRAINT "booking_webhook_events_attempts_check" CHECK ("booking_webhook_events"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "booking_webhook_events" ADD CONSTRAINT "booking_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_webhook_events" ADD CONSTRAINT "booking_webhook_events_org_program_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."programs"("organization_id","id") ON DELETE no action ON UPDATE no action;