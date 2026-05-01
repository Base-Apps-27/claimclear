-- Per-leg / per-invoice state machine reshape.
--
-- Replaces the legacy `workflow_progress` JSONB blob with discrete typed
-- columns on `claims` and `invoice_groups`, introduces the append-only
-- `claim_verdict` (per-leg verdicts) and `state_events` (machine-data
-- transition log) tables, and adds the supporting indexes / CHECK
-- constraints. See `docs/architecture/per-invoice-transition.md` and
-- `lib/db/src/enums/leg-state.ts` for the pinned vocabulary.

-- ─────────────────────────────────────────────────────────────────────────
-- claims: per-leg state columns
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "claims" DROP COLUMN IF EXISTS "workflow_progress";--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "included_in_dispute" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "sop_node_id" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "sop_answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "sop_outcome" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "drop_reason" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "drop_note" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "dropped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "per_leg_context" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "mas_action_required" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "mas_action_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "mas_action_completed_by" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "mas_action_note" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "attestation_state" text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "attested_by" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "attestation_note" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "attestation_queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "attestation_queued_by" text;--> statement-breakpoint

ALTER TABLE "claims" DROP CONSTRAINT IF EXISTS "claims_sop_outcome_chk";--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_sop_outcome_chk" CHECK ("sop_outcome" IS NULL OR "sop_outcome" IN ('portal_dispute','dispute','hold','cannot_dispute','non_issue'));--> statement-breakpoint
ALTER TABLE "claims" DROP CONSTRAINT IF EXISTS "claims_drop_reason_chk";--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_drop_reason_chk" CHECK ("drop_reason" IS NULL OR "drop_reason" IN ('cannot_dispute','non_issue'));--> statement-breakpoint
ALTER TABLE "claims" DROP CONSTRAINT IF EXISTS "claims_mas_action_required_chk";--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_mas_action_required_chk" CHECK ("mas_action_required" IS NULL OR "mas_action_required" IN ('cancel','none'));--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_claims_sop_outcome" ON "claims" USING btree ("sop_outcome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_mas_action_pending" ON "claims" USING btree ("invoice_group_id") WHERE "mas_action_required" = 'cancel' AND "mas_action_completed_at" IS NULL;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- invoice_groups: group-level state columns
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "invoice_groups" DROP COLUMN IF EXISTS "workflow_progress";--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "group_context" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "understanding_readback" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "understanding_readback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "understanding_readback_by" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "preview_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "preview_generated_by" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "reattest_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "reattest_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "reattest_completed_by" text;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "reattest_note" text;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- claim_verdict: append-only per-leg verdict history
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "claim_verdict" (
  "id" serial PRIMARY KEY NOT NULL,
  "claim_id" integer NOT NULL,
  "source" text NOT NULL,
  "outcome" text NOT NULL,
  "note" text,
  "confidence" numeric(3, 2),
  "reasoning" text,
  "created_by" text,
  "inspection_time_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "claim_verdict_source_chk" CHECK ("source" IN ('ai_suggested','operator_confirmed')),
  CONSTRAINT "claim_verdict_outcome_chk" CHECK ("outcome" IN ('Approved','Denied','Partial'))
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "claim_verdict" ADD CONSTRAINT "claim_verdict_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claim_verdict_claim_created" ON "claim_verdict" USING btree ("claim_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claim_verdict_source_outcome" ON "claim_verdict" USING btree ("source","outcome","created_at" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- state_events: append-only machine-data transition log
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "state_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "event_key" text NOT NULL,
  "claim_id" integer,
  "invoice_group_id" integer,
  "actor_user_id" text,
  "duration_ms" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "state_events" ADD CONSTRAINT "state_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "state_events" ADD CONSTRAINT "state_events_invoice_group_id_invoice_groups_id_fk" FOREIGN KEY ("invoice_group_id") REFERENCES "public"."invoice_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_state_events_event_key_created" ON "state_events" USING btree ("event_key","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_state_events_group_created" ON "state_events" USING btree ("invoice_group_id","created_at" DESC);
