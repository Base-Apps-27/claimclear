// Group readiness helpers for the "Ready to package" CTA introduced in
// Task #231. The CTA is the operator-driven flip from a pre-submit
// invoice group (status ∈ {New, Needs Evidence}) into the existing
// `Generating Email` flow, which kicks off draft generation and the
// downstream portal/email submission pipeline.
//
// Readiness is purely a function of the leg state: it can be computed
// from the rows already loaded on the group detail page, and it is
// safe to recompute on every request (no side effects, no caching).
//
// Wave C reader switch (Task #517): per-leg bucket assignment now
// reads `claims.disposition` (the canonical Wave-C+ column) with a
// fallback to the legacy `sop_outcome` ladder for in-flight rows whose
// disposition is still the `unclassified` default. The dispute /
// exclusion / hold disposition value sets are derived from
// `DISPOSITION_TO_SUB_STATUS` in `lib/leg-state/src/per-leg-sub-status.ts`
// — see the comments next to each Set below for the per-value mapping.
// The group-level `PACKAGEABLE_GROUP_STATUSES` check stays status-based
// (see §3.B residual rationale in the Wave C continuation handoff:
// `phase = "triage"` over-includes `Needs Review`, `On Hold`, and the
// legacy `Resolved` fallthrough; Wave D will narrow this once the
// writer rewire lands).

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
  /** Legs in the group that still need worktree review (no terminal disposition, no hold). */
  unprocessedLegCount: number;
  /** Legs whose worktree concluded with a dispute disposition (disposed_portal / disposed_email). */
  processedLegCount: number;
  /** Legs whose worktree concluded as withdraw / non-issue (disposed_withdraw / disposed_nonissue). */
  excludedLegCount: number;
  /** Legs currently on hold (per-leg holdReason, disposition='blocked', or legacy sopOutcome='hold'). */
  heldLegCount: number;
  /** Total non-orphan legs considered (held legs included in the count). */
  totalLegCount: number;
  /** Sibling-duplicate legs that point at a primary in this group. */
  duplicateLegCount: number;
  /** Sibling-duplicate legs whose primary is NOT yet resolved (block the gate). */
  unresolvedDuplicateLegCount: number;
}

type LegInput = Pick<Claim, "id" | "disposition" | "sopOutcome" | "holdReason" | "status" | "duplicateOfClaimId"> | {
  id?: number;
  disposition?: string | null;
  sopOutcome: string | null;
  holdReason: string | null;
  status?: string | null;
  duplicateOfClaimId?: number | null;
};

type GroupInput = Pick<InvoiceGroup, "status"> | { status: string | null };

// Statuses that gate the "Ready to package" action: the CTA is only
// meaningful while the group is still pre-submit. Anything else is
// either already past the package step, on hold at the group level,
// or in a closed state. Intentionally NOT switched to a phase predicate
// in Wave C — see the file header for rationale.
const PACKAGEABLE_GROUP_STATUSES = new Set(["New", "Needs Evidence"]);

// Canonical Wave-C+ value sets. Each set is the disposition-side
// equivalent of the legacy sopOutcome set on the right; the mapping is
// fixed by `DISPOSITION_TO_SUB_STATUS` in
// `lib/leg-state/src/per-leg-sub-status.ts`:
//   disposed_portal / disposed_email → sub-status "ready" (= dispute leg)
//   disposed_withdraw / disposed_nonissue → sub-status "dropped" (= excluded)
//   blocked → sub-status "blocked" (= held)
const DISPUTE_DISPOSITIONS = new Set(["disposed_portal", "disposed_email"]);
const EXCLUSION_DISPOSITIONS = new Set(["disposed_withdraw", "disposed_nonissue"]);

// Legacy sopOutcome value sets, kept for the fallback ladder when a
// row's disposition is still the `unclassified` default (mid-flight
// during Wave C, before Wave D's writer rewire). See `deriveLegSubStatus`
// for the same pattern.
const DISPUTE_OUTCOMES = new Set(["portal_dispute", "dispute"]);
const EXCLUSION_OUTCOMES = new Set(["cannot_dispute", "non_issue"]);

function isHeld(leg: LegInput): boolean {
  if (leg.holdReason != null) return true;
  // Canonical Wave-C+ marker for "operator paused this leg from inside
  // the SOP walk". Equivalent to legacy `sopOutcome === 'hold'`.
  if (leg.disposition === "blocked") return true;
  // Legacy fallback for in-flight rows whose disposition writer hasn't
  // synced yet.
  if (leg.sopOutcome === "hold") return true;
  return false;
}

type LegBucket = "duplicate" | "held" | "processed" | "excluded" | "unprocessed";

