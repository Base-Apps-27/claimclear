-- Migration 0020: backfill claims.date to ISO YYYY-MM-DD.
--
-- Background: `claims.date` is a TEXT column populated from the
-- importer's raw CSV inputs, which historically arrived in M/D/YYYY
-- and (later) M/D/YY shape. As of May 2026 zero rows in production
-- were stored as ISO YYYY-MM-DD. This broke every read path that
-- assumed ISO:
--   * MIN(date) sorted lexically — "4/15/2026" < "4/2/2026" because
--     '1' < '2' — so invoice-group "earliest service date" was wrong.
--   * The JS deadline helpers (daysRemaining / isUrgentDeadline)
--     parse ISO only, so every M/D/YYYY value was silently treated as
--     "no deadline known" → dashboard showed "FILE TODAY: 0" and the
--     queue showed "All clear" even when claims were past their 30-day
--     filing window.
--   * Service Date column on the Invoice Groups list rendered "—".
--
-- Fix: cast every non-ISO row through PostgreSQL's `::date` (which
-- respects the cluster's DateStyle of `ISO, MDY` and parses both
-- M/D/YYYY and M/D/YY correctly), then re-emit as ISO YYYY-MM-DD.
-- Empty-string entries are left alone (the read-side queries already
-- coerce them to NULL via NULLIF).
--
-- Idempotent: the WHERE clause filters out rows already in ISO shape,
-- so re-running the migration is a no-op. Wrapped in a transaction so
-- a partial failure leaves the table untouched.

BEGIN;

UPDATE claims
SET date = to_char(NULLIF(date, '')::date, 'YYYY-MM-DD')
WHERE date IS NOT NULL
  AND date <> ''
  AND date !~ '^\d{4}-\d{2}-\d{2}$';

COMMIT;

-- Note on indexing: every read path now casts `claims.date` through
-- `NULLIF(date,'')::date` for calendar-correct sort/filter. We do NOT
-- create an expression index over that cast because PostgreSQL requires
-- index expressions to be IMMUTABLE, and `text::date` is STABLE (it
-- depends on the cluster's DateStyle setting). At the table's current
-- scale (~2K rows) seq-scan + cast is fine. If performance ever becomes
-- the bottleneck, the right fix is a separate typed `service_date DATE`
-- column maintained by the importer + a backfill, not an index trick.
