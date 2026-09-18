ALTER TABLE "conversion_items" ADD COLUMN "position" integer;--> statement-breakpoint
-- Existing items have no creation timestamp; their immutable UUID is the stable fallback order.
WITH ordered_items AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "organization_id", "conversion_id" ORDER BY "id"
  ) - 1 AS "position"
  FROM "conversion_items"
)
UPDATE "conversion_items" AS item SET "position" = ordered_items."position"
FROM ordered_items WHERE item."id" = ordered_items."id";--> statement-breakpoint
ALTER TABLE "conversion_items" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD COLUMN "conversion_id" uuid;--> statement-breakpoint
-- Retain the generic resource and cached response for replay compatibility. In-progress
-- records may have neither; the new nullable FK also permits those records.
UPDATE "idempotency_records" SET "conversion_id" = "resource_id"
WHERE "resource_id" IS NOT NULL
  AND ("scope" = 'conversion.create' OR "scope" LIKE 'conversion.complete:%');--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_org_conversion_fk" FOREIGN KEY ("organization_id","conversion_id") REFERENCES "public"."conversions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_items" ADD CONSTRAINT "conversion_items_org_conversion_position_unique" UNIQUE("organization_id","conversion_id","position");--> statement-breakpoint
ALTER TABLE "conversion_items" ADD CONSTRAINT "conversion_items_position_check" CHECK ("conversion_items"."position" >= 0);--> statement-breakpoint
