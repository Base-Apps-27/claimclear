# Portal Tickets Reconciliation — 2026-05-22

  **Source CSV:** `attached_assets/tickets_1779462881651.csv` (1,050 rows)
  **Compared against:** `invoice_groups` table in ClaimClear development database (153 rows)
  **Match key used:** `invoice_number` (also re-checked with digit-only normalization)

  ---

  ## TL;DR — the most important finding

  **There is no overlap between the two systems right now.**

  - Invoice numbers present on **both** sides: **0**
  - Invoice numbers only on the **portal** (CSV): **896**
  - Invoice numbers only in **ClaimClear**: **153**

  The reason is structural, not a matching bug:

  - Every ticket in the CSV is a real production dispute (10-digit MAS invoice numbers like `1870559090`), filed manually by `accounting@agapeny.com` between **2026-04-15 16:31:42** and **2026-05-21 23:30:44**.
  - Every invoice group in ClaimClear right now is **synthetic test data** — prefixes like `SMOKE-`, `T-BULKQ-G-`, `TOUR-SAMPLE-INV`, `RBAC-TEST`. No real MAS invoices have been imported into the database yet.
  - Our `portal_submissions` table (the closer analog to "tickets") has only **4 rows**, all `cancelled`/`dry_run` smoke tests with no `portal_ticket_id`.

  So the comparison itself works, but until real claims are imported into ClaimClear, there is nothing meaningful for the portal export to reconcile against.

  ---

  ## Portal CSV summary

  **Total tickets:** 1,050
  **Date range:** 2026-04-15 16:31:42 → 2026-05-21 23:30:44

  **Status (their side):**
  - Open: 26
- Closed: 1024

  **Category:**
  - GPS Control Deviation: 950
- Other Issue or Question: 100

  **Requester:**
  - accounting@agapeny.com: 1050

  **Tickets with an invoice number:** 949
  **Tickets without an invoice number:** 101 (mostly category `Other Issue or Question`)

  **Distinct invoices covered by the portal export:** 896

  ---

  ## Duplicate tickets on the portal side

  There are **26 invoice numbers** with more than one ticket on the portal — worth a closer look since these may be re-files or accidental duplicates.

  | Invoice # | # of tickets | Ticket IDs |
  |---|---|---|
  | 1852543460 | 12 | 85051, 85050, 85049, 85048, 85047, 85046, 85045, 85044, 85043, 85042, 85041, 85040 |
| 1855378920 | 11 | 85159, 85158, 85157, 85130, 85095, 85096, 85091, 85089, 85087, 85084, 85083 |
| 1854058610 | 8 | 85063, 85060, 85059, 85058, 85056, 85055, 85054, 85053 |
| 1871101850 | 3 | 92031, 92003, 91979 |
| 1854504290 | 3 | 92027, 91984, 91769 |
| 1871409580 | 2 | 92561, 92560 |
| 1880992690 | 2 | 92434, 92389 |
| 1870389070 | 2 | 92030, 91986 |
| 1880499200 | 2 | 92029, 92002 |
| 1869434080 | 2 | 92028, 91959 |
| 1873567140 | 2 | 91766, 91763 |
| 1871058590 | 2 | 91528, 91441 |
| 1871176460 | 2 | 91506, 91445 |
| 1872845240 | 2 | 91504, 91390 |
| 1865669820 | 2 | 90249, 90250 |
| 1858775730 | 2 | 89962, 89961 |
| 1865902750 | 2 | 89958, 89957 |
| 1858683460 | 2 | 89303, 89276 |
| 1864781930 | 2 | 89302, 89239 |
| 1863222250 | 2 | 89301, 89242 |
| 1821244240 | 2 | 89300, 89240 |
| 1864775090 | 2 | 88705, 88544 |
| 1869194970 | 2 | 88599, 88449 |
| 1848206320 | 2 | 85718, 85716 |
| 1860438520 | 2 | 85153, 84644 |
  
_…and 1 more — see CSV._

  ---

  ## ClaimClear (our side) summary

  **Total invoice_groups:** 153
  **Date range:** 2026-04-23 12:33:30.660487+00 → 2026-05-21 16:08:01.449282+00

  **Status (our side):**
  - New: 2
- Needs Review: 77
- Awaiting Response: 12
- Expired: 1
- Resolved: 30
- Needs Evidence: 29
- MAS Eligible: 2

  **Outcome:**
  - Pending: 125
- Approved: 1
- No Action Needed: 27

  **Sample invoice numbers in our DB (note the synthetic prefixes):**
  - `SMOKE-MULTILEG-001` — status: New, outcome: Pending
- `T-BULKQ-G-1777923852662-660627946` — status: Needs Review, outcome: Pending
- `T-BULKQ-G-1777923852767-99227131` — status: Needs Review, outcome: Pending
- `T-BULKQ-G-1777923852794-82183676` — status: Needs Review, outcome: Pending
- `T-BULKQ-G-1777923852830-64535154` — status: Needs Review, outcome: Pending
- `T-BULKQ-G-1777923852854-198494460` — status: Needs Review, outcome: Pending
- `T-BULKQ-G-1777923852873-961743096` — status: Awaiting Response, outcome: Pending
- `T-BULKQ-G-1777923853220-88164131` — status: Needs Review, outcome: Pending
- `TOUR-SAMPLE-INV` — status: Expired, outcome: Pending
- `RBAC-TEST` — status: Needs Review, outcome: Pending
- `T130G-1778119381365-404485` — status: Needs Review, outcome: Pending
- `T130G-1778119381374-494417` — status: Needs Review, outcome: Pending
- `T130G-1778119381479-954674` — status: Needs Review, outcome: Pending
- `T165G-1778119381589-5431` — status: Awaiting Response, outcome: Pending
- `T165G-1778119381605-982324` — status: Awaiting Response, outcome: Pending

  ---

  ## Output files

  - **Per-invoice diff (CSV):** `reports/portal_reconciliation_2026-05-22.csv` — one row per invoice number, with columns for portal presence, portal ticket IDs / status / category, and ClaimClear presence / status / outcome. Filter `present_on_portal=yes,present_in_claimclear=no` to see the 896-row "portal but not us" list once real data is loaded.

  ---

  ## Recommended next steps

  1. **Import real claims into ClaimClear** (or point reconciliation at the right production DB) — until that happens, the comparison can't surface anything actionable.
  2. Once real data is loaded, **re-run this reconciliation** — same code, just feed it the CSV again. Likely findings to expect:
     - Tickets on the portal that have no corresponding invoice group in ClaimClear (we're missing the case entirely).
     - Invoice groups in ClaimClear that have never been filed on the portal (we owe a submission).
     - Duplicate tickets on the portal side (same invoice filed twice) — already 26 such cases visible in this export.
  3. **Capture `portal_ticket_id` at submission time** for every `portal_submissions` row so future reconciliation can match 1:1 on ticket ID, not just on invoice number. (We already have the column; it's just unpopulated.)
  4. Consider a recurring lightweight sync: re-export this CSV from the portal weekly and run the same diff.
  