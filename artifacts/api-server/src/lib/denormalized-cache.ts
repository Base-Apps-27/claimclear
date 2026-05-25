// Denormalized read-cache refresh helpers for `claims` and
// `invoice_groups`. These are the only writers for the denormalized
// columns; every contracts endpoint that mutates a leg or group calls
// the matching helper at the end so the read caches cannot drift.
//
// Wave D-PR2a (this file): the helpers now also write the canonical
// state-hierarchy columns alongside the legacy mirror columns:
//   • refreshClaimDenormalizedCache → writes `claims.disposition` and
//     (when stale) the parent `invoice_groups.phase`.
//   • refreshGroupDerivedFields → writes `invoice_groups.phase` and
//     refreshes every child claim's `disposition` against the new
//     phase.
//
// Both derivations come from `@workspace/invoice-state` (the same
// pure functions migration 0034 used to backfill prod, and that
// `scripts/check-invoice-state-derivation.ts` audits weekly). The
// trigger `claims_disposition_phase_chk` is `DEFERRABLE INITIALLY
// DEFERRED` and only fires on `claims.disposition` /
// `claims.invoice_group_id` UPDATEs (NOT on `invoice_groups.phase`
// changes), so:
//   1. Updating `group.phase` does not revalidate sibling legs that
//      this helper isn't touching — they get healed lazily on their
//      own next refresh; meanwhile the trigger never sees their stale
//      pair so nothing fails.
//   2. Updating `claim.disposition` validates against the *current*
//      `group.phase` at trigger time, which is the value we (may have)
//      just written in the same tx.

import { eq, desc, and, isNotNull, isNull, ne } from "drizzle-orm";
import {
  db,
  claimsTable,
  claimVerdictTable,
  invoiceGroupsTable,
  type Claim,
  type InvoiceGroup,
} from "@workspace/db";
import {
  derivePhaseFromLegacy,
  deriveDispositionFromLegacy,
  type LegacyClaimShape,
  type LegacyInvoiceGroupShape,
} from "@workspace/invoice-state";
import type { ClaimDisposition, InvoicePhase } from "@workspace/vocab";
import type { DbExecutor } from "./claim-transitions";
import { getMacroPhase, getGroupMacroPhase, type MacroPhase } from "./macro-phase";
import { dispositionToStatus } from "./leg-state/set-claim-disposition";

type ClaimOutcome = Claim["outcome"];
type ClaimStatus = Claim["status"];

// Map verdict.outcome (Approved | Denied | Partial) → claim_outcome enum.
function verdictOutcomeToClaimOutcome(verdictOutcome: string): ClaimOutcome {
  if (verdictOutcome === "Partial") return "Partially Approved";
  if (verdictOutcome === "Approved") return "Approved";
  if (verdictOutcome === "Denied") return "Denied";
  return "Pending";
}

// Adapt a `claims.$inferSelect` row into the LegacyClaimShape that
// the canonical deriver expects. Keeps the deriver decoupled from
// drizzle while ensuring every required field is supplied.
function toLegacyClaimShape(claim: typeof claimsTable.$inferSelect): LegacyClaimShape {
  return {
    status: claim.status as LegacyClaimShape["status"],
    outcome: claim.outcome as LegacyClaimShape["outcome"],
    sopOutcome: claim.sopOutcome as LegacyClaimShape["sopOutcome"],
    attestationState: claim.attestationState as LegacyClaimShape["attestationState"],
    includedInDispute: claim.includedInDispute,
    duplicateOfClaimId: claim.duplicateOfClaimId,
    dropReason: claim.dropReason as LegacyClaimShape["dropReason"],
    errorTypeId: claim.errorTypeId,
    closureReason: claim.closureReason,
  };
}

function toLegacyGroupShape(
  group: typeof invoiceGroupsTable.$inferSelect,
  // Wave D-PR5: group-level aggregate of `claims.submitted_via` —
  // any non-null value across the disputed children means the group
  // has crossed the "filed" line and the deriver promotes it from
  // `ready_to_submit` → `submitted`. Callers fetch this with
  // `fetchAnyChildSubmittedVia` before constructing the shape.
  extras?: { submittedVia?: string | null },
): LegacyInvoiceGroupShape {
  return {
    status: group.status as LegacyInvoiceGroupShape["status"],
    outcome: group.outcome as LegacyInvoiceGroupShape["outcome"],
    reattestRequired: group.reattestRequired ?? false,
    reattestCompletedAt: group.reattestCompletedAt,
    closureReason: group.closureReason,
    holdReason: group.holdReason,
    submittedVia: extras?.submittedVia ?? null,
  };
}

