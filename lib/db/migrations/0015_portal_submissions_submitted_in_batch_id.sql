-- 0015_portal_submissions_submitted_in_batch_id.sql
--
-- Adds `submitted_in_batch_id` to `portal_submissions`. The column captures
-- which batch run brought a row to status='submitted', so the Portal
-- Submissions UI can render an inline "Already submitted in run #N" pill on
-- *other* rows whose invoice group has a successful submission elsewhere.
--
-- We do NOT reuse `claimed_by_batch_id` for this signal because that column
-- is intentionally cleared as soon as a row leaves the pending queue (so the
-- "Queued" treatment turns off). `submitted_in_batch_id` is a one-way write
-- on the pending → submitted transition and is never overwritten, so even
-- terminal-state rows keep their batch reference for the lifetime of the
-- row.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` makes this safe to re-run.

ALTER TABLE "portal_submissions"
  ADD COLUMN IF NOT EXISTS "submitted_in_batch_id" text;
