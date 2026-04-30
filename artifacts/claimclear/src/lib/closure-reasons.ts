export const CLOSURE_REASON_LABELS: Record<string, string> = {
  denied_by_payor: "Denied by payor",
  cannot_dispute: "Withdrawn — cannot dispute",
  non_issue: "Resolved — non-issue at classification",
};

export function closureReasonLabel(reason?: string | null): string {
  if (!reason) return "";
  return CLOSURE_REASON_LABELS[reason] ?? reason;
}
