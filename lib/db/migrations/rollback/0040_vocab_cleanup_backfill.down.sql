-- 0040_vocab_cleanup_backfill.down.sql
-- Inverse of 0040: restores the pre-vocab strings on the three rows
-- the forward migration rewrote. One-shot; not auto-applied.

BEGIN;

UPDATE claims
SET closure_reason = 'accepted_loss'
WHERE id = 163 AND closure_reason = 'cannot_dispute';

UPDATE claims
SET closure_reason = 'not_contestable'
WHERE id = 240 AND closure_reason = 'cannot_dispute';

UPDATE invoice_groups
SET hold_reason = 'MAS needs to fix date of service in the portal. '
WHERE id = 32 AND hold_reason = 'awaiting_external_party';

COMMIT;