/**
 * Wave D-PR5: returns the first non-null `submitted_via` value across
 * a group's child claims (or null when no child has been stamped). The
 * deriver only checks for non-null, so a single match is sufficient
 * — the partial index `claims_submitted_via_idx` keeps this cheap.
 */
async function fetchAnyChildSubmittedVia(
  groupId: number,
  ex: DbExecutor,
): Promise<string | null> {
  const [row] = await ex
    .select({ submittedVia: claimsTable.submittedVia })
    .from(claimsTable)
    .where(and(
      eq(claimsTable.invoiceGroupId, groupId),
      isNotNull(claimsTable.submittedVia),
    ))
    .limit(1);
  return row?.submittedVia ?? null;
}

/**
 * Refresh `claims.status` (per-leg projection — see `projectLegStatus`),
 * `claims.outcome` (latest claim_verdict outcome, defaults to "Pending"
 * when no verdict exists), and `claims.disposition` (canonical state
 * column, derived from the leg + parent phase via
 * `deriveDispositionFromLegacy`). Idempotent.
 *
 * If the parent group's `phase` column is stale relative to its legacy
 * status/outcome (e.g. the group just transitioned via a writer that
 * hasn't been rewired to set phase directly yet), this helper updates
 * `group.phase` in the same transaction so the new disposition is
 * validated against the correct phase.
 *
 * For standalone legs (no `invoice_group_id`) the disposition column
 * is left at its trigger-default and status is left untouched — there
 * is no parent group to project from.
 */
