// Group readiness helpers for the "Ready to package" CTA introduced in
// Task #231. The CTA is the operator-driven flip from a pre-submit
// invoice group (status ∈ {New, Needs Evidence}) into the existing
// `Generating Email` flow, which kicks off draft generation and the
// downstream portal/email submission pipeline.
//
// Readiness is purely a function of the leg state: it can be computed
// from the rows already loaded on the group detail page, and it is
// safe to recompute on every request (no side effects, no caching).

import { eq } from "drizzle-orm";
import { db, claimsTable, invoiceGroupsTable, type Claim, type InvoiceGroup } from "@workspace/db";
import type { DbExecutor } from "./claim-transitions";

export interface GroupReadiness {
  /** True iff the operator can click "Ready to package" right now. */
  ready: boolean;
  /**
   * Human-readable explanation, suitable for the disabled-CTA tooltip.
   * Always present; reads "Ready to package" when `ready` is true.
   */
  reason: string;
  /** Legs in the group that still need worktree review (sop_outcome IS NULL, no hold). */
  unprocessedLegCount: number;
  /** Legs whose worktree concluded with a dispute outcome. */
  processedLegCount: number;
  /** Legs whose worktree concluded as cannot_dispute or non_issue. */
  excludedLegCount: number;
  /** Legs currently on hold (per-leg hold_reason or sop_outcome='hold'). */
  heldLegCount: number;
  /** Total non-orphan legs considered (held legs included in the count). */
  totalLegCount: number;
}

type LegInput = Pick<Claim, "sopOutcome" | "holdReason" | "status"> | {
  sopOutcome: string | null;
  holdReason: string | null;
  status?: string | null;
};

type GroupInput = Pick<InvoiceGroup, "status"> | { status: string | null };

// Statuses that gate the "Ready to package" action: the CTA is only
// meaningful while the group is still pre-submit. Anything else is
// either already past the package step, on hold at the group level,
// or in a closed state.
const PACKAGEABLE_GROUP_STATUSES = new Set(["New", "Needs Evidence"]);

const DISPUTE_OUTCOMES = new Set(["portal_dispute", "dispute"]);
const EXCLUSION_OUTCOMES = new Set(["cannot_dispute", "non_issue"]);

function isHeld(leg: LegInput): boolean {
  return leg.holdReason != null || leg.sopOutcome === "hold";
}

/**
 * Compute readiness for an invoice group from in-memory leg + group
 * rows. Pure function — exported separately from the DB-backed wrapper
 * so callers (notably `GET /invoice-groups/:id`) can reuse the rows
 * they already loaded instead of issuing a second query.
 */
export function computeGroupReadiness(
  group: GroupInput,
  legs: ReadonlyArray<LegInput>,
): GroupReadiness {
  let unprocessed = 0;
  let processed = 0;
  let excluded = 0;
  let held = 0;

  for (const leg of legs) {
    if (isHeld(leg)) {
      held += 1;
      continue;
    }
    if (leg.sopOutcome != null && DISPUTE_OUTCOMES.has(leg.sopOutcome)) {
      processed += 1;
      continue;
    }
    if (leg.sopOutcome != null && EXCLUSION_OUTCOMES.has(leg.sopOutcome)) {
      excluded += 1;
      continue;
    }
    // sop_outcome IS NULL and not held → still owes worktree review.
    unprocessed += 1;
  }

  const total = legs.length;
  const baseCounts = {
    unprocessedLegCount: unprocessed,
    processedLegCount: processed,
    excludedLegCount: excluded,
    heldLegCount: held,
    totalLegCount: total,
  };

  // Gate 1: group must be in a packageable status.
  if (!PACKAGEABLE_GROUP_STATUSES.has(group.status ?? "")) {
    return {
      ready: false,
      reason: `Group is ${group.status ?? "unknown"} — packaging is only available for pre-submit invoices.`,
      ...baseCounts,
    };
  }

  // Gate 2: must have at least one leg.
  if (total === 0) {
    return {
      ready: false,
      reason: "Invoice has no legs to package.",
      ...baseCounts,
    };
  }

  // Gate 3: every non-held leg must have a sop_outcome set. Held legs
  // are tracked separately and intentionally do not block packaging —
  // they will resume their own flow after the hold is released.
  if (unprocessed > 0) {
    const noun = unprocessed === 1 ? "leg" : "legs";
    return {
      ready: false,
      reason: `${unprocessed} ${noun} still ${unprocessed === 1 ? "needs" : "need"} worktree review.`,
      ...baseCounts,
    };
  }

  // Gate 4: at least one leg must actually be contestable. An invoice
  // composed entirely of excluded/held legs has nothing to package —
  // the email flow would have no dispute body.
  if (processed === 0) {
    return {
      ready: false,
      reason: "No contestable legs in this invoice. Mark at least one leg as a portal or email dispute before packaging.",
      ...baseCounts,
    };
  }

  return {
    ready: true,
    reason: "Ready to package",
    ...baseCounts,
  };
}

/**
 * DB-backed convenience wrapper for callers that have only the group
 * id in hand (e.g. the package endpoint, called without a preceding
 * GET). Loads the group + its legs in two cheap queries and delegates
 * to the pure helper above.
 *
 * Returns `null` when the group does not exist; callers should map
 * this to a 404.
 */
export async function loadGroupReadiness(
  groupId: number,
  executor?: DbExecutor,
): Promise<GroupReadiness | null> {
  const ex: DbExecutor = executor ?? db;
  const [group] = await ex
    .select({ status: invoiceGroupsTable.status })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, groupId))
    .limit(1);
  if (!group) return null;

  const legs = await ex
    .select({
      sopOutcome: claimsTable.sopOutcome,
      holdReason: claimsTable.holdReason,
      status: claimsTable.status,
    })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, groupId));

  return computeGroupReadiness(group, legs);
}
