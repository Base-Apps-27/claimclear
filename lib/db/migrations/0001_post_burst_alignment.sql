-- 0001_post_burst_alignment.sql
--
-- Aligns the production database with the post-burst TypeScript schema
-- (per-leg state machine: SOP, drop reasons, MAS action, attestation,
-- reattest, special circumstances, understanding readback, claim verdict
-- history, state events).
--
-- Background: until this migration shipped, schema changes were applied to
-- the dev DB via `drizzle-kit push --force` from `scripts/post-merge.sh`,
-- but production never ran a push step. After the per-leg burst, prod was
-- missing ~30 columns and 2 whole tables, so every dashboard read returned
-- 500. The first attempt to fix this by adding `push --force` to the prod
-- build silently no-op'd because drizzle-kit's rename-disambiguation
-- prompt cannot be answered in a non-TTY build (and `--force` only skips
-- data-loss prompts, not rename prompts).
--
-- This file is the explicit, idempotent SQL we apply via the new
-- `pnpm --filter @workspace/db run migrate` script (see
-- `lib/db/scripts/apply-migrations.mjs`). The runner records applied
-- migrations in a `__schema_migrations` table so re-runs are no-ops.
--
-- Safety:
--   * Every ADD COLUMN uses `IF NOT EXISTS`, so this is safe to re-run
--     against environments that are already up-to-date (e.g. dev).
--   * The two `workflow_progress` JSONB columns are dropped intentionally;
--     legacy data was exported to CSV in `attached_assets/prod-backups/`
--     before this migration shipped.
--   * `portal_submissions.claim_id` is intentionally PRESERVED — the
--     current TS schema doesn't reference it but the column still holds
--     278 rows of historical submission→claim links. A separate cleanup
--     can drop it later once we're sure nothing needs it.
--   * The 3 prod rows where `portal_submissions.invoice_group_id` is NULL
--     are backfilled from the existing `claim_id → claims.invoice_group_id`
--     link before we tighten the NOT NULL constraint.

BEGIN;

-- ============================================================
-- 0) Pre-migration data backfill
-- ============================================================

-- Three portal_submissions rows have NULL invoice_group_id but a valid
-- claim_id; backfill from the claim's group so the NOT NULL ALTER below
-- doesn't fail. (Runs as a no-op on dev where these rows don't exist.)
UPDATE portal_submissions ps
SET invoice_group_id = c.invoice_group_id
FROM claims c
WHERE ps.claim_id = c.id
  AND ps.invoice_group_id IS NULL
  AND c.invoice_group_id IS NOT NULL;

-- ============================================================
-- 1) New tables: claim_verdict, state_events
-- ============================================================

CREATE TABLE IF NOT EXISTS claim_verdict (
  id SERIAL PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  outcome TEXT NOT NULL,
  note TEXT,
  confidence NUMERIC(3,2),
  reasoning TEXT,
  created_by TEXT,
  inspection_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT claim_verdict_source_chk
    CHECK (source IN ('ai_suggested','operator_confirmed')),
  CONSTRAINT claim_verdict_outcome_chk
    CHECK (outcome IN ('Approved','Denied','Partial'))
);

