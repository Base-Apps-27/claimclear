// Pure helpers backing the Queue page's urgency surface (Task #274).
// Extracted so the filter, tier, and badge logic can be unit-tested
// without spinning up React.

import { countUrgentRows } from "./urgent-count";

// Task #352 — "stuck" is the parallel "submitted but unconfirmed" tier.
// Same date math as "urgent" (deadline ≤ today), but the status filter
// is the post-submit set (Portal Queued / Processed) rather than the
// pre-submit actionable set. The backend's `?expiring=stuck` uses the
// same ExpiringMode type, so these two values stay in sync.
export type ExpiringFilter = "urgent" | "soon" | "stuck" | null;

/** Validate the raw `?expiring=` URL param. Anything else collapses to null. */
export function parseExpiringParam(raw: string | null | undefined): ExpiringFilter {
  if (raw === "urgent") return "urgent";
  if (raw === "soon") return "soon";
  if (raw === "stuck") return "stuck";
  return null;
}

export interface UrgencyShape {
  isUrgent?: boolean | null;
  effectiveDaysLeft?: number | null;
}

// Task #352 — rows carry both `isUrgent` and `submittedStuck` from the
// API so the filter helpers need to see them.
export interface UrgencyShapeWithStuck extends UrgencyShape {
  submittedStuck?: boolean | null;
}

/**
 * Match the Dashboard's "+ N more in next 3 days" set: 1..3 days left,
 * not already urgent. (`isUrgent` covers <=0 days, so the soon set is
 * strictly the upcoming-but-not-due-today bucket.)
 *
 * `stuck` mode (Task #352): pass rows whose `submittedStuck` flag is true —
 * i.e. already filed, deadline slipped, needs a confirmation chase.
 * These rows live in the Portal Queued lane and already have a separate
 * `submittedStuck` flag computed by the backend; the filter simply
 * surfaces them without any extra date math on the client.
 */
export function matchesExpiringFilter(
  group: UrgencyShapeWithStuck,
  filter: ExpiringFilter,
): boolean {
  if (filter == null) return true;
  if (filter === "urgent") return !!group.isUrgent && !group.submittedStuck;
  if (filter === "stuck") return !!group.submittedStuck;
  if (group.isUrgent) return false;
  const d = group.effectiveDaysLeft;
  return d != null && d >= 1 && d <= 3;
}

export function filterByExpiringParam<T extends UrgencyShapeWithStuck>(
  rows: T[],
  filter: ExpiringFilter,
): T[] {
  if (filter == null) return rows;
  return rows.filter(r => matchesExpiringFilter(r, filter));
}

/**
 * Tier the row falls into — drives the per-row deadline pill and the
 * legend text. "later" is the catch-all for anything past a week so
 * every on-clock row gets *some* indicator (the legend used to lie
 * about this).
 */
export type DeadlineTier = "overdue" | "today" | "soon" | "week" | "later";

export function computeDeadlineTier(group: UrgencyShape): DeadlineTier | null {
  const days = group.effectiveDaysLeft;
  if (days == null) return null;
  if (group.isUrgent) return "today";
  if (days < 0) return "overdue";
  if (days <= 2) return "soon";
  if (days <= 7) return "week";
  return "later";
}

/**
 * Add `days` calendar days to `from` and return a fresh Date. Used to
 * project the filing-deadline date from `effectiveDaysLeft` so urgent
 * rows can show "Today · M/D" instead of a bare "TODAY" with no date.
 */
export function addDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

