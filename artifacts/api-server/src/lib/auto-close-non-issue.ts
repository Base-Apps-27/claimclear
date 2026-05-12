// Task #714 — Auto-close cascade for "every disputed leg is non-issue".
//
// When a writer lands a leg at `sop_outcome='non_issue'` (per-leg
// `/sop-advance` terminal, `/conclude-leg`, or `excludeLegCore` with
// reason='non_issue'), and the parent invoice group is still
// pre-submit, and EVERY disputed leg of that group has reached
// `sop_outcome='non_issue'`, then the group should auto-land at
// (status='Resolved', outcome='No Action Needed', closure_reason='non_issue')
// — never `Withdrawn`, never `Non-Issue`. See the task spec for the
// full rationale.
//
// "Disputed leg" = `included_in_dispute = true AND error_type_id NOT NULL`.
// A leg without an error_type isn't part of any dispute (clean
// passenger row), and an excluded leg has been pulled out of the
// dispute by the operator already; neither blocks the auto-close.
//
// Idempotency: short-circuits when the group is already in a terminal
// status (Resolved / Denied / Expired) so a writer that fires the
// helper repeatedly does not 400 the caller. Also short-circuits when
// the disputed-leg set is empty (no legs to roll up).
//
// Pre-submit gate: skips when `groupHasEverBeenSubmitted` is true.
// `transitionGroupStatusAndOutcome` would also reject the close in
// that case (the "No Action Needed" branch refuses post-submit), but
// pre-checking lets us avoid the noisy try/catch on a path that fires
// once per leg conclusion.

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { invoiceGroupsTable, claimsTable } from "@workspace/db";
import { type DbExecutor } from "./claim-transitions";
import {
  transitionGroupStatusAndOutcome,
  groupHasEverBeenSubmitted,
  type GroupTransitionActor,
} from "./group-transitions";

const TERMINAL_GROUP_STATUSES = new Set(["Resolved", "Denied", "Expired"]);

const SYSTEM_ACTOR: GroupTransitionActor = {
  userEmail: "system@auto-close-no-action-needed",
  userName: "System (auto-close)",
};

export interface AutoCloseAllNonIssueResult {
  /** True iff this call performed the close transition. */
  closed: boolean;
  /** Reason the helper short-circuited, when `closed` is false. */
  skippedReason?:
    | "group_not_found"
    | "already_terminal"
    | "post_submit"
    | "no_disputed_legs"
    | "not_all_non_issue";
}

/**
 * If every disputed leg of `groupId` has `sop_outcome='non_issue'` and
 * the group is still pre-submit, transitions the group to
 * (Resolved, No Action Needed, closure_reason='non_issue'). Idempotent.
 *
 * The transition uses `systemOverride: true` so the
 * `New → Resolved` (and `Needs Review → Resolved`, etc.) status flips
 * bypass the per-status manual-transition guards even when those
 * destinations aren't in the manual-transition map. The
 * "No Action Needed" outcome branch in `group-transitions.ts` always
 * stamps `closure_reason='non_issue'` regardless of override.
 *
 * Pass an `executor` (a drizzle `tx`) when invoking inside an enclosing
 * transaction so the auto-close commits atomically with the leg edit.
 */
export async function autoCloseGroupIfAllNonIssue(
  groupId: number,
  executor?: DbExecutor,
): Promise<AutoCloseAllNonIssueResult> {
  const ex: DbExecutor = executor ?? db;

  const [group] = await ex
    .select({
      id: invoiceGroupsTable.id,
      status: invoiceGroupsTable.status,
      outcome: invoiceGroupsTable.outcome,
    })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, groupId));
  if (!group) return { closed: false, skippedReason: "group_not_found" };

  if (TERMINAL_GROUP_STATUSES.has(group.status)) {
    return { closed: false, skippedReason: "already_terminal" };
  }

  if (await groupHasEverBeenSubmitted(groupId, ex)) {
    return { closed: false, skippedReason: "post_submit" };
  }

  // Disputed legs only — the rollup must ignore clean passenger rows
  // (no error_type) and rows the operator already excluded. The
  // exclusion path itself sets `sop_outcome='non_issue'` when the
  // exclusion reason is non_issue (see excludeLegCore mirror policy),
  // so excluding-then-non-issue legs naturally count as non_issue.
  const disputedLegs = await ex
    .select({
      id: claimsTable.id,
      sopOutcome: claimsTable.sopOutcome,
      includedInDispute: claimsTable.includedInDispute,
    })
    .from(claimsTable)
    .where(
      and(
        eq(claimsTable.invoiceGroupId, groupId),
        isNotNull(claimsTable.errorTypeId),
      ),
    );

  // Filter to legs that still count toward the dispute rollup. Excluded
  // legs whose exclusion carried a non_issue verdict count (their
  // sopOutcome is already 'non_issue'); excluded legs whose exclusion
  // carried no verdict are not blockers (they were pulled out of the
  // dispute entirely).
  const rollupLegs = disputedLegs.filter(
    (l) => l.includedInDispute !== false || l.sopOutcome === "non_issue",
  );

  if (rollupLegs.length === 0) {
    return { closed: false, skippedReason: "no_disputed_legs" };
  }

  const allNonIssue = rollupLegs.every((l) => l.sopOutcome === "non_issue");
  if (!allNonIssue) {
    return { closed: false, skippedReason: "not_all_non_issue" };
  }

  await transitionGroupStatusAndOutcome({
    groupId,
    newStatus: "Resolved",
    newOutcome: "No Action Needed",
    source: "auto_close_all_non_issue",
    reason: "All disputed legs resolved to non_issue before submission",
    actor: SYSTEM_ACTOR,
    closureReason: "non_issue",
    systemOverride: true,
    executor: ex,
  });

  return { closed: true };
}
