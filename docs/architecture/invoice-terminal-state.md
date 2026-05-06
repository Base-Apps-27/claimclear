# Invoice & claim terminal-state model

**Status:** Authoritative — every read-side classifier ("is this done?") and every closure write-path MUST conform to this document.
**Locked:** 2026-05-06 (Task #512).
**Supersedes:** every ad-hoc `status ∈ {…}` / `outcome ≠ 'Pending'` / `reattestCompletedAt IS NOT NULL` / `closureReason IS NOT NULL` predicate scattered across the codebase. See `.local/tasks/invoice-terminal-state-unification.md` §F for the full pre-lock-down inventory.

This document is the **only** thing a contributor should need to read to answer the question "is this invoice done, and if so, why?".

---

## 1. The two terminal buckets

Every invoice group ends in **exactly one of two** terminal states. There are no other terminals.

| Terminal | Meaning to the operator |
|---|---|
| **Re-attested** | The dispute landed in the portal and we got paid (full or partial). The money is back. |
| **Withdrawn** | We are not pursuing this dispute any further. The money is not coming back from this dispute. |

A group is **open** (not terminal) until exactly one of those two stamps is recorded.

`Re-attested` and `Withdrawn` are **mutually exclusive** and **terminal**. A group cannot move from one to the other; reverting either requires an explicit admin "reopen" action, which clears all closure metadata in the same transaction.

## 2. Sub-reasons

Each terminal carries one structured sub-reason. The sub-reason is **not** a separate terminal — it is the *why*.

### 2.1 `Re-attested` sub-reasons

| Sub-reason | Operator-facing label | When |
|---|---|---|
| `full` | Re-attested in full | Payor approved the entire disputed amount and we completed the MAS portal re-attestation. |
| `partial` | Re-attested partially | Payor approved part of the disputed amount; we re-attested the approved portion in MAS. |

### 2.2 `Withdrawn` sub-reasons

| Sub-reason | Operator-facing label | When |
|---|---|---|
| `cannot_dispute` | Cannot dispute | We worked the case but the evidence we'd need doesn't exist or isn't recoverable. |
| `denied_by_payor` | Denied by payor | The payor returned a denial; we accepted the loss rather than appeal. |
| `non_issue` | Non-issue | On closer look this wasn't a billing error — nothing to dispute. |
| `expired` | Expired | The 30-day filing deadline passed before we filed. |

The `expired` sub-reason is **new with this contract**. Existing rows where `status='Expired'` (76 in prod on 2026-05-06) are backfilled to `Withdrawn / expired` via the one-shot script in §6.

## 3. The single read helper

Every "is this terminal?" question goes through one function. Write `getInvoiceTerminalState(group)` once, in `artifacts/api-server/src/lib/invoice-terminal-state.ts`, and re-export it via `@workspace/leg-state` for the client.

```ts
export type InvoiceTerminalState =
  | { terminal: "re_attested"; subReason: "full" | "partial"; at: Date }
  | { terminal: "withdrawn"; subReason: "cannot_dispute" | "denied_by_payor" | "non_issue" | "expired"; at: Date }
  | { terminal: null };

export function getInvoiceTerminalState(group: {
  status: string | null;
  outcome: string | null;
  reattestCompletedAt: Date | string | null;
  closureReason: string | null;
  closureAddressedAt: Date | string | null;
  // 'expired' is read from `status` until the closure_reason backfill lands.
}): InvoiceTerminalState;
```

**`group.terminal === null`** ⇒ the group is open. **No other code may add a third terminal** without first updating this document.

## 4. The mapping table (DB columns → terminal)

This is the **only** mapping permitted. Both new writes and the legacy-row backfill use it.

| `terminal` | `subReason` | `status` | `outcome` | `reattestCompletedAt` | `closureReason` |
|---|---|---|---|---|---|
| `re_attested` | `full` | `Resolved` | `Approved` | NOT NULL | NULL |
| `re_attested` | `partial` | `Resolved` | `Partially Approved` | NOT NULL | NULL |
| `withdrawn` | `cannot_dispute` | `Resolved` | `Withdrawn` | NULL | `'cannot_dispute'` |
| `withdrawn` | `denied_by_payor` | `Resolved` | `Withdrawn` | NULL | `'denied_by_payor'` |
| `withdrawn` | `non_issue` | `Resolved` | `Withdrawn` | NULL | `'non_issue'` |
| `withdrawn` | `expired` | `Resolved` | `Withdrawn` | NULL | `'expired'` |
| (open) | — | anything else | anything else | — | — |

Notes:
- The `Denied` *status* and the `Non-Issue` *outcome* are **deprecated** as terminal indicators. Existing rows are migrated by §6; new writes use `Withdrawn / denied_by_payor` and `Withdrawn / non_issue` instead. The pgEnum values stay (no breaking schema change), but the terminal helper ignores them — only `closureReason` is read.
- The `Expired` *status* is deprecated as a terminal indicator. Existing rows migrate to `Resolved / Withdrawn / expired`. The status enum value stays for historical audit-log readback.
- `reattestCompletedAt IS NOT NULL` and `closureReason IS NOT NULL` are **mutually exclusive** by contract; the helper throws if both are set on a single row.

## 5. The single source of truth per enum

| Concept | Source of truth | Re-exporters allowed | Re-declarations forbidden |
|---|---|---|---|
| `claim_status` | `lib/db/src/schema/claims.ts:claimStatusEnum` | `@workspace/leg-state`, `@workspace/vocab` (label map only) | anywhere else |
| `claim_outcome` | `lib/db/src/schema/claims.ts:claimOutcomeEnum` | `@workspace/leg-state`, `@workspace/vocab` (label map only) | anywhere else |
| `closure_reason` | A new `closureReasonEnum` in `lib/db/src/schema/claims.ts` (currently a free-text column — promoted to pgEnum in v2). Until then, `lib/leg-state/src/closure-reason.ts` is the canonical TS literal-union. | `@workspace/vocab` (label map only) | anywhere else |
| `LEG_SUB_STATUS` | `lib/leg-state/src/per-leg-sub-status.ts` | `@workspace/vocab` (label map only) | anywhere else |
| `VERDICT_OUTCOMES` (per-leg) | `lib/leg-state/src/verdict.ts` | `@workspace/vocab` (label map only) | anywhere else |
| `MacroPhase` | `artifacts/api-server/src/lib/macro-phase.ts` | (server-only) | anywhere else |

Every redeclared array in `lib/vocab` (currently `CLAIM_STATUSES`, `OUTCOMES`, `CLOSURE_REASONS`, `LEG_SUB_STATUSES`, `VERDICT_OUTCOMES`) **MUST** be replaced by a re-export of the source-of-truth array. The label/description maps stay; only the array literal is removed. A vitest case fails the build if any label-map key drifts from the source enum.

## 6. Migration

**No schema change in v1.** Migration is data-only.

1. **One-shot backfill script** (`artifacts/api-server/src/scripts/oneshot-terminal-state-backfill-2026-05-XX.ts`) classifies every existing row into a terminal per §4 and writes:
   - `closure_reason='non_issue'` for the 80 `Resolved/Non-Issue` groups (and their child claims), then flips `outcome='Withdrawn'`.
   - `closure_reason='denied_by_payor'` for the 5 `Denied/Denied` groups, then flips `status='Resolved'` and `outcome='Withdrawn'`.
   - `closure_reason='expired', status='Resolved', outcome='Withdrawn'` for the 72 `status='Expired'` groups (and any Expired claims).
   - One audit-log entry per row, action `terminal_state_lockdown_backfill`, metadata phase `task-512-lockdown`.
2. **Idempotent and gated** by the audit-log marker. Safe to re-run.
3. **Dry-run by default.** Production execution is invoked manually through `pnpm --filter @workspace/api-server run script:terminal-state-backfill -- --apply` after a code review of the plan output.
4. **Boot-time backfills are forbidden.** The legacy Task #74 boot-time block has been removed (see §8). All future repair scripts live under `src/scripts/` and run on-demand.

## 7. Macro-phase derivation

`macro_phase` remains a derived field — it answers "which queue does this belong to right now?", not "is it terminal?". The two helpers (`getMacroPhase(status)` and `getGroupMacroPhase(group)`) read **only** the status, `reattestRequired`, `reattestCompletedAt` columns, and (going forward) the result of `getInvoiceTerminalState`.

When `getInvoiceTerminalState(group).terminal !== null`, `getGroupMacroPhase` returns `"closed"` regardless of any other field.

`STATUSES_BY_PHASE.closed` lists statuses; it must NOT contain outcome values. (`"Withdrawn"` was removed from this list as part of the lock-down — it was an unreachable branch since `Withdrawn` is never a status.)

## 8. Forbidden patterns

The following are **build errors** going forward (enforced by lint rule + code review). If you find one in the codebase, file a follow-up task to remove it.

1. **Boot-time data backfills.** Backfills live in `src/scripts/`, are run manually with `--apply`, and are gated by an audit-log marker. Boot-time blocks like the removed Task #74 closure_reason backfill add 240 lines to startup, run on every publish, and silently mutate prod data — never again.
2. **Hand-rolled terminal predicates.** `status === 'Resolved'`, `status === 'Denied'`, `outcome !== 'Pending'`, `reattestCompletedAt != null`, `closureReason != null` — none of these may be used to answer "is this terminal?". Only `getInvoiceTerminalState(group).terminal !== null`.
3. **Outcome↔closureReason validation matrices.** The matrix lives once, in `lib/closure-validation.ts`. Routes import it; they do not re-implement it.
4. **Raw SQL terminal-status strings.** `status IN ('Resolved','Denied')` in a SQL string is forbidden. Use `inArray(claimsTable.status, TERMINAL_STATUS_LIST)` (typed) or a `WHERE g.id IN (SELECT id FROM …)` subquery built from the helper.
5. **Vocabulary redeclaration.** `lib/vocab` may declare label/description maps **only**. The enum array literal must be `export const X = sourceX;`. A vitest case fails the build on drift.
6. **Per-leg vs per-group word mismatches.** The per-leg `VERDICT_OUTCOMES` value `'Partial'` MUST be translated to `'Partially Approved'` (the `claim_outcome` value) at the boundary — `lib/leg-state/src/verdict.ts:verdictOutcomeToGroupOutcome()`. No site may compare `verdict.outcome === 'Partial'` against a group `outcome` column.
7. **Per-leg `attestation_state`.** Deprecated. The 22 non-default rows in prod are kept for historical readback; new code reads the per-group `reattestCompletedAt` only.

## 9. Acceptance test (fail the build if these break)

A vitest suite at `lib/leg-state/src/__tests__/invoice-terminal-state.test.ts` exercises:

- Every row in §4's mapping table round-trips through the helper.
- Both terminals reject the row when their mutually-exclusive partner is also set.
- Reverting a terminal (admin reopen) clears `reattestCompletedAt`, `closureReason`, `closureAddressedAt`, `closureReviewState` in one transaction.
- The four legacy predicates from `.local/tasks/invoice-terminal-state-unification.md` §A all agree with the helper on every row produced by §6's backfill.
- `lib/vocab` arrays are reference-equal to the schema-source arrays.

## 10. Open questions deferred to v2

- Promoting `closure_reason` from `text` to a pgEnum (requires migration coordination with the dashboard exporters).
- Renaming `claim_outcome` enum values to align with the per-leg vocabulary (`Partial` vs `Partially Approved`).
- Deleting the `attestation_state` per-leg column.
- Splitting `claim_status` and `invoice_group_status` into two distinct pgEnums (today they share `claimStatusEnum`).

These are **out of scope** for v1 and require separate design + migration tasks.
