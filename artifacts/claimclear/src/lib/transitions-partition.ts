// Task #555 — partitioning helper for the Transitions dropdown on
// `invoice-group-detail-v2`. The server hands us a flat list of
// `validStatuses`; the operator-facing menu splits that list into:
//
//   • Phase actions    — same-phase or forward transitions every
//                        operator can take (Submit / Mark MAS Eligible
//                        / Place on hold / Clear hold ...).
//   • Status overrides — backwards transitions, only surfaced to
//                        admins as an escape hatch.
//
// The split is derived from each candidate status' lifecycle phase
// rank (PHASE_ORDER in lifecycle-phase.ts), NOT from a hardcoded
// allow-list, so any new server-side transition automatically lands
// in the right section without a UI change.
import { getLifecyclePhase, type LifecyclePhase } from "./lifecycle-phase";

export const PHASE_ORDER_INDEX: Record<LifecyclePhase, number> = {
  "pre-submit": 0,
  "in-flight": 1,
  "response-pending": 2,
  "on-hold": 3,
  "mas-action-required": 4,
  "closed": 5,
};

export interface TransitionsPartition {
  phaseActionStatuses: string[];
  overrideStatuses: string[];
}

export function partitionTransitions(
  currentStatus: string | null | undefined,
  validStatuses: readonly string[],
  isAdmin: boolean,
): TransitionsPartition {
  const currentRank =
    PHASE_ORDER_INDEX[getLifecyclePhase(currentStatus)] ?? 0;
  const rank = (s: string) =>
    PHASE_ORDER_INDEX[getLifecyclePhase(s)] ?? 0;
  return {
    phaseActionStatuses: validStatuses.filter((s) => rank(s) >= currentRank),
    overrideStatuses: isAdmin
      ? validStatuses.filter((s) => rank(s) < currentRank)
      : [],
  };
}
