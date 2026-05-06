export type MacroPhase =
  | "pre-submit"
  | "in-flight"
  | "response-pending"
  | "mas-action-required"
  | "awaiting-payout"
  | "closed"
  | "on-hold";

// "mas-action-required" now has BOTH a status-driven entry (the new
// "MAS Eligible" status from the post-upload triage bridge) AND a
// derived entry (any group with reattestRequired=true regardless of
// status — typically an Approved/Partially-Approved group whose payor
// verdict triggered re-attestation). "awaiting-payout" remains purely
// derived (reattestCompletedAt != null).
const STATUSES_BY_PHASE: Record<Exclude<MacroPhase, "awaiting-payout">, readonly string[]> = {
  "pre-submit": ["New", "Needs Evidence"],
  "in-flight": ["Portal Queued", "Generating Email", "Awaiting Response"],
  "response-pending": ["Ready to Review", "Needs Review"],
  "mas-action-required": ["MAS Eligible"],
  // "Withdrawn" was removed here (Task #512): it is an outcome value,
  // never a status, so the original entry was unreachable. See
  // docs/architecture/invoice-terminal-state.md §7.
  "closed": ["Resolved", "Denied"],
  "on-hold": ["On Hold"],
};

export function getMacroPhase(status: string | null | undefined): Exclude<MacroPhase, "awaiting-payout"> {
  if (!status) return "pre-submit";
  for (const phase of Object.keys(STATUSES_BY_PHASE) as Array<keyof typeof STATUSES_BY_PHASE>) {
    if (STATUSES_BY_PHASE[phase].includes(status)) return phase;
  }
  return "pre-submit";
}

export function getGroupMacroPhase(group: {
  status: string | null | undefined;
  reattestRequired?: boolean | null;
  reattestCompletedAt?: Date | null;
}): MacroPhase {
  if (group.reattestCompletedAt != null) return "awaiting-payout";
  if (group.reattestRequired === true) return "mas-action-required";
  return getMacroPhase(group.status);
}
