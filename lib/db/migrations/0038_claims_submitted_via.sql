-- 0038_claims_submitted_via.sql
-- Wave D-PR5 (2026-05-07).
--
-- Adds `claims.submitted_via` (text, nullable). The column carries the
-- per-leg signal "this claim was filed via X" where X ∈ {'portal',
-- 'email'} (NULL = not yet submitted). The writer-rewire of D-PR5
-- stamps this column at the operator-click sites (portal-submission
-- create/confirm/retry → 'portal'; batch-processor Direct Email and
-- external-bot Awaiting Response → 'email' / 'portal'). The deriver
-- (`derivePhaseFromLegacy`) promotes any group whose children carry a
-- non-null `submitted_via` from `ready_to_submit` → `submitted`,
-- collapsing the §3.B Portal-Queued residual exclusion across the
-- expiring-filter / urgent-snapshot / dashboard predicates and
-- letting the day-complete matcher drop its three-status residual.
--
-- Backfill rule (positive-signal-only — closed rows with no signal
-- are left NULL on purpose so the cleanup routes can spot them):
--   * dispute_email_sent = true                                → 'email'
--   * status IN (Generating Email, Portal Queued, Processed,
--                Ready to Review, Awaiting Response)
--     AND dispute_email_sent = false                           → 'portal'
--   * else                                                     → NULL
--
-- Idempotent: ALTER TABLE uses IF NOT EXISTS; backfill UPDATE is
-- guarded by `submitted_via IS NULL` so a re-run is a no-op once
-- columns settle. Paired rollback: 0038_claims_submitted_via.down.sql.

BEGIN;

-- 1. Add the column.
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS submitted_via text;

-- 2. Backfill from positive signals only. The conditional UPDATE
--    leaves rows whose status doesn't establish a submission path
--    untouched (NULL is the meaningful absent-signal value here).
UPDATE claims
   SET submitted_via = CASE
     WHEN dispute_email_sent = true THEN 'email'
     WHEN status IN (
       'Generating Email','Portal Queued','Processed',
       'Ready to Review','Awaiting Response'
     ) THEN 'portal'
     ELSE NULL
   END
 WHERE submitted_via IS NULL
   AND (
     dispute_email_sent = true
     OR status IN (
       'Generating Email','Portal Queued','Processed',
       'Ready to Review','Awaiting Response'
     )
   );

-- 3. Value-domain CHECK so a stray writer can never insert garbage.
DO $$ BEGIN
  ALTER TABLE claims
    ADD CONSTRAINT claims_submitted_via_chk
    CHECK (submitted_via IS NULL OR submitted_via IN ('portal','email'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Partial index — most readers want "any child stamped" per group;
--    the partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS claims_submitted_via_idx
  ON claims (invoice_group_id)
  WHERE submitted_via IS NOT NULL;

COMMIT;
