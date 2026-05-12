// Pure helpers backing the Queue page's urgency surface (Task #274).
// Extracted so the filter, tier, and badge logic can be unit-tested
// without spinning up React.

import { countUrgentRows } from "./urgent-count";

// Task #352 — "stuck" is the parallel "submitted but unconfirmed" tier.
// Same date math as "urgent" (deadline ≤ today), but the status filter
// is the post-submit set (Portal Queued / Processed) rather than the
// pre-submit actionable set. The backend's `?expiring=stuck` uses the
// same ExpiringMode type, so these two values stay in sync.
//
// Task #452 — "tomorrow" surfaces the day-1 band on its own, and
// "today-tomorrow" is the combined urgent + tomorrow superset that the
// Dashboard's "File today or tomorrow" hero summarises. Both new modes
// are derivable from `isUrgent` / `effectiveDaysLeft` alone, so the
// backend filter vocabulary stays at urgent/soon/stuck — the new modes
// are filtered client-side by the Queue.
export type ExpiringFilter =
  | "urgent"
  | "soon"
  | "stuck"
  | "tomorrow"
  | "today-tomorrow"
  | null;

/** Validate the raw `?expiring=` URL param. Anything else collapses to null.
 *
 * Accepts both the canonical `today-tomorrow` token and the comma form
 * (`urgent,tomorrow` / `tomorrow,urgent`) so a thoughtfully-typed URL
 * still lands on the combined view. Anything outside the known
 * vocabulary collapses to null so a stale share link can't pin the
 * Queue to a state that no longer exists. */
export function parseExpiringParam(raw: string | null | undefined): ExpiringFilter {
  if (raw == null || raw === "") return null;
  if (raw === "urgent") return "urgent";
  if (raw === "soon") return "soon";
  if (raw === "stuck") return "stuck";
  if (raw === "tomorrow") return "tomorrow";
  if (raw === "today-tomorrow") return "today-tomorrow";
  if (raw.includes(",")) {
    const parts = new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
    if (parts.size === 2 && parts.has("urgent") && parts.has("tomorrow")) {
      return "today-tomorrow";
    }
  }
  return null;
}

/** Serialise an `ExpiringFilter` back to the URL token. The combined
 *  mode round-trips through the canonical `today-tomorrow` form so the
 *  URL stays stable — the comma form is only an inbound convenience. */
