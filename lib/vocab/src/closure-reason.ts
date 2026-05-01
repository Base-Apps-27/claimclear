import type { GlossaryEntry } from "./domains";

// ─────────────────────────────────────────────────────────────────────────
// Structured closure reason — one of the three buckets the closure intake
// dialog writes into the `closureReason` column on a claim or group.
// Underlying enum: keys of `CLOSURE_REASON_BANNER` in
// `@workspace/closure-options`.
//
// The shorter `CLOSURE_REASON_LABELS` map (used by the audit-log render
// path) inserts a hyphen-prefixed qualifier ("Withdrawn — cannot
// dispute") so a reader can tell which closure reason produced the
// `Withdrawn` outcome at a glance. That qualifier convention is owned by
// `closureReasonAuditLabel` below.
// ─────────────────────────────────────────────────────────────────────────

export const CLOSURE_REASONS = [
  "denied_by_payor",
  "cannot_dispute",
  "non_issue",
] as const;

export type ClosureReason = typeof CLOSURE_REASONS[number];

export const CLOSURE_REASON: Record<ClosureReason, GlossaryEntry> = {
  denied_by_payor: {
    enumValue: "denied_by_payor",
    label: "Denied by payor",
    description: "The payor returned a denial that we are recording as the final outcome. The dollars stay lost.",
    domain: "closure_reason",
  },
  cannot_dispute: {
    enumValue: "cannot_dispute",
    label: "Cannot dispute",
    description: "We worked the case but the evidence we'd need doesn't exist or isn't recoverable. The dollars stay lost.",
    domain: "closure_reason",
  },
  non_issue: {
    enumValue: "non_issue",
    label: "Non-issue",
    description: "On closer look, this isn't actually a billing error — nothing for us to dispute.",
    domain: "closure_reason",
  },
};

export function closureReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return CLOSURE_REASON[reason as ClosureReason]?.label ?? reason;
}

// Label used by the audit log / closure metadata cells: prefixes the
// outcome the closure produced so the line reads as a self-contained
// statement of what happened.
export function closureReasonAuditLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  switch (reason as ClosureReason) {
    case "denied_by_payor":
      return "Denied by payor";
    case "cannot_dispute":
      return "Withdrawn — cannot dispute";
    case "non_issue":
      return "Resolved — non-issue at classification";
    default:
      return CLOSURE_REASON[reason as ClosureReason]?.label ?? reason;
  }
}
