// Denormalized read-cache refresh helpers for `claims` and
// `invoice_groups`. These are the only writers for the denormalized
// columns; every contracts endpoint that mutates a leg or group calls
// the matching helper at the end so the read caches cannot drift.

import { eq, desc, and, isNotNull, isNull, ne } from "drizzle-orm";
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

/**
 * Refresh `claims.status` (per-leg projection — see `projectLegStatus`)
 * and `claims.outcome` (latest claim_verdict outcome, defaults to
 * "Pending" when no verdict exists). Idempotent.
 *
 * For standalone legs (no `invoice_group_id`) the status is left
 * untouched — there is no parent group to project from.
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

  // Project status from the parent group + leg's own per-leg state.
  // Orphan legs keep their existing status (no group to derive from).
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
      const projected = projectLegStatus(
        { status: leg.status, sopOutcome: leg.sopOutcome, holdReason: leg.holdReason },
        group,
      );
      if (projected != null) nextStatus = projected;
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

// Exported for unit tests. Pure function — no DB access.
export { projectLegStatus };

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
