ALTER TYPE "public"."claim_outcome" ADD VALUE 'Withdrawn';--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_reason" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_reason" text;