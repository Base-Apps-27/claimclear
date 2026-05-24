-- 0054_user_responsible_roles.sql
--
-- Task #889 — Responsible-party self-serve portal. Adds a per-user
-- `responsible_roles` jsonb array column to model the three supervisor
-- roles that scope the new /my-closures portal:
--   contact_center_manager | contractor_relations_coordinator | it_coordinator_or_coo
--
-- Stored as a jsonb array (not a separate join table) because a user
-- typically holds zero or one role, occasionally two (the COO can hold
-- both `it_coordinator_or_coo` and full operator access). Independent of
-- `users.role` so the existing admin / user / clerk operator model
-- continues unchanged.
--
-- Idempotent — safe to re-apply.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS responsible_roles jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN users.responsible_roles IS
  'Task #889 — jsonb array of responsible-role identifiers (contact_center_manager / contractor_relations_coordinator / it_coordinator_or_coo). Scopes the /my-closures portal. Independent of users.role.';

-- GIN index so `WHERE responsible_roles @> '"foo"'::jsonb` lookups (used
-- by the closure-notification fan-out path) stay cheap as the user table
-- grows. CONCURRENTLY would be safer in prod, but our migrations run
-- inside a single transaction so we keep this synchronous; the table is
-- small (<100 rows in prod) and this is a one-time cost.
CREATE INDEX IF NOT EXISTS idx_users_responsible_roles
  ON users USING gin (responsible_roles);

COMMIT;
