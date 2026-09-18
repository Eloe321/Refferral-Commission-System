ALTER TABLE "claim_items" ADD COLUMN "earning_amount_minor" bigint;
--> statement-breakpoint
UPDATE "claim_items" SET "earning_amount_minor" = "amount_minor";
--> statement-breakpoint
ALTER TABLE "claim_items" ALTER COLUMN "earning_amount_minor" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_earning_amount_check"
  CHECK ("earning_amount_minor" >= 0 AND "amount_minor" <= "earning_amount_minor");
