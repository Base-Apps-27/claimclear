// Per-invoice (group) outcome derivation. Lives in this dependency-free
// package so the React client (Group Detail page, Insights page) AND the
// api-server (dashboard rollups) share one source of truth — see Task #563.
//
// Per Task #555 / per-invoice-transition.md no surface should read the
// stored `invoice_groups.outcome` column for display: that field can drift
// behind per-leg edits and the operator must always see the verdict that
// matches the leg rail.
//
// Bucketing rules — applied to legs with a meaningful per-leg verdict
// (sibling-duplicate legs follow their primary; legs excluded by the
// operator with no per-leg verdict are skipped):
//
//   1. If the leg has an Approved/Partially-Approved verdict → approved
//   2. Else if the leg has a Denied verdict                  → denied
//   3. Else map by closure role:
//        cannot_dispute → cannotDispute (group as "denied side", $0 recovery)
//        non_issue      → nonIssue      (per-leg verdict: this leg is fine —
//                                        NOT a withdrawal of the dispute)
//        anything else  → pending
//
// `non_issue` and `cannot_dispute` legs count toward their bucket even
// when `includedInDispute === false`: that exclusion was the writer's
// way of recording "this leg has a per-leg verdict and is no longer
// actionable", and the SOP outcome IS the verdict.
//
// Group rollup (in priority order — first match wins):
//   - any pending                                    → "Pending"
//   - approved > 0 AND no denied/cannotDispute       → "Approved"
//   - approved > 0 AND some denied/cannotDispute     → "Partially Approved"
//   - denied > 0 OR cannotDispute > 0                → "Denied"
//   - only nonIssue legs                             → "No Action Needed"
//                                                      (every leg checked
//                                                      out fine — the
//                                                      invoice was already
//                                                      attested correctly,
//                                                      this is NOT a
//                                                      withdrawal)
//   - no actionable legs at all                      → "Withdrawn"
//   - empty fallback                                 → "Pending"
import { outcomeRole, type LegForOutcomeRole } from "./index";

export type DerivedGroupOutcome_Outcome =
  | "Pending"
  | "Approved"
  | "Denied"
  | "Partially Approved"
  | "No Action Needed"
  | "Withdrawn";

export interface VerdictLike {
  source: string;
  outcome: string;
  createdAt: string;
}

/**
 * Minimum leg shape required to compute a group outcome. Matches the
 * relevant subset of `ClaimResponse` (frontend) and the per-claim row
 * shape on the server, so callers spread their row in directly.
 */
export interface LegForGroupOutcome extends LegForOutcomeRole {
  includedInDispute?: boolean | null;
  latestVerdict?: VerdictLike | null;
  latestDraft?: VerdictLike | null;
}

export interface GroupOutcomeBuckets {
  approved: number;
  denied: number;
  cannotDispute: number;
  nonIssue: number;
  pending: number;
  /** Total actionable legs considered (post-exclusion, post-duplicate-filter). */
  total: number;
}

export interface DerivedGroupOutcome {
  outcome: DerivedGroupOutcome_Outcome;
  buckets: GroupOutcomeBuckets;
}

const APPROVED_OUTCOMES: ReadonlySet<string> = new Set(["Approved", "Partially Approved"]);
const DENIED_OUTCOMES: ReadonlySet<string> = new Set(["Denied"]);

function isActionable(leg: LegForGroupOutcome): boolean {
  if (outcomeRole(leg) === "duplicate") return false;
  if (leg.includedInDispute === false) {
    // Excluded legs still count IF the exclusion carried a per-leg
    // verdict (non_issue or cannot_dispute via the SOP/triage path).
    // The verdict is what we want to roll up; the includedInDispute
    // flag is just the storage signal for "this leg is no longer
    // actionable on its own". Without this branch, an invoice whose
    // every leg was per-leg-classified as non_issue collapses to
    // total === 0 and gets mis-labeled as a withdrawal.
    const role = outcomeRole(leg);
    return role === "non_issue" || role === "cannot_dispute";
  }
  return true;
}

/**
 * "What is the operator's pick for this leg?" — newest of an
 * `operator_draft` and an `operator_confirmed` verdict wins. AI hints
 * are ignored here. Returns "pending" if neither exists.
 */
function legVerdictBucket(leg: LegForGroupOutcome): "approved" | "denied" | "pending" {
  const draft =
    leg.latestDraft && leg.latestDraft.source === "operator_draft" ? leg.latestDraft : null;
  const confirmed =
    leg.latestVerdict && leg.latestVerdict.source === "operator_confirmed"
      ? leg.latestVerdict
      : null;
  let pick: VerdictLike | null = null;
  if (draft && confirmed) {
    pick =
      new Date(draft.createdAt).getTime() >= new Date(confirmed.createdAt).getTime()
        ? draft
        : confirmed;
  } else {
    pick = draft ?? confirmed ?? null;
  }
  if (!pick) return "pending";
  if (APPROVED_OUTCOMES.has(pick.outcome)) return "approved";
  if (DENIED_OUTCOMES.has(pick.outcome)) return "denied";
  return "pending";
}

export function deriveGroupOutcomeFromLegs(
  legs: readonly LegForGroupOutcome[],
): DerivedGroupOutcome {
  const actionable = legs.filter(isActionable);
  const buckets: GroupOutcomeBuckets = {
    approved: 0,
    denied: 0,
    cannotDispute: 0,
    nonIssue: 0,
    pending: 0,
    total: actionable.length,
  };
  for (const leg of actionable) {
    const verdict = legVerdictBucket(leg);
    if (verdict === "approved") {
      buckets.approved += 1;
      continue;
    }
    if (verdict === "denied") {
      buckets.denied += 1;
      continue;
    }
    const role = outcomeRole(leg);
    if (role === "cannot_dispute") {
      buckets.cannotDispute += 1;
    } else if (role === "non_issue") {
      buckets.nonIssue += 1;
    } else {
      buckets.pending += 1;
    }
  }

  let outcome: DerivedGroupOutcome_Outcome;
  if (buckets.pending > 0) {
    outcome = "Pending";
  } else if (
    buckets.approved > 0 &&
    buckets.denied === 0 &&
    buckets.cannotDispute === 0
  ) {
    outcome = "Approved";
  } else if (buckets.approved > 0) {
    outcome = "Partially Approved";
  } else if (buckets.denied > 0 || buckets.cannotDispute > 0) {
    outcome = "Denied";
  } else if (buckets.nonIssue > 0) {
    // Every actionable leg checked out as a non-issue. The invoice
    // didn't need work — it was almost certainly already attested
    // correctly and just left behind in the import. This is NOT a
    // withdrawal (a withdrawal means we backed off a dispute we could
    // have filed); it's "we looked, nothing was wrong".
    outcome = "No Action Needed";
  } else if (buckets.total === 0) {
    // No actionable legs at all (every leg excluded for reasons other
    // than a per-leg verdict, or the group is empty). This is the
    // operator-withdrew-the-whole-thing case.
    outcome = "Withdrawn";
  } else {
    outcome = "Pending";
  }
  return { outcome, buckets };
}