CREATE INDEX IF NOT EXISTS idx_claim_verdict_claim_created
  ON claim_verdict (claim_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claim_verdict_source_outcome
  ON claim_verdict (source, outcome, created_at DESC);

CREATE TABLE IF NOT EXISTS state_events (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL,
  claim_id INTEGER REFERENCES claims(id) ON DELETE SET NULL,
  invoice_group_id INTEGER REFERENCES invoice_groups(id) ON DELETE SET NULL,
  actor_user_id TEXT,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_events_event_key_created
  ON state_events (event_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_state_events_group_created
  ON state_events (invoice_group_id, created_at DESC);

-- ============================================================
-- 2) claims: 19 new columns + 2 indexes + 3 check constraints
-- ============================================================

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS included_in_dispute BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sop_node_id TEXT,
  ADD COLUMN IF NOT EXISTS sop_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sop_outcome TEXT,
  ADD COLUMN IF NOT EXISTS drop_reason TEXT,
  ADD COLUMN IF NOT EXISTS drop_note TEXT,
  ADD COLUMN IF NOT EXISTS dropped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS per_leg_context TEXT,
  ADD COLUMN IF NOT EXISTS mas_action_required TEXT,
  ADD COLUMN IF NOT EXISTS mas_action_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mas_action_completed_by TEXT,
  ADD COLUMN IF NOT EXISTS mas_action_note TEXT,
  ADD COLUMN IF NOT EXISTS attestation_state TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS attested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attested_by TEXT,
  ADD COLUMN IF NOT EXISTS attestation_note TEXT,
  ADD COLUMN IF NOT EXISTS attestation_queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attestation_queued_by TEXT;

CREATE INDEX IF NOT EXISTS idx_claims_sop_outcome ON claims (sop_outcome);

CREATE INDEX IF NOT EXISTS idx_claims_mas_action_pending
  ON claims (invoice_group_id)
  WHERE mas_action_required = 'cancel' AND mas_action_completed_at IS NULL;

ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_sop_outcome_chk;
ALTER TABLE claims ADD CONSTRAINT claims_sop_outcome_chk
  CHECK (sop_outcome IS NULL OR sop_outcome IN
    ('portal_dispute','dispute','hold','cannot_dispute','non_issue'));

ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_drop_reason_chk;
ALTER TABLE claims ADD CONSTRAINT claims_drop_reason_chk
  CHECK (drop_reason IS NULL OR drop_reason IN ('cannot_dispute','non_issue'));

ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_mas_action_required_chk;
ALTER TABLE claims ADD CONSTRAINT claims_mas_action_required_chk
  CHECK (mas_action_required IS NULL OR mas_action_required IN ('cancel','none'));

-- ============================================================
-- 3) invoice_groups: 10 new columns
-- ============================================================

ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS group_context TEXT,
  ADD COLUMN IF NOT EXISTS understanding_readback TEXT,
  ADD COLUMN IF NOT EXISTS understanding_readback_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS understanding_readback_by TEXT,
  ADD COLUMN IF NOT EXISTS preview_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preview_generated_by TEXT,
  ADD COLUMN IF NOT EXISTS reattest_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reattest_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reattest_completed_by TEXT,
  ADD COLUMN IF NOT EXISTS reattest_note TEXT;

-- ============================================================
-- 4) outbound_emails: 1 new column
-- ============================================================

ALTER TABLE outbound_emails
  ADD COLUMN IF NOT EXISTS attachment_names JSONB;

-- ============================================================
-- 5) portal_submissions: 3 new columns + tighten invoice_group_id
-- ============================================================

ALTER TABLE portal_submissions
  ADD COLUMN IF NOT EXISTS special_circumstances TEXT,
  ADD COLUMN IF NOT EXISTS understanding_readback TEXT,
  ADD COLUMN IF NOT EXISTS understanding_readback_at TIMESTAMPTZ;

ALTER TABLE portal_submissions ALTER COLUMN invoice_group_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS portal_submissions_invoice_group_id_idx
  ON portal_submissions (invoice_group_id);

-- ============================================================
-- 6) Drop legacy workflow_progress JSONB columns
--
-- Replaced by the discrete typed columns added above (status, sub_status,
-- attestation_state, mas_action_required, sop_outcome, etc.). The 162
-- claim rows and 54 invoice_group rows that held values were exported to
-- attached_assets/prod-backups/ before this migration shipped.
-- ============================================================

ALTER TABLE claims DROP COLUMN IF EXISTS workflow_progress;
ALTER TABLE invoice_groups DROP COLUMN IF EXISTS workflow_progress;

COMMIT;
