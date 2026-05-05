// Single source of truth for "how many groups must be filed today?" on
// the client. Every page that surfaces an urgent count — Dashboard
// hero, Dashboard readout sentence, Queue hero, Insights banner —
// MUST go through this module so the number can never drift between
// surfaces again.
//
// Background: the server already computes one canonical `isUrgent`
// flag per row and one canonical `urgentCount` scalar on the dashboard
// summary (see api-server/src/lib/dates.ts and routes/dashboard.ts;
// the parity is locked in by `must-file-today-parity.test.ts`).
// The bug we shipped against was the *client* re-deriving the same
// number with a slightly different filter (`effectiveDaysLeft === 0`
// instead of `isUrgent`), which made the Dashboard read 0 while the
// Queue correctly read 71 for the same data. Funnelling every
// surface through these two helpers prevents a recurrence: there is
// no other supported way to compute the count on the client.
//
// Two shapes, one definition:
//   - `getUrgentGroupCountFromSummary(summary)` — for surfaces that
//     load the dashboard summary; returns the server-stamped scalar.
//   - `countUrgentRows(rows)` — for surfaces that already loaded the
//     row arrays themselves (Queue lanes); counts the same `isUrgent`
//     flag the server stamped on each row.
//
// Both definitions reduce to "how many rows have `isUrgent === true`"
// — the same predicate the server uses, the same predicate the
// per-row TODAY badge uses. By construction they agree.

export interface UrgentRow {
  isUrgent?: boolean | null;
}

export interface DashboardSummaryUrgentShape {
  /** Server-stamped scalar — count of `expiringGroups[].isUrgent === true`. */
  urgentCount?: number | null;
  /** Fallback path: re-count `isUrgent` on the embedded array if the scalar
   *  is missing (e.g. older server without Task #358 wiring). */
  expiringGroups?: ReadonlyArray<UrgentRow> | null;
}

/**
 * Count rows whose server-computed `isUrgent` flag is true. Use for
 * surfaces that already loaded the row arrays themselves (e.g. the
 * Queue, which fetches the on-clock lanes directly).
 */
export function countUrgentRows(
  ...lanes: ReadonlyArray<ReadonlyArray<UrgentRow>>
): number {
  let total = 0;
  for (const lane of lanes) {
    for (const row of lane) {
      if (row.isUrgent === true) total += 1;
    }
  }
  return total;
}

/**
 * Pull the urgent count off a dashboard summary response. Prefers the
 * server-stamped `urgentCount` scalar (one read, no client-side
 * derivation); falls back to recounting `expiringGroups[].isUrgent`
 * if the scalar is absent so older server builds still render a
 * non-zero count instead of silently zeroing out.
 *
 * NEVER count `effectiveDaysLeft === 0` here — use the server-stamped
 * `isUrgent` flag (strict-today) so the count never disagrees with the
 * Queue's own `isUrgent` rendering. Past-due rows are NOT urgent and
 * the platform never surfaces them as actionable work — see the
 * deliberate strict-equality contract in `api-server/src/lib/dates.ts`
 * (`isUrgentDeadline`) and the must-file-today parity test.
 */
export function getUrgentGroupCountFromSummary(
  summary: DashboardSummaryUrgentShape | null | undefined,
): number {
  if (!summary) return 0;
  if (typeof summary.urgentCount === "number" && Number.isFinite(summary.urgentCount)) {
    return summary.urgentCount;
  }
  return countUrgentRows(summary.expiringGroups ?? []);
}

/**
 * Filter a list of `expiringGroups` down to the ones the Dashboard
 * "File today" hero should render as bullet rows. Same predicate as
 * the count above so the visible items can never disagree with the
 * scalar count rendered next to them.
 */
export function selectUrgentRows<T extends UrgentRow>(
  rows: ReadonlyArray<T> | null | undefined,
): T[] {
  if (!rows) return [];
  return rows.filter((r): r is T => r.isUrgent === true);
}

/**
 * Filter `expiringGroups` down to rows the operator should look at
 * for today's filing pass: everything strictly urgent (must file by
 * EOD today) PLUS everything whose effective deadline is tomorrow.
 * The Dashboard "File today or tomorrow" hero renders this superset
 * so the next-day work is visible alongside what must ship before EOD.
 *
 * Past-due rows are intentionally excluded — payors won't accept
 * them, so surfacing them as actionable work would mislead the
 * operator. The server's `isUrgent` flag is strict-today (see
 * `isUrgentDeadline` in `api-server/src/lib/dates.ts`) and the
 * `effectiveDaysLeft === 1` arm only adds tomorrow, never anything
 * with a negative day count.
 */
export function selectUrgentOrTomorrowRows<
  T extends UrgentRow & { effectiveDaysLeft?: number | null },
>(rows: ReadonlyArray<T> | null | undefined): T[] {
  if (!rows) return [];
  return rows.filter((r): r is T => {
    if (r.isUrgent === true) return true;
    return r.effectiveDaysLeft === 1;
  });
}
