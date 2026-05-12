-- 0042_reply_attachment_staging.sql
--
-- Task #713 (real reply attachments).
--
-- Operators stage files for an outbound email reply by uploading them to
-- object storage. The reply request later references those uploads by an
-- opaque, server-issued `staged_id` rather than the raw object path. That
-- gives us:
--   * trust boundary — the server, not the client, decides which storage
--     key to attach (clients never see / forge object paths in payloads);
--   * ownership — each row pins the upload to the user that staged it, so
--     a different operator can't borrow another user's staged file;
--   * lifecycle — `consumed_at` and `created_at` let a janitor purge
--     uploads abandoned for >24h without touching files referenced by a
--     real reply.
--
-- Idempotent: `IF NOT EXISTS` so re-running the migration is a no-op.

BEGIN;

CREATE TABLE IF NOT EXISTS reply_attachment_staging (
  id text PRIMARY KEY,
  user_email text,
  storage_key text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS reply_attachment_staging_created_at_idx
  ON reply_attachment_staging (created_at);

CREATE INDEX IF NOT EXISTS reply_attachment_staging_user_email_idx
  ON reply_attachment_staging (user_email);

COMMIT;
