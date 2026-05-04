ALTER TABLE "outbound_emails" ADD COLUMN "error_excerpt" text;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "metadata" jsonb;