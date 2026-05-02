# llm-first-classifier-backfill — production run report (2026-05-02)

This file records the operational run that completes Task #327
("Backfill AI hints on existing Responses Awaiting Review rows").
The script
(`artifacts/api-server/src/scripts/llm-first-classifier-backfill.ts`,
already at `CLASSIFIER_VERSION = "llm-first-v2"` from Task #321) was
executed against the production database from this workspace using
`DATABASE_URL=$PROD_DATABASE_URL`. No source code changed; only
`portal_responses` rows in the response-pending cohort and
`audit_logs` rows tagged `response_reclassified` /
`response_reclassify_skipped` were written.

## 1. Pre-state snapshot (production)

`portal_responses` rows linked to a group whose status is
`Ready to Review` or `Needs Review` (the "Responses Awaiting Review"
cohort), grouped by `metadata.classifierVersion`:

```
v,n
llm-first-v1,22
```

All 22 candidate rows were stamped v1 and therefore eligible for
the v2 metadata refresh (none already on v2).

## 2. Dry-run

Command:
```
DATABASE_URL="$PROD_DATABASE_URL" \
  npx tsx artifacts/api-server/src/scripts/llm-first-classifier-backfill.ts --dry-run
```

Output (trimmed):
```
[backfill] mode=dry-run limit=(none) responseId=(any)
[pre] 22 portal_responses rows linked to response-pending groups
[scan] 22 candidate response rows in scope

  ✓ response#88  group#56  ... verdict unchanged (info_request, src=ai); metadata stamped
  ✓ response#107 group#53  ... verdict unchanged (info_request, src=ai); metadata stamped
  ✓ response#111 group#189 ... verdict unchanged (info_request, src=ai); metadata stamped
  ✓ response#149 group#176 ... verdict unchanged (approval, src=ai); metadata stamped
  ✓ response#150 group#100 ... verdict unchanged (approval, src=ai); metadata stamped
  ✓ response#151 group#42  ... verdict unchanged (approval, src=ai); metadata stamped
  ✓ response#152 group#17  ... verdict unchanged (approval, src=ai); metadata stamped
  ✓ response#153 group#18  ... verdict unchanged (approval, src=ai); metadata stamped
  ✓ response#155 group#26  ... verdict unchanged (denial, src=ai); metadata stamped
  ✓ response#157 group#148 ... verdict unchanged (approval, src=ai); metadata stamped
  ✓ response#172 group#241 ... verdict unchanged (acknowledgment, src=phrase_signature); metadata stamped
  ✓ response#173 group#266 ... verdict unchanged (acknowledgment, src=phrase_signature); metadata stamped
  ⚠ response#174 group#235 ... legacy=acknowledgment → acknowledgment (src=phrase_signature);
       RELABEL SKIPPED — human activity audit#2729 by z7ytv7jcb4@privaterelay.appleid.com
       on 2026-05-01T21:09:06.892Z
  ✓ response#175 group#474 ... verdict unchanged (acknowledgment, src=phrase_signature); metadata stamped
  ✓ response#176 group#232 ... verdict unchanged (acknowledgment, src=phrase_signature); metadata stamped
  ✓ response#178 group#233 ... verdict unchanged (denial, src=ai); metadata stamped
  ✓ response#179 group#217 ... verdict unchanged (denial, src=ai); metadata stamped
  ✓ response#183 group#235 ... verdict unchanged (approval, src=ai); metadata stamped
  ✓ response#184 group#474 ... verdict unchanged (denial, src=ai); metadata stamped
  ✓ response#185 group#232 ... verdict unchanged (denial, src=ai); metadata stamped
  ✓ response#186 group#241 ... verdict unchanged (approval, src=ai); metadata stamped
  ✓ response#187 group#266 ... verdict unchanged (denial, src=ai); metadata stamped

[summary]
  considered:                    22
  already stamped (skipped):     0
  reclassified (verdict change): 0
  unchanged (metadata stamped):  21
  skipped (human activity):      1
  LLM abstained (other/abstain): 0

[transitions]
     8  approval → approval
     6  denial → denial
     5  acknowledgment → acknowledgment
     3  info_request → info_request
```

The cheap-LLM v2 re-classification reproduced every previous
verdict exactly (zero `... → other` rows, zero verdict transitions),
so applying was safe. The single human-activity skip was
response#174 / group#235, which an operator touched on
2026-05-01T21:09Z (audit#2729).

## 3. Apply

Command:
```
DATABASE_URL="$PROD_DATABASE_URL" \
  npx tsx artifacts/api-server/src/scripts/llm-first-classifier-backfill.ts --apply
```

Output (trimmed):
```
[backfill] mode=APPLY limit=(none) responseId=(any)
[pre]  22 portal_responses rows linked to response-pending groups
[scan] 22 candidate response rows in scope

  (per-row lines identical to dry-run above)

[summary]
  considered:                    22
  already stamped (skipped):     0
  reclassified (verdict change): 0
  unchanged (metadata stamped):  21
  skipped (human activity):      1
  LLM abstained (other/abstain): 0

[apply] Done. Reclassified 0, stamped 21, skipped 1.
```

The script was run with no `--limit`, in a single batch, because
the cohort was small (22 rows) and the dry-run showed no surprise
verdict transitions. No batching was needed.

## 4. Post-state validation (production)

### 4.1 All cohort rows are now stamped v2

```
SELECT pr.metadata->>'classifierVersion' AS v, count(*)::int AS n
FROM portal_responses pr
INNER JOIN invoice_groups ig ON ig.id = pr.invoice_group_id
WHERE ig.status IN ('Ready to Review', 'Needs Review')
GROUP BY 1;
```
```
v,n
llm-first-v2,22
```

### 4.2 Audit trail (`response_reclassified` / `response_reclassify_skipped`)

```
SELECT id, action, user_email, details
FROM audit_logs
WHERE user_email = 'system@llm-first-classifier-backfill'
  AND timestamp > NOW() - INTERVAL '30 minutes'
ORDER BY id;
```
21 `response_reclassified` rows (ids 4223–4234, 4236–4244) plus
1 `response_reclassify_skipped` row (id 4235 for response#174,
"SKIPPED (human activity after receivedAt — audit#2729)").

The single skip is the expected human-activity guard — no other
skips, no failures.

### 4.3 `metadata.suggestedPayorDenialReason` populated for every AI-denial row

The 6 candidate rows whose AI verdict is `denial`:
```
SELECT id, metadata->>'suggestedPayorDenialReason' AS reason_hint
FROM portal_responses
WHERE id IN (155, 178, 179, 184, 185, 187)
ORDER BY id;
```
```
id,reason_hint
155,payor_rejected_gps
178,payor_cited_benefit_rule
179,payor_cited_benefit_rule
184,payor_rejected_gps
185,payor_rejected_gps
187,payor_rejected_gps
```
All six are populated — the operator picker on Responses Awaiting
Review will now pre-fill for every denial in this cohort, which
satisfies the task's "Done looks like" criterion.

### 4.4 `metadata.newInvoiceNumber` (info_request rows)

The 3 candidate rows whose AI verdict is `info_request`:
```
SELECT id, metadata->>'newInvoiceNumber' AS new_inv
FROM portal_responses
WHERE id IN (88, 107, 111)
ORDER BY id;
```
```
id,new_inv
88,
107,
111,
```
All three are NULL — the AI did not extract a corrected invoice
number from those email bodies. Spot-checking the persisted
`raw_content` shows none of them include a new MAS invoice number
(they're "Corrections – Ticket Closed" replies that just redirect
the user to the MAS portal), so a NULL hint is the correct
behavior, not a backfill bug.

### 4.5 Human-activity skip (response#174)

```
SELECT id,
       metadata->>'classifierVersion'  AS v,
       metadata->>'backfillSkipped'    AS skipped,
       metadata->>'suggestedPayorDenialReason' AS reason_hint,
       metadata->>'newInvoiceNumber'   AS new_inv
FROM portal_responses WHERE id = 174;
```
```
id,v,skipped,reason_hint,new_inv
174,llm-first-v2,true,,
```
The row is stamped v2 with `backfillSkipped=true`; verdict
columns (`response_type`, `classifier_source`,
`classifier_confidence`, `ai_summary`, ...) were intentionally
not touched, preserving the operator's prior decision. No hints
were stamped because the v2 verdict went through
`phrase_signature` (acknowledgment) — no AI call ran for that
path, so there was nothing to write.

## 5. Outcome

- v1 cohort drained: 22 → 0; v2 cohort: 0 → 22.
- 21 rows safely re-stamped, 1 row protected by the human-activity
  guard, 0 verdict regressions, 0 LLM abstains.
- Every AI-denial response in Responses Awaiting Review now
  carries a non-null `metadata.suggestedPayorDenialReason`, which
  is what the operator UI from Task #321 needs to pre-fill its
  pickers.
- Audit trail (21 reclassified + 1 skipped) is in `audit_logs`
  for operator review.

Task #327 is complete. Re-running the script now is a no-op:
all 22 rows are already stamped `llm-first-v2`, so
`alreadyLlmFirst` will short-circuit them.
