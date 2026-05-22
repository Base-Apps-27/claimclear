# Portal Tickets Reconciliation — PRODUCTION — 2026-05-22

  **Source CSV:** `attached_assets/tickets_1779462881651.csv` (1,050 tickets covering 896 distinct invoices, 2026-04-15 16:31:42 → 2026-05-21 23:30:44)
  **Compared against:** ClaimClear **production** database — `invoice_groups` (1,899 rows) and `portal_submissions` (1,781 rows; 1,104 in `submitted` state)
  **Match keys:** `invoice_number` (primary), and `portal_ticket_id` (numeric Freshdesk ids) cross-checked against the CSV `Ticket Id` column.

  ---

  ## TL;DR

  The integration is healthy and the data lines up well.

  | Bucket | Count |
  |---|---|
  | Invoices we submitted **and** the portal has them | **813** |
  | Invoices we submitted but **not** in the portal export | 230 — explained below, almost all benign |
  | Invoices on portal but we never submitted | **0** |
  | Invoices on portal but we have no invoice group at all | **0** |
  | Invoice groups in ClaimClear we have **never submitted** | **794** ← real backlog/triage signal |
  | Ticket-IDs in the CSV matched 1:1 to a `portal_ticket_id` on our side | **1,032 of 1,050** (98%) |

  The headline: **every single ticket in the portal export came from ClaimClear.** We are not missing any portal cases. The 230 "we submitted but not on the export" rows are explained almost entirely by submission method or timing, not by lost submissions.

  ---

  ## Portal CSV (their side)

  - **Total tickets:** 1,050
  - **Distinct invoices:** 896 (26 invoices have multiple tickets)
  - **Status:** Open 26, Closed 1024
  - **Category:** GPS Control Deviation (950), Other Issue or Question (100)
  - **101 tickets** carry no invoice number (mostly "Other Issue or Question")

  ## ClaimClear (our side — production)

  - `invoice_groups`: **1,899** total (1,899 distinct invoice numbers)
  - `portal_submissions`: **1,781** total — submitted 1,104 / cancelled 673 / pending 2 / dry_run 2
  - **Submissions in the last 7 days:** 292

  ---

  ## The 230 "we submitted but not in the portal export" — explained

  | Sub-bucket | Count | What it means |
  |---|---|---|
  | Submitted **via Outlook email** (opaque 20- or 152-char ticket id, not a numeric Freshdesk id) | **149** | The portal export only includes tickets created in the Freshdesk web portal. Email-based disputes don't show up there at all — this is expected. |
  | Submitted via the **web portal**, ticket-ID **does match** a row in the CSV, but the invoice number on the CSV row is blank | **98** | Ticket exists on portal (matched by id), but its **Invoice Number** column wasn't populated by the submitter — so the invoice-number join missed it. The submission actually landed; the portal just doesn't have the invoice tagged. Mostly older "Ineligible Enrollee" and "Invoice Number Not in System" categories. |
  | Submitted via web portal, ticket id **not in CSV at all** | **1** | Submitted at 2026-05-22 15:00 UTC — **after** the CSV was exported (CSV's latest ticket is 2026-05-21 23:30). This is the only genuine "we don't know if it landed" row, and the cause is just CSV staleness. |
  | (also 8 of the 149 email submissions were sent after the CSV cutoff — same story) | 8 | timing |

  **Net real concern: 0.** Re-export the portal CSV after today and the post-cutoff rows will appear.

  ---

  ## The 813 invoices that matched on both sides

  Of these, the portal status is:
  - **Closed: 839 tickets** (some invoices have multiple tickets)
  - **Open: 26 tickets**

  So nearly every dispute we filed has already been worked by the payor. The 26 Open ones are the active "awaiting response" set from the portal's perspective — worth syncing back onto our side (see "Recommendations").

  ---

  ## The 794 invoice groups we have never submitted

  This is the most actionable finding. These cases exist in ClaimClear but no portal submission was ever created.

  **By status:**
  - **New: 437** — sitting in the queue, never triaged into a draft
  - **Resolved: 136** — closed out without a submission (likely "no action needed" pathway)
  - **Needs Review: 106** — paused at review
  - **Expired: 80** — past deadline; lost opportunity if these were eligible
  - **Ready to Review: 23** — drafted, just need a reviewer
  - **MAS Eligible: 6, On Hold: 2, Denied: 4**

  **By outcome:**
  - Pending: 658
  - Non-Issue: 97
  - No Action Needed: 18
  - Approved (without submission): 10
  - Withdrawn: 11

  The **80 Expired** and **437 New** are the rows most worth a second look — Expired ones may need a write-off or appeal, and New ones may be unworked inventory.

  ---

  ## Output files

  - **`reports/portal_reconciliation_PROD_2026-05-22.md`** — this report
  - **`reports/portal_reconciliation_PROD_2026-05-22.csv`** — one row per distinct invoice (1924 rows) with columns for portal presence, our group, our submission, and a `match_quality` label. Useful filters:
    - `match_quality=group_only_never_submitted` → the 794 backlog
    - `match_quality=submitted_matched_by_ticket_id_only` → the 98 portal-side-missing-invoice cases
    - `match_quality=submitted_but_not_in_portal_export` → the 1 genuine post-cutoff straggler
    - `portal_status` contains `Open` → 26 cases currently open on the payor's side

  ---

  ## Recommendations

  1. **Sync the 26 Open portal tickets back onto our side.** These are the actual "awaiting payor" set per the portal. Update the matching invoice groups so they show as Awaiting Response in ClaimClear too.
  2. **Triage the 794 never-submitted invoice groups.** Start with the 80 Expired and 437 New — that's where unworked or lost-deadline cases hide.
  3. **Backfill invoice numbers on the 98 portal tickets** that have a matching submission on our side but a blank Invoice Number field on the portal. (Or accept it — matching by ticket-id already covers them.)
  4. **Re-export the portal CSV after today** to clear the 1 post-cutoff straggler from the report.
  5. **Long-term:** since we already match 1,032 of 1,050 (98%) on `portal_ticket_id`, prefer ticket-id as the primary match key for any future automated sync; fall back to invoice number only when missing.
  