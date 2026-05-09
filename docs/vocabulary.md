# ClaimClear operator vocabulary

This document is the human-readable companion to the `@workspace/vocab`
package. It describes the canonical operator-facing labels used across
ClaimClear, organised by domain, and explains the few naming collisions
that exist on purpose.

> **Source of truth.** The TypeScript files under `lib/vocab/src/` are
> the only place a label may be defined. UI code looks labels up via the
> helper functions exported from `@workspace/vocab` (e.g.
> `outcomeLabel`, `legSubStatusDisplayLabel`, `closureReasonLabel`).
> If you find a hard-coded literal in a `.tsx` file, the CI guardrail
> `pnpm --filter @workspace/scripts run check:vocab-drift` should
> reject it. The drift check runs automatically on every merge via
> `scripts/post-merge.sh`.

## How to render state in the UI

Operator-facing surfaces render every state pill through a single
component, `<StateBadge>` (`artifacts/claimclear/src/components/state-badge.tsx`).
StateBadge is the only place these vocabularies become pixels — it
sources its label and tooltip from `@workspace/vocab` and its tone
from the cohesion palette, and it always wraps itself in a tooltip
that names the domain so an operator can never confuse "Resolved"
the workflow status with "Resolved" the outcome.

Six variants, one per domain:

| `variant`     | Vocab module                   | Helper                              |
| ------------- | ------------------------------ | ----------------------------------- |
| `phase`       | `invoice-phase.ts`             | `invoicePhaseLabel`                 |
| `status`      | `claim-status.ts`              | `claimStatusLabel`                  |
| `subStatus`   | `leg-sub-status.ts`            | `legSubStatusDisplayLabel`          |
| `verdict`     | `verdict-outcome.ts` / `outcome.ts` | `verdictOutcomeLabel` / `outcomeLabel` |
| `outcome`     | `outcome.ts`                   | `outcomeLabel`                      |
| `stage`       | `submission-stage.ts`          | `submissionStageLabel`              |

```tsx
<StateBadge variant="status" value={group.status} />
<StateBadge variant="status" value={claim.status} row={claim} />  {/* row-aware tone */}
<StateBadge variant="subStatus" leg={leg} />                       {/* derives value */}
<StateBadge variant="outcome" value={group.outcome} />
<StateBadge variant="verdict" value={verdict.outcome} />
<StateBadge variant="phase" value={group.phase} />
<StateBadge variant="stage" value={submission.stage} />
```

Sidebar mounts a `<StateLegend />` popover (link **State legend**
under the Help group) — operators can skim every domain's definition,
example pills, and surface list without leaving the page they're on.

### Decorative pills are NOT state

For chips that aren't bound to one of the six domains (counters,
"DONE" stamps, MAS-action prompts, period markers), use the
presentational primitive `<TonePill tone="…">…</TonePill>` from
`@/components/cohesion`. TonePill just renders children with a tone
background; it intentionally does NOT carry a tooltip or a vocab
lookup. If you reach for TonePill to render a `claim_status`,
`outcome`, or other glossary value — stop, that's what `<StateBadge>`
is for.

The legacy renderers `status-badge.tsx` and `cohesion/status-pill.tsx`
were deleted in Task #554. See
`docs/audits/state-pill-inventory.md` for the migration audit.

---

## Display vs. enum values

A handful of enum values in the database / OpenAPI spec are spelled in
TitleCase or with a hyphen (`"Non-Issue"`, `"Partially Approved"`).
Renaming those would be an API break, so the glossary keeps the
`enumValue` field exactly as the wire format requires and exposes a
separate `label` field for the UI:

| Domain  | enumValue          | label                |
| ------- | ------------------ | -------------------- |
| outcome | `"Non-Issue"`      | **Non-issue**        |
| outcome | `"Partially Approved"` | Partially Approved |

The forbidden-literal scanner enforces the unification: literals like
`"Non-Issue"`, `"Non Issue"`, `"Excluded"`, and `"Dropped"` may not
appear inside `artifacts/*/src/**/*.tsx`. When the literal really *is*
the API enum value (e.g. constructing a request body), annotate the
line with `// vocab-allow-next-line` and a one-line justification.

---

## Domains

### Claim / group workflow status (`claim_status`)

Applied to both individual claims and invoice groups. Source enum:
`status` column on the `claims` and `invoice_groups` tables.

| Enum value         | Label              |
| ------------------ | ------------------ |
| New                | New                |
| Needs Review       | Needs Review       |
| Needs Evidence     | Needs Evidence     |
| Generating Email   | Generating Email   |
| Ready to Review    | Ready to Review    |
| Awaiting Response  | Awaiting Response  |
| On Hold            | On Hold            |
| Resolved           | Resolved           |
| Denied             | Denied             |
| Portal Queued      | Portal Queued      |
| Processed          | Processed          |

**Collisions kept on purpose.** `Pending`, `Denied`, and `Resolved`
appear in more than one domain. Each is the same word at a different
scope (workflow vs outcome vs leg conclusion); renaming one would
introduce a difference without adding meaning. Tooltip prose in the UI
spells out the distinction so a reader is never guessing.

### Outcome (`outcome`)

Terminal verdict on a claim or invoice group. Source enum: `outcome`
column.

| Enum value         | Label                |
| ------------------ | -------------------- |
| Pending            | Pending              |
| Approved           | Approved             |
| Denied             | Denied               |
| Partially Approved | Partially Approved   |
| **Non-Issue**      | **Non-issue**        |
| Withdrawn          | Withdrawn            |

`Non-Issue` is the most important entry — every UI reference renders
the sentence-case form, while the wire enum stays TitleCase.

### Per-leg sub-status (`leg_sub_status`)