export async function refreshClaimDenormalizedCache(
  claimId: number,
  executor?: DbExecutor,
): Promise<Claim | null> {
  const ex: DbExecutor = executor ?? db;

  const [leg] = await ex.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!leg) return null;

  // Latest verdict from a *terminal* source (`ai_suggested` or
  // `operator_confirmed`). Task #343 added `operator_draft` as a
  // non-terminal selection that must NOT move the denormalized
  // outcome — otherwise the parent group would advance out of
  // `response-pending` the moment the operator clicks a draft pill.
  // Drafts are promoted in the matching `operator_confirmed` row
  // by `POST /invoice-groups/{id}/promote-verdict-drafts` (which
  // calls this helper again, so the cache stays accurate).
  const [latestVerdict] = await ex
    .select({ outcome: claimVerdictTable.outcome })
    .from(claimVerdictTable)
    .where(and(
      eq(claimVerdictTable.claimId, claimId),
      ne(claimVerdictTable.source, "operator_draft"),
    ))
    .orderBy(desc(claimVerdictTable.createdAt))
    .limit(1);

  // When no terminal verdict row exists, preserve the leg's current
  // `outcome` rather than forcing it back to "Pending". Several writers
  // (notably `transitionClaimOutcome` / `transitionClaimSubStatusAndOutcome`
  // and the PATCH /claims/:id/outcome fast path) set `claims.outcome`
  // directly without emitting a `claim_verdict` row — the verdict table
  // is the AI-vs-operator calibration ledger, not the canonical writer
  // for the outcome cache. Defaulting to "Pending" here used to silently
  // revert a queued-for-reattest Approved leg back to Pending the moment
  // `applyAttestationAction` called this helper, which then dropped the
  // leg from the queue list and counters (both filter on outcome ∈
  // Approved family). Keeping the existing outcome is the conservative
  // refresh contract: only overwrite when we have new data to write.
  const nextOutcome: ClaimOutcome = latestVerdict
    ? verdictOutcomeToClaimOutcome(latestVerdict.outcome)
    : leg.outcome;

  // Project status + disposition from the parent group + leg's own
  // per-leg state. Orphan legs keep their existing status/disposition
  // (no group to derive from).
  let nextStatus: ClaimStatus = leg.status;
  let nextDisposition: ClaimDisposition | null = null;
  let groupPhaseUpdate: { id: number; phase: InvoicePhase } | null = null;

  if (leg.invoiceGroupId != null) {
    const [group] = await ex
      .select()
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId))
      .limit(1);
    if (group) {
      // Compute (and possibly update) parent phase first so the
      // disposition trigger validates against the current phase.
      // D-PR5: feed the deriver the group-level `submittedVia`
      // aggregate so the `ready_to_submit` → `submitted` promotion
      // fires the moment any child carries a stamp.
      const submittedVia = await fetchAnyChildSubmittedVia(group.id, ex);
      const derivedPhase = derivePhaseFromLegacy(
        toLegacyGroupShape(group, { submittedVia }),
      ).phase;
      if (group.phase !== derivedPhase) {
        groupPhaseUpdate = { id: group.id, phase: derivedPhase };
      }

      // D-PR2c — invert the cache. Compute disposition first from
      // the legacy inputs (still the source of truth for the cache
      // helper's recompute path; the writer in
      // `setClaimDisposition` is the single producer of disposition
      // on synchronous mutations). Then project status FROM
      // disposition. After this PR, status is a derived projection
      // of disposition; the legacy `projectLegStatus` decision table
      // moved into `dispositionToStatus` and is no longer reachable.
      //
      // We stamp `nextStatus` *before* re-deriving disposition so the
      // deriver's submitted-path tiebreaker (Portal Queued vs other)
      // sees the projected status — but the projector reads the
      // same parent we feed the deriver, so the values agree.
      const preDispositionLegShape: LegacyClaimShape = {
        ...toLegacyClaimShape(leg),
        outcome: nextOutcome as LegacyClaimShape["outcome"],
      };
      // Provisional disposition from legacy inputs. We use the
      // current `leg.status` for the submitted-path tiebreaker;
      // status doesn't drift in the same refresh pass for these
      // dispositions (Portal Queued only flips via the submission
      // gauntlet, which calls this helper after the status flip).
      const provisionalDisposition = deriveDispositionFromLegacy(
        { ...preDispositionLegShape, status: leg.status as LegacyClaimShape["status"] },
        derivedPhase,
      );

      const projected = dispositionToStatus(
        provisionalDisposition,
        {
          phase: derivedPhase,
          status: group.status,
          reattestRequired: group.reattestRequired,
          reattestCompletedAt: group.reattestCompletedAt,
        },
        { legHoldReason: leg.holdReason },
      );
      if (projected != null) nextStatus = projected;

      // Final disposition write — recompute against the post-projection
      // status so the deriver's tiebreaker is consistent.
      const postUpdateLegShape: LegacyClaimShape = {
        ...preDispositionLegShape,
        status: nextStatus as LegacyClaimShape["status"],
      };
      nextDisposition = deriveDispositionFromLegacy(postUpdateLegShape, derivedPhase);
    }
  }

  const dispositionChanged = nextDisposition != null && leg.disposition !== nextDisposition;
  const nothingToDo =
    leg.outcome === nextOutcome &&
    leg.status === nextStatus &&
    !dispositionChanged &&
    groupPhaseUpdate == null;
  if (nothingToDo) return leg;

  // Apply both writes in one transaction so the disposition trigger
  // validates against the (possibly just-updated) phase.
  const runInTx = async (tx: DbExecutor): Promise<Claim | null> => {
    if (groupPhaseUpdate != null) {
      await tx
        .update(invoiceGroupsTable)
        .set({ phase: groupPhaseUpdate.phase })
        .where(eq(invoiceGroupsTable.id, groupPhaseUpdate.id));
    }
    const updateSet: Partial<typeof claimsTable.$inferInsert> = {
      outcome: nextOutcome,
      status: nextStatus,
    };
    if (dispositionChanged && nextDisposition != null) {
      updateSet.disposition = nextDisposition;
    }
    const [updated] = await tx
      .update(claimsTable)
      .set(updateSet)
      .where(eq(claimsTable.id, claimId))
      .returning();
    return updated ?? null;
  };

  if (executor != null) {
    // Caller provided a tx; reuse it.
    return runInTx(ex);
  }
  return db.transaction(async (tx) => runInTx(tx as DbExecutor));
}

// D-PR2c removed `projectLegStatus`; the inversion lives in
// `dispositionToStatus` (co-located with `dispositionToLegacy` in
// `leg-state/set-claim-disposition.ts`). The unit-test suite was
// rewritten against the new projector — see
// `__tests__/leg-status-projector.test.ts`.

/**
 * Recompute `invoice_groups.reattest_required` and (Wave D-PR2a)
 * `invoice_groups.phase`, plus `claims.disposition` for every child
 * leg whose disposition would shift under the new phase.
 *
 * While at least one disputed leg still owes a MAS cancel
 * (mas_action_required='cancel' AND mas_action_completed_at IS NULL),
 * leave the reattest flag alone — the group is still in
 * mas-action-required.
 *
 * Once every owed cancel is complete (or none exist), set the flag
 * based on whether at least one *payable* leg remains:
 *   • latest verdict ∈ {Approved, Partial}, OR
 *   • sop_outcome = 'non_issue'
 * If yes → true. Otherwise → false (group will close as denied_by_payor
 * and skip awaiting-payout).
 *
 * Never overrides a row already stamped reattest_completed_at.
 *
 * Phase + per-leg disposition are recomputed unconditionally so the
 * canonical columns track every legacy mutation.
 */
