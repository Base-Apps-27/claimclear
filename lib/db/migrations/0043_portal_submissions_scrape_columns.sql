-- 0043_portal_submissions_scrape_columns.sql
-- Task #738. Per-submission portal-scrape outcome columns so the
-- "Last portal scrape" panel on System Health and the per-row "Last
-- checked" column on Portal Submissions can render without joining
-- to cron_runs.metadata.
--
-- Idempotent: each statement guards on existence so a re-run after a
-- clean rollout is a no-op.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'portal_scrape_outcome') THEN
    CREATE TYPE portal_scrape_outcome AS ENUM ('new_reply', 'no_change', 'error');
  END IF;
END$$;

ALTER TABLE portal_submissions
  ADD COLUMN IF NOT EXISTS last_scraped_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_scrape_outcome portal_scrape_outcome,
  ADD COLUMN IF NOT EXISTS last_scrape_error text;

CREATE INDEX IF NOT EXISTS portal_submissions_last_scraped_at_idx
  ON portal_submissions (last_scraped_at DESC NULLS LAST);

COMMIT;
