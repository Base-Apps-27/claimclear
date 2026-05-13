# Portal-vs-DB Verification Report — 2026-05-13

Generated at: 2026-05-13T17:01:02.148Z
Elapsed: 14.8s
Cohort: `metadata->>upgradeBackfillId='duplicate_cluster_response_upgrade_2026_05_13'` (213 invoice_groups, 214 distinct real Freshdesk tickets)
Mode: read-only scrape + NO LLM re-classification (Claude Haiku, same model used in the upgrade)

## Summary

| Verdict | Count | % |
|---|---:|---:|
| match | 3 | 100.0% |
| soft_match | 0 | 0.0% |
| mismatch | 0 | 0.0% |
| scrape_failed | 0 | 0.0% |
| no_carrier_message | 0 | 0.0% |
| **TOTAL** | **3** | 100% |

### Chip re-classification (DB chip vs portal-body re-classified by Claude Haiku)

| Outcome | Count |
|---|---:|
| Re-classifier agrees with stored chip | 0 |
| Re-classifier DISAGREES with stored chip | 0 |
| Re-classifier abstained (LLM error) | 0 |
| Re-classification skipped | 3 |

### Submission status agreement (DB portal_submissions.status vs portal ticket status)

| Outcome | Submissions |
|---|---:|
| Agree | 0 |
| Disagree | 3 |
| Unknown / unmapped portal status | 0 |

## Status drifts (DB submission status disagrees with portal ticket status) (3)

| Group | Invoice | DB chip | Re-classifier chip | DB body head | Portal body head | Notes |
|---:|---|---|---|---|---|---|
| 162 | 1826048390 | acknowledgment | (skipped/abstain) | Hi Accounting Agape,

​You submitted a correction for this on 4/15/26. It was re | Hi Accounting Agape,

​You submitted a correction for this on 4/15/26. It was re | status drift |
| 180 | 1856644670 | approval | (skipped/abstain) | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 182 | 1854104160 | info_request | (skipped/abstain) | Hi Accounting Agape,

Corrections - Ticket Closed

TPIssues.medanswering.com is  | Hi Accounting Agape,

Corrections - Ticket Closed

TPIssues.medanswering.com is  | status drift |

## Methodology

- **Scrape:** Each distinct `portal_submissions.portal_ticket_id` was loaded once via `readPortalTicket()` (the same Playwright code that powers the production cron). The full message thread was parsed.
- **Carrier vs ours:** Messages whose author email matches `MAS_PORTAL_USERNAME` (case-insensitive) are treated as our outbound; everything else is the carrier (the payor). The latest carrier message per ticket is the candidate verdict.
- **Body comparison:** Whitespace-collapsed, lowercased SHA-256 of the candidate verdict vs the stored `portal_responses.content`. `bodyMatchesDb` requires an exact normalized match. `bodyOverlapWithDb` looks for an 80-char prefix overlap either direction (catches portal-side appended footers / signatures).
- **Status comparison:** `portal_submissions.status` ('submitted'/'cancelled') is mapped to expected portal statuses. Open/Pending/Awaiting variants → submitted; Closed/Resolved/Cancelled → cancelled. Any other portal status is recorded as `unknown` (not a failure).
- **Chip re-classification:** The latest carrier body across the group's tickets is fed back through `tryClassifyInboundEmail()` (Claude Haiku, the exact model used in the original upgrade). If the LLM verdict matches the stored `portal_responses.responseType`, the chip is confirmed; if not, it's flagged for review.
- **Overall verdict:** `match` requires exact body + non-disagreeing chip; `soft_match` requires overlap body + non-disagreeing chip; `mismatch` is everything else with a carrier message; `scrape_failed` is when every ticket for the group failed to scrape; `no_carrier_message` is when the scrape succeeded but no non-internal message was found.

## Raw data

Per-group records: `exports/verify-against-portal-2026-05-13.jsonl`.