# Wave C Continuation Handoff #6

**Status as of this session**: T006-B (frontend reads — components/pages migration) is **substantively complete**. T010 (typecheck portion of the gauntlet) is **green**. T011's Wave-D handoff is **shipped** (`docs/architecture/state-wave-d-handoff.md`). Remaining: T008 (training guide rewrite) and the test-suite portion of T010.

## What shipped this session

### T006-B audit findings

The continuation #5 inventory of "13 callers" was stale. Re-ran
`rg -n "toneForStatus" artifacts/claimclear/src -g '*.ts' -g '*.tsx'` and
cross-referenced every component the inventory listed. Concrete findings:

| Class | Count | Files |
|---|---|---|
| True `toneForStatus` callers (the migration target) | 4 | `tone.ts`, `tone.test.ts`, `status-pill.tsx`, `index.ts` |
| `<StatusPillForStatus>` callsites with row context (the page-level migration target) | 2 | `pages/claims.tsx`, `pages/invoice-groups.tsx` |
| `TONE_STYLE` direct color-token consumers (out of scope — these never derived a tone, they style with a fixed color) | ~16 | every other file in continuation #5's inventory |

Of the two row-context callsites, only `claims.tsx` was eligible for the
row-aware migration: `ClaimResponse` carries `disposition` (canonical),
while `InvoiceGroupResponse` only carries `phase` — it has no `disposition`
to feed `toneForRow`, so migrating it would be an identity rename.
Documented inline in `status-pill.tsx`'s comment on `StatusPillForRow`.

### `StatusPillForRow` (the row-aware sibling primitive)

Added next to `StatusPillForStatus` in
`artifacts/claimclear/src/components/cohesion/status-pill.tsx`:

- Tone derives from `disposition` first via `toneForRow`; falls through to
  the status ladder under the same `unclassified` rule as the rest of the
  Wave-C readers (§3.D).
- Display label still derives from `status` because the user-facing glossary
  in `@workspace/vocab` is status-keyed.
- Both pills now share a `renderStatusPill(tone, status, className)` helper
  to keep the tooltip-wrap logic in one place.

`StatusPillForStatus` is unchanged; status-only callsites (URL filter pills,
group rows that have no disposition, tab labels) keep using it.

### `pages/claims.tsx` — switched to `<StatusPillForRow row={claim} />`

Drops the unused `StatusPillForStatus` import. Tone now follows
`claim.disposition` for every row in the claims list; the status pill copy
is unchanged.

### T010 typecheck gauntlet

`pnpm -r --workspace-concurrency=1 typecheck` runs clean across all 19
workspace projects after this session's edits. (Default concurrency wedged
the shell — pinning to 1 is the reliable invocation here.)

### T011 Wave D handoff

Wrote `docs/architecture/state-wave-d-handoff.md`. Catalogues every
remaining `claims.status` / `claims.outcome` / `invoice_groups.status` /
`invoice_groups.outcome` / `sopOutcome` reference in the codebase against
the specific §3.A–E sharp edge that justifies it, and proposes a 6-PR
suggested sequence for the writer rewire (D-PR1 through D-PR6).

**Note**: continuation #5's T011 line item said "update Wave C section in
`docs/architecture/state-machine-refactor.md`". That file does not exist;
the closest doc is `docs/architecture/state-migration-plan.md`, which
covers the orthogonal data/schema waves 1-5 (not the A/B/C/D code-migration
axis). Skipped that line item rather than invent a new doc structure — the
Wave-C continuation series itself is the canonical log of A/B/C/D. Future
sessions should decide whether to fold A/B/C/D into an explicit summary
doc or leave the rolling continuation series as the authoritative source.

### Files touched this session

- `artifacts/claimclear/src/components/cohesion/status-pill.tsx` — added
  `StatusPillForRow`, `RowForTone`-typed prop, shared
  `renderStatusPill` helper.
- `artifacts/claimclear/src/components/cohesion/index.ts` — exported
  `StatusPillForRow`, `toneForRow`, `RowForTone`.
- `artifacts/claimclear/src/components/cohesion/status-pill.test.tsx` — new
  file. 4 tests: disposition wins, `unclassified` falls through, missing
  disposition falls through, legacy `StatusPillForStatus` still pinned.
- `artifacts/claimclear/src/pages/claims.tsx` — switched the row-context
  status pill to `<StatusPillForRow row={claim} />`; dropped the
  `StatusPillForStatus` import.
- `docs/architecture/state-wave-d-handoff.md` — new file (T011).
- `docs/architecture/state-wave-c-continuation-handoff-prompt-6.md` — this
  doc.

