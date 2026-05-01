export type MacroPhase =
  | "pre-submit"
  | "in-flight"
  | "response-pending"
  | "mas-action-required"
  | "awaiting-payout"
  | "closed"
  | "on-hold";

const STATUSES_BY_PHASE: Record<Exclude<MacroPhase, "mas-action-required" | "awaiting-payout">, readonly string[]> = {
  "pre-submit": ["New", "Needs Evidence"],
  "in-flight": ["Portal Queued", "Generating Email", "Awaiting Response"],
  "response-pending": ["Ready to Review", "Needs Review"],
  "closed": ["Resolved", "Denied", "Withdrawn"],
  "on-hold": ["On Hold"],
};

export function getMacroPhase(status: string | null | undefined): Exclude<MacroPhase, "mas-action-required" | "awaiting-payout"> {
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
