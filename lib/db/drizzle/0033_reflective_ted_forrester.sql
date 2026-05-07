ALTER TYPE "public"."claim_disposition" ADD VALUE 'disposed_expired';--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "submitted_via" text;--> statement-breakpoint
CREATE INDEX "claims_submitted_via_idx" ON "claims" USING btree ("invoice_group_id") WHERE "claims"."submitted_via" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_submitted_via_chk" CHECK ("claims"."submitted_via" IS NULL OR "claims"."submitted_via" IN ('portal','email'));