A derived projection from the leg's discrete columns. Source enum:
`LEG_SUB_STATUSES` in `@workspace/leg-state`.

| Enum value            | Label              |
| --------------------- | ------------------ |
| `excluded`            | Non-issue          |
| `needs_classification`| Needs classification |
| `investigating`       | Investigating      |
| `blocked`             | On hold            |
| `ready`               | Ready              |
| `dropped`             | Non-issue *(see note)* |
| `frozen`              | Frozen             |

**Two enums, one default label.** `excluded` and `dropped` are the same
operational concept — a leg that has been removed from the dispute and
needs no further work. They both render as **Non-issue** by default.
When the caller has the leg row in hand they should call
`legSubStatusDisplayLabel(s, leg)`; for `dropped` legs whose
`sopOutcome` is `cannot_dispute`, that helper returns the more specific
**Non-contestable** label.

### Leg conclusion (`leg_conclusion`)

The three-button vocabulary locked in by Task #265. Source enum: the
`reason` field on `POST /claims/:id/conclude-leg` and the `sopOutcome`
column.

| Enum value      | Label             |
| --------------- | ----------------- |
| `sop`           | Open SOP          |
| `non_issue`     | Non-issue         |
| `cannot_dispute`| Non-contestable   |

### Closure reason (`closure_reason`)

The bucket the closure intake dialog writes into the `closureReason`
column. Source enum: keys of `CLOSURE_REASON_BANNER` in
`@workspace/closure-options`.

| Enum value         | Label             | Audit-log label              |
| ------------------ | ----------------- | ---------------------------- |
| `denied_by_payor`  | Denied by payor   | Denied — by payor            |
| `cannot_dispute`   | Cannot dispute    | Withdrawn — cannot dispute   |
| `non_issue`        | Non-issue         | Resolved — non-issue at classification |

The audit-log form is generated by `closureReasonAuditLabel(reason)`
and prefixes the outcome the closure produces so the line reads as a
self-contained statement of what happened.

### Hold reason (`hold_reason`)

Source enum: `LegHoldReason` in `@workspace/leg-state`. Used by the
hold-reason picker.

| Enum value                  | Label                                         |
| --------------------------- | --------------------------------------------- |
| `evidence_pending`          | Awaiting evidence                             |
| `awaiting_external_party`   | Awaiting external party (e.g. payor, hospital) |
| `awaiting_member_response`  | Awaiting member response                      |
| `awaiting_internal_review`  | Awaiting internal review (e.g. supervisor, MAS) |
| `other`                     | Other (specify below)                         |

### Submission stage (`submission_stage`)

Source enum: `status` field on portal submissions. Drives the
Submissions page chips and filter tabs.

| Enum value     | Label         |
| -------------- | ------------- |
| `draft`        | Draft         |
| `pending`      | Pending       |
| `queued`       | Queued        |
| `in_progress`  | In Progress   |
| `submitted`    | Submitted     |
| `failed`       | Failed        |
| `cancelled`    | Cancelled     |
| `dry_run`      | Dry Run       |

### Verdict outcome (`verdict_outcome`)

Per-leg verdict captured during response review. Source enum:
`verdictOutcome` field on the response-review payload.

### Audit action (`audit_action`)

Source enum: discriminator on rows in the audit log. The label set is
shared between the claim and the group log; per-kind nuances are
captured by passing the second argument to `auditActionLabel(action,
kind)`. Icons, categories, and tone classes live next to the rendering
code in `artifacts/claimclear/src/lib/audit-action-meta.ts` — only the
label string flows through the glossary.

### Verbs (`verb`)

Short button labels for actions the operator is about to take. Lives in
`lib/vocab/src/verbs.ts`. Examples:

| Key                  | Label                       |
| -------------------- | --------------------------- |
| `markNonIssue`       | Mark Non-issue              |
| `markCannotDispute`  | Mark Non-contestable        |
| `withdrawFromDispute`| Withdraw from dispute       |
| `approveDispute`     | Approve dispute             |
| `closeClaim`         | Close claim                 |
| `reopenClaim`        | Re-open claim               |

---

## Forbidden literals

The CI guardrail
(`pnpm --filter @workspace/scripts run check:vocab-drift`) refuses to
let any of the following literals appear inside
`artifacts/*/src/**/*.tsx` for the operator-facing artifacts
(`claimclear`, `api-server`):

- `"Excluded"` — use `legSubStatusLabel("excluded")` or `legSubStatusDisplayLabel(...)`
- `"Dropped"` — use `legSubStatusLabel("dropped")` or `legSubStatusDisplayLabel(...)`
- `"Non-Issue"` — render as `outcomeLabel("Non-Issue")` (resolves to "Non-issue")
- `"Non Issue"` — never correct; use `outcomeLabel("Non-Issue")`

### Allow directive

Some files genuinely need to spell the API enum value verbatim — for
example, when constructing a request body. Annotate the offending line
with a comment on the immediately preceding line:

```tsx
// vocab-allow-next-line: API enum payload sent to POST /claims/:id/close
const outcome: "Non-Issue" | "Denied" | "Withdrawn" = "Non-Issue";
```

The directive is intentionally narrow (one line, no wildcard). If you
find yourself wanting to allow a whole file, the literal is probably in
the wrong place — look for the helper in `@workspace/vocab` first.

---

## How to add a new enum value

1. Add the value to the appropriate domain file in `lib/vocab/src/`,
   including the `description` field.
2. Add a test entry in `lib/vocab/src/__tests__/vocab.test.ts` if the
   completeness check doesn't already cover the new value.
3. Run `pnpm --filter @workspace/vocab test`.
4. Update the relevant table in this document.
5. Migrate any newly-introduced UI literals to the helper function and
   re-run the drift scanner.
