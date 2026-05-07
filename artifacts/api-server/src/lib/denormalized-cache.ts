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

type ClaimOutcome = Claim["outcome"];
type ClaimStatus = Claim["status"];

// All claim_status enum values that can validly be mirrored from a
// parent group onto a leg. The set excludes `Processed` (legs only;
// not a valid group status) but otherwise covers the full enum.
// Used as a runtime guard before the unsafe-looking
// `group.status as ClaimStatus` cast in the projector below — if
// upstream introduces a new group status that isn't in this set,
// projection falls back to the leg's existing status instead of
// silently coercing an invalid value.
const MIRRORABLE_LEG_STATUSES: ReadonlySet<ClaimStatus> = new Set<ClaimStatus>([
  "New",
  "Needs Review",
  "Needs Evidence",
  "Portal Queued",
  "Generating Email",
  "Ready to Review",
  "Awaiting Response",
  "On Hold",
  "MAS Eligible",
  "Resolved",
  "Denied",
]);

function asMirroredStatus(
  groupStatus: string,
  fallback: ClaimStatus,
): ClaimStatus {
  return (MIRRORABLE_LEG_STATUSES as ReadonlySet<string>).has(groupStatus)
    ? (groupStatus as ClaimStatus)
    : fallback;
}

// Map verdict.outcome (Approved | Denied | Partial) → claim_outcome enum.
function verdictOutcomeToClaimOutcome(verdictOutcome: string): ClaimOutcome {
  if (verdictOutcome === "Partial") return "Partially Approved";
  if (verdictOutcome === "Approved") return "Approved";
  if (verdictOutcome === "Denied") return "Denied";
  return "Pending";
}

// Project the next per-leg `claim.status` from the parent group's
// macro phase plus the leg's own per-leg state (sop_outcome,
// hold_reason). See `.local/tasks/task-231.md` §A for the full
// decision table; the rules below mirror it line-for-line.
//
// Sentinel return value `null` means "leave the leg's existing
// status alone" — used for excluded legs in pre-submit (their
// closed/withdrawn status is already correct) and the defensive
// fall-through path. Callers should treat null as "no projection".
function projectLegStatus(
  leg: { status: ClaimStatus; sopOutcome: string | null; holdReason: string | null },
  group: { status: string; reattestRequired: boolean | null; reattestCompletedAt: Date | string | null },
): ClaimStatus | null {
  // Rule 1: per-leg hold wins over everything. Either an explicit
  // hold_reason or sop_outcome='hold' marks the leg as held; the
  // projector preserves this regardless of macro phase.
  if (leg.holdReason != null || leg.sopOutcome === "hold") {
    return "On Hold";
  }

  const phase: MacroPhase = getGroupMacroPhase({
    status: group.status,
    reattestRequired: group.reattestRequired,
    reattestCompletedAt: group.reattestCompletedAt instanceof Date
      ? group.reattestCompletedAt
      : group.reattestCompletedAt != null ? new Date(group.reattestCompletedAt) : null,
  });

  switch (phase) {
    case "pre-submit":
      // Rule 2a: per-leg projection from sop_outcome.
      if (leg.sopOutcome === "portal_dispute" || leg.sopOutcome === "dispute") {
        return "Processed";
      }
      if (leg.sopOutcome === "cannot_dispute" || leg.sopOutcome === "non_issue") {
        // Excluded leg: the closed/withdrawn status set by the SOP
        // exclusion path is authoritative — do not overwrite.
        return null;
      }
      // No SOP outcome yet → mirror the group (New|Needs Evidence).
      return asMirroredStatus(group.status, leg.status);

    case "in-flight":
      // Rule 2b: collapse to a single representative status. The
      // task spec confirms this is the intended behaviour for now.
      return "Awaiting Response";

    case "response-pending":
      // Rule 2c: mirror group (Ready to Review|Needs Review).
      return asMirroredStatus(group.status, leg.status);

    case "mas-action-required":
    case "awaiting-payout":
    case "closed":
      // Rule 2d: mirror the group's actual status. The derived
      // phases all share the closed family of statuses on the
      // group itself, so mirroring is correct.
      return asMirroredStatus(group.status, leg.status);

    case "on-hold":
      // Rule 2e: explicit on-hold group → leg is on hold too.
      return "On Hold";
  }
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

function toLegacyGroupShape(group: typeof invoiceGroupsTable.$inferSelect): LegacyInvoiceGroupShape {
  return {
    status: group.status as LegacyInvoiceGroupShape["status"],
    outcome: group.outcome as LegacyInvoiceGroupShape["outcome"],
    reattestRequired: group.reattestRequired ?? false,
    reattestCompletedAt: group.reattestCompletedAt,
    closureReason: group.closureReason,
    holdReason: group.holdReason,
  };
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

  const nextOutcome: ClaimOutcome = latestVerdict
    ? verdictOutcomeToClaimOutcome(latestVerdict.outcome)
    : "Pending";

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
      const derivedPhase = derivePhaseFromLegacy(toLegacyGroupShape(group)).phase;
      if (group.phase !== derivedPhase) {
        groupPhaseUpdate = { id: group.id, phase: derivedPhase };
      }

      // Status: existing per-leg projector (legacy mirror).
      const projected = projectLegStatus(
        { status: leg.status, sopOutcome: leg.sopOutcome, holdReason: leg.holdReason },
        {
          status: group.status,
          reattestRequired: group.reattestRequired,
          reattestCompletedAt: group.reattestCompletedAt,
        },
      );
      if (projected != null) nextStatus = projected;

      // Disposition: canonical write. Pass the post-update legacy
      // shape (with the new status/outcome) so the deriver's
      // submitted-path tiebreaker sees the right "Portal Queued"
      // vs other-status signal.
      const postUpdateLegShape: LegacyClaimShape = {
        ...toLegacyClaimShape(leg),
        status: nextStatus as LegacyClaimShape["status"],
        outcome: nextOutcome as LegacyClaimShape["outcome"],
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

// Exported for unit tests. Pure function — no DB access.
export { projectLegStatus };

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
  const derivedPhase = derivePhaseFromLegacy(toLegacyGroupShape(group)).phase;
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
