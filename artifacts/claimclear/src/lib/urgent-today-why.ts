// Pure state-machine for the "Why?" line shown next to the
// File-today urgent number. Lives outside the React component so:
//   • the Dashboard hero and the Queue hero (3 tones) provably
//     render the same copy for the same data — parity is enforced
//     at the function boundary, not at the JSX level,
//   • we can unit-test the wording without a DOM.

export interface UrgentTodayWhyInput {
  /** Current urgent count from the live snapshot. */
  urgentCount: number;
  /** Cleared-today total from `clearedSummary.total`. */
  cleared: number;
  /** Pre-formatted "Avery, Tom and 1 other"-style actor list. */
  actorList: string;
  /** Server-truth: was the file-today queue ever non-zero today? */
  wasUrgentToday: boolean;
  /** Peak urgentCount observed today, used for the self-resolved copy. */
  maxUrgentToday: number;
}

export type UrgentTodayWhyResult =
  | { kind: "hidden" }
  | { kind: "shown"; summary: string };

/**
 * Decide the summary copy for the Why-line.
 *
 *   - Hidden when nothing was ever urgent today (`wasUrgentToday=false`).
 *     This avoids the prior bug where a calm day with snapshots present
 *     rendered "quiet day — nothing on the file-today clock", which was
 *     itself noisy on a literally-quiet day.
 *
 *   - "X cleared today by …"               — both still urgent and cleared
 *   - "All clear — X cleared today by …"   — done, with cleared rows
 *   - "nothing cleared yet today"          — still urgent, nothing done
 *   - "peaked at N earlier — all clear now" — was urgent, now empty,
 *     cleared list also empty (e.g. cleared older than the day window)
 */
export function deriveUrgentTodayWhy(input: UrgentTodayWhyInput): UrgentTodayWhyResult {
  if (!input.wasUrgentToday) return { kind: "hidden" };

  if (input.urgentCount > 0 && input.cleared > 0) {
    return { kind: "shown", summary: `${input.cleared} cleared today by ${input.actorList}` };
  }
  if (input.urgentCount === 0 && input.cleared > 0) {
    return { kind: "shown", summary: `All clear — ${input.cleared} cleared today by ${input.actorList}` };
  }
  if (input.urgentCount > 0) {
    return { kind: "shown", summary: `nothing cleared yet today` };
  }
  return {
    kind: "shown",
    summary: `peaked at ${input.maxUrgentToday} earlier — all clear now`,
  };
}
