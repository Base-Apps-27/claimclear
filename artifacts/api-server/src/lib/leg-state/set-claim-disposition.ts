// Wave D-PR2b — single-writer for `claims.disposition` and the
// legacy mirror columns (`sop_outcome`, `drop_reason`,
// `included_in_dispute`, `dropped_at`, `ready_at`).
//
// This is the only writer that should stamp `disposition` directly
// from a route handler. The cache-helper writers in
// `lib/denormalized-cache.ts` (D-PR2a) continue to derive disposition
// from legacy inputs as a defense in depth and run *downstream* of
// every call site that uses this module — they observe the row this
// writer just stamped and (idempotently) recompute the same value.
//
// What this module replaces (per the D-PR2b inventory in
// `docs/architecture/state-wave-d-pr2b-handoff-prompt.md`):
//   • `excludeLegCore` — exclusion → disposition stamp
//   • per-leg SOP-advance terminal step (`POST /claims/:id/sop-advance`)
//   • operator conclude-leg (`POST /claims/:id/conclude-leg`)
//   • bulk SOP-advance terminal step (`POST /invoice-groups/:id/sop-advance`)
//
// What this module does NOT cover:
//   • Mid-walk SOP-advance steps (no terminal outcome → no disposition
//     stamp; cache helper recomputes from `errorTypeId != null →
//     classifying`).
//   • Clearing paths (`clear-sop-hold`, `reclassify`, `include`):
//     those keep their direct legacy null-out writes; the cache helper
//     recomputes `unclassified` / `classifying` / `disposed_*` from
//     the cleared inputs. Adding an explicit `clearClaimDisposition`
//     would just round-trip through the same code path.
//
// Sharp edges preserved:
//   • Task #476 audit-reason ↔ `sop_outcome` co-write guard:
//     the writer never overwrites a non-null `sop_outcome` with a
//     derived value, so an exclusion-as-non_issue can't clobber a
//     verdict that landed before exclusion.
//   • Terminal-vs-mid-walk distinction for `drop_reason`: `dropReason`
//     is only stamped when `isTerminal === true`, mirroring the
//     `SOP_DROP_REASONS.has(...)` guard that lived inline in both
//     SOP-advance handlers.
//   • Per-reason mirror divergence in exclusions: `excludeLegCore`
//     historically co-wrote `sop_outcome = 'non_issue'` ONLY when
//     `reason === 'non_issue'`; other exclusion reasons (e.g.
//     `cannot_dispute`) leave `sop_outcome` alone. Callers express
//     this by passing `mirror: 'derived'` (co-write from disposition)
//     vs `mirror: 'skip'` (write only disposition + explicit fields).
//   • The trigger `claims_disposition_phase_chk` is per-claim and
//     fires AFTER UPDATE OF disposition — see §6.3 of
//     `state-wave-d-handoff.md`. Callers that have already updated
//     `invoice_groups.phase` in the same tx are safe; callers that
//     haven't (the SOP-advance handlers, which never change phase)
//     are also safe because phase doesn't move on these transitions.

import { eq, and } from "drizzle-orm";
import { db, claimsTable, type Claim } from "@workspace/db";
import type { ClaimDisposition } from "@workspace/vocab";
import type {
  LegacyDropReason,
  LegacySopOutcome,
} from "@workspace/invoice-state";
import type { DbExecutor } from "../claim-transitions";

/**
 * Inverse of the §3.D fallback table in `derive-disposition.ts`.
 *
 * Returns the legacy mirror columns the disposition implies when it
 * was produced by an SOP-walk or operator conclusion. `isTerminal`
 * gates `drop_reason` because mid-walk transitions stamp `sop_outcome`
 * only — `drop_reason` belongs to the terminal step.
 *
 * NOTE: Pure helper. Lives next to the writer so the inversion is in
 * one place. This is the seed for D-PR2c's `dispositionToStatus`.
 */
