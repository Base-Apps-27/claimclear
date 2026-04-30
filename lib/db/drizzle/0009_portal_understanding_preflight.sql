ALTER TABLE "portal_submissions" ADD COLUMN IF NOT EXISTS "special_circumstances" text;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN IF NOT EXISTS "understanding_readback" text;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN IF NOT EXISTS "understanding_readback_at" timestamp with time zone;