export async function refreshGroupDerivedFields(
  invoiceGroupId: number,
  executor?: DbExecutor,
): Promise<InvoiceGroup | null> {
  const ex: DbExecutor = executor ?? db;

  const [group] = await ex
    .select()
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, invoiceGroupId))
    .limit(1);
  if (!group) return null;

  // Compute the canonical phase first — used both for the group
  // update and for re-deriving every child leg's disposition.
  // D-PR5: pass the group-level `submittedVia` aggregate so the
  // submitted-promotion deriver branch fires.
  const submittedVia = await fetchAnyChildSubmittedVia(invoiceGroupId, ex);
  const derivedPhase = derivePhaseFromLegacy(
    toLegacyGroupShape(group, { submittedVia }),
  ).phase;
  const phaseChanged = group.phase !== derivedPhase;

  // reattest_required: only recompute when not blocked by pending MAS
  // cancels and not already closed via reattestCompletedAt.
  let nextReattestRequired = group.reattestRequired;
  let reattestRequiredChanged = false;

  if (group.reattestCompletedAt == null) {
    const stillPendingCancels = await ex
      .select({ id: claimsTable.id })
      .from(claimsTable)
      .where(and(
        eq(claimsTable.invoiceGroupId, invoiceGroupId),
        eq(claimsTable.masActionRequired, "cancel"),
        isNull(claimsTable.masActionCompletedAt),
      ));

    if (stillPendingCancels.length === 0) {
      // MAS cancels are settled. Look for payable legs.
      const legs = await ex
        .select({ id: claimsTable.id, sopOutcome: claimsTable.sopOutcome })
        .from(claimsTable)
        .where(eq(claimsTable.invoiceGroupId, invoiceGroupId));

      let hasPayable = false;
      for (const leg of legs) {
        if (leg.sopOutcome === "non_issue") {
          hasPayable = true;
          break;
        }
        const [latestVerdict] = await ex
          .select({ outcome: claimVerdictTable.outcome, source: claimVerdictTable.source })
          .from(claimVerdictTable)
          .where(eq(claimVerdictTable.claimId, leg.id))
          .orderBy(desc(claimVerdictTable.createdAt))
          .limit(1);
        if (
          latestVerdict &&
          latestVerdict.source === "operator_confirmed" &&
          (latestVerdict.outcome === "Approved" || latestVerdict.outcome === "Partial")
        ) {
          hasPayable = true;
          break;
        }
      }
      nextReattestRequired = hasPayable;
      reattestRequiredChanged = group.reattestRequired !== nextReattestRequired;
    }
  }

  // Re-derive every child leg's disposition under the (possibly new)
  // phase. We always do this so the canonical column tracks every
  // legacy mutation; if the new value matches the existing value, we
  // skip the UPDATE.
  const childLegs = await ex
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, invoiceGroupId));

  type LegDispositionUpdate = { id: number; disposition: ClaimDisposition };
  const dispositionUpdates: LegDispositionUpdate[] = [];
  for (const leg of childLegs) {
    const newDisposition = deriveDispositionFromLegacy(
      toLegacyClaimShape(leg),
      derivedPhase,
    );
    if (leg.disposition !== newDisposition) {
      dispositionUpdates.push({ id: leg.id, disposition: newDisposition });
    }
  }

  const nothingToDo =
    !phaseChanged && !reattestRequiredChanged && dispositionUpdates.length === 0;
  if (nothingToDo) return group;

  const runInTx = async (tx: DbExecutor): Promise<InvoiceGroup | null> => {
    if (phaseChanged || reattestRequiredChanged) {
      const updateSet: Partial<typeof invoiceGroupsTable.$inferInsert> = {};
      if (phaseChanged) updateSet.phase = derivedPhase;
      if (reattestRequiredChanged) updateSet.reattestRequired = nextReattestRequired;
      await tx
        .update(invoiceGroupsTable)
        .set(updateSet)
        .where(eq(invoiceGroupsTable.id, invoiceGroupId));
    }
    for (const u of dispositionUpdates) {
      await tx
        .update(claimsTable)
        .set({ disposition: u.disposition })
        .where(eq(claimsTable.id, u.id));
    }
    const [updated] = await tx
      .select()
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, invoiceGroupId))
      .limit(1);
    return updated ?? null;
  };

  if (executor != null) {
    return runInTx(ex);
  }
  return db.transaction(async (tx) => runInTx(tx as DbExecutor));
}

export { getGroupMacroPhase, getMacroPhase };
export type { MacroPhase };
