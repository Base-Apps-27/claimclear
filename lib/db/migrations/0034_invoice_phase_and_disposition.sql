-- 0034_invoice_phase_and_disposition.sql
-- Wave B of the hierarchical state machine refactor (2026-05-07).
--
-- One atomic migration that:
--   1. Creates the `invoice_phase` and `claim_disposition` Postgres enums.
--   2. Adds `invoice_groups.phase`, `invoice_groups.phase_entered_at`, and
--      `claims.disposition` columns (NOT NULL with safe defaults so the
--      ADD COLUMN is non-blocking on the existing rows).
--   3. Heals four small drift cases on `invoice_groups.closure_reason`
--      that the §6.1 deriver expects to be populated for closed phases
--      (denied/non_issue/expired/reattested/withdrawn — all currently NULL
--      on a handful of prod rows per state-pre-migration-census.md §A).
--   4. Backfills `invoice_groups.phase` per `derivePhaseFromLegacy` (§6.1).
--   5. Backfills `claims.disposition` per `deriveDispositionFromLegacy` (§6.2).
--   6. Adds the cross-row deferrable trigger from spec §5.2 — kept AFTER
--      the backfill so the bulk UPDATEs cannot trip it on partial state.
--   7. Adds reader-supporting indexes for Wave C.
--
-- Lockstep constraints (change one, change ALL THREE — there are runtime tests
-- that compare these to keep them in sync):
--   * The `invoice_phase` / `claim_disposition` enum value lists below MUST
--     match `INVOICE_PHASES` / `CLAIM_DISPOSITIONS` in `lib/vocab/src/`.
--   * The trigger's per-phase `valid_set` CASE below MUST match
--     `VALID_DISPOSITIONS_BY_PHASE` in `lib/vocab/src/claim-disposition.ts`.
--   * The backfill CASE expressions in steps 3+4 MUST match
--     `derivePhaseFromLegacy` / `deriveDispositionFromLegacy` in
--     `lib/invoice-state/src/`. The TS derivers are the spec; the SQL is the
--     executable. `scripts/src/check-invoice-state-derivation.ts` runs the TS
--     derivers against every prod row and asserts equality — wire it into CI.
--
-- Pre-conditions (verified 2026-05-07 against prod, see
-- state-pre-migration-census.md §A/§B/§C):
--   * §A invoice tuple census: 1,310 rows, 14 distinct tuples, all map cleanly.
--   * §B claim tuple census: 2,406 rows, 33 distinct tuples; R1 mapping
--     returns 0 NULL dispositions across 2,406 rows.
--
-- Post-Wave-B / pre-Wave-D operational note: between Wave B publish and Wave D
-- publish the legacy writers continue to mutate `(status, outcome, ...)` while
-- the new columns sit static at their backfilled values. Wave D's first task
-- is therefore a re-backfill from the legacy columns at the moment the writer
-- swap happens — see docs/architecture/state-hierarchy-execution-plan.md.
--
-- Idempotent: every CREATE/ALTER uses IF NOT EXISTS or DO-block guards so a
-- failed mid-flight retry is a no-op.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE invoice_phase AS ENUM (
    'triage','ready_to_submit','submitted','response_received',
    'reviewed','awaiting_reattestation','closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE claim_disposition AS ENUM (
    'unclassified','classifying','disposed_portal','disposed_email',
    'disposed_withdraw','disposed_nonissue','blocked','duplicate',
    'awaiting_review','verdict_drafted',
    'verdict_approved','verdict_denied','verdict_partial',
    'attest_pending','attest_queued','attested','mas_cancelled','attest_not_required',
    'final_reattested','final_withdrawn','final_denied','final_nonissue'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS phase invoice_phase NOT NULL DEFAULT 'triage',
  ADD COLUMN IF NOT EXISTS phase_entered_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS disposition claim_disposition NOT NULL DEFAULT 'unclassified';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3a. Heal closure_reason drift before the closed-phase deriver reads it.
--     These four UPDATEs match the drift notes in census §A and the heal
--     defaults in `derivePhaseFromLegacy`.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE invoice_groups SET closure_reason = 'denied_by_payor'
  WHERE status = 'Denied' AND closure_reason IS NULL;
UPDATE invoice_groups SET closure_reason = 'non_issue'
  WHERE status = 'Resolved' AND outcome = 'Non-Issue' AND closure_reason IS NULL;
UPDATE invoice_groups SET closure_reason = 'reattested'
  WHERE reattest_completed_at IS NOT NULL AND closure_reason IS NULL;
UPDATE invoice_groups SET closure_reason = 'expired'
  WHERE status = 'Expired' AND closure_reason IS NULL;
UPDATE invoice_groups SET closure_reason = 'cannot_dispute'
  WHERE status = 'Resolved' AND outcome = 'Withdrawn' AND closure_reason IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. Backfill `invoice_groups.phase` per §6.1. First-match-wins ordering must
--     mirror `derivePhaseFromLegacy`.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE invoice_groups SET phase = (CASE
  WHEN reattest_completed_at IS NOT NULL                          THEN 'closed'
  WHEN status = 'Resolved' AND outcome = 'Non-Issue'              THEN 'closed'
  WHEN status = 'Expired'                                         THEN 'closed'
  WHEN status = 'Denied'                                          THEN 'closed'
  WHEN status = 'Resolved' AND outcome = 'Withdrawn'              THEN 'closed'
  WHEN status = 'On Hold'                                         THEN 'triage'
  WHEN status = 'MAS Eligible' AND reattest_required = TRUE       THEN 'awaiting_reattestation'
  WHEN status IN ('New','Needs Review','Needs Evidence')          THEN 'triage'
  WHEN status IN ('Generating Email','Portal Queued','Processed') THEN 'ready_to_submit'
  WHEN status = 'Ready to Review'                                 THEN 'response_received'
  WHEN status = 'Awaiting Response'                               THEN 'submitted'
  WHEN status = 'MAS Eligible'                                    THEN 'awaiting_reattestation'
  WHEN status = 'Resolved'                                        THEN 'triage'
  ELSE 'triage'
END)::invoice_phase;

-- 3c. `phase_entered_at` is intentionally left at the column default (NOW()) on
--     this initial backfill. Recovering the historical entry timestamp would
--     require a per-phase `audit_logs.action` mapping that is only resolved by
--     Wave D's writer rewire. Wave D's `transitionInvoice` starts maintaining
--     this column correctly from then on.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill `claims.disposition` per §6.2. Needs the parent invoice's phase,
--    so JOIN to `invoice_groups` (which step 3b just populated). First-match-
--    wins ordering must mirror `deriveDispositionFromLegacy`.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE claims c SET disposition = (CASE
  WHEN c.duplicate_of_claim_id IS NOT NULL                                              THEN 'duplicate'

  -- closed phase: closure_reason wins, then attestation, then outcome, then sop_outcome
  WHEN g.phase = 'closed' AND c.closure_reason = 'non_issue'                            THEN 'final_nonissue'
  WHEN g.phase = 'closed' AND c.closure_reason = 'denied_by_payor'                      THEN 'final_denied'
  WHEN g.phase = 'closed' AND c.closure_reason = 'cannot_dispute'                       THEN 'final_withdrawn'
  WHEN g.phase = 'closed' AND c.attestation_state = 'completed'                         THEN 'final_reattested'
  WHEN g.phase = 'closed' AND c.outcome IN ('Approved','Partially Approved')            THEN 'final_reattested'
  WHEN g.phase = 'closed' AND c.outcome = 'Denied'                                      THEN 'final_denied'
  WHEN g.phase = 'closed' AND c.outcome = 'Withdrawn'                                   THEN 'final_withdrawn'
  WHEN g.phase = 'closed' AND c.outcome = 'Non-Issue'                                   THEN 'final_nonissue'
  WHEN g.phase = 'closed' AND c.sop_outcome = 'non_issue'                               THEN 'final_nonissue'
  WHEN g.phase = 'closed' AND c.sop_outcome = 'cannot_dispute'                          THEN 'final_withdrawn'
  WHEN g.phase = 'closed'                                                               THEN 'final_nonissue'

  -- awaiting_reattestation: verdict + attestation queue
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome = 'Denied'                      THEN 'verdict_denied'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome IN ('Approved','Partially Approved') AND c.attestation_state = 'queued'       THEN 'attest_queued'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome IN ('Approved','Partially Approved') AND c.attestation_state = 'pending'      THEN 'attest_pending'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome IN ('Approved','Partially Approved') AND c.attestation_state = 'completed'    THEN 'attested'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome IN ('Approved','Partially Approved') AND c.attestation_state = 'not_required' THEN 'attest_not_required'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome = 'Approved'                    THEN 'verdict_approved'
  WHEN g.phase = 'awaiting_reattestation' AND c.outcome = 'Partially Approved'          THEN 'verdict_partial'
  WHEN g.phase = 'awaiting_reattestation'                                               THEN 'attest_pending'

  -- reviewed: verdict from outcome (Wave D will tighten the default)
  WHEN g.phase = 'reviewed' AND c.outcome = 'Approved'                                  THEN 'verdict_approved'
  WHEN g.phase = 'reviewed' AND c.outcome = 'Partially Approved'                        THEN 'verdict_partial'
  WHEN g.phase = 'reviewed' AND c.outcome = 'Denied'                                    THEN 'verdict_denied'
  WHEN g.phase = 'reviewed'                                                             THEN 'verdict_approved'

  -- response_received: verdict-or-awaiting_review
  WHEN g.phase = 'response_received' AND c.outcome = 'Approved'                         THEN 'verdict_approved'
  WHEN g.phase = 'response_received' AND c.outcome = 'Partially Approved'               THEN 'verdict_partial'
  WHEN g.phase = 'response_received' AND c.outcome = 'Denied'                           THEN 'verdict_denied'
  WHEN g.phase = 'response_received'                                                    THEN 'awaiting_review'

  -- triage / ready_to_submit / submitted: triageDisposition logic.
  -- The two-path collapse (excludeLegCore vs conclude-leg/sop-advance) for
  -- non_issue / cannot_dispute is handled by checking sop_outcome first then
  -- drop_reason; both feed the same disposition.
  WHEN c.sop_outcome = 'non_issue'                                                      THEN 'disposed_nonissue'
  WHEN c.sop_outcome = 'cannot_dispute'                                                 THEN 'disposed_withdraw'
  WHEN c.sop_outcome = 'hold'                                                           THEN 'blocked'
  WHEN c.sop_outcome = 'portal_dispute'                                                 THEN 'disposed_portal'
  WHEN c.sop_outcome = 'dispute'                                                        THEN 'disposed_email'
  WHEN c.drop_reason = 'non_issue'                                                      THEN 'disposed_nonissue'
  WHEN c.drop_reason = 'cannot_dispute'                                                 THEN 'disposed_withdraw'
  WHEN c.included_in_dispute = FALSE AND c.sop_outcome IS NULL                          THEN 'disposed_nonissue'
  WHEN c.error_type_id IS NOT NULL                                                      THEN 'classifying'
  ELSE 'unclassified'
END)::claim_disposition
FROM invoice_groups g
WHERE c.invoice_group_id = g.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Cross-row validation trigger (spec §5.2). The per-phase valid_set CASE
--    below MUST mirror `VALID_DISPOSITIONS_BY_PHASE` in
--    `lib/vocab/src/claim-disposition.ts`. Created AFTER the backfill so the
--    bulk UPDATEs in step 4 cannot trip it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_disposition_against_phase() RETURNS trigger AS $$
DECLARE
  parent_phase invoice_phase;
  valid_set claim_disposition[];
BEGIN
  IF NEW.invoice_group_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT phase INTO parent_phase FROM invoice_groups WHERE id = NEW.invoice_group_id;
  IF parent_phase IS NULL THEN
    RETURN NEW;
  END IF;
  valid_set := CASE parent_phase
    WHEN 'triage' THEN ARRAY[
      'unclassified','classifying','disposed_portal','disposed_email',
      'disposed_withdraw','disposed_nonissue','blocked','duplicate'
    ]::claim_disposition[]
    WHEN 'ready_to_submit' THEN ARRAY[
      'disposed_portal','disposed_email','disposed_withdraw','disposed_nonissue','duplicate'
    ]::claim_disposition[]
    WHEN 'submitted' THEN ARRAY[
      'disposed_portal','disposed_email','disposed_withdraw','disposed_nonissue','duplicate'
    ]::claim_disposition[]
    WHEN 'response_received' THEN ARRAY[
      'awaiting_review','verdict_drafted','verdict_approved','verdict_denied','verdict_partial','duplicate'
    ]::claim_disposition[]
    WHEN 'reviewed' THEN ARRAY[
      'verdict_approved','verdict_denied','verdict_partial','duplicate'
    ]::claim_disposition[]
    WHEN 'awaiting_reattestation' THEN ARRAY[
      'verdict_approved','verdict_denied','verdict_partial',
      'attest_pending','attest_queued','attested','mas_cancelled','attest_not_required','duplicate'
    ]::claim_disposition[]
    WHEN 'closed' THEN ARRAY[
      'final_reattested','final_withdrawn','final_denied','final_nonissue','duplicate'
    ]::claim_disposition[]
  END;
  IF NOT (NEW.disposition = ANY(valid_set)) THEN
    RAISE EXCEPTION 'disposition % not valid for parent invoice phase %',
      NEW.disposition, parent_phase;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS claims_disposition_phase_chk ON claims;
CREATE CONSTRAINT TRIGGER claims_disposition_phase_chk
  AFTER INSERT OR UPDATE OF disposition, invoice_group_id ON claims
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_disposition_against_phase();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Indexes for Wave C readers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS invoice_groups_phase_idx ON invoice_groups (phase);
CREATE INDEX IF NOT EXISTS claims_disposition_idx ON claims (disposition);
CREATE INDEX IF NOT EXISTS claims_invoice_group_disposition_idx
  ON claims (invoice_group_id, disposition);

COMMIT;