export function serializeExpiringParam(filter: ExpiringFilter): string | null {
  return filter ?? null;
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
 *
 * Task #452:
 * - `tomorrow` matches non-urgent rows whose effective deadline is
 *   exactly day-1 (and not stuck — stuck rows have their own lane).
 * - `today-tomorrow` is the union: any urgent row plus any non-urgent
 *   row exactly day-1. Stuck rows are excluded so the combined view
 *   matches the Dashboard "File today or tomorrow" superset.
 */
export function matchesExpiringFilter(
  group: UrgencyShapeWithStuck,
  filter: ExpiringFilter,
): boolean {
  if (filter == null) return true;
  if (filter === "urgent") return !!group.isUrgent && !group.submittedStuck;
  if (filter === "stuck") return !!group.submittedStuck;
  if (filter === "tomorrow") {
    if (group.submittedStuck) return false;
    return !group.isUrgent && group.effectiveDaysLeft === 1;
  }
  if (filter === "today-tomorrow") {
    if (group.submittedStuck) return false;
    if (group.isUrgent) return true;
    return group.effectiveDaysLeft === 1;
  }
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
 *
 * Task #452 splits the old "soon" band so day-1 ("tomorrow") gets its
 * own tier and renders in a clearly distinct yellow from the 2–3-day
 * rows. The 2–3 day band keeps the "soon" name but renders softer so
 * "tomorrow" reads as the more urgent of the yellows.
 */
export type DeadlineTier =
  | "overdue"
  | "today"
  | "tomorrow"
  | "soon"
  | "week"
  | "later";

export function computeDeadlineTier(group: UrgencyShape): DeadlineTier | null {
  const days = group.effectiveDaysLeft;
  if (days == null) return null;
  if (group.isUrgent) return "today";
  if (days < 0) return "overdue";
  if (days === 1) return "tomorrow";
  if (days <= 3) return "soon";
  if (days <= 7) return "week";
  return "later";
}

/**
 * A row is "overdue" when the filing deadline has already passed and
 * the row is not flagged as `isUrgent` (which covers due-today). Past
 * the deadline the payor will not accept the claim, so the operator
 * literally cannot act on these — they should be tucked behind a
 * disclosure on the queue rather than dominating the visible list.
 */
export function isOverdueRow(group: UrgencyShape): boolean {
  return computeDeadlineTier(group) === "overdue";
}

/**
 * Split a lane's rows into the visible set (everything the operator
 * can still act on) and the overdue set (past-deadline rows the queue
 * hides by default behind a "show overdue" disclosure).
 */
export function partitionOverdue<T extends UrgencyShape>(
  rows: T[],
): { visible: T[]; overdue: T[] } {
  const visible: T[] = [];
  const overdue: T[] = [];
  for (const r of rows) {
    if (isOverdueRow(r)) overdue.push(r);
    else visible.push(r);
  }
  return { visible, overdue };
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
  /** Short text shown inside the pill, e.g. "Today · 5/1", "≤3d · 5/3". */
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
    case "tomorrow":
      return {
        tier,
        label: `Tomorrow · ${date}`,
        tooltip: `Filing deadline is tomorrow (${date}). One day left.`,
      };
    case "soon":
      return {
        tier,
        label: `≤3d · ${date}`,
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
  /** Tomorrow-only count text, populated under `?expiring=tomorrow`. */
  tomorrow: string | null;
  /** Combined today+tomorrow count text, populated under
   *  `?expiring=today-tomorrow`. */
  todayTomorrow: string | null;
}

/**
 * Compute the split-badge text for an on-clock tab.
 *
 * - `?expiring=urgent` → drop totals + soon, show only the urgent count.
 *   Anything else is misleading because the filter is hiding non-urgent
 *   rows from view.
 * - `?expiring=soon`   → drop totals + urgent split (urgent rows are
 *   filtered out by the soon set), show the soon count for the lane.
 * - `?expiring=tomorrow` → drop totals + urgent, show the tomorrow
 *   count for this lane only.
 * - `?expiring=today-tomorrow` → show the combined count for this lane
 *   only — totals would mislead since the filter is hiding everything
 *   beyond day-1.
 * - no filter         → "<total> · <N> urgent" split when urgent items
 *   exist, plain total otherwise.
 *
 * `matchingInLane` is the count of rows that match the active filter
 * inside this tab; consulted under the soon / tomorrow / today-tomorrow
 * filter modes.
 */
export function formatTabBadge(
  total: number,
  urgent: number,
  filterMode: ExpiringFilter,
  matchingInLane = 0,
): TabBadge {
  const empty: TabBadge = {
    total: null,
    urgent: null,
    soon: null,
    tomorrow: null,
    todayTomorrow: null,
  };
  if (filterMode === "urgent") {
    if (urgent > 0) return { ...empty, urgent: String(urgent) };
    return empty;
  }
  if (filterMode === "soon") {
    if (matchingInLane > 0) return { ...empty, soon: String(matchingInLane) };
    return empty;
  }
  if (filterMode === "tomorrow") {
    if (matchingInLane > 0) return { ...empty, tomorrow: String(matchingInLane) };
    return empty;
  }
  if (filterMode === "today-tomorrow") {
    if (matchingInLane > 0) return { ...empty, todayTomorrow: String(matchingInLane) };
    return empty;
  }
  if (urgent > 0) {
    return { ...empty, total: String(total), urgent: `${urgent} urgent` };
  }
  if (total > 0) {
    return { ...empty, total: String(total) };
  }
  return empty;
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
 *
 * The `portal-queued` lane was removed from the Queue's lane stack
 * (submitted groups now live on the Response Tracker / Portal
 * Submissions surfaces), so the lane union here is narrowed to the
 * two lanes the Queue actually renders. The `stuck` filter mode is
 * still part of the URL vocabulary (used by the Dashboard's "Stuck
 * after submission" hero card), but the Queue's UI no longer exposes
 * it, so we no longer need a tailored copy variant for it here.
 */
export function emptyStateCopy(
  lane: "actionable" | "on-hold",
  filter: ExpiringFilter,
): string {
  if (filter === "urgent") {
    if (lane === "actionable") return "No file-today groups in Action Required.";
    return "No file-today groups on hold.";
  }
  if (filter === "soon") {
    if (lane === "actionable") return "No due-within-3-days groups in Action Required.";
    return "No due-within-3-days groups on hold.";
  }
  if (filter === "tomorrow") {
    if (lane === "actionable") return "No file-tomorrow groups in Action Required.";
    return "No file-tomorrow groups on hold.";
  }
  if (filter === "today-tomorrow") {
    if (lane === "actionable") return "No file-today-or-tomorrow groups in Action Required.";
    return "No file-today-or-tomorrow groups on hold.";
  }
  if (filter === "stuck") {
    // Reachable only via a stale link pinning `?expiring=stuck`. The
    // Queue can never match a stuck row (submitted groups aren't in
    // the lane stack), so the copy points the operator at the right
    // surface instead of falsely claiming the lane is empty.
    return "No stuck-after-submission groups here — see Portal Submissions.";
  }
  if (lane === "actionable") return "No invoice groups need action right now.";
  return "No invoice groups on hold.";
}
