ALTER TABLE "presence_logs" DROP CONSTRAINT "presence_logs_resource_user";--> statement-breakpoint
ALTER TABLE "claims" DROP CONSTRAINT "claims_drop_reason_chk";--> statement-breakpoint
ALTER TABLE "claims" DROP CONSTRAINT "claims_mas_action_required_chk";--> statement-breakpoint
ALTER TABLE "claims" DROP CONSTRAINT "claims_sop_outcome_chk";--> statement-breakpoint
ALTER TABLE "claim_verdict" DROP CONSTRAINT "claim_verdict_outcome_chk";--> statement-breakpoint
ALTER TABLE "claim_verdict" DROP CONSTRAINT "claim_verdict_source_chk";--> statement-breakpoint
ALTER TABLE "portal_submissions" DROP CONSTRAINT "portal_submissions_claim_id_claims_id_fk";
--> statement-breakpoint
ALTER TABLE "portal_submissions" DROP CONSTRAINT "portal_submissions_invoice_group_id_invoice_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "claim_evidence" DROP CONSTRAINT "claim_evidence_invoice_group_id_invoice_groups_id_fk";
--> statement-breakpoint
DROP INDEX "portal_submissions_claim_id_idx";--> statement-breakpoint
DROP INDEX "IDX_session_expire";--> statement-breakpoint
DROP INDEX "portal_submissions_status_idx";--> statement-breakpoint
DROP INDEX "notes_claim_id_idx";--> statement-breakpoint
DROP INDEX "audit_logs_claim_id_idx";--> statement-breakpoint
DROP INDEX "invoice_groups_created_at_idx";--> statement-breakpoint
DROP INDEX "invoice_groups_invoice_number_idx";--> statement-breakpoint
DROP INDEX "invoice_groups_outcome_idx";--> statement-breakpoint
DROP INDEX "invoice_groups_status_idx";--> statement-breakpoint
DROP INDEX "bot_activity_log_submission_id_idx";--> statement-breakpoint
DROP INDEX "portal_responses_claim_id_idx";--> statement-breakpoint
DROP INDEX "portal_responses_external_message_id_idx";--> statement-breakpoint
DROP INDEX "portal_responses_processed_idx";--> statement-breakpoint
DROP INDEX "portal_responses_source_idx";--> statement-breakpoint
DROP INDEX "portal_responses_submission_id_idx";--> statement-breakpoint
DROP INDEX "presence_logs_resource_idx";--> statement-breakpoint
DROP INDEX "claim_evidence_claim_id_idx";--> statement-breakpoint
DROP INDEX "claims_conf_number_idx";--> statement-breakpoint
DROP INDEX "claims_created_at_idx";--> statement-breakpoint
DROP INDEX "claims_date_idx";--> statement-breakpoint
DROP INDEX "claims_invoice_group_id_idx";--> statement-breakpoint
DROP INDEX "claims_status_idx";--> statement-breakpoint
DROP INDEX "idx_claims_mas_action_pending";--> statement-breakpoint
DROP INDEX "idx_claims_sop_outcome";--> statement-breakpoint
DROP INDEX "outbound_emails_claim_id_idx";--> statement-breakpoint
DROP INDEX "outbound_emails_conversation_id_idx";--> statement-breakpoint
DROP INDEX "outbound_emails_invoice_group_id_idx";--> statement-breakpoint
DROP INDEX "cron_runs_job_name_started_idx";--> statement-breakpoint
DROP INDEX "cron_runs_started_idx";--> statement-breakpoint
DROP INDEX "email_bounces_received_idx";--> statement-breakpoint
DROP INDEX "email_bounces_recipient_idx";--> statement-breakpoint
DROP INDEX "portal_batch_runs_started_at_idx";--> statement-breakpoint
DROP INDEX "portal_batch_runs_triggered_by_email_idx";--> statement-breakpoint
DROP INDEX "idx_claim_verdict_claim_created";--> statement-breakpoint
DROP INDEX "idx_claim_verdict_source_outcome";--> statement-breakpoint
DROP INDEX "idx_state_events_event_key_created";--> statement-breakpoint
DROP INDEX "idx_state_events_group_created";--> statement-breakpoint
ALTER TABLE "portal_submissions" ALTER COLUMN "invoice_group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "claim_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_evidence" ALTER COLUMN "claim_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "description_editor_email" text;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "description_editor_name" text;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "description_history" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "max_attempts" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "error_types" ADD COLUMN "use_gps_control_deviation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "error_types" ADD COLUMN "use_direct_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD COLUMN "extracted_amount" text;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD COLUMN "extracted_deadline" text;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD COLUMN "requested_action" text;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD COLUMN "classifier_source" text DEFAULT 'keyword' NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD COLUMN "classifier_confidence" text;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_invoice_group_id_invoice_groups_id_fk" FOREIGN KEY ("invoice_group_id") REFERENCES "public"."invoice_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_invoice_group_id_invoice_groups_id_fk" FOREIGN KEY ("invoice_group_id") REFERENCES "public"."invoice_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_submissions_invoice_group_id_idx" ON "portal_submissions" USING btree ("invoice_group_id");--> statement-breakpoint
CREATE INDEX "portal_responses_conversation_id_idx" ON "portal_responses" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "portal_submissions_status_idx" ON "portal_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notes_claim_id_idx" ON "notes" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "audit_logs_claim_id_idx" ON "audit_logs" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "invoice_groups_created_at_idx" ON "invoice_groups" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "invoice_groups_invoice_number_idx" ON "invoice_groups" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoice_groups_outcome_idx" ON "invoice_groups" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "invoice_groups_status_idx" ON "invoice_groups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bot_activity_log_submission_id_idx" ON "bot_activity_log" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "portal_responses_claim_id_idx" ON "portal_responses" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "portal_responses_external_message_id_idx" ON "portal_responses" USING btree ("external_message_id");--> statement-breakpoint
CREATE INDEX "portal_responses_processed_idx" ON "portal_responses" USING btree ("processed");--> statement-breakpoint
CREATE INDEX "portal_responses_source_idx" ON "portal_responses" USING btree ("source");--> statement-breakpoint
CREATE INDEX "portal_responses_submission_id_idx" ON "portal_responses" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "presence_logs_resource_idx" ON "presence_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_claim_id_idx" ON "claim_evidence" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claims_conf_number_idx" ON "claims" USING btree ("conf_number");--> statement-breakpoint
CREATE INDEX "claims_created_at_idx" ON "claims" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "claims_date_idx" ON "claims" USING btree ("date");--> statement-breakpoint
CREATE INDEX "claims_invoice_group_id_idx" ON "claims" USING btree ("invoice_group_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_claims_mas_action_pending" ON "claims" USING btree ("invoice_group_id") WHERE "claims"."mas_action_required" = 'cancel' AND "claims"."mas_action_completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_claims_sop_outcome" ON "claims" USING btree ("sop_outcome");--> statement-breakpoint
CREATE INDEX "outbound_emails_claim_id_idx" ON "outbound_emails" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "outbound_emails_conversation_id_idx" ON "outbound_emails" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "outbound_emails_invoice_group_id_idx" ON "outbound_emails" USING btree ("invoice_group_id");--> statement-breakpoint
CREATE INDEX "cron_runs_job_name_started_idx" ON "cron_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE INDEX "cron_runs_started_idx" ON "cron_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "email_bounces_received_idx" ON "email_bounces" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "email_bounces_recipient_idx" ON "email_bounces" USING btree ("recipient_email");--> statement-breakpoint
CREATE INDEX "portal_batch_runs_started_at_idx" ON "portal_batch_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "portal_batch_runs_triggered_by_email_idx" ON "portal_batch_runs" USING btree ("triggered_by_email");--> statement-breakpoint
CREATE INDEX "idx_claim_verdict_claim_created" ON "claim_verdict" USING btree ("claim_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_claim_verdict_source_outcome" ON "claim_verdict" USING btree ("source","outcome","created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_state_events_event_key_created" ON "state_events" USING btree ("event_key","created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_state_events_group_created" ON "state_events" USING btree ("invoice_group_id","created_at" DESC);--> statement-breakpoint
ALTER TABLE "portal_submissions" DROP COLUMN "claim_id";--> statement-breakpoint
ALTER TABLE "presence_logs" ADD CONSTRAINT "presence_logs_resource_user" UNIQUE("resource_type","resource_id","user_email");--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_drop_reason_chk" CHECK ("claims"."drop_reason" IS NULL OR "claims"."drop_reason" IN ('cannot_dispute','non_issue'));--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_mas_action_required_chk" CHECK ("claims"."mas_action_required" IS NULL OR "claims"."mas_action_required" IN ('cancel','none'));--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_sop_outcome_chk" CHECK ("claims"."sop_outcome" IS NULL OR "claims"."sop_outcome" IN ('portal_dispute','dispute','hold','cannot_dispute','non_issue'));--> statement-breakpoint
ALTER TABLE "claim_verdict" ADD CONSTRAINT "claim_verdict_outcome_chk" CHECK ("claim_verdict"."outcome" IN ('Approved','Denied','Partial'));--> statement-breakpoint
ALTER TABLE "claim_verdict" ADD CONSTRAINT "claim_verdict_source_chk" CHECK ("claim_verdict"."source" IN ('ai_suggested','operator_confirmed'));