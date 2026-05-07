# Wave D PR2c Handoff

**Status as of this session**: D-PR1 (`is_open` GENERATED column) shipped commit `e883c79d`; D-PR2a (cache helpers write canonical columns alongside legacy mirrors) shipped commit `1ac4867a`; D-PR2b (single-writer rewire of the four SOP/exclude call-site groups) shipped commit `aad41b98`. The Wave D suggested sequence in `state-wave-d-handoff.md` §3 / §6.3 is now at **D-PR2c**: invert the cache so `claims.disposition` is the single source of truth and `claims.status` / `claims.outcome` become projections of it.

## What shipped this session

### D-PR2b — single-writer rewire of disposition

Introduced `setClaimDisposition()` as the single writer for `claims.disposition` and the legacy mirror columns (`sop_outcome`, `drop_reason`, `included_in_dispute`, `dropped_at`, `ready_at`). Rewired the four call-site groups identified in the D-PR2b inventory:

- **`excludeLegCore`** (`artifacts/api-server/src/lib/claim-transitions.ts:548-602`) — exclusion path. Two-mode mirror policy: `mirror: "derived"` for `reason === "non_issue"` (preserves the Task #476 `sop_outcome = 'non_issue'` co-write under the existing null-guard); `mirror: "skip"` for all other reasons (e.g. `cannot_dispute`) so legacy mirrors stay untouched, identical to the previous direct UPDATE behavior.
- **Per-leg SOP-advance terminal step** (`routes/claims.ts:~1885`) — terminal SOP-walk transitions stamp `disposition = sopOutcomeToDisposition(nextSopOutcome)` with `isTerminal: true`. Mid-walk transitions keep their inline UPDATE (no terminal outcome → no disposition stamp; cache helper recomputes from `errorTypeId != null → classifying`). `extraFields: updateData` lets the writer fold `sopAnswers`, `sopNodeId`, MAS-derivation columns, etc. into the same UPDATE so there is one trigger fire per claim per route.
- **Conclude-leg** (`routes/claims.ts:~2001`) — operator-initiated drop. Passes `isTerminal: true` and an explicit `droppedAt` so it stamps the full terminal tuple (`sopOutcome` + `dropReason` + `droppedAt`) under the same writer.
- **Bulk SOP-advance terminal step** (`routes/invoice-groups.ts:~3281`) — hot path. Passes `tx` as `ex` so the per-leg disposition stamp + audit insert + state-event insert all execute on the loop's outer transaction. The per-leg `bulk: true, source: "group_sop_advance"` audit metadata is unchanged.

#### `setClaimDisposition()` shape

`artifacts/api-server/src/lib/leg-state/set-claim-disposition.ts` (~290 lines). Signature:

```ts
setClaimDisposition(
  claimId: number,
  disposition: ClaimDisposition,
  opts?: {
    isTerminal?: boolean;             // gates dropReason + droppedAt
    mirror?: "derived" | "skip";      // legacy-mirror policy
    includedInDispute?: boolean;      // explicit caller intent only
    droppedAt?: Date | null;          // override or suppress
    readyAt?: Date | null;            // override or suppress
    onlyWhenIncluded?: boolean;       // mirrors excludeLegCore predicate
    extraFields?: Partial<...>;       // merge into same UPDATE
    ex?: DbExecutor;                  // reuse caller's tx
  },
): Promise<Claim | null>
```

Companion helpers (kept in the same module so the inversion lives in one place — this is the seed for D-PR2c's `dispositionToStatus`):

- `dispositionToLegacy(disposition, isTerminal)` — inverse of the §3.D fallback table.
- `sopOutcomeToDisposition(sopOutcome)` — forward map matching `sopOrDropReasonDisposition` in `lib/invoice-state/derive-disposition.ts`.

#### Sharp edges preserved

1. **Task #476 `sop_outcome` co-write guard.** The writer reads the row first and only stamps `sop_outcome` when the existing column is null. An exclusion-as-non_issue cannot clobber an SOP-walk verdict that landed first. Pinned by parity test `excludeLegCore reason=non_issue honors Task #476 sop_outcome guard`.
2. **Terminal-vs-mid-walk distinction.** `dropReason` and `droppedAt` only flow when `isTerminal === true`. Mid-walk SOP transitions stamp `sopOutcome` only.
3. **Bulk-loop tx executor reuse.** The bulk SOP-advance loop passes `ex: tx` so per-leg disposition stamps, audit inserts, and state-event inserts execute on the same outer transaction the loop opened. No per-leg savepoint, no extra connection acquisition.
4. **Orphan-leg guard.** When `current.invoiceGroupId == null` the writer SKIPS the canonical `disposition` column write (legacy mirrors still flow). This preserves the cache-helper invariant: standalone legs don't carry a meaningful disposition because there is no parent phase to validate against, and stamping it permanently would strand the column at the writer's value (the cache helper short-circuits without ever recomputing it on subsequent state changes — clear-sop-hold, reclassify, re-include). Production has zero orphan legs; this branch exists only for tests and any historical bare rows. Pinned by parity test `setClaimDisposition skips canonical column for orphan legs`.

#### Latent test-fixture overload uncovered & fixed

The auto-exclude commit failure on `Needs Review → Needs Evidence via group classify auto-excludes blank-description sibling claims` traced to a long-standing overload in the test-fixture phase mapping. `STATUS_TO_PHASE["Needs Review"]` was set to `response_received`, but `derivePhaseFromLegacy` (the canonical mapping in migration `0034_invoice_phase_and_disposition.sql`) puts the **Needs Review → Needs Evidence auto-promotion** path in `triage`. The two interpretations both have callers:

- `denormalized-cache.ts:138`, `macro-phase.ts:54`, `response-matcher.ts`, the response-pending tests — treat `Needs Review` as `response_received`.
- `derivePhaseFromLegacy`, `group-transitions.ts:autoExcludeBlankSiblingsOnPromote`, the auto_after_classify path — treat `Needs Review` as `triage`.

Pre-D-PR2b this was invisible because `excludeLegCore` never touched the `disposition` column, so the deferred `claims_disposition_phase_chk` trigger never fired. After D-PR2b stamps `disposition = 'disposed_nonissue'` on the auto-excluded blank legs, the trigger correctly rejected `disposed_nonissue` as invalid for the wrongly-stored `response_received` parent phase.

Resolution (kept minimal, no behavior change): the default fixture mapping stays `response_received` (the response-pending tests rely on it), and the two triage-phase tests pass `phase: "triage"` explicitly. Comments in both `state.ts` and `per-leg-state.test.ts` document the overload.

### Files touched this session

- `artifacts/api-server/src/lib/leg-state/set-claim-disposition.ts` — new writer (~290 lines).
- `artifacts/api-server/src/lib/claim-transitions.ts` — `excludeLegCore` rewired; new import of `setClaimDisposition`.
- `artifacts/api-server/src/routes/claims.ts` — per-leg SOP-advance terminal + conclude-leg rewired; new import.
- `artifacts/api-server/src/routes/invoice-groups.ts` — bulk SOP-advance terminal step rewired; new import.
- `artifacts/api-server/src/__tests__/set-claim-disposition-parity.test.ts` — new parity test (9 cases, satisfies the §5 parity-test requirement).
- `artifacts/api-server/src/__tests__/fixtures/state.ts` — comment-only documentation of the `Needs Review` overload; mapping unchanged.
- `artifacts/api-server/src/__tests__/per-leg-state.test.ts` — two `phase: "triage"` explicit overrides on the auto_after_classify tests.
- `docs/architecture/state-wave-d-pr2c-handoff-prompt.md` — this doc.

### Validation

- `pnpm -r --workspace-concurrency=1 typecheck` — clean.
- §5 validation gauntlet (`leg-status-projector` + `per-leg-state` + `group-sop-advance` + `set-claim-disposition-parity`): **95/95 green**.
- Targeted runs on every disposition-touching test file: green (`include-terminal-readback-cycle`, `disputed-legs-resolved`, `group-packaging-readiness`, `submit-flow-gates`).
- Pre-existing failures from the D-PR2b handoff doc (`duplicate-of-endpoints.test.ts:291`, `list-count-past-deadline-parity.test.ts:254`) reproduce identically and are NOT regressions of this session. Two additional pre-existing failure clusters surfaced under the broader test sweep (object-storage URL validation in `closure-data-foundation.test.ts`; calendar/weekend math in `dates-guardrail.test.ts` / `dashboard-expiring.test.ts`) — both unrelated to disposition and present in `aad41b98`'s parent.
- Dev DB conformance audit (`scripts/src/check-invoice-state-derivation.ts`): 42 `phase_mismatch` rows, all the `Needs Review stored=response_received derived=triage` drift the fixture overload above documents. Holds steady from the 38 rows reported pre-D-PR2b. PROD audit not run from this session — see follow-up §1.

---

## What's left in Wave D

| PR | Estimate | Notes |
|---|---|---|
| **D-PR2c — invert the cache** | 1 slice | Replace `projectLegStatus` (`denormalized-cache.ts:99-153`) with `dispositionToStatus(disposition, parent)`. Status / outcome become derived projections of the now-canonical disposition. Add the formal parity assertion the original §6.3 plan asked for. |
| **D-PR3 — §3.B residuals onto `is_open`** | half a slice | Pure column substitution at the 6 callsites in `state-wave-d-handoff.md` §3.B. |
| **D-PR4 — `day-complete.ts` SQL builder rewrite** | half a slice | §3.C. Source the matcher's sets from `disposition` / `phase` directly. |
| **D-PR5 — §3.E aggregates** | half a slice | Per §6.2: ship immediately, no parity window. PROD audit is the parity proof. |
| **D-PR6 — drop the `unclassified` fallback** | half a slice | §3.D. Gated on a re-run of the conformance script post-D-PR2b showing no `unclassified` row that should have a canonical value. |

After D-PR6, Wave E (drop the legacy columns) is unblocked.

---

## D-PR2c inventory — `projectLegStatus` and the legacy-mirror cache writes

Run `rg -n "projectLegStatus|deriveDispositionFromLegacy" artifacts/api-server/src lib` for the up-to-date list. As of this session:

### `denormalized-cache.ts`

| Line(s) | Surface | Notes |
|---|---|---|
| 99-153 | `projectLegStatus` definition | The 5-rule decision table that takes `(group.status, sopOutcome, holdReason, group.reattestRequired, group.reattestCompletedAt)` and returns the projected `claim.status`. **D-PR2c replaces this** with `dispositionToStatus(disposition, parent)` — the inversion. The table's per-MacroPhase branches are the inputs you'll need to re-express in disposition terms; preserve the sentinel-`null` "leave the leg's existing status alone" return for excluded legs in pre-submit. |
| 234, 253-264 | `refreshClaimDenormalizedCache` status projection | Today: `nextStatus = projectLegStatus(leg, group)`. After D-PR2c: `nextStatus = dispositionToStatus(nextDisposition, group)`. The `nextDisposition` value already comes from `deriveDispositionFromLegacy` two lines above, so the inversion is a one-line swap inside this helper — but the contract change ripples through `projectLegStatus`'s 21 unit tests (`leg-status-projector.test.ts`). |
| 316 | `export { projectLegStatus }` | Currently exported for the unit-test suite. D-PR2c either drops this export (and rewrites `leg-status-projector.test.ts` to exercise `dispositionToStatus` instead) or keeps it as a deprecated re-export through D-PR6. The Wave D §6.3 plan implies the former. |

### Co-located with `set-claim-disposition.ts`

| Surface | Notes |
|---|---|
| `dispositionToLegacy(disposition, isTerminal)` | The §3.D inverse table for `(sop_outcome, drop_reason)`. D-PR2c's `dispositionToStatus` is the parallel inverse for `(claim.status, claim.outcome)`. Putting both inversions in the same module (`leg-state/set-claim-disposition.ts` or a new `leg-state/disposition-projections.ts`) keeps the §3.D fallback geometry localized. |
| `sopOutcomeToDisposition(sopOutcome)` | Forward map. Useful as a reference for the inverse direction. |

### Cache-helper callsites (read-only — do NOT change in D-PR2c)

`refreshClaimDenormalizedCache` is called 27 times in `routes/claims.ts` and 8 times in `routes/invoice-groups.ts`. D-PR2c does NOT touch these — the helper's signature stays the same; only its internal projection inverts. Adding the inversion *inside* `refreshClaimDenormalizedCache` means callers see no change.

---

## Sharp edges D-PR2c must preserve

Beyond the §3.A-E sharp edges in the Wave-C continuation series and the four D-PR2b additions, D-PR2c inherits two contracts that surfaced or sharpened this session:

1. **`Needs Review` is overloaded between `triage` and `response_received`.** The macro-phase reader, denormalized cache, and response-matcher all treat `Needs Review` as `response_received`, but `derivePhaseFromLegacy` and `autoExcludeBlankSiblingsOnPromote` treat it as `triage`. D-PR2c's `dispositionToStatus` projector must be specified against the **canonical phase** (the one the trigger validates against), not the macro-phase reading. Concretely: a `Needs Review` group with `phase = 'triage'` should project legs back to `Needs Review` (via the existing "mirror group" rule) regardless of which interpretation the read-side surface uses. The 42 dev-DB `phase_mismatch` rows are the exhaust of this overload; they will heal lazily as D-PR2a's cache helpers touch them.
2. **Orphan legs keep status / outcome untouched.** D-PR2b's writer skips the canonical `disposition` column for orphan legs; D-PR2c's `dispositionToStatus` must mirror this — an orphan leg has no `parent.phase`, so the projector can't compute a status from disposition. Today `refreshClaimDenormalizedCache` already short-circuits orphan legs (line 198-199 docstring); the inversion should preserve that early-return.

## Sharp edges (still authoritative — see continuation #2 §3.A-E + Wave D §3)

The Wave-C continuation #2 §3.A-E catalogue and Wave D §3.A-E are unchanged by this session. D-PR2c does NOT close any of them — the cache inversion is a §6.3 concern only.

---

## Pre-existing test noise to disentangle

D-PR2c verification will encounter five unrelated failure clusters that are NOT regressions of D-PR1 / D-PR2a / D-PR2b — all confirmed pre-existing. Two were already documented in the D-PR2b handoff doc; three more surfaced under the broader test sweep this session:

| Test | Failure | Cause |
|---|---|---|
| `artifacts/api-server/src/__tests__/duplicate-of-endpoints.test.ts` | line 291 | Pre-existing dev DB drift; fails identically under D-PR1 code. |
| `artifacts/api-server/src/__tests__/list-count-past-deadline-parity.test.ts` | line 254 | Pre-existing dev DB drift; fails identically under D-PR1 code. |
| `artifacts/api-server/src/__tests__/closure-data-foundation.test.ts` | 10 cases (closure_evidence + outcome PATCH) | `imageUrl must be an application storage path beginning with /objects/` — object-storage validation in evidence routes. Unrelated to disposition. |
| `artifacts/api-server/src/__tests__/dates-guardrail.test.ts` | 8 cases (Friday/Saturday/Sunday math) | Calendar/weekend deadline math; date-dependent on the test runner's wall clock. |
| `artifacts/api-server/src/__tests__/dashboard-expiring.test.ts` | 7 cases (today-deadline group urgency) | Same calendar/weekend math as above. |

Dev DB also still has 42 `phase_mismatch` rows (PROD audit was clean as of D-PR2a; D-PR2b should not have moved that needle). The D-PR2a cache helpers will heal these lazily as normal traffic touches them. **Do not block D-PR2c on these** — re-run the conformance audit on PROD after D-PR2b lands; that's the verification that matters. Per Wave D §6.2, no parity window is needed.

---

## Recommended next session

1. **Read first** (in order): `state-wave-d-handoff.md` §6.3 (the three-stage flip rationale), then `denormalized-cache.ts:90-316` (the `projectLegStatus` table + the disposition-aware refresh helper), then `set-claim-disposition.ts:60-120` (the `dispositionToLegacy` and `sopOutcomeToDisposition` inversions to mirror), then `leg-status-projector.test.ts` (the 21 unit tests that currently pin `projectLegStatus`).
2. **Design `dispositionToStatus(disposition, parent)`** as a pure helper, co-located with `dispositionToLegacy`. Required signature shape:
   - `(disposition: ClaimDisposition, parent: { phase: InvoicePhase | null; status: string; reattestRequired: boolean | null; reattestCompletedAt: Date | string | null }) => ClaimStatus | null`
   - Returns `null` for orphan / excluded-in-pre-submit legs (preserve the sentinel from `projectLegStatus`).
   - Spec'd against `parent.phase` (canonical), not the macro-phase reading. Use `STATUSES_BY_PHASE` from `macro-phase.ts` as the cross-reference for which legacy statuses each phase admits.
3. **Invert the cache** inside `refreshClaimDenormalizedCache`:
   - Compute `nextDisposition` first (already does — line 247 area).
   - Replace the `projectLegStatus(leg, group)` call with `dispositionToStatus(nextDisposition, group)`.
   - Delete `projectLegStatus` and its export. The `leg-status-projector.test.ts` suite gets renamed/rewritten against `dispositionToStatus`.
4. **Add the §6.3 parity assertion**: a dev-only assertion (or test) that `projectLegStatus(leg, group) === dispositionToStatus(deriveDispositionFromLegacy(toLegacyClaimShape(leg)), group)` for every cache-refresh write. This is the parity check the original §6.3 plan asked for; it becomes meaningful only now that D-PR2b's writer is the sole producer of disposition.
5. **Validation gauntlet** (per Wave D §5):
   - `pnpm -r --workspace-concurrency=1 typecheck` — clean.
   - `pnpm --filter @workspace/api-server exec node --import tsx --test src/__tests__/leg-status-projector.test.ts src/__tests__/per-leg-state.test.ts src/__tests__/group-sop-advance.test.ts src/__tests__/set-claim-disposition-parity.test.ts src/__tests__/include-terminal-readback-cycle.test.ts` — must stay 100% green.
   - `scripts/src/check-invoice-state-derivation.ts` against PROD post-D-PR2b-publish (see Operator follow-up §1) and again post-D-PR2c-merge — both must remain 0/3,715. Re-run the dev audit; the 42 pre-existing drifted rows should monotonically decrease as traffic flows.
6. **Stop at D-PR2c.** D-PR3 (§3.B residuals onto `is_open`) is the next session after that.

---

## Operator follow-up (carried over from this session)

These are not D-PR2c implementation work but they belong in the very next operator window because the conformance audit and the dev-DB heal trend depend on them:

1. **Publish the unpublished Wave D work to PROD.** Last publish was at the end of Wave C; commits `e883c79d` (D-PR1), `1ac4867a` (D-PR2a), and `aad41b98` (D-PR2b) are all unpublished. The conformance script measures PROD's actual data, so it can't verify D-PR2b until the writer is in PROD and exercising the four call sites.
2. **Run `pnpm --filter @workspace/scripts run check:invoice-state-derivation` against PROD** post-publish. The acceptance bar is unchanged from the 2026-05-07 baseline: 1,310 groups + 2,405 claims = 3,715 rows, **0 violations** across all three assertions. Either order (pre-publish baseline + post-publish re-run, or just post-publish) is safe — D-PR2a was the last write-touching change, so a pre-publish PROD run gives a clean baseline to compare against. The script needs `DATABASE_URL` pointed at PROD when invoked.
3. **Re-run the dev audit periodically** through the D-PR2c window. The 42 `phase_mismatch` rows are the `Needs Review stored=response_received derived=triage` drift documented above; they should heal lazily as the D-PR2a cache helpers touch them. Treat any *increase* as a regression worth investigating.

---

## Validation invocation reference

The default `pnpm test` concurrency wedges the shell on this monorepo. The reliable invocations from D-PR2a / D-PR2b:

```bash
# Typecheck (workspace-wide)
pnpm -r --workspace-concurrency=1 typecheck

# Targeted unit tests (must run from inside the api-server filter so tsx resolves)
pnpm --filter @workspace/api-server exec node --import tsx --test \
  src/__tests__/leg-status-projector.test.ts \
  src/__tests__/per-leg-state.test.ts \
  src/__tests__/group-sop-advance.test.ts \
  src/__tests__/set-claim-disposition-parity.test.ts

# Conformance audit
pnpm --filter @workspace/scripts run check:invoice-state-derivation
```

Workflow `artifacts/training-guide: web` emits port-collision noise (`EADDRINUSE 0.0.0.0:5924`) on every restart — pre-existing, ignore.
