ALTER TABLE "invoice_groups" ADD COLUMN "closure_category" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_category_other" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_root_cause" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_root_cause_other" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_narrative" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_accountability_tags" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_accountability_other" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_drivers" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_dispatchers" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_communicated_to" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_review_state" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_addressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_addressed_by" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_addressed_by_email" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_review_notes" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_category" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_category_other" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_root_cause" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_root_cause_other" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_narrative" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_accountability_tags" jsonb;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_accountability_other" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_drivers" jsonb;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_dispatchers" jsonb;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_communicated_to" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_review_state" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_addressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_addressed_by" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_addressed_by_email" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_review_notes" text;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD COLUMN "closure_scope" text;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD COLUMN "closure_reason_at_attach" text;
