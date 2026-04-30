export const CLOSURE_REASON_LABELS: Record<string, string> = {
  payer_denied: "Denied by payer",
  not_contestable: "Withdrawn — not contestable",
  accepted_loss: "Withdrawn — accepted loss after denial",
  non_issue: "Resolved — non-issue at classification",
};

export function closureReasonLabel(reason?: string | null): string {
  if (!reason) return "";
  return CLOSURE_REASON_LABELS[reason] ?? reason;
}
