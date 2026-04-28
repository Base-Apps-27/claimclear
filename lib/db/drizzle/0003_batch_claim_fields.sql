ALTER TABLE "portal_submissions" ADD COLUMN "claimed_by_batch_id" text;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "claimed_by_user_name" text;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "claimed_at" timestamp with time zone;