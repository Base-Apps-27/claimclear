-- Sibling-duplicate support for trip-overriding error types.
--
-- Adds two columns:
--   * claims.duplicate_of_claim_id (self-FK, ON DELETE SET NULL)
--       Points a sibling leg at its primary when both legs of a trip share
--       the same trip-bound finding (eligibility, time-at-facility, etc.).
--       Hidden from work surfaces; satisfies the readiness gate when its
--       primary is terminal; counted in the invoice $ rollup.
--   * error_types.trip_overriding (boolean, default false)
--       Marks error types whose finding binds every leg of the trip
--       identically. The SOP entry on a sibling leg uses this flag to
--       offer the one-click "Mark as Sibling duplicate" prompt.
--
-- See lib/db/src/schema/claims.ts and lib/db/src/schema/error-types.ts
-- for the Drizzle definitions and field-level comments.
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS duplicate_of_claim_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_schema = 'public'
       AND table_name = 'claims'
       AND constraint_name = 'claims_duplicate_of_claim_id_claims_id_fk'
  ) THEN
    ALTER TABLE claims
      ADD CONSTRAINT claims_duplicate_of_claim_id_claims_id_fk
      FOREIGN KEY (duplicate_of_claim_id)
      REFERENCES claims(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_claims_duplicate_of_claim_id
  ON claims (duplicate_of_claim_id)
  WHERE duplicate_of_claim_id IS NOT NULL;

ALTER TABLE error_types
  ADD COLUMN IF NOT EXISTS trip_overriding boolean NOT NULL DEFAULT false;

COMMIT;
