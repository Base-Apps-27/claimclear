-- Task #265: editable AI dispute draft + AI baseline snapshot.
-- Adds the per-group draft pair (operator-edited, what gets submitted) and
-- the AI baseline pair (last raw AI output) plus edit/review attribution.

BEGIN;

ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS draft_subject text,
  ADD COLUMN IF NOT EXISTS draft_description_html text,
  ADD COLUMN IF NOT EXISTS ai_baseline_subject text,
  ADD COLUMN IF NOT EXISTS ai_baseline_description_html text,
  ADD COLUMN IF NOT EXISTS draft_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS draft_edited_by text,
  ADD COLUMN IF NOT EXISTS draft_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS draft_reviewed_by text;

COMMIT;
