ALTER TYPE "public"."outbox_status" ADD VALUE 'unknown' BEFORE 'sent';
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "reconciliation_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "outbox_reconciliation_attempts_check"
  CHECK ("reconciliation_attempts" >= 0);
--> statement-breakpoint
UPDATE "notification_outbox"
SET "content" = NULL,
    "recipient" = CASE
      WHEN "channel" = 'sms' THEN '***' || right("recipient", 4)
      ELSE left(split_part("recipient", '@', 1), 1) || '***@' ||
           left(split_part("recipient", '@', 2), 1) || '***'
    END
WHERE "status" = 'processing' AND "provider_reference" IS NOT NULL;
