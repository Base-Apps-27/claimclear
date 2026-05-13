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
// Rollup leg = a non-duplicate leg that either (a) is included in the
// dispute, or (b) carries `sop_outcome='non_issue'` (the canonical
// "operator already declared this one a no-issue" marker, regardless
// of whether the leg ever earned an error_type or got excluded out
// of the dispute). Duplicates never count — they were collapsed onto
// a representative leg and carry no independent verdict.
//
// The "or `sop_outcome='non_issue'` regardless of error_type" clause
// covers the orphan shape produced by Task #260's auto-non-issue-
// siblings rule and by operator-driven "Mark all as no-issue" on
// blank-classified groups: every leg lands at sop_outcome='non_issue'
// before ANY leg earns an error_type, so a stricter `error_type_id
// NOT NULL` predicate would short-circuit and leave the group stuck
// pre-submit. The 2026-05 backfill swept up the legacy cohort; this
// broadened predicate keeps the runtime cascade in sync so future
// orphan groups close on the spot.
//
// Idempotency: short-circuits when the group is already in a terminal
// status (Resolved / Denied / Expired) so a writer that fires the
// helper repeatedly does not 400 the caller. Also short-circuits when
// the rollup-leg set is empty (no legs to roll up).
//
// Pre-submit gate: skips when `groupHasEverBeenSubmitted` is true.
// `transitionGroupStatusAndOutcome` would also reject the close in
// that case (the "No Action Needed" branch refuses post-submit), but
// pre-checking lets us avoid the noisy try/catch on a path that fires
// once per leg conclusion.

import { and, eq, isNull } from "drizzle-orm";
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
    | "no_rollup_legs"
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

  // Pull every non-duplicate leg of the group. Duplicates were
  // collapsed onto a representative leg and carry no independent
  // verdict, so they never block the rollup.
  const allLegs = await ex
    .select({
      id: claimsTable.id,
      sopOutcome: claimsTable.sopOutcome,
      includedInDispute: claimsTable.includedInDispute,
    })
    .from(claimsTable)
    .where(
      and(
        eq(claimsTable.invoiceGroupId, groupId),
        isNull(claimsTable.duplicateOfClaimId),
      ),
    );

  // A leg counts toward the rollup if it's still part of the dispute,
  // OR if it already carries the canonical no-issue marker
  // (`sop_outcome='non_issue'`). The second clause is what catches the
  // orphan shape: legs that never earned an error_type but were
  // excluded as non_issue (Task #260 sibling rule, "Mark all as
  // no-issue" on blank groups, etc.) — `excludeLegCore` writes
  // `sop_outcome='non_issue'` on those, so they show up here even
  // though `error_type_id` is NULL and `included_in_dispute` is false.
  // Legs the operator excluded for any OTHER reason (cannot_dispute,
  // duplicate_handled, …) carry no `sop_outcome='non_issue'` and
  // `included_in_dispute=false`, so they correctly drop out as
  // non-blockers (already pulled out of the dispute).
  const rollupLegs = allLegs.filter(
    (l) => l.includedInDispute !== false || l.sopOutcome === "non_issue",
  );

  if (rollupLegs.length === 0) {
    return { closed: false, skippedReason: "no_rollup_legs" };
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
    reason: "All non-duplicate legs resolved to non_issue before submission",
    actor: SYSTEM_ACTOR,
    closureReason: "non_issue",
    systemOverride: true,
    executor: ex,
  });

  return { closed: true };
}
