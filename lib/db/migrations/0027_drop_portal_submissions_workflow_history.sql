-- 0027_drop_portal_submissions_workflow_history.sql
--
-- Drop the dead `workflow_history` JSONB column from `portal_submissions`.
--
-- Background:
--   * The column was originally a per-claim "workflow progress" blob copied
--     into each submission snapshot.
--   * Task #195 (per-leg foundation) retired that blob in favour of discrete
--     `sop_answers` / `lifecycle_phase` columns. Since then the snapshot
--     code in `routes/portal-submissions.ts` has only ever written `null`
--     into this column, and no consumer reads it (the bot worker stopped
--     touching it when the per-leg state landed).
--   * Task #384 began tightening loose JSONB columns on this table; this
--     migration finishes the audit by removing the forever-null column
--     entirely (Task #389) so the OpenAPI / Drizzle schemas no longer have
--     to model an opaque pass-through.
--
-- Idempotent: guarded with `IF EXISTS` so re-runs are safe.

BEGIN;

ALTER TABLE portal_submissions
  DROP COLUMN IF EXISTS workflow_history;

COMMIT;
