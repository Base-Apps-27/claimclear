-- 0055_users_is_portal_only.sql
--
-- Task #889 round-3 — explicit portal-only marker. Derived gating
-- (responsibleRoles + role==="user") regressed legitimate operator
-- users who were also assigned a responsible role. This adds an
-- explicit boolean the admin sets at role-assignment time so the
-- nav-isolation decision is unambiguous and reversible.
--
-- Defaults to false: every existing user (operators + previously
-- assigned responsible parties) keeps full operator access until an
-- admin explicitly flips them to portal-only.
--
-- Idempotent — safe to re-apply.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_portal_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_portal_only IS
  'Task #889 — when true, AppLayout hides all operator nav and shows only the My Closures portal entry. Independent of users.role so admins can flip without touching operator-tier metadata.';

COMMIT;
