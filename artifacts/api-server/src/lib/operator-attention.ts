// Shared "operator-done" / "needs-operator-attention" predicates.
//
// Single source of truth for the celebration / urgency / counter
// surfaces (Task #541). Two predicates, exact inverses of each other:
//
//   • OPERATOR_DONE   — the group has been pushed off the operator's
//     active queue. Either its phase is post-submit (handed off to
//     the system or the payor) or its outcome marks it as
//     never-needed-to-file (Non-Issue / Withdrawn).
//
//   • NEEDS_OPERATOR_ATTENTION — the inverse. The operator still owes
//     a click on this group (classify, package, queue for portal,
//     finish a re-attest, etc.).
//
// These predicates power, in lockstep:
//
//   1. Day-complete celebration matcher (`lib/day-complete.ts`).
//   2. Dashboard "must file today" hero + Queue urgent lane
//      (`routes/dashboard.ts` + `lib/urgent-snapshot.ts` +
//      `lib/expiring-filter.ts`).
//   3. Per-row "Today / Stuck" badge stamping on the lists
//      (`routes/invoice-groups.ts` + `routes/claims.ts`).
//   4. Session-milestone counter dedup-key generation
//      (`hooks/use-session-milestones.ts` mirrors the JS predicate
//      via the per-row `phase` + `outcome` it already receives).
//
// Adding a new "off-the-queue" disposition means editing exactly one
// file (this one) — every consumer above re-derives from these
// constants so they cannot drift.
//
// HISTORY: extracted in Task #541 from the local `isGroupConcluded`
// helper that previously lived in `day-complete.ts`. The Wave D-PR5
// rewrite of that file (writer-rewire stamps `claims.submitted_via`,
// deriver promotes any stamped group out of `ready_to_submit` →
// `submitted`) means the predicate is pure phase-membership +
// outcome-driven closure with no residual status carve-outs.

import { eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { invoiceGroupsTable } from "@workspace/db";

export const OPERATOR_DONE_PHASES = [
  "submitted",
  "response_received",
  "awaiting_reattestation",
  "closed",
] as const;

export const OPERATOR_DONE_OUTCOMES = ["Non-Issue", "Withdrawn"] as const;

const OPERATOR_DONE_PHASE_SET = new Set<string>(OPERATOR_DONE_PHASES);
const OPERATOR_DONE_OUTCOME_SET = new Set<string>(OPERATOR_DONE_OUTCOMES);

/** JS predicate. True iff the row is off the operator's active queue. */
export function isGroupOperatorDone(g: { phase: string; outcome: string }): boolean {
  return (
    OPERATOR_DONE_PHASE_SET.has(g.phase) || OPERATOR_DONE_OUTCOME_SET.has(g.outcome)
  );
}

/** JS predicate. Inverse of `isGroupOperatorDone`. */
export function groupNeedsOperatorAttention(g: { phase: string; outcome: string }): boolean {
  return !isGroupOperatorDone(g);
}

/** SQL predicate against `invoice_groups`. True iff operator-done. */
export function operatorDoneSql(): SQL {
  return sql`(
    ${invoiceGroupsTable.phase}::text IN (
      'submitted', 'response_received', 'awaiting_reattestation', 'closed'
    )
    OR ${invoiceGroupsTable.outcome}::text IN ('Non-Issue', 'Withdrawn')
  )`;
}

/**
 * SQL predicate against `invoice_groups`. True iff the operator still
 * owes action — exact inverse of `operatorDoneSql`. Use for queue
 * lanes / urgency expansions that should ignore concluded rows.
 */
export function needsOperatorAttentionSql(): SQL {
  return sql`NOT ${operatorDoneSql()}`;
}

/**
 * SQL fragment matching groups that have NOT been classified at the
 * group level — i.e., they sit in the Classification Inbox waiting
 * for an Error Type assignment. Pairs with `needsOperatorAttentionSql()`
 * to expand the dashboard urgent set so unclassified inbox rows whose
 * deadline lands today (or tomorrow) can never disappear from the hero
 * count just because their parent status doesn't sit in the pre-submit
 * actionable phase set.
 */
export function groupUnclassifiedSql(): SQL {
  return or(
    isNull(invoiceGroupsTable.errorTypeId),
    eq(invoiceGroupsTable.errorTypeId, ""),
  ) as SQL;
}
