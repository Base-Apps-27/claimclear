CREATE TYPE "public"."invoice_phase" AS ENUM('triage', 'ready_to_submit', 'submitted', 'response_received', 'reviewed', 'awaiting_reattestation', 'closed');--> statement-breakpoint
CREATE TYPE "public"."claim_disposition" AS ENUM('unclassified', 'classifying', 'disposed_portal', 'disposed_email', 'disposed_withdraw', 'disposed_nonissue', 'blocked', 'duplicate', 'awaiting_review', 'verdict_drafted', 'verdict_approved', 'verdict_denied', 'verdict_partial', 'attest_pending', 'attest_queued', 'attested', 'mas_cancelled', 'attest_not_required', 'final_reattested', 'final_withdrawn', 'final_denied', 'final_nonissue');--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "phase" "invoice_phase" DEFAULT 'triage' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "phase_entered_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "disposition" "claim_disposition" DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
CREATE INDEX "invoice_groups_phase_idx" ON "invoice_groups" USING btree ("phase");--> statement-breakpoint
CREATE INDEX "claims_disposition_idx" ON "claims" USING btree ("disposition");--> statement-breakpoint
CREATE INDEX "claims_invoice_group_disposition_idx" ON "claims" USING btree ("invoice_group_id","disposition");