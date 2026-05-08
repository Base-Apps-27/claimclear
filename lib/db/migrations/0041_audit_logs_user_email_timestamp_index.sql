-- 0041_audit_logs_user_email_timestamp_index.sql
--
-- Task #522 (Avatar hover card with activity heatmap).
--
-- Adds a composite `(user_email, timestamp)` index to `audit_logs` so
-- the per-user activity-summary aggregate (12 weeks of grouped daily
-- counts powering the avatar hover-card heatmap) and the broadened
-- `/dashboard/my-processed-today` count both stay cheap as the
-- audit log grows. Both queries pin `user_email` to the calling
-- operator and bound `timestamp` to a window, so this composite
-- order matches their access pattern exactly.
--
-- Idempotent: `IF NOT EXISTS` so re-running the migration is a no-op.

BEGIN;

CREATE INDEX IF NOT EXISTS audit_logs_user_email_timestamp_idx
  ON audit_logs (user_email, timestamp);

COMMIT;
