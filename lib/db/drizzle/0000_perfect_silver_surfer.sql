CREATE TYPE "public"."claim_outcome" AS ENUM('Pending', 'Approved', 'Denied', 'Partially Approved', 'Non-Issue');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('New', 'Needs Review', 'Needs Evidence', 'Portal Queued', 'Generating Email', 'Ready to Review', 'Awaiting Response', 'On Hold', 'Resolved', 'Denied');--> statement-breakpoint
CREATE TYPE "public"."note_type" AS ENUM('manual', 'email', 'email_sent', 'reply_parsed', 'status_change', 'outcome_recorded', 'system', 'bot');--> statement-breakpoint
CREATE TYPE "public"."portal_submission_status" AS ENUM('draft', 'pending', 'in_progress', 'submitted', 'failed', 'cancelled', 'dry_run');--> statement-breakpoint
CREATE TYPE "public"."bot_status" AS ENUM('running', 'idle', 'error', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."response_source" AS ENUM('email', 'portal', 'manual');--> statement-breakpoint
CREATE TYPE "public"."response_type" AS ENUM('approval', 'denial', 'partial_approval', 'info_request', 'acknowledgment', 'other');--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"role" varchar DEFAULT 'user' NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "invoice_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"client_number" text,
	"error_details" text,
	"error_type_id" text,
	"error_type_name" text,
	"status" "claim_status" DEFAULT 'New' NOT NULL,
	"outcome" "claim_outcome" DEFAULT 'Pending' NOT NULL,
	"approved_amount" numeric(12, 2),
	"ride_count" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(12, 2),
	"workflow_progress" jsonb,
	"hold_reason" text,
	"hold_pending_from" text,
	"hold_placed_at" text,
	"triage_notes" text,
	"triaged_at" text,
	"dispute_email_sent" boolean DEFAULT false NOT NULL,
	"dispute_email_sent_at" text,
	"generated_email_subject" text,
	"generated_email_body" text,
	"generated_email_at" text,
	"evidence_files" jsonb,
	"evidence_notes" text,
	"evidence_checklist" jsonb,
	"payor_email" text,
	"import_batch" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_group_id" integer,
	"conf_number" text NOT NULL,
	"date" text,
	"ref_number" text,
	"client_number" text,
	"car_number" text,
	"error_details" text,
	"error_type_id" text,
	"error_type_name" text,
	"claim_amount" numeric(12, 2),
	"status" "claim_status" DEFAULT 'New' NOT NULL,
	"outcome" "claim_outcome" DEFAULT 'Pending' NOT NULL,
	"approved_amount" numeric(12, 2),
	"invoice_numbers" text,
	"payor_email" text,
	"dispute_email_sent" boolean DEFAULT false NOT NULL,
	"dispute_email_sent_at" text,
	"import_batch" text,
	"evidence_files" jsonb,
	"evidence_notes" text,
	"evidence_checklist" jsonb,
	"generated_email_subject" text,
	"generated_email_body" text,
	"generated_email_at" text,
	"workflow_progress" jsonb,
	"hold_reason" text,
	"hold_pending_from" text,
	"hold_placed_at" text,
	"triage_notes" text,
	"triaged_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"guidance" text,
	"recommended_actions" text,
	"dispute_reasons_library" jsonb,
	"evidence_requirements" jsonb,
	"decision_tree" jsonb,
	"email_template" text,
	"dispute_instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"invoice_group_id" integer,
	"type" "note_type" DEFAULT 'manual' NOT NULL,
	"content" text NOT NULL,
	"author" text,
	"email_subject" text,
	"extracted_invoice_numbers" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer,
	"invoice_group_id" integer,
	"action" text NOT NULL,
	"details" text NOT NULL,
	"metadata" jsonb,
	"user_email" text,
	"user_name" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"invoice_group_id" integer,
	"status" "portal_submission_status" DEFAULT 'pending' NOT NULL,
	"issue_type" text,
	"subject" text,
	"requester_email" text,
	"transportation_provider_name" text,
	"phone_number" text,
	"invoice_number" text,
	"gps_breadcrumbs_available" text,
	"description_html" text,
	"attachment_urls" jsonb,
	"conf_number" text,
	"service_date" text,
	"ref_number" text,
	"client_number" text,
	"car_number" text,
	"claim_amount" numeric(12, 2),
	"error_type_name" text,
	"error_details" text,
	"dispute_reason" text,
	"evidence_notes" text,
	"evidence_files" jsonb,
	"workflow_history" jsonb,
	"portal_ticket_id" text,
	"screenshot_url" text,
	"error_message" text,
	"submitted_at" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presence_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"user_email" text NOT NULL,
	"user_name" text,
	"last_heartbeat" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presence_logs_claim_user" UNIQUE("claim_id","user_email")
);
--> statement-breakpoint
CREATE TABLE "bot_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "bot_status" DEFAULT 'running' NOT NULL,
	"last_heartbeat" timestamp with time zone DEFAULT now() NOT NULL,
	"last_poll_at" timestamp with time zone,
	"submissions_today" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"session_valid" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"bot_instance_id" integer,
	"action" text NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"message" text,
	"screenshot_path" text,
	"page_html_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_detail_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"normalized_text" text NOT NULL,
	"original_text" text NOT NULL,
	"error_type_id" integer NOT NULL,
	"error_type_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "error_detail_mappings_normalized_text_unique" UNIQUE("normalized_text")
);
--> statement-breakpoint
CREATE TABLE "evidence_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"accepts_image" boolean DEFAULT true NOT NULL,
	"accepts_text" boolean DEFAULT false NOT NULL,
	"instruction_text" text,
	"instruction_image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"invoice_group_id" integer,
	"evidence_type_id" integer,
	"evidence_type_name" text NOT NULL,
	"tree_node_id" text,
	"image_url" text,
	"notes" text,
	"collected_by" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "portal_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer,
	"invoice_group_id" integer,
	"submission_id" integer,
	"source" "response_source" NOT NULL,
	"responseType" "response_type" DEFAULT 'other' NOT NULL,
	"subject" text,
	"content" text,
	"raw_content" text,
	"sender_email" text,
	"sender_name" text,
	"matched_via" text,
	"match_confidence" text,
	"portal_ticket_id" text,
	"external_message_id" text,
	"processed" boolean DEFAULT false NOT NULL,
	"auto_linked" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_invoice_group_id_invoice_groups_id_fk" FOREIGN KEY ("invoice_group_id") REFERENCES "public"."invoice_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_invoice_group_id_invoice_groups_id_fk" FOREIGN KEY ("invoice_group_id") REFERENCES "public"."invoice_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_invoice_group_id_invoice_groups_id_fk" FOREIGN KEY ("invoice_group_id") REFERENCES "public"."invoice_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_invoice_group_id_invoice_groups_id_fk" FOREIGN KEY ("invoice_group_id") REFERENCES "public"."invoice_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_logs" ADD CONSTRAINT "presence_logs_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_activity_log" ADD CONSTRAINT "bot_activity_log_submission_id_portal_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."portal_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_activity_log" ADD CONSTRAINT "bot_activity_log_bot_instance_id_bot_instances_id_fk" FOREIGN KEY ("bot_instance_id") REFERENCES "public"."bot_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_detail_mappings" ADD CONSTRAINT "error_detail_mappings_error_type_id_error_types_id_fk" FOREIGN KEY ("error_type_id") REFERENCES "public"."error_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_invoice_group_id_invoice_groups_id_fk" FOREIGN KEY ("invoice_group_id") REFERENCES "public"."invoice_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_type_id_evidence_types_id_fk" FOREIGN KEY ("evidence_type_id") REFERENCES "public"."evidence_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD CONSTRAINT "portal_responses_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD CONSTRAINT "portal_responses_invoice_group_id_invoice_groups_id_fk" FOREIGN KEY ("invoice_group_id") REFERENCES "public"."invoice_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD CONSTRAINT "portal_responses_submission_id_portal_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."portal_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "invoice_groups_invoice_number_idx" ON "invoice_groups" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoice_groups_status_idx" ON "invoice_groups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_groups_outcome_idx" ON "invoice_groups" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "invoice_groups_created_at_idx" ON "invoice_groups" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "claims_conf_number_idx" ON "claims" USING btree ("conf_number");--> statement-breakpoint
CREATE INDEX "claims_invoice_group_id_idx" ON "claims" USING btree ("invoice_group_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "claims_date_idx" ON "claims" USING btree ("date");--> statement-breakpoint
CREATE INDEX "claims_created_at_idx" ON "claims" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notes_claim_id_idx" ON "notes" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "audit_logs_claim_id_idx" ON "audit_logs" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "portal_submissions_claim_id_idx" ON "portal_submissions" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "portal_submissions_status_idx" ON "portal_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bot_activity_log_submission_id_idx" ON "bot_activity_log" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_claim_id_idx" ON "claim_evidence" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "portal_responses_claim_id_idx" ON "portal_responses" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "portal_responses_submission_id_idx" ON "portal_responses" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "portal_responses_source_idx" ON "portal_responses" USING btree ("source");--> statement-breakpoint
CREATE INDEX "portal_responses_external_message_id_idx" ON "portal_responses" USING btree ("external_message_id");--> statement-breakpoint
CREATE INDEX "portal_responses_processed_idx" ON "portal_responses" USING btree ("processed");