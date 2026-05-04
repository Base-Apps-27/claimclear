-- 0028_outbound_emails_brief_logging.sql
--
-- Task #398: stop daily-brief silent outages.
--
-- Adds two columns to `outbound_emails` so the daily brief route can persist
-- one row per recipient *attempt*, not just per successful send:
--
--   * `error_excerpt`  — short send-failure message (Graph error, network
--                        excerpt, etc). Null when the send succeeded.
--   * `metadata`       — jsonb bag for kind-specific context (currently
--                        `{ roleVariant: "admin"|"operator", briefRunId }`
--                        for daily_brief rows; reserved for future kinds).
--
-- The route now writes a row per recipient regardless of outcome, so the
-- System Health "Last daily brief" panel can show admin@ vs ops@ outcomes
-- side by side (with Graph messageId on success, error_excerpt on failure)
-- without re-running the cron.
--
-- Idempotent: guarded with `IF NOT EXISTS` so re-runs are safe.

BEGIN;

ALTER TABLE outbound_emails
  ADD COLUMN IF NOT EXISTS error_excerpt text;

ALTER TABLE outbound_emails
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMIT;
