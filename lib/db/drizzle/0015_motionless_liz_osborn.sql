ALTER TABLE "invoice_groups" ADD COLUMN "draft_subject" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "draft_description_html" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "ai_baseline_subject" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "ai_baseline_description_html" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "draft_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "draft_edited_by" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "draft_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "draft_reviewed_by" text;