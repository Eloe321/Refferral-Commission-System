-- Reconcile legacy 0000 installations without rewriting their applied migration.
ALTER TABLE "earning_holds" DROP CONSTRAINT IF EXISTS "earning_holds_previous_status_check";
--> statement-breakpoint
ALTER TABLE "earning_holds" ADD CONSTRAINT "earning_holds_previous_status_check"
  CHECK ("previous_status" IN ('pending', 'eligible', 'reserved'));
