-- 0014_drop_portal_submissions_claim_id.sql
--
-- Drop the stale `claim_id` column from `portal_submissions`. The column is a
-- leftover from the per-claim submission model that was retired in favor of
-- per-invoice-group submissions (see `invoice_group_id` on the same table).
-- The Drizzle source schema (`lib/db/src/schema/portal-submissions.ts`) has
-- not referenced `claim_id` for some time, but the live DB column was never
-- dropped. The result is a NOT NULL drift: every test that tries to insert a
-- portal submission via the source-schema shape fails with
-- `null value in column "claim_id" of relation "portal_submissions" violates
-- not-null constraint` (5 tests in per-leg-state, closure-data-foundation,
-- and submit-flow-gates were red because of this — see Task #237).
--
-- This migration brings the live DB in line with the source schema by
-- dropping the column. The associated FK
-- (`portal_submissions_claim_id_claims_id_fk`) and the
-- `portal_submissions_claim_id_idx` index are dropped as a consequence of
-- `DROP COLUMN`.
--
-- Idempotent: guarded with `IF EXISTS` so re-runs are safe.

BEGIN;

ALTER TABLE portal_submissions
  DROP COLUMN IF EXISTS claim_id;

COMMIT;
