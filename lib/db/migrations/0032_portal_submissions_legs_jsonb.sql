-- Task #485: collapse portal_submissions to one row per invoice group, with
-- per-leg outcomes captured in a new `legs` JSONB column.
--
-- Each entry in the array represents one disputed leg in the group:
--   { legId: number, confNumber: string|null, ticked: boolean, error?: string|null }
--
-- Recorded at draft generation (every leg starts ticked=false) and overwritten
-- by the producer after the worker run completes, using the worker's
-- `perLeg[]` return. The drawer renders the per-leg breakdown directly off
-- this column so the list page can stay one-row-per-group.
--
-- No backfill: legacy per-leg rows already in the table keep `legs = '[]'`
-- and the drawer renders a graceful "per-leg breakdown unavailable for legacy
-- rows" notice for them. Wrapped in a transaction; idempotent via
-- ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE portal_submissions
  ADD COLUMN IF NOT EXISTS legs JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
