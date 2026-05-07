-- 0036_invoice_groups_and_claims_is_open.sql
-- Wave D-PR1 (2026-05-07).
--
-- Adds a `is_open boolean GENERATED ALWAYS AS (status IN (…)) STORED` column
-- to both `invoice_groups` and `claims`, plus a partial index on each. This
-- is the §3.B prerequisite called out in `docs/architecture/
-- state-wave-d-handoff.md`: every "is this row in flight?" filter scattered
-- across the api-server (dashboard, daily-brief, expiring-filter,
-- urgent-snapshot, brief-personalization, group-packaging) currently
-- expands `OPEN_STATUSES.map(s => eq(table.status, s))`. D-PR3 collapses
-- every one of those onto the new column.
--
-- Why a GENERATED column (vs. a hand-maintained mirror or a JOIN helper):
--   * No writer-side invariant. Postgres recomputes `is_open` atomically
--     with any UPDATE that touches `status`; we cannot forget to refresh.
--   * No JOIN added to hot list pages. Indexed identically to a regular
--     column, with a partial index `WHERE is_open = true` to keep the
--     hot list-page filter cheap.
--   * Conformance is mechanically verifiable: the matching TS helper
--     `isClaimOpen()` in `lib/leg-state/src/openness.ts` runs against
--     every prod row in `scripts/src/check-invoice-state-derivation.ts`
--     and asserts equality.
--
-- LOCKSTEP CONTRACT (change one, change ALL THREE):
--   1. The `IN (…)` list below.
--   2. `OPEN_STATUSES` in `lib/leg-state/src/openness.ts`.
--   3. The legacy `OPEN_STATUSES` arrays in
--      `artifacts/api-server/src/lib/brief-personalization.ts` (line 16)
--      and `artifacts/api-server/src/routes/dashboard.ts` (line 23).
--      D-PR3 will delete those two and have the readers `import { OPEN_STATUSES }
--      from "@workspace/leg-state"` for any straggler that still needs
--      the literal list.
--
-- Reversibility: `migrations/rollback/0036_…down.sql` drops both columns
-- and indexes. Generated columns can be DROPped cleanly; no data loss
-- because nothing in the app writes to `is_open` (it is computed).

BEGIN;

ALTER TABLE invoice_groups
  ADD COLUMN is_open boolean
    GENERATED ALWAYS AS (
      status IN (
        'New',
        'Needs Evidence',
        'Processed',
        'Portal Queued',
        'Generating Email',
        'Ready to Review',
        'Awaiting Response',
        'On Hold'
      )
    ) STORED;

ALTER TABLE claims
  ADD COLUMN is_open boolean
    GENERATED ALWAYS AS (
      status IN (
        'New',
        'Needs Evidence',
        'Processed',
        'Portal Queued',
        'Generating Email',
        'Ready to Review',
        'Awaiting Response',
        'On Hold'
      )
    ) STORED;

-- Partial indexes covering the hot read pattern (`WHERE is_open = true`).
-- Most queries scoped to "currently in-flight" work, so a partial index
-- is materially smaller than a full-column one.
CREATE INDEX invoice_groups_is_open_idx
  ON invoice_groups (id)
  WHERE is_open = true;

CREATE INDEX claims_is_open_idx
  ON claims (id)
  WHERE is_open = true;

-- Compound partial indexes that match the most common filter+order
-- pairings on the dashboard / daily-brief surfaces. Cheap (only open
-- rows are indexed) and avoids planner regressions on D-PR3.
CREATE INDEX claims_is_open_invoice_group_idx
  ON claims (invoice_group_id)
  WHERE is_open = true;

COMMIT;
