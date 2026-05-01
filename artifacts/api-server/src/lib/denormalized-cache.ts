// Denormalized read-cache refresh helpers for `claims` and
// `invoice_groups`. These are the only writers for the denormalized
// columns; every contracts endpoint that mutates a leg or group calls
// the matching helper at the end so the read caches cannot drift.

import { eq, desc, and, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  claimsTable,
  claimVerdictTable,
  invoiceGroupsTable,
  type Claim,
  type InvoiceGroup,
} from "@workspace/db";
import type { DbExecutor } from "./claim-transitions";
import { getMacroPhase, getGroupMacroPhase, type MacroPhase } from "./macro-phase";

type ClaimOutcome = Claim["outcome"];
type ClaimStatus = Claim["status"];

// Map verdict.outcome (Approved | Denied | Partial) → claim_outcome enum.
function verdictOutcomeToClaimOutcome(verdictOutcome: string): ClaimOutcome {
  if (verdictOutcome === "Partial") return "Partially Approved";
  if (verdictOutcome === "Approved") return "Approved";
  if (verdictOutcome === "Denied") return "Denied";
  return "Pending";
}

// Project a derived macro phase onto a representative claim_status enum
// value. Both claims.status and invoice_groups.status share the
// claim_status enum, but the new derived phases (mas-action-required,
// awaiting-payout) have no enum representation, so they project to the
// nearest existing status. List-view rollups use macro phase directly,
// so this is purely a back-compat surface for callers reading raw status.
function macroPhaseToStatus(phase: MacroPhase): ClaimStatus {
  switch (phase) {
    case "pre-submit": return "Needs Evidence";
    case "in-flight": return "Awaiting Response";
    case "response-pending": return "Needs Review";
    case "mas-action-required": return "Resolved";
    case "awaiting-payout": return "Resolved";
    case "closed": return "Resolved";
    case "on-hold": return "On Hold";
  }
}

/**
 * Refresh `claims.status` (mirrors the parent group's macro-phase
 * derivation) and `claims.outcome` (latest claim_verdict outcome,
 * defaults to "Pending" when no verdict exists). Idempotent.
 */
export async function refreshClaimDenormalizedCache(
  claimId: number,
  executor?: DbExecutor,
): Promise<Claim | null> {
  const ex: DbExecutor = executor ?? db;

  const [leg] = await ex.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!leg) return null;

  // Latest verdict (any source). Per spec the denormalized cache
  // tracks the single most recent claim_verdict row regardless of
  // source. AI suggestions may transiently move the cached value
  // until an operator confirmation lands; this matches the contract.
  const [latestVerdict] = await ex
    .select({ outcome: claimVerdictTable.outcome })
    .from(claimVerdictTable)
    .where(eq(claimVerdictTable.claimId, claimId))
    .orderBy(desc(claimVerdictTable.createdAt))
    .limit(1);

  const nextOutcome: ClaimOutcome = latestVerdict
    ? verdictOutcomeToClaimOutcome(latestVerdict.outcome)
    : "Pending";

  // Derive status from the parent group's macro phase. Orphan legs
  // (no parent group) keep their existing status.
  let nextStatus: ClaimStatus = leg.status;
  if (leg.invoiceGroupId != null) {
    const [group] = await ex
      .select({
        status: invoiceGroupsTable.status,
        reattestRequired: invoiceGroupsTable.reattestRequired,
        reattestCompletedAt: invoiceGroupsTable.reattestCompletedAt,
      })
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, leg.invoiceGroupId))
      .limit(1);
    if (group) {
      const phase = getGroupMacroPhase(group);
      nextStatus = macroPhaseToStatus(phase);
    }
  }

  if (leg.outcome === nextOutcome && leg.status === nextStatus) return leg;

  const [updated] = await ex
    .update(claimsTable)
    .set({ outcome: nextOutcome, status: nextStatus })
    .where(eq(claimsTable.id, claimId))
    .returning();
  return updated ?? null;
}

/**
 * Recompute `invoice_groups.reattest_required`.
 *
 * While at least one disputed leg still owes a MAS cancel
 * (mas_action_required='cancel' AND mas_action_completed_at IS NULL),
 * leave the flag alone — the group is still in mas-action-required.
 *
 * Once every owed cancel is complete (or none exist), set the flag
 * based on whether at least one *payable* leg remains:
 *   • latest verdict ∈ {Approved, Partial}, OR
 *   • sop_outcome = 'non_issue'
 * If yes → true. Otherwise → false (group will close as denied_by_payor
 * and skip awaiting-payout).
 *
 * Never overrides a row already stamped reattest_completed_at.
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

  if (group.reattestCompletedAt != null) return group;

  // Outstanding MAS cancels block the derivation.
  const stillPendingCancels = await ex
    .select({ id: claimsTable.id })
    .from(claimsTable)
    .where(and(
      eq(claimsTable.invoiceGroupId, invoiceGroupId),
      eq(claimsTable.masActionRequired, "cancel"),
      isNull(claimsTable.masActionCompletedAt),
    ));
  if (stillPendingCancels.length > 0) return group;

  // MAS cancels are settled. Look for payable legs.
  const legs = await ex
    .select({ id: claimsTable.id, sopOutcome: claimsTable.sopOutcome })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, invoiceGroupId));

  let hasPayable = false;
  for (const leg of legs) {
    // sop_outcome = 'non_issue' counts as payable per spec.
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

  const nextReattestRequired = hasPayable;
  if (group.reattestRequired === nextReattestRequired) return group;

  const [updated] = await ex
    .update(invoiceGroupsTable)
    .set({ reattestRequired: nextReattestRequired })
    .where(eq(invoiceGroupsTable.id, invoiceGroupId))
    .returning();
  return updated ?? null;
}

export { getGroupMacroPhase, getMacroPhase };
export type { MacroPhase };