// Resolve a single leg into one of the five readiness buckets. Reads
// `disposition` first (canonical Wave-C+ column) and falls back to the
// legacy `sopOutcome` ladder when disposition is missing or still the
// `unclassified` default — see `deriveLegSubStatus` for the same
// precedence pattern. Duplicate / held checks short-circuit before
// either ladder runs.
function bucketForLeg(leg: LegInput): LegBucket {
  if (leg.duplicateOfClaimId != null) return "duplicate";
  if (isHeld(leg)) return "held";

  if (leg.disposition && leg.disposition !== "unclassified") {
    if (DISPUTE_DISPOSITIONS.has(leg.disposition)) return "processed";
    if (EXCLUSION_DISPOSITIONS.has(leg.disposition)) return "excluded";
    // Any other meaningful disposition (awaiting_review, verdict_*,
    // attest_*, classifying, …) means the leg has not yet reached a
    // terminal-triage state and therefore still owes worktree review
    // from the packaging gate's POV.
    return "unprocessed";
  }

  // Legacy fallback ladder for rows still on `disposition='unclassified'`.
  if (leg.sopOutcome != null && DISPUTE_OUTCOMES.has(leg.sopOutcome)) return "processed";
  if (leg.sopOutcome != null && EXCLUSION_OUTCOMES.has(leg.sopOutcome)) return "excluded";
  return "unprocessed";
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
  let duplicateCount = 0;
  let unresolvedDuplicateCount = 0;

  // Pre-build an id → leg index so duplicate-resolution can look up its
  // primary's bucket without a nested loop. Legs without an id field
  // (e.g. test fixtures) cannot be primaries; they're only counted in
  // their own bucket.
  const byId = new Map<number, LegInput>();
  for (const leg of legs) {
    if (leg.id != null) byId.set(leg.id, leg);
  }

  // A primary is "resolved" for the duplicate-gate sense iff its bucket
  // is processed (dispute) or excluded (withdraw / non-issue). Held /
  // unprocessed primaries leave their duplicates unresolved. Note we
  // call `bucketForLeg` on the primary directly — but a primary that is
  // itself a duplicate would resolve to the `duplicate` bucket and
  // therefore NOT count as resolved here, which is the correct
  // behaviour (a chain of duplicates can never satisfy the gate).
  function primaryIsResolved(primary: LegInput | undefined): boolean {
    if (!primary) return false;
    const b = bucketForLeg(primary);
    return b === "processed" || b === "excluded";
  }

  for (const leg of legs) {
    const bucket = bucketForLeg(leg);
    switch (bucket) {
      case "duplicate":
        // Sibling duplicates short-circuit before every other bucket —
        // they have no SOP walk of their own and must not be counted
        // as unprocessed. Their gate contribution depends entirely on
        // the primary's bucket, computed above.
        duplicateCount += 1;
        if (!primaryIsResolved(byId.get(leg.duplicateOfClaimId!))) {
          unresolvedDuplicateCount += 1;
        }
        break;
      case "held":
        held += 1;
        break;
      case "processed":
        processed += 1;
        break;
      case "excluded":
        excluded += 1;
        break;
      case "unprocessed":
        unprocessed += 1;
        break;
    }
  }

  const total = legs.length;
  const baseCounts = {
    unprocessedLegCount: unprocessed,
    processedLegCount: processed,
    excludedLegCount: excluded,
    heldLegCount: held,
    totalLegCount: total,
    duplicateLegCount: duplicateCount,
    unresolvedDuplicateLegCount: unresolvedDuplicateCount,
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

  // Gate 3: every non-held, non-duplicate leg must have reached a
  // terminal-triage disposition. Held legs are tracked separately and
  // intentionally do not block packaging. Sibling duplicates inherit
  // their primary's resolution (handled by Gate 3b) and never appear
  // in `unprocessed`.
  if (unprocessed > 0) {
    const noun = unprocessed === 1 ? "leg" : "legs";
    return {
      ready: false,
      reason: `${unprocessed} ${noun} still ${unprocessed === 1 ? "needs" : "need"} worktree review.`,
      ...baseCounts,
    };
  }

  // Gate 3b: every sibling-duplicate must have a resolved primary.
  // A duplicate whose primary is mid-walk blocks the gate; the gate
  // naturally re-locks if the primary is reclassified back into the
  // unprocessed bucket. (Validation at the mark-duplicate endpoint
  // enforces same-group + same-error-type, so primaries are always
  // present in this `legs` list.)
  if (unresolvedDuplicateCount > 0) {
    const noun = unresolvedDuplicateCount === 1 ? "duplicate" : "duplicates";
    return {
      ready: false,
      reason: `${unresolvedDuplicateCount} sibling ${noun} ${unresolvedDuplicateCount === 1 ? "is" : "are"} waiting on the primary leg.`,
      ...baseCounts,
    };
  }

  // Gate 4: at least one leg must actually be contestable. An invoice
  // composed entirely of excluded/held legs has nothing to package —
  // the email flow would have no dispute body. Sibling duplicates do
  // not contribute to "contestable" because the primary is the one
  // being disputed; the duplicate just rides along in the $ rollup.
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
      id: claimsTable.id,
      disposition: claimsTable.disposition,
      sopOutcome: claimsTable.sopOutcome,
      holdReason: claimsTable.holdReason,
      status: claimsTable.status,
      duplicateOfClaimId: claimsTable.duplicateOfClaimId,
    })
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, groupId));

  return computeGroupReadiness(group, legs);
}