export function dispositionToLegacy(
  disposition: ClaimDisposition,
  isTerminal: boolean,
): {
  sopOutcome?: Exclude<LegacySopOutcome, null>;
  dropReason?: Exclude<LegacyDropReason, null>;
} {
  switch (disposition) {
    case "disposed_nonissue":
      return isTerminal
        ? { sopOutcome: "non_issue", dropReason: "non_issue" }
        : { sopOutcome: "non_issue" };
    case "disposed_withdraw":
      return isTerminal
        ? { sopOutcome: "cannot_dispute", dropReason: "cannot_dispute" }
        : { sopOutcome: "cannot_dispute" };
    case "blocked":
      return { sopOutcome: "hold" };
    case "disposed_portal":
      return { sopOutcome: "portal_dispute" };
    case "disposed_email":
      return { sopOutcome: "dispute" };
    default:
      return {};
  }
}

/**
 * Forward map: SOP-walk `sop_outcome` literal → `ClaimDisposition`.
 *
 * The SOP handlers (per-leg + bulk) and `conclude-leg` resolve to a
 * `sop_outcome` string from the decision tree's `outcomeType` (or
 * the operator's conclusion reason). This maps that literal onto the
 * canonical disposition the writer should stamp. Mirrors the
 * `sopOrDropReasonDisposition` switch in
 * `lib/invoice-state/derive-disposition.ts` so the writer's input
 * and the cache helper's deriver agree on every value.
 */
export function sopOutcomeToDisposition(sopOutcome: string): ClaimDisposition {
  switch (sopOutcome) {
    case "non_issue": return "disposed_nonissue";
    case "cannot_dispute": return "disposed_withdraw";
    case "hold": return "blocked";
    case "portal_dispute": return "disposed_portal";
    case "dispute": return "disposed_email";
    default:
      throw new Error(`sopOutcomeToDisposition: unknown sop_outcome "${sopOutcome}"`);
  }
}

/**
 * How to populate the legacy mirror columns alongside the canonical
 * `disposition` write.
 *
 * - `"derived"`: invert `disposition` via `dispositionToLegacy` and
 *   stamp the resulting `sop_outcome` / `drop_reason`. Used by every
 *   SOP-walk terminal path and exclusion-as-non_issue.
 * - `"skip"`: write disposition + caller-supplied `extraFields` only;
 *   do NOT touch `sop_outcome` or `drop_reason`. Used by exclusions
 *   for reasons other than `non_issue` (where the legacy code path
 *   intentionally left `sop_outcome` null).
 */
export type DispositionMirrorMode = "derived" | "skip";

export interface SetClaimDispositionOpts {
  /**
   * Terminal SOP step or exclusion (vs. a mid-walk advance). Gates
   * whether `drop_reason` and `dropped_at` flow into the UPDATE.
   * Exclusions pass `false` because the legacy code never stamped
   * `drop_reason` on exclusion. Defaults to `false`.
   */
  isTerminal?: boolean;
  /**
   * Legacy-mirror policy. Defaults to `"derived"`.
   */
  mirror?: DispositionMirrorMode;
  /**
   * Set `included_in_dispute` to the given value. Used by exclusions
   * (`false`); SOP-advance and conclude-leg leave it alone (omit).
   */
  includedInDispute?: boolean;
  /**
   * Override the `dropped_at` timestamp. Defaults to `new Date()` when
   * the writer would otherwise stamp `drop_reason`. Pass `null` to
   * suppress.
   */
  droppedAt?: Date | null;
  /**
   * Override the `ready_at` timestamp. Defaults to `new Date()` for
   * terminal `disposed_portal` / `disposed_email`. Pass `null` to
   * suppress.
   */
  readyAt?: Date | null;
  /**
   * Reuse caller's transaction (e.g. the bulk SOP-advance loop's
   * outer tx). Falls back to `db` when omitted.
   */
  ex?: DbExecutor;
  /**
   * When true, the UPDATE only fires on rows where
   * `included_in_dispute = true`, so a double-exclude is a no-op
   * and returns the existing row. Mirrors the previous
   * `excludeLegCore` predicate.
   */
  onlyWhenIncluded?: boolean;
  /**
   * Extra fields the caller wants to merge into the same UPDATE
   * (e.g. `sopAnswers`, `sopNodeId`, MAS-derivation columns). Pass
   * straight through to `.set()`. Lets every per-route column +
   * disposition stamp + legacy mirror land in one row update +
   * one trigger fire.
   */
  extraFields?: Partial<typeof claimsTable.$inferInsert>;
}