### Validation
- `pnpm --filter @workspace/claimclear typecheck` — clean.
- `pnpm -r --workspace-concurrency=1 typecheck` — clean across 19 projects.
- Targeted `node:test` run on the changed cohesion files: **11/11 green**
  (`tone.test.ts` 7/7 + `status-pill.test.tsx` 4/4).

---

## What's left in Wave C

| Task | Estimate | Notes |
|---|---|---|
| **T008 training guide rewrite** | 1 slice | 9 slide components in `artifacts/training-guide/src/pages/slides/` (specifically those that reference status names that have shifted meaning under disposition/phase: `StatusLifecycle`, `Classify`, `WorkflowPlayer`, `HandlingResponse`, `WithdrawalsReview`, `AwaitingResponse`, `SubmitDispute`, `JourneyOverview`, `CommonPitfalls`). The manifest itself is fine; the slides' copy needs an editorial pass to reflect Wave C terminology. **Needs explicit content guidance from the product owner before a session can start** — the slides are operator-facing, and the change is editorial, not mechanical. |
| **T010 test-suite gauntlet** | half a slice | `pnpm --filter @workspace/api-server test` + `pnpm --filter @workspace/claimclear test`. Continuation #5 flagged 5 newly-observed flakes; this session did not re-run the suites. T010 should triage them against the 3 known TZ flakes from continuation #2 §3.A. |

**Realistic remaining cadence**: 2 more focused sessions (T010 test-suite gauntlet; T008 once content guidance lands).

---

## T008 inventory — slides likely needing copy refresh

Run `rg -n "Status|Outcome|status|outcome|disposition|phase" artifacts/training-guide/src/pages/slides/` for the up-to-date list of slides that reference state-vocabulary terms. As of this session, the candidates (per the manifest order) are:

| Position | Slide | Why it's a candidate |
|---|---|---|
| 2 | `JourneyOverview.tsx` | "Triage, Classify, Process, Submit, Outcome" — verify the macro-phase names still match `INVOICE_PHASES`. |
| 4 | `StatusLifecycle.tsx` | Reference card for every claim/group status. Highest-touch slide; needs the full status→disposition crosswalk. |
| 6 | `Classify.tsx` | Pick the Error Type that runs the right workflow. Verify the workflow-name copy matches the disposition-driven router. |
| 8 | `WorkflowPlayer.tsx` | Decision tree per error type. Verify the per-step "what status is this in" labels. |
| 14 | `SubmitDispute.tsx` | Pre-flight checklist + Sandbox Run. Verify the readiness-gate copy matches `group-readiness.ts`. |
| 16 | `AwaitingResponse.tsx` | MAS reply window + follow-up rules. Verify the `disposition === awaiting_review` rule wording. |
| 17 | `HandlingResponse.tsx` | Pick the verdict (Re-dispute / Re-attest / Submit New Invoice / Denied by Payor). Verify the verdict labels match `verdict_*` dispositions. |
| 18 | `WithdrawalsReview.tsx` | Supervisor sign-off for Cannot Dispute, Non-Issue, and Denied by Payor. Verify the closure-reason vocabulary matches `@workspace/vocab` `OUTCOME` / `CLAIM_DISPOSITION`. |
| 23 | `CommonPitfalls.tsx` | Six common mistakes. Verify any "if status is X then Y" callouts still hold under disposition-driven tone. |

**Slice strategy** (when the session lands): start with `StatusLifecycle.tsx` since it's the reference card the others link back to; once the canonical crosswalk is settled there, the remaining 8 slides become consistency edits rather than authoring decisions.

---

## Sharp edges (still authoritative — see continuation #2 §3.A-E)

Unchanged. The Wave-D backlog now lives in
`docs/architecture/state-wave-d-handoff.md` rather than being recapped here;
it cross-references each §3.B–E sharp edge to the specific writer surface
that unblocks switching its residuals.

The 5 broader-suite flakes flagged in continuation #5 (`attestation-queue-open-interactions`, `attestation-queue-open`, `invoice-group-submission-gauntlet`, `invoice-reattest-only`, `use-transient-flag`) were NOT re-run this session. Still open for T010 triage.

---

## Recommended next session

Run T010's test-suite portion first — it's bounded (~1 hour worst case) and either confirms the 5 flakes are pre-existing/timing or surfaces a real regression worth fixing before T008. Once T010 is closed, T008 can ship behind a content-guidance unblock from the product owner. After T008 + T010, Wave C is complete and Wave D becomes the active doc.
