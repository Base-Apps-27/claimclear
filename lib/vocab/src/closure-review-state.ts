// @workspace/vocab — closure_review_state labels.
//
// Task #889 — adds `acknowledged_by_party` to distinguish a portal-side
// acknowledgement (the responsible supervisor marked it addressed via
// /my-closures) from `acknowledged` (a dispute-team operator cleared
// it from the Withdrawals page). Both count as "addressed" for the
// hide-addressed filter; the per-row drawer surfaces which mechanism
// was used.

export const CLOSURE_REVIEW_STATES = [
  "pending",
  "acknowledged",
  "acknowledged_by_party",
  "needs_revisit",
  "resolved",
] as const;

export type ClosureReviewState = typeof CLOSURE_REVIEW_STATES[number];

export const CLOSURE_REVIEW_STATE_LABELS: Record<ClosureReviewState, string> = {
  pending: "Pending review",
  acknowledged: "Marked by the dispute team",
  acknowledged_by_party: "Acknowledged by responsible party",
  needs_revisit: "Needs revisit",
  resolved: "Resolved",
};

export function closureReviewStateLabel(value: string | null | undefined): string {
  if (!value) return "";
  return (
    CLOSURE_REVIEW_STATE_LABELS[value as ClosureReviewState] ?? value
  );
}

export function isClosureReviewStateAddressed(
  value: string | null | undefined,
): boolean {
  return (
    value === "acknowledged" ||
    value === "acknowledged_by_party" ||
    value === "resolved"
  );
}
