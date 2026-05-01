// Server-side mirror of artifacts/claimclear/src/lib/lifecycle-phase.ts.
// Kept in lockstep — if either changes, update both.

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

/** Status-only macro phase. Use when no group flags are available. */
export function getMacroPhase(status: string | null | undefined): Exclude<MacroPhase, "mas-action-required" | "awaiting-payout"> {
  if (!status) return "pre-submit";
  for (const phase of Object.keys(STATUSES_BY_PHASE) as Array<keyof typeof STATUSES_BY_PHASE>) {
    if (STATUSES_BY_PHASE[phase].includes(status)) return phase;
  }
  return "pre-submit";
}

/**
 * Group-aware macro phase. Layers post-response derivation on top of
 * status: `awaiting-payout` when reattest_completed_at is set,
 * `mas-action-required` when reattest_required is true (but not yet
 * stamped). Otherwise falls through to status.
 */
export function getGroupMacroPhase(group: {
  status: string | null | undefined;
  reattestRequired?: boolean | null;
  reattestCompletedAt?: Date | null;
}): MacroPhase {
  if (group.reattestCompletedAt != null) return "awaiting-payout";
  if (group.reattestRequired === true) return "mas-action-required";
  return getMacroPhase(group.status);
}
