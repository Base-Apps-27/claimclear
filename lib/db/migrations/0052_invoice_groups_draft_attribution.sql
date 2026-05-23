-- 0050_invoice_groups_draft_attribution.sql
--
-- Task #836 — per-paragraph attribution for the AI-generated dispute
-- write-up. Stored as JSONB alongside the existing draft so the source
-- chips rendered on the operator's write-up display survive reload and
-- regenerate. Shape: Array<{ paragraph, sourceKind, sourceRef }>.
--
-- Idempotent — safe to re-apply.

BEGIN;

ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS draft_attribution jsonb;

COMMENT ON COLUMN invoice_groups.draft_attribution IS
  'Task #836 — per-paragraph source attribution for the AI dispute write-up. Array of { paragraph, sourceKind, sourceRef }. Cleared when the draft is regenerated.';

COMMIT;
