-- Rollback for 0037_disposed_expired_disposition.sql
--
-- Reverts the trigger function to the migration-0034 closed-phase valid
-- set (without `disposed_expired`). PostgreSQL does NOT support
-- removing an enum value, so the value itself stays in the type; any
-- rows the writer stamped to 'disposed_expired' must be re-mapped to a
-- valid pre-rollback disposition (e.g. 'final_nonissue') BEFORE this
-- rollback runs, or subsequent UPDATEs will fail the trigger check.
--
-- Reusable one-shot — the heal UPDATE below is the recommended pre-step.

BEGIN;

-- Pre-step (commented; opt-in). Uncomment to remap stamped rows back
-- to the closed-phase fallback so the trigger function below accepts
-- subsequent writes. Safe to run repeatedly.
--
-- UPDATE claims SET disposition = 'final_nonissue'
-- WHERE disposition = 'disposed_expired';

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

COMMIT;
