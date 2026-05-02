-- Lightweight per-group payor-denial-reason signal + "I replied — wait for
-- payor again" flip flag for the redesigned "What's next?" section on the
-- Responses Awaiting Review page (Task #321).
--
-- Five new columns on `invoice_groups`:
--   * payor_denial_reason         — single-select code (free-form text at
--       the DB level; the API enforces the union from
--       `@workspace/payor-denial-reasons`).
--   * payor_denial_reason_note    — required free-text when the code is
--       `payor_other`; otherwise optional.
--   * payor_denial_reason_at      — when the operator recorded the reason.
--   * payor_denial_reason_by      — actor email/name.
--   * awaiting_payor_again_at     — set when the operator clicks
--       "I replied — wait for payor again" so the group flips off the
--       Responses Awaiting Review list back to the "Awaiting Response"
--       view WITHOUT changing `status`/`outcome`. The list query
--       re-includes the row the moment a newer inbound response arrives
--       (received_at > awaiting_payor_again_at).
--
-- These are intentionally separate from the heavyweight `closure_*` columns
-- and the `closure_reason` value union — see lib/payor-denial-reasons for
-- the rationale. No `closure_*` column is touched.
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS payor_denial_reason text,
  ADD COLUMN IF NOT EXISTS payor_denial_reason_note text,
  ADD COLUMN IF NOT EXISTS payor_denial_reason_at timestamptz,
  ADD COLUMN IF NOT EXISTS payor_denial_reason_by text,
  ADD COLUMN IF NOT EXISTS awaiting_payor_again_at timestamptz;

COMMIT;
