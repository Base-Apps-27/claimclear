ALTER TABLE "invoice_groups" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "draft_discarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "draft_discarded_subject" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "draft_discarded_description_html" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "removed_offline_at" timestamp with time zone;