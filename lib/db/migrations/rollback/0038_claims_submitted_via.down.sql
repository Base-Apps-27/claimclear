-- Rollback for 0038_claims_submitted_via.sql.
--
-- Drops the index, CHECK constraint, and column added by the forward
-- migration. The backfill UPDATE itself is non-reversible (the prior
-- state was "no column"); on re-apply, step 2 of the forward migration
-- regenerates the same values from `dispute_email_sent` + `status`.

BEGIN;

DROP INDEX IF EXISTS claims_submitted_via_idx;

ALTER TABLE claims
  DROP CONSTRAINT IF EXISTS claims_submitted_via_chk;

ALTER TABLE claims
  DROP COLUMN IF EXISTS submitted_via;

COMMIT;
