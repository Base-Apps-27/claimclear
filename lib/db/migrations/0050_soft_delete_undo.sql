-- 0050_soft_delete_undo.sql
--
-- Task #838 — soft-delete + 30-day undo on destructive ops.
--
-- Four destructive actions (withdraw claim, withdraw group,
-- remove-handled-offline, discard dispute draft) now stamp a
-- timestamp on the affected row instead of leaving operators with
-- no way back. The admin "Recent removals" page lists rows where any
-- of these stamps is non-null and < 30 days old; a Restore button
-- reverses the action and writes a dedicated `restored` audit row.
-- A daily purge cron hard-deletes claims/groups whose `withdrawn_at`
-- / `removed_offline_at` is past the 30-day window and clears the
-- discarded-draft snapshot columns on groups past the same window.
--
-- Mirrors the columns added in lib/db/src/schema/{claims,invoice-groups}.ts.
--
-- Idempotent — safe to re-apply.

BEGIN;

ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp with time zone;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "removed_offline_at" timestamp with time zone;

ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp with time zone;
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "draft_discarded_at" timestamp with time zone;
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "draft_discarded_subject" text;
ALTER TABLE "invoice_groups" ADD COLUMN IF NOT EXISTS "draft_discarded_description_html" text;

-- Partial indexes so the admin Recent-Removals listing + the daily
-- purge sweep can both find the soft-deleted rows without a full
-- table scan. NULL entries (the overwhelming majority) are skipped
-- entirely.
CREATE INDEX IF NOT EXISTS "claims_withdrawn_at_idx"
  ON "claims" ("withdrawn_at")
  WHERE "withdrawn_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "claims_removed_offline_at_idx"
  ON "claims" ("removed_offline_at")
  WHERE "removed_offline_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "invoice_groups_withdrawn_at_idx"
  ON "invoice_groups" ("withdrawn_at")
  WHERE "withdrawn_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "invoice_groups_draft_discarded_at_idx"
  ON "invoice_groups" ("draft_discarded_at")
  WHERE "draft_discarded_at" IS NOT NULL;

COMMIT;
