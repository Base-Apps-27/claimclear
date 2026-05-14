CREATE TYPE "public"."portal_scrape_outcome" AS ENUM('new_reply', 'no_change', 'error');--> statement-breakpoint
CREATE TABLE "reply_attachment_staging" (
	"id" text PRIMARY KEY NOT NULL,
	"user_email" text,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "last_scraped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "last_scrape_outcome" "portal_scrape_outcome";--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "last_scrape_error" text;--> statement-breakpoint
CREATE INDEX "reply_attachment_staging_created_at_idx" ON "reply_attachment_staging" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reply_attachment_staging_user_email_idx" ON "reply_attachment_staging" USING btree ("user_email");--> statement-breakpoint
CREATE INDEX "portal_submissions_last_scraped_at_idx" ON "portal_submissions" USING btree ("last_scraped_at");