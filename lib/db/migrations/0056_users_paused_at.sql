-- 0056_users_paused_at.sql
--
-- Task #880 — auto-pause dormant admin accounts. Adds a `paused_at`
-- timestamp on users so the nightly dormant-account sweep can stamp
-- the exact moment an account was flipped from `approved` to
-- `paused`. The daily brief reads this column to surface "Accounts
-- paused in the last 24h" without scanning the audit_logs table, and
-- the Settings UI uses it to label the paused user with a relative
-- "paused 3 days ago".
--
-- `status` itself is the existing varchar column; the sweep simply
-- writes the literal "paused" (which the admin UI + auth screens
-- now recognise alongside "pending"/"approved"/"denied"). Re-approval
-- via the admin Approve button nulls this back out.
--
-- Idempotent — safe to re-apply.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS paused_at timestamp with time zone;

COMMENT ON COLUMN users.paused_at IS
  'Task #880 — set by the nightly dormant-account sweep when an approved user is auto-paused for inactivity. Cleared when an admin re-approves.';

COMMIT;
