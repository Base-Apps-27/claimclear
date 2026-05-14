-- 0045_invoice_groups_special_circumstances_split.sql
-- Task #745. Split the operator's "Understanding notes" textarea off the
-- `understanding_readback` column (which historically double-dutied as both
-- the operator's note and the AI's restatement). The verify-then-save gate
-- needs three distinct fields:
--
--   * special_circumstances              — the operator's typed note.
--   * understanding_readback             — the AI's 2–4 sentence restatement.
--   * understanding_readback_for_text    — the exact note text the readback
--                                          was generated for (drift anchor).
--
-- Backfill: existing rows hold the operator's note in `understanding_readback`
-- (the legacy double-duty meaning). Copy that into `special_circumstances` so
-- the operator's text isn't lost, then null out the readback columns so every
-- existing group lands in the "typed but not checked" state on next view.
-- The field's promise ("AI verified") wasn't true for those rows; making the
-- operator re-run the check is intentional.

BEGIN;

ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS special_circumstances text;

ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS understanding_readback_for_text text;

UPDATE invoice_groups
SET
  special_circumstances = understanding_readback,
  understanding_readback = NULL,
  understanding_readback_for_text = NULL,
  understanding_readback_at = NULL,
  understanding_readback_by = NULL
WHERE understanding_readback IS NOT NULL
  AND special_circumstances IS NULL;

COMMIT;
