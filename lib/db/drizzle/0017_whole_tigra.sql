ALTER TABLE "invoice_groups" ADD COLUMN "payor_denial_reason" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "payor_denial_reason_note" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "payor_denial_reason_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "payor_denial_reason_by" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "awaiting_payor_again_at" timestamp with time zone;