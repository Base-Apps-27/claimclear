ALTER TABLE "outbound_emails" ADD COLUMN "to" jsonb;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "cc" jsonb;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "delivery_receipt_requested" boolean DEFAULT false NOT NULL;