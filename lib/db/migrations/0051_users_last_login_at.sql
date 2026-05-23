-- 0051_users_last_login_at.sql
--
-- Task #849 — last-login badge in admin user list.
--
-- Adds a nullable `last_login_at` column to `users`. The auth callback
-- stamps this on every successful sign-in so admins can spot dormant
-- accounts (>30 days inactive) in the user list.
--
-- Mirrors lib/db/src/schema/auth.ts. Idempotent.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

COMMIT;