/** Compact M/D label (no leading zeros, no year) for the deadline pill. */
export function formatShortMonthDay(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export interface DeadlineLabel {
  tier: DeadlineTier;
  /** Short text shown inside the pill, e.g. "Today · 5/1", "≤2d · 5/3". */
  label: string;
  /** Long-form tooltip that explains the tier and concrete date. */
  tooltip: string;
}

/**
 * Build the per-row deadline pill copy. `now` is injected so tests can
 * pin the clock; production callers pass `new Date()`.
 */
export function formatDeadlineLabel(
  group: UrgencyShape,
  now: Date = new Date(),
): DeadlineLabel | null {
  const tier = computeDeadlineTier(group);
  if (tier == null) return null;
  const days = group.effectiveDaysLeft as number;
  const deadline = addDays(now, days);
  const date = formatShortMonthDay(deadline);
  switch (tier) {
    case "today":
      return {
        tier,
        label: `Today · ${date}`,
        tooltip: `Filing deadline is today (${date}). Must be submitted before EOD.`,
      };
    case "overdue":
      return {
        tier,
        label: `Overdue · ${date}`,
        tooltip: `Past the filing deadline (${date}). File immediately.`,
      };
    case "soon":
      return {
        tier,
        label: `≤2d · ${date}`,
        tooltip: `${days} day${days === 1 ? "" : "s"} until the filing deadline (${date}).`,
      };
    case "week":
      return {
        tier,
        label: `≤7d · ${date}`,
        tooltip: `${days} days until the filing deadline (${date}).`,
      };
    case "later":
      return {
        tier,
        label: `${days}d · ${date}`,
        tooltip: `${days} days until the filing deadline (${date}).`,
      };
  }
}

export interface TabBadge {
  /** Total count, hidden when a filter is collapsing the badge. */
  total: string | null;
  /** Urgent count text, e.g. "62 urgent" or "62". Null when the urgent
   *  signal is irrelevant to the current view (e.g. soon-only filter). */
  urgent: string | null;
  /** Soon-only count text, populated under `?expiring=soon` so the
   *  badge reflects what the operator actually sees in that lane. */
  soon: string | null;
}

/**
 * Compute the split-badge text for an on-clock tab.
 *
 * - `?expiring=urgent` → drop totals + soon, show only the urgent count.
 *   Anything else is misleading because the filter is hiding non-urgent
 *   rows from view.
 * - `?expiring=soon`   → drop totals + urgent split (urgent rows are
 *   filtered out by the soon set), show the soon count for the lane.
 * - no filter         → "<total> · <N> urgent" split when urgent items
 *   exist, plain total otherwise.
 *
 * `soonInLane` is the count of rows that match the soon filter inside
 * this tab; only consulted under the soon filter mode.
 */
export function formatTabBadge(
  total: number,
  urgent: number,
  filterMode: ExpiringFilter,
  soonInLane = 0,
): TabBadge {
  if (filterMode === "urgent") {
    if (urgent > 0) return { total: null, urgent: String(urgent), soon: null };
    return { total: null, urgent: null, soon: null };
  }
  if (filterMode === "soon") {
    if (soonInLane > 0) return { total: null, urgent: null, soon: String(soonInLane) };
    return { total: null, urgent: null, soon: null };
  }
  if (urgent > 0) {
    return { total: String(total), urgent: `${urgent} urgent`, soon: null };
  }
  if (total > 0) {
    return { total: String(total), urgent: null, soon: null };
  }
  return { total: null, urgent: null, soon: null };
}

/**
 * Sum of urgent rows across the on-clock lanes — drives the queue-level
 * hero count. Thin wrapper over `lib/urgent-count.countUrgentRows`,
 * the single sanctioned client-side urgency counter; kept here as a
 * named export so the queue's call site reads naturally and the Queue
 * and Dashboard provably reduce to the same predicate.
 */
export function computeAggregateUrgentCount(
  ...lanes: ReadonlyArray<ReadonlyArray<UrgencyShape>>
): number {
  // Delegated rather than re-implemented so a future change to the
  // urgency predicate (e.g. a new flag on the row) only has to land
  // in one place. See `lib/urgent-count.ts` for the contract and the
  // regression history that justified consolidating it.
  return countUrgentRows(lanes.flat());
}

/**
 * Empty-state copy for an on-clock tab. Centralised so the message
 * accurately reflects the active filter (e.g. "no file-today groups")
 * instead of falsely claiming the lane is empty.
 */
export function emptyStateCopy(
  lane: "actionable" | "portal-queued" | "on-hold",
  filter: ExpiringFilter,
): string {
  if (filter === "urgent") {
    if (lane === "actionable") return "No file-today groups in Action Required.";
    if (lane === "portal-queued") return "No file-today groups in Portal Queued.";
    return "No file-today groups on hold.";
  }
  if (filter === "soon") {
    if (lane === "actionable") return "No due-within-3-days groups in Action Required.";
    if (lane === "portal-queued") return "No due-within-3-days groups in Portal Queued.";
    return "No due-within-3-days groups on hold.";
  }
  // Task #352 — "stuck" only ever appears in the portal-queued lane;
  // other lanes will show the normal unfiltered empty-state instead.
  if (filter === "stuck") {
    if (lane === "portal-queued") return "No stuck-after-submission groups in Portal Queued.";
    return "No stuck-after-submission groups in this lane.";
  }
  if (lane === "actionable") return "No invoice groups need action right now.";
  if (lane === "portal-queued") return "No invoice groups queued for portal submission.";
  return "No invoice groups on hold.";
}
