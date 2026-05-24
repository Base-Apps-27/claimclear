-- 0053_closure_responsibility.sql
--
-- Task #888 — slim down the closure intake modal and add a five-value
-- canonical `closure_responsibility` column. The full vocabulary lives in
-- `@workspace/closure-responsibility`; values are:
--   agent_mistake | driver_mistake | system_error | external_payor | no_one_process_limit
--
-- The new column lives alongside the legacy `closure_accountability_tags`
-- jsonb column. Server-side derivation populates the legacy tags from the
-- new value going forward (one responsibility → one tag) so existing
-- reporting surfaces keep working without a flag-day rewrite.
--
-- Backfill maps each legacy row's first accountability tag back into the
-- new column so the Withdrawals Review page can group historical rows by
-- responsibility immediately. Rows whose legacy tag set was empty or
-- contained only unmapped values stay NULL.
--
-- Idempotent — safe to re-apply.

BEGIN;

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS closure_responsibility text;

ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS closure_responsibility text;

COMMENT ON COLUMN claims.closure_responsibility IS
  'Task #888 — five-value canonical responsibility recorded by the slim closure modal. See @workspace/closure-responsibility for the pinned vocabulary and the responsibility → role mapping.';
COMMENT ON COLUMN invoice_groups.closure_responsibility IS
  'Task #888 — five-value canonical responsibility recorded by the slim closure modal. Mirrors claims.closure_responsibility.';

-- Backfill: map the first matching legacy tag → responsibility. The
-- ordering of the WHEN branches encodes the precedence we want when a
-- legacy row carried multiple tags (driver beats dispatcher beats…).
-- Rows already populated (idempotent re-runs) are skipped.
UPDATE claims
SET closure_responsibility = CASE
  WHEN closure_accountability_tags @> '"driver"'::jsonb
    OR closure_accountability_tags @> '"dispatcher"'::jsonb THEN 'driver_mistake'
  WHEN closure_accountability_tags @> '"our_staff"'::jsonb THEN 'agent_mistake'
  WHEN closure_accountability_tags @> '"it_system"'::jsonb THEN 'system_error'
  WHEN closure_accountability_tags @> '"external_payor"'::jsonb THEN 'external_payor'
  WHEN closure_accountability_tags @> '"member"'::jsonb
    OR closure_accountability_tags @> '"other"'::jsonb THEN 'no_one_process_limit'
  ELSE NULL
END
WHERE closure_responsibility IS NULL
  AND closure_accountability_tags IS NOT NULL;

UPDATE invoice_groups
SET closure_responsibility = CASE
  WHEN closure_accountability_tags @> '"driver"'::jsonb
    OR closure_accountability_tags @> '"dispatcher"'::jsonb THEN 'driver_mistake'
  WHEN closure_accountability_tags @> '"our_staff"'::jsonb THEN 'agent_mistake'
  WHEN closure_accountability_tags @> '"it_system"'::jsonb THEN 'system_error'
  WHEN closure_accountability_tags @> '"external_payor"'::jsonb THEN 'external_payor'
  WHEN closure_accountability_tags @> '"member"'::jsonb
    OR closure_accountability_tags @> '"other"'::jsonb THEN 'no_one_process_limit'
  ELSE NULL
END
WHERE closure_responsibility IS NULL
  AND closure_accountability_tags IS NOT NULL;

-- Value-domain enforcement at the DB level (cheap insurance against a
-- bypassed validator writing junk into the column).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'claims'
      AND constraint_name = 'claims_closure_responsibility_chk'
  ) THEN
    ALTER TABLE claims
      ADD CONSTRAINT claims_closure_responsibility_chk
      CHECK (
        closure_responsibility IS NULL
        OR closure_responsibility IN (
          'agent_mistake',
          'driver_mistake',
          'system_error',
          'external_payor',
          'no_one_process_limit'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoice_groups'
      AND constraint_name = 'invoice_groups_closure_responsibility_chk'
  ) THEN
    ALTER TABLE invoice_groups
      ADD CONSTRAINT invoice_groups_closure_responsibility_chk
      CHECK (
        closure_responsibility IS NULL
        OR closure_responsibility IN (
          'agent_mistake',
          'driver_mistake',
          'system_error',
          'external_payor',
          'no_one_process_limit'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_claims_closure_responsibility
  ON claims (closure_responsibility)
  WHERE closure_responsibility IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_groups_closure_responsibility
  ON invoice_groups (closure_responsibility)
  WHERE closure_responsibility IS NOT NULL;

COMMIT;
