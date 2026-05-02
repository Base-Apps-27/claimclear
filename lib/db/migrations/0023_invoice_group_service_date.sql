-- Migration 0022: invoice_groups.service_date — typed, indexed
-- earliest-service-date column maintained by `recomputeGroupServiceDate`.
--
-- Background: prior to this migration the dashboard "FILE TODAY" hero,
-- the Invoice Queue "must file today" tier, and the Groups list Service
-- Date column each computed the earliest child-claim service date with
-- their own correlated `MIN(NULLIF(claims.date, '')::date)` subquery.
-- Because every read site cast the text-typed `claims.date` on the fly,
-- there was no shared cache and no way to index the value, and any
-- subtle divergence between the three SQL fragments could let the three
-- counts disagree on the same group.
--
-- Forward fix (Task #350): introduce a real `date`-typed column on
-- `invoice_groups`, populated and maintained by a single JS helper
-- (`recomputeGroupServiceDate`) called from every write path that can
-- change the set of children or any child's `claims.date` value. A
-- one-shot backfill (`scripts/src/migrations/2026-05-invoice-group-
-- service-date-backfill.ts`) seeds existing rows. A drift-check guard
-- in `lib/group-service-date.ts` rolls into the existing
-- system-health rollup so any future write path that forgets to call
-- the helper surfaces as an ops signal instead of a silent skew.
--
-- Idempotent: `IF NOT EXISTS` on both the column and the btree index,
-- wrapped in a transaction so a partial failure leaves the table
-- untouched. Running this twice is a no-op.

BEGIN;

ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS service_date date;

CREATE INDEX IF NOT EXISTS invoice_groups_service_date_idx
  ON invoice_groups (service_date);

COMMENT ON COLUMN invoice_groups.service_date IS
  'Earliest service date across the group''s child claims, calendar MIN over claims.date. Maintained by recomputeGroupServiceDate on every write path. NULL when no child has a parseable date. Replaces the on-the-fly MIN(NULLIF(claims.date,'''')::date) subquery — see Task #350.';

COMMIT;
