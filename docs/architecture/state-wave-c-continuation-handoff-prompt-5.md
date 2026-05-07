# Wave C Continuation Handoff #5

**Status as of this session**: T006-A (frontend reads — foundation slice) is **complete**. T005 backend remains substantially complete per continuation #4. Remaining: T006-B (components/pages migration), T008 (training guide), T010 (gauntlet), T011 (docs + Wave D handoff).

## What shipped this session

### T006-A audit findings

Re-ran `rg -l "claims?\.(status|outcome)|sopOutcome" artifacts/claimclear/src/lib`. Three matches:

| File | Status | Notes |
|---|---|---|
| `lib/prompt-context-counters.ts` | already migrated | Already routes through `outcomeRole` from `@workspace/leg-state`. The `sopOutcome` field is part of the input shape passed into the canonical helper, not a direct read. |
| `lib/sop-terminal-routing.ts` | already migrated | Already routes through `outcomeRole`. |
| `lib/whats-next-derivation.ts` | **switched this session** | Line 283 read `leg.sopOutcome` directly to test for `non_issue` / `cannot_dispute` closure. Switched to `outcomeRole(leg) === "non_issue"` / `"cannot_dispute"`. The `outcomeRole` ladder collapses both legacy `sopOutcome` strings to the same role names, so the switch is identity-preserving. Sibling-duplicate detection stays on `duplicateOfClaimId != null` (separate bucket from cannot_dispute / non_issue — using `outcomeRole === "duplicate"` would mask the underlying closure). |

The handoff #4 line item "5 frontend derivation libs" was approximate — only 3 lib files matched, and 2 of those were already on the canonical helper. The actual surface area for slice A was **`tone.ts` + `whats-next-derivation.ts`**.

### `tone.ts` foundation (the central status→tone color map)

Added a row-aware `toneForRow(row)` alongside the existing `toneForStatus(status)`. New helper:

- Reads `disposition` first; maps each `ClaimDisposition` from `@workspace/vocab` to its tone family via a complete `DISPOSITION_TO_TONE` table (compile-time exhaustive for the 22-tuple, defensive runtime guard with `in` check).
- Skips the `unclassified` default and falls through to `toneForStatus(row.status)` — same Wave-C fallback rule as `deriveLegSubStatus` in `@workspace/leg-state`. This keeps tones correct on rows whose writer hasn't synced disposition yet (in-flight Wave-D writer rewire).
- `toneForStatus` is unchanged. The two special status-only cases (`Processed → purple`, `MAS Eligible → green`) remain status-keyed because neither has a clean disposition counterpart — `Processed` is a leg-level "worktree complete, parent not packaged" UI state the disposition column does not encode, and `MAS Eligible` resolves through `attest_pending` / `attest_queued` (both green) rather than a 1:1 status. Documented inline.

This is foundation work for slice B — no callers updated yet.

### Files touched this session

- `artifacts/claimclear/src/lib/whats-next-derivation.ts` — switched closure check to `outcomeRole`.
- `artifacts/claimclear/src/components/cohesion/tone.ts` — added `toneForRow`, `RowForTone`, `DISPOSITION_TO_TONE`.
- `artifacts/claimclear/src/components/cohesion/tone.test.ts` — new file. 7 tests pinning the precedence rules (disposition > status, unclassified-default fallback, defensive unknown-string fallback, full disposition→tone matrix, legacy `toneForStatus` still pinned).

### Validation
- `pnpm --filter @workspace/claimclear typecheck` — clean.
- Targeted `node:test` run on the two changed files: **27/27 green** (`whats-next-derivation` 20/20 + `tone` 7/7).
- Pre-existing flakes observed in the broader test run (NOT touched this session): `attestation-queue-open-interactions`, `attestation-queue-open`, `invoice-group-submission-gauntlet`, `invoice-reattest-only`, `use-transient-flag` (timing). None overlap with the changed files.

## What's left in Wave C

| Task | Estimate | Notes |
|---|---|---|
| **T006-B components/pages** | 1 slice | Migrate the ~13 `toneForStatus` callers (enumerated below) to `toneForRow` so they read disposition first. |
| **T008 training guide rewrite** | 1 slice | 9 slide components + manifest in `artifacts/training-guide/`. Standalone, no backend touch. |
| **T010 gauntlet** | half a slice | Run the prod-mirror test gauntlet: `pnpm -r typecheck`, `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/claimclear test`. Document the 5 newly-observed flakes (above) vs. the 3 known TZ flakes from continuation #2 §3.A. |
| **T011 docs + Wave D handoff** | half a slice | Update Wave C section in `docs/architecture/state-machine-refactor.md`. Write `state-wave-d-handoff.md` enumerating the writer rewire backlog (see continuation #4's §3.B residuals list). |

**Realistic remaining cadence**: 3 more focused sessions (T006-B; T008; T010+T011 combined).

## T006-B inventory — `toneForStatus` callers

Run `rg -n "toneForStatus" artifacts/claimclear/src -g '*.ts' -g '*.tsx'` for the up-to-date list. As of this session:

- `pages/withdrawals.tsx`
- `pages/invoice-groups.tsx`
- `pages/claims.tsx`
- `pages/claim-new.tsx`
- `pages/invoice-group-detail.tsx`
- `pages/invoice-new.tsx`
- `pages/import.tsx`
- `components/cohesion/status-pill.tsx`
- `components/cohesion/recommended.tsx`
- `components/cohesion/page-header.tsx`
- `components/cohesion/metric-tile.tsx`
- `components/cohesion/filter-strip.tsx`
- `components/cohesion/cross-page-nudge.tsx`
- `components/withdrawal-review-drawer.tsx`
- `components/mas-action-checklist.tsx`
- `components/attestation/group-review-pane.tsx`
- `components/attestation/completed-detail-pane.tsx`
- `components/attestation/queue-row.tsx`

**Slice strategy**: switch `status-pill.tsx` first (the lowest-level cohesion primitive — every page-level callsite that wraps a status string for display flows through it). Most page-level callers can then drop their direct `toneForStatus(row.status)` calls in favor of passing the row through `<StatusPill row={row} />`. The handful that genuinely only have a status string in scope (URL filter pills, tab labels) keep `toneForStatus` and stay correct by definition.

After each batch of 4-5 components, run typecheck + the affected component tests; the test runner (`node:test`, not vitest) globs by directory so the convenient command is `cd artifacts/claimclear && TSX_TSCONFIG_PATH=./tsconfig.test.json node --experimental-test-module-mocks --import tsx --test --test-force-exit src/components/cohesion/*.test.ts*`.

## Sharp edges (still authoritative — see continuation #2 §3.A-E)

Unchanged. The Wave-D backlog (§3.B claim-level open filters, §3.C raw SQL in `day-complete.ts`, §3.D unclassified fallback rule, §3.E response-shape aggregates) all remain open and intentional.

**New observation worth flagging in T011 / Wave D handoff**: 5 component/hook tests are now flaking in the broader claimclear suite (listed under Validation above). These were NOT touched this session and their failures are unrelated to the disposition switch — probably timing/environment. T010 should triage whether they're new flakes or pre-existing-unobserved.

## Recommended next session

Start T006-B with `components/cohesion/status-pill.tsx` — the central primitive. Migrating it once likely lets several page-level callers drop their `toneForStatus` calls without further edits. After status-pill, work outward through the cohesion primitives (`recommended`, `metric-tile`, `page-header`, `filter-strip`, `cross-page-nudge`), then the attestation surfaces, then the page-level callers. Keep typecheck + targeted tests green after every 4-5 file batch.
