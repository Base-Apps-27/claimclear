// Thin wrapper around the canonical glossary so existing import sites
// (`import { closureReasonLabel } from "@/lib/closure-reasons"`)
// continue to compile. New code should import directly from
// `@workspace/vocab`.
import {
  CLOSURE_REASON,
  closureReasonAuditLabel,
} from "@workspace/vocab";

export const CLOSURE_REASON_LABELS: Record<string, string> = {
  denied_by_payor: closureReasonAuditLabel("denied_by_payor"),
  cannot_dispute: closureReasonAuditLabel("cannot_dispute"),
  non_issue: closureReasonAuditLabel("non_issue"),
};

export function closureReasonLabel(reason?: string | null): string {
  if (!reason) return "";
  return CLOSURE_REASON_LABELS[reason] ?? CLOSURE_REASON[reason as keyof typeof CLOSURE_REASON]?.label ?? reason;
}