/**
 * Writes `claims.disposition` and (per `mirror` policy) the legacy
 * mirror columns for the given leg in a single UPDATE.
 *
 * Honors the Task #476 guard: when the derived mirror would stamp
 * `sop_outcome`, the writer reads the current value first and only
 * stamps when the existing column is null. This prevents an exclusion
 * from clobbering an SOP verdict that landed first.
 *
 * Idempotent: if the disposition AND every implied legacy field
 * already match the row, no UPDATE is issued and the existing row is
 * returned.
 *
 * Returns the updated row (or the existing row if no update was
 * needed). Returns `null` when no row matches `claimId`.
 */
export async function setClaimDisposition(
  claimId: number,
  disposition: ClaimDisposition,
  opts: SetClaimDispositionOpts = {},
): Promise<Claim | null> {
  const ex: DbExecutor = opts.ex ?? db;
  const isTerminal = opts.isTerminal ?? false;
  const mirror = opts.mirror ?? "derived";

  // Read-then-write: needed for the Task #476 sop_outcome-null guard
  // and for idempotency. Single read, then a single UPDATE — both
  // happen on the caller's executor so they participate in the same
  // tx when one was passed.
  const [current] = await ex
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.id, claimId));
  if (!current) return null;

  const updateSet: Partial<typeof claimsTable.$inferInsert> = {
    ...(opts.extraFields ?? {}),
  };

  // Canonical disposition column. Skipped for orphan legs (no parent
  // invoice group) to preserve the `refreshClaimDenormalizedCache`
  // invariant: standalone legs don't carry a meaningful disposition
  // because there is no parent phase to validate against. Stamping
  // it here would also strand the column at the writer's value
  // forever, since the cache helper short-circuits without ever
  // recomputing it on subsequent state changes (e.g. clear-sop-hold,
  // reclassify, re-include). Production has zero orphan legs; this
  // branch exists only for tests and any historical bare rows.
  if (current.invoiceGroupId != null && current.disposition !== disposition) {
    updateSet.disposition = disposition;
  }

  if (mirror === "derived") {
    const legacy = dispositionToLegacy(disposition, isTerminal);

    // sop_outcome: stamp only when current is null. Task #476 guard.
    if (legacy.sopOutcome != null && current.sopOutcome == null) {
      updateSet.sopOutcome = legacy.sopOutcome;
    }

    // drop_reason + dropped_at: terminal-only.
    if (legacy.dropReason != null && current.dropReason !== legacy.dropReason) {
      updateSet.dropReason = legacy.dropReason;
      if (opts.droppedAt !== null) {
        updateSet.droppedAt = opts.droppedAt ?? new Date();
      }
    }

    // ready_at: stamped on terminal `disposed_portal` / `disposed_email`,
    // and only when not already stamped (avoid resetting on retries).
    if (
      isTerminal &&
      (disposition === "disposed_portal" || disposition === "disposed_email") &&
      opts.readyAt !== null &&
      current.readyAt == null
    ) {
      updateSet.readyAt = opts.readyAt ?? new Date();
    }
  }

  // included_in_dispute: explicit caller intent only.
  if (
    opts.includedInDispute !== undefined &&
    current.includedInDispute !== opts.includedInDispute
  ) {
    updateSet.includedInDispute = opts.includedInDispute;
  }

  // Nothing to do? Return the existing row.
  if (Object.keys(updateSet).length === 0) {
    return current;
  }

  const whereClause = opts.onlyWhenIncluded
    ? and(eq(claimsTable.id, claimId), eq(claimsTable.includedInDispute, true))
    : eq(claimsTable.id, claimId);

  const [updated] = await ex
    .update(claimsTable)
    .set(updateSet)
    .where(whereClause)
    .returning();

  // The `onlyWhenIncluded` guard can produce a no-op UPDATE (already
  // excluded). Mirror the previous `excludeLegCore` behavior of
  // returning the pre-existing row in that case.
  return updated ?? current;
}
