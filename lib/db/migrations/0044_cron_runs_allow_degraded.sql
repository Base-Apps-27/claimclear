-- 0044_cron_runs_allow_degraded.sql
-- Task #738. The Wave-D-PR6 collapse in 0039 narrowed cron_runs.status
-- to {running | completed | failed} on the assumption that "degraded"
-- was a producer-side leftover with no operational meaning. Task #738
-- re-establishes "degraded" as a first-class state for partial-failure
-- runs (e.g. a portal_response_sync sweep where 19/25 tickets succeeded
-- and 6 errored). Operators need amber on the rollup, not red — a
-- partial in-tolerance sweep is "investigate but not page-worthy",
-- which is functionally different from a hard failure where zero
-- tickets were scraped.
--
-- The recorder in `cron-runs.ts` now maps producer status="degraded"
-- onto a real "degraded" row; without this constraint relax, every
-- such INSERT/UPDATE would fail at the DB and the entire run would be
-- recorded as nothing (the recorder swallows DB errors), making the
-- problem invisible to operators and to System Health.
--
-- Idempotent: drop-and-recreate on the existing constraint name.

BEGIN;

ALTER TABLE cron_runs
  DROP CONSTRAINT IF EXISTS cron_runs_status_check;

ALTER TABLE cron_runs
  ADD CONSTRAINT cron_runs_status_check
  CHECK (status IN ('running', 'completed', 'degraded', 'failed'));

COMMIT;
