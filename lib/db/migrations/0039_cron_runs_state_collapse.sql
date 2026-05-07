-- 0039_cron_runs_state_collapse.sql
-- Wave D-PR6 (2026-05-07).
--
-- Collapses `cron_runs.status` onto the canonical run-state vocabulary
-- {running | completed | failed} that the rest of the state-fingerprint
-- contract (docs/architecture/state-migration-plan.md §G) is built on.
--
-- The legacy producer vocab was {ok | degraded | failed} (system-health
-- rollup + batch-processor returned `{status: "ok"|"degraded"}` from
-- their cron callees, and `recordCronRun` wrote the producer string
-- through unchanged). That left the column with two parallel
-- vocabularies — the live writer's and the rest of the run-state
-- column's — which the §G fingerprint surfaced as `cron_drift = 2894`
-- in the 2026-05-07 prod audit (2892 'ok' + 2 'degraded' rows).
--
-- Decision recap (operator: 2026-05-07): "Cron Option B" — rewrite
-- existing rows in place rather than introducing a parallel column.
-- The producer-side mapping landed in
-- artifacts/api-server/src/lib/cron-runs.ts (mapResultStatus): future
-- writes use {completed | failed} unconditionally; this migration
-- normalises the historical rows so the §G fingerprint drops to 0.
--
-- Mapping (matches the writer-side `mapResultStatus` exactly):
--   ok       → completed
--   degraded → failed   (degraded is operationally a partial-failure
--                        signal — surfacing it as a failure makes the
--                        health rollup honest; the partial-success
--                        narrative still lives in `message`).
--   failed   → failed   (no-op)
--   running  → running  (no-op, in-flight rows untouched)
--
-- Idempotent: each UPDATE is guarded on the legacy string so a re-run
-- after a clean rollout is a no-op.

UPDATE cron_runs
   SET status = 'completed'
 WHERE status = 'ok';

UPDATE cron_runs
   SET status = 'failed'
 WHERE status = 'degraded';

-- We do NOT promote `cron_runs.status` to a Postgres enum in this
-- migration on purpose. The column is `text NOT NULL DEFAULT
-- 'running'` and is read-only from the application's standpoint
-- (`recordCronRun` is the only writer). A CHECK constraint is the
-- lighter-weight enforcement and lets us keep the existing column
-- type — promoting to an enum would require a column rewrite under
-- AccessExclusiveLock, which is unjustified for a write-once audit
-- table that the writer already restricts to {running | completed |
-- failed}. If a future producer drifts back to legacy strings the
-- CHECK fires at INSERT/UPDATE time, which is the same backstop an
-- enum would give us.

ALTER TABLE cron_runs
  DROP CONSTRAINT IF EXISTS cron_runs_status_check;

ALTER TABLE cron_runs
  ADD CONSTRAINT cron_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed'));
