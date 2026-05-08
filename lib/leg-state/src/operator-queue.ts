// "Is this invoice group still on the operator's queue?" predicate —
// the cross-surface source of truth for the Queue page's
// engagement-needed lanes (Classification Inbox + Action Required) and
// for the day-complete celebration matcher in the API server.
//
// LOCKSTEP CONTRACT (change one, change ALL):
//   1. The `OPERATOR_ON_QUEUE_STATUSES` constant below.
//   2. The Queue page's lane filters in
//      `artifacts/claimclear/src/pages/queue.tsx` (Action Required tab
//      filters by New / Needs Evidence / Generating Email; the
//      Classification Inbox row uses Needs Review).
//   3. The `isDayConcluded` SQL CTE + JS predicate in
//      `artifacts/api-server/src/lib/day-complete.ts` (which now
//      imports from this module so they cannot drift on the API side).
//
// `OPERATOR_DONE_OUTCOMES` is the outcome-driven escape hatch: a row
// whose outcome is Non-Issue / Withdrawn never had to be filed, so it
// counts as operator-done regardless of where its status sits.

export const OPERATOR_ON_QUEUE_STATUSES = [
  "New",
  "Needs Evidence",
  "Generating Email",
  "Needs Review",
] as const;
export type OperatorOnQueueStatus = (typeof OPERATOR_ON_QUEUE_STATUSES)[number];

export const OPERATOR_DONE_OUTCOMES = ["Non-Issue", "Withdrawn"] as const;
export type OperatorDoneOutcome = (typeof OPERATOR_DONE_OUTCOMES)[number];

const OPERATOR_ON_QUEUE_STATUS_SET: ReadonlySet<string> = new Set<string>(
  OPERATOR_ON_QUEUE_STATUSES,
);
const OPERATOR_DONE_OUTCOME_SET: ReadonlySet<string> = new Set<string>(
  OPERATOR_DONE_OUTCOMES,
);

/**
 * True iff the invoice group is no longer on the operator's queue —
 * either its outcome puts it in the "never needed to file" bucket, or
 * its status has left the engagement-needed lanes (handed off to the
 * bots, parked on hold, awaiting payor, or closed).
 *
 * Pure, no DB. Same shape used by the Queue page and the API.
 */
export function isInvoiceGroupOperatorDone(row: {
  status: string;
  outcome: string;
}): boolean {
  if (OPERATOR_DONE_OUTCOME_SET.has(row.outcome)) return true;
  return !OPERATOR_ON_QUEUE_STATUS_SET.has(row.status);
}
