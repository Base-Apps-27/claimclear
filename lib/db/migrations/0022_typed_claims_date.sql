-- Migration 0022: convert claims.date from TEXT to DATE.
--
-- Background: `claims.date` was a TEXT column populated from raw CSV
-- inputs. Migration 0021 backfilled every stored value to ISO
-- `YYYY-MM-DD`, and the importer was tightened (Task #351) to reject
-- any row whose date can't be normalized — so by the time this
-- migration runs the column should hold either NULL or strict ISO
-- text. Promoting the column to a typed `date` column lets us drop
-- every `NULLIF(date,'')::date` cast and `to_char(..., 'YYYY-MM-DD')`
-- wrapping in the read paths (urgent-snapshot, expiring-filter,
-- invoice-groups earliest-date, day-complete, dashboard, claims sort).
--
-- Defensive USING clause: the conversion mirrors `normalizeServiceDate`
-- in `artifacts/api-server/src/lib/dates.ts` so the migration is
-- self-sufficient even if a stray pre-tightening row slipped past
-- migration 0021. Empty / blank input becomes NULL; ISO passes
-- through; legacy `M/D/YYYY` and `M/D/YY` are parsed via to_date with
-- the Excel-style two-digit-year window (00-69 → 20YY, 70-99 → 19YY);
-- anything else becomes NULL (data loss is preferred over a hard fail
-- here because the backfill script in `scripts/src/migrations/2026-05
-- -typed-claims-date-backfill.ts` is the supported pre-migration audit
-- path — operators run `--apply` first to surface and fix any
-- unparseable rows before this migration runs).
--
-- Idempotent: PostgreSQL refuses ALTER COLUMN TYPE when the column is
-- already that type, so the migration runner's `__schema_migrations`
-- table is the only thing keeping this safe to re-run. The cast
-- expression itself is also idempotent because it normalizes through
-- the canonical date shape.
--
-- Safety: ALTER TABLE ... ALTER COLUMN TYPE rewrites the entire table
-- and takes an ACCESS EXCLUSIVE lock. At the claims table's current
-- scale (~2K rows) this is sub-second; the operation runs inside the
-- migration's transaction so a partial failure leaves the column
-- unchanged.

BEGIN;

ALTER TABLE "claims"
  ALTER COLUMN "date" TYPE date
  USING (
    CASE
      WHEN "date" IS NULL OR btrim("date") = '' THEN NULL
      WHEN "date" ~ '^\d{4}-\d{2}-\d{2}' THEN substring("date" from 1 for 10)::date
      WHEN "date" ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date("date", 'FMMM/FMDD/YYYY')
      WHEN "date" ~ '^\d{1,2}/\d{1,2}/\d{2}$' THEN
        CASE
          WHEN substring("date" from '\d+$')::int < 70
            THEN to_date(regexp_replace("date", '/(\d{2})$', '/20\1'), 'FMMM/FMDD/YYYY')
          ELSE to_date(regexp_replace("date", '/(\d{2})$', '/19\1'), 'FMMM/FMDD/YYYY')
        END
      ELSE NULL
    END
  );

COMMIT;
