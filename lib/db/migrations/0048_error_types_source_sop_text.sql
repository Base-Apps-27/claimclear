-- 0048_error_types_source_sop_text.sql
--
-- Task #784 — persist the plain-text SOP description the author pastes
-- into the AI Builder so it round-trips between the editor's settings,
-- the API (POST/PATCH /api/error-types[/:id]), the version snapshot, and
-- a subsequent reload. Without this column, GET /api/error-types fails
-- with `column "source_sop_text" does not exist` in any environment
-- where the schema hasn't been applied yet (May 2026 prod incident).
--
-- Idempotent — safe to re-apply.

BEGIN;

ALTER TABLE error_types
  ADD COLUMN IF NOT EXISTS source_sop_text text;

COMMENT ON COLUMN error_types.source_sop_text IS
  'Task #784 — plain-text SOP description the author pasted into the AI Builder. Persisted so the AI Builder panel can re-hydrate on reload.';

COMMIT;
