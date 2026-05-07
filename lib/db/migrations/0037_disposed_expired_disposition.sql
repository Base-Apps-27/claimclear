-- 0037_disposed_expired_disposition.sql
-- Wave D-PR4 (2026-05-07).
--
-- Adds a new `claim_disposition` enum value `disposed_expired` to mark
-- legs cascaded into the closed phase by the nightly Expired sweep
-- (`syncChildRides` when newStatus='Expired'). Pre-PR these legs were
-- left at their backfilled `final_nonissue` (the closed-phase fallback
-- in the §6.2 deriver), which conflated them with operator-driven
-- non-issue closures and made the §3.E aggregates impossible to
-- partition cleanly.
--
-- This migration also widens the `validate_disposition_against_phase`
-- trigger's `closed`-phase valid set to include the new value so the
-- D-PR4 writer rewire (sweep stamps `disposition='disposed_expired'`
-- alongside the legacy `status='Expired'` cascade) can land cleanly.
--
-- Lockstep companions updated in this PR (must stay in sync — the
-- enum-parity test in `scripts/src/__tests__/enum-parity.test.ts`
-- enforces 1↔2; the runtime check-invoice-state-derivation script
-- enforces 3↔derivation):
--   1. `lib/vocab/src/claim-disposition.ts`        — CLAIM_DISPOSITIONS + glossary + CLOSED_SET
--   2. `lib/db/src/schema/claims.ts`               — claimDispositionEnum 23-tuple
--   3. `lib/invoice-state/src/derive-disposition.ts` — closure_reason='expired' branch
--   4. `lib/leg-state/src/per-leg-sub-status.ts`   — DISPOSITION_TO_SUB_STATUS → 'frozen'
--
-- Idempotent: the ALTER TYPE uses IF NOT EXISTS; the trigger function
-- is CREATE OR REPLACE. Re-applying after a successful run is a no-op.
--
-- NOTE on transactional ADD VALUE: PostgreSQL ≥12 allows
-- `ALTER TYPE ... ADD VALUE` inside a transaction block as long as the
-- new value is not USED in the same transaction. The CREATE OR REPLACE
-- below references `'disposed_expired'` only as a literal inside the
-- `CASE` — that literal is parsed and cast at trigger fire time, not
-- at function-definition time, so it is safe to define the new trigger
-- body in the same migration that adds the enum value.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend the enum.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE claim_disposition ADD VALUE IF NOT EXISTS 'disposed_expired';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Re-emit the per-phase validation trigger function with `disposed_expired`
--    added to the `closed`-phase valid set. Mirrors the updated CLOSED_SET in
--    `lib/vocab/src/claim-disposition.ts`. Every other phase's array is
--    unchanged from migration 0034 — re-emitted here verbatim so a fresh
--    read of this file yields the entire authoritative function body.
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
      'final_reattested','final_withdrawn','final_denied','final_nonissue',
      'disposed_expired','duplicate'
    ]::claim_disposition[]
  END;
  IF NOT (NEW.disposition = ANY(valid_set)) THEN
    RAISE EXCEPTION 'disposition % not valid for parent invoice phase %',
      NEW.disposition, parent_phase;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

COMMIT;
