-- 0035_heal_legacy_classifying_dispositions.sql
-- Wave B follow-up (2026-05-07).
--
-- Migration 0034 backfilled `claims.disposition` using the §6.2 deriver.
-- Post-publish prod conformance (`scripts/src/check-invoice-state-derivation.ts`
-- via direct executeSql) found 12 rows with `disposition='classifying'` under
-- non-triage parent phases (10 under `submitted`, 2 under `ready_to_submit`).
-- These rows violate `VALID_DISPOSITIONS_BY_PHASE` and would be rejected by the
-- `validate_disposition_against_phase` trigger on any subsequent UPDATE.
--
-- Root cause: the deriver's triage fallback `errorTypeId IS NOT NULL → classifying`
-- fires for any non-triage claim that lacks `sop_outcome`. These 12 are legacy
-- rows that were classified (have `error_type_id`) and submitted as part of a
-- group, but never went through the per-leg SOP triage system that would have
-- set `sop_outcome`. The TS deriver in `lib/invoice-state/src/derive-disposition.ts`
-- has been updated in this PR to add a `submitted` / `ready_to_submit` branch
-- that picks `disposed_portal` (when `claim.status='Portal Queued'`) or
-- `disposed_email` (otherwise) when no SOP signal is present. This migration
-- applies the same heal to the existing prod data.
--
-- Why this is safe under the trigger: the new dispositions are valid for their
-- parent phases (`disposed_portal`/`disposed_email` ∈ ready_to_submit and
-- submitted valid sets per §5.1). The trigger fires AFTER this UPDATE and
-- accepts the transition.
--
-- Idempotent: targets only rows currently storing `disposition='classifying'`
-- whose parent group has phase IN ('ready_to_submit', 'submitted'). Re-running
-- after a successful apply is a no-op (zero rows match).
--
-- Reversibility: `migrations/rollback/0035_…down.sql` reverts the 12 rows back
-- to `classifying` (only useful as a one-shot if Wave B is rolled back; not
-- automatically applied).

BEGIN;

UPDATE claims c
SET disposition = (CASE
  WHEN c.status = 'Portal Queued' THEN 'disposed_portal'
  ELSE 'disposed_email'
END)::claim_disposition
WHERE c.disposition = 'classifying'
  AND c.invoice_group_id IN (
    SELECT id FROM invoice_groups
    WHERE phase IN ('ready_to_submit', 'submitted')
  );

COMMIT;
