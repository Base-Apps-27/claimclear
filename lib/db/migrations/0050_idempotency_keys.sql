-- 0050_idempotency_keys.sql
-- Task #842. Structural duplicate guarantee for bot-originated mutations.
--
-- Adds nullable `idempotency_key` columns to the three tables a bot
-- mutation can write through (`portal_responses`, `audit_logs`,
-- `portal_submissions`) and creates a partial unique index on each so a
-- retried bot mutation carrying the same `Idempotency-Key` header
-- collides at the database level instead of silently double-inserting.
--
-- Operator-initiated rows leave the column null and so are excluded from
-- the partial index; they remain free to insert without collisions.
--
-- Idempotent: each statement guards on existence so a re-run after a
-- clean rollout is a no-op.

BEGIN;

ALTER TABLE portal_responses
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS portal_responses_idempotency_key_uidx
  ON portal_responses (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_idempotency_key_uidx
  ON audit_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE portal_submissions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS portal_submissions_idempotency_key_uidx
  ON portal_submissions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
