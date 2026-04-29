-- Migrate presence_logs from a claim-only key to a polymorphic
-- (resource_type, resource_id) key so groups can also record presence.

ALTER TABLE "presence_logs" DROP CONSTRAINT IF EXISTS "presence_logs_claim_id_claims_id_fk";--> statement-breakpoint
ALTER TABLE "presence_logs" DROP CONSTRAINT IF EXISTS "presence_logs_claim_user";--> statement-breakpoint

ALTER TABLE "presence_logs" ADD COLUMN IF NOT EXISTS "resource_type" text;--> statement-breakpoint
UPDATE "presence_logs" SET "resource_type" = 'claim' WHERE "resource_type" IS NULL;--> statement-breakpoint
ALTER TABLE "presence_logs" ALTER COLUMN "resource_type" SET NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'presence_logs' AND column_name = 'claim_id'
  ) THEN
    ALTER TABLE "presence_logs" RENAME COLUMN "claim_id" TO "resource_id";
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "presence_logs" DROP CONSTRAINT IF EXISTS "presence_logs_resource_user";--> statement-breakpoint
ALTER TABLE "presence_logs" ADD CONSTRAINT "presence_logs_resource_user" UNIQUE ("resource_type", "resource_id", "user_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presence_logs_resource_idx" ON "presence_logs" USING btree ("resource_type", "resource_id");
