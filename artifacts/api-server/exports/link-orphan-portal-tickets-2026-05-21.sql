-- ============================================================================
-- One-off prod data fix — 2026-05-21
-- Link 7 orphaned portal tickets to their 5 invoice_groups so the next
-- scrape cron run picks up the payor responses already sitting on the portal.
--
-- WHY: The submit-bot retried these disputes; each retry created a new portal
-- ticket, but the *old* ticket's id was lost from portal_submissions when the
-- row was updated/overwritten with the latest id. The payor responded to the
-- earlier (orphaned) ticket in 6 of 7 cases. Without re-linking, those
-- responses are invisible to the review queue.
--
-- This script:
--   1. Inserts 7 portal_submissions rows by copying the currently-tracked
--      sibling row for the same invoice and swapping in the orphan's
--      portal_ticket_id. last_scraped_at = NULL so the cron picks them up.
--      Guarded by NOT EXISTS so it is safe to re-run.
--   2. Stamps triage_notes on the 4 invoice_groups whose orphan already
--      carries a payor decision (Approved/Denied). Skips 1880992690 because
--      both its tickets are still Open on the portal.
--
-- After running, the existing scrape cron will hit the new rows on its next
-- pass, write portal_responses rows, and advance phase to response_received.
--
-- Mapping (invoice, tracked_sibling_id, orphan_id, portal_status, decision):
--   1880499200, 92029, 92002, Closed, Approved
--   1854504290, 92027, 91984, Closed, Approved
--   1854504290, 92027, 91769, Closed, Approved
--   1870389070, 92030, 91986, Closed, DENIED  (Pickup Location Deviation)
--   1871101850, 92031, 92003, Closed, Approved
--   1871101850, 92031, 91979, Closed, Approved
--   1880992690, 92434, 92389, Open,   (no response yet — link only)
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Insert the 7 orphan portal_submissions rows by copying the tracked sibling
-- ---------------------------------------------------------------------------

INSERT INTO portal_submissions (
  status, issue_type, subject, requester_email, transportation_provider_name,
  phone_number, invoice_number, gps_breadcrumbs_available, description_html,
  attachment_urls, conf_number, service_date, ref_number, client_number,
  car_number, claim_amount, error_type_name, error_details, dispute_reason,
  evidence_notes, evidence_files, portal_ticket_id, error_message,
  submitted_at, attempts, created_at, updated_at, invoice_group_id,
  description_history, description_editor_email, description_editor_name,
  max_attempts, special_circumstances, understanding_readback,
  understanding_readback_at, legs, last_scraped_at, last_scrape_outcome,
  last_scrape_error
)
SELECT
  'submitted', issue_type, subject, requester_email, transportation_provider_name,
  phone_number, invoice_number, gps_breadcrumbs_available, description_html,
  attachment_urls, conf_number, service_date, ref_number, client_number,
  car_number, claim_amount, error_type_name, error_details, dispute_reason,
  evidence_notes, evidence_files,
  m.orphan_id AS portal_ticket_id,
  NULL AS error_message,
  NOW() AS submitted_at,
  0 AS attempts,
  NOW() AS created_at,
  NOW() AS updated_at,
  invoice_group_id, description_history, description_editor_email,
  description_editor_name, max_attempts, special_circumstances,
  understanding_readback, understanding_readback_at, legs,
  NULL AS last_scraped_at,
  NULL AS last_scrape_outcome,
  NULL AS last_scrape_error
FROM portal_submissions ps
JOIN (VALUES
  ('1880499200', '92029', '92002'),
  ('1854504290', '92027', '91984'),
  ('1854504290', '92027', '91769'),
  ('1870389070', '92030', '91986'),
  ('1871101850', '92031', '92003'),
  ('1871101850', '92031', '91979'),
  ('1880992690', '92434', '92389')
) AS m(invoice, sibling_id, orphan_id)
  ON ps.invoice_number = m.invoice AND ps.portal_ticket_id = m.sibling_id
WHERE NOT EXISTS (
  SELECT 1 FROM portal_submissions x
  WHERE x.portal_ticket_id = m.orphan_id
    AND x.invoice_number = m.invoice
);

-- Expected: 7 rows inserted on first run, 0 on any re-run.
SELECT COUNT(*) AS inserted_rows
  FROM portal_submissions
 WHERE portal_ticket_id IN ('92002','91984','91769','91986','92003','91979','92389')
   AND last_scraped_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Stamp triage_notes on the 4 invoice_groups whose orphan already has a
--    payor decision. Append rather than overwrite so any existing notes
--    survive.
-- ---------------------------------------------------------------------------

UPDATE invoice_groups
   SET triage_notes = COALESCE(triage_notes || E'\n\n', '')
       || '2026-05-21 portal audit: orphan portal ticket #92002 (Closed) carries payor decision APPROVED. Original tracked ticket #92029 remains Open. portal_submissions backfilled to re-link; cron will pull the response on next scrape. https://tpissues.medanswering.com/support/tickets/92002',
       updated_at = NOW()
 WHERE invoice_number = '1880499200';

UPDATE invoice_groups
   SET triage_notes = COALESCE(triage_notes || E'\n\n', '')
       || '2026-05-21 portal audit: orphan portal tickets #91984 and #91769 (both Closed) carry payor decision APPROVED. Original tracked ticket #92027 remains Open. portal_submissions backfilled to re-link both. https://tpissues.medanswering.com/support/tickets/91984 https://tpissues.medanswering.com/support/tickets/91769',
       updated_at = NOW()
 WHERE invoice_number = '1854504290';

UPDATE invoice_groups
   SET triage_notes = COALESCE(triage_notes || E'\n\n', '')
       || '2026-05-21 portal audit: orphan portal ticket #91986 (Closed) carries payor decision DENIED — Pickup Location Deviation on Leg 405063839 (4.42 mi outside the 0.90 mi enrollee-residence enforcement range). Original tracked ticket #92030 remains Open. portal_submissions backfilled; reviewer should evaluate counter-dispute viability. https://tpissues.medanswering.com/support/tickets/91986',
       updated_at = NOW()
 WHERE invoice_number = '1870389070';

UPDATE invoice_groups
   SET triage_notes = COALESCE(triage_notes || E'\n\n', '')
       || '2026-05-21 portal audit: orphan portal tickets #92003 and #91979 (both Closed) carry payor decision APPROVED. Original tracked ticket #92031 remains Open. portal_submissions backfilled to re-link both. https://tpissues.medanswering.com/support/tickets/92003 https://tpissues.medanswering.com/support/tickets/91979',
       updated_at = NOW()
 WHERE invoice_number = '1871101850';

-- Verification: which invoice_groups now have today's triage stamp.
SELECT invoice_number, LEFT(triage_notes, 80) AS triage_preview
  FROM invoice_groups
 WHERE invoice_number IN ('1880499200','1854504290','1870389070','1871101850')
 ORDER BY invoice_number;

COMMIT;

-- ============================================================================
-- Roll back instead of commit if either verification SELECT looks wrong.
-- After commit, the scrape cron's next run will write portal_responses rows
-- for #92002, #91984, #91769, #91986, #92003, #91979 and advance the 4
-- invoice_groups' phase to response_received → Ready to Review naturally.
-- ============================================================================
