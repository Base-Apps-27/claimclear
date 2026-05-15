-- 0046_bulk_approve_progress.sql
--
-- Task #755 — durable progress tracker for in-flight bulk-approve runs.
-- Replaces the per-process `Map` in artifacts/api-server/src/routes/
-- invoice-groups.ts so the GET
-- `/invoice-groups/bulk-approve/:bulkApproveRunId/progress` poll keeps
-- working across page reloads, API restarts, and multiple instances
-- behind a load balancer.
--
-- The natural primary key is the `bulk_approve_run_id` UUID the POST
-- handler also stamps onto every audit row, so this row doubles as a
-- correlation handle into audit_logs.
--
-- TTL: rows linger for a short window (5 min) after `completed_at` so
-- a slow final poll still sees terminal counts. The POST handler
-- prunes anything past the window on its next run; the index keeps
-- that scan cheap.
--
-- Idempotent — safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS bulk_approve_progress (
  bulk_approve_run_id text PRIMARY KEY,
  total integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  approved integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS bulk_approve_progress_completed_at_idx
  ON bulk_approve_progress (completed_at);

COMMENT ON TABLE bulk_approve_progress IS
  'Task #755 — durable progress tracker for /invoice-groups/bulk-approve runs. One row per bulkApproveRunId; pruned ~5 min after completion. Survives API restarts and is shared across instances so the dialog poll reattaches after a page reload.';

COMMIT;
