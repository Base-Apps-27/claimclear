-- 0056_user_logins.sql
--
-- Task #881 — per-user sign-in history. Records one row per successful
-- OIDC callback (timestamp, IP, user agent) so admins can investigate
-- "who signed in, when, from where" beyond the single `users.last_login_at`
-- field surfaced by the admin user list (task #849).
--
-- Idempotent — safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS user_logins (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_in_at timestamp with time zone NOT NULL DEFAULT now(),
  ip_address varchar,
  user_agent text
);

CREATE INDEX IF NOT EXISTS user_logins_user_id_logged_in_at_idx
  ON user_logins (user_id, logged_in_at);

COMMENT ON TABLE user_logins IS
  'Task #881 — append-only sign-in history. One row per successful OIDC callback for the admin Sign-in history page.';

COMMIT;
