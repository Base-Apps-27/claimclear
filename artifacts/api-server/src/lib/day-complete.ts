// Day-complete celebration helper (Task #313, rule re-aligned in Task #538).
//
// Decides whether all invoice groups dated for a given calendar day have
// reached a state where the operator is done with them for the day —
// "operator-done." This is the inverse of the Queue page's
// engagement-needed lanes (Classification Inbox + Action Required):
// the moment a group leaves those lanes — by being queued for the bots
// (Portal Queued), pushed to re-attest (MAS Eligible / awaiting payor),
// parked (On Hold), waiting on a payor reply (Awaiting Response), or
// closed (Resolved / Denied / Expired / outcome-driven Non-Issue or
// Withdrawn) — the operator has nothing left to do on it today, even
// if the system or the payor still does.
//
// Source-of-truth alignment: the JS `OPERATOR_ON_QUEUE_STATUSES` set
// and the matching SQL `IN (...)` literal in `isDayConcluded` mirror
// the status filters the Queue page's engagement-needed default uses
// (`New`, `Needs Evidence`, `Generating Email` for Action Required, and
// `Needs Review` for the Classification Inbox via the
// `?include=needs_classification` payload). If the Queue page widens
// or narrows what an operator must engage with, this set must move
// with it so the celebration matcher can never disagree with the lane
// the operator is actually working out of.
//
// A day is concluded when EVERY invoice group whose service date
// equals that day satisfies the rule above AND the day has at least
// one invoice group. An empty day NEVER triggers a celebration.
//
// On a successful day-complete detection, we insert a fresh
// `state_events` row with `event_key=day_completed_celebration` and
// `metadata.date=<ISO date>`. Task #495 dropped the partial unique
// index from migration 0019: deduplication now happens at the EDGE
// — `checkAndEmitDayCompleteForGroup` requires the caller to hand in
// the day-aggregate "concluded" state captured BEFORE its update, and
// only emits when the new state is the false→true edge. This lets a
// day that re-concludes after a manual revert celebrate again, and
// keeps the celebration logic close to the transition that caused it
// instead of buried in a database constraint.

import { sql } from "drizzle-orm";
import { db, invoiceGroupsTable, stateEventsTable } from "@workspace/db";
import {
  OPERATOR_ON_QUEUE_STATUSES,
  OPERATOR_DONE_OUTCOMES,
  isInvoiceGroupOperatorDone,
} from "@workspace/leg-state";
import { logger } from "./logger";
import { broadcastSystemEvent } from "./sse";
import type { DbExecutor } from "./claim-transitions";
import type { GroupTransitionActor } from "./group-transitions";

// Drizzle's `DbExecutor` type intentionally narrows to select/insert/update
// /delete so callers can't lean on transaction-only escape hatches. The
// `.execute()` raw-SQL method is always present on the underlying
// `NodePgDatabase` (and on a `tx` returned from `db.transaction`), so we
// cast through this helper for the raw `INSERT ... RETURNING` used by the
// emit path and the CTE used by `isDayConcluded`.
type DbWithExecute = DbExecutor & Pick<typeof db, "execute">;
const withExecute = (ex: DbExecutor): DbWithExecute => ex as DbWithExecute;

// Task #538 (2026-05-08): the day-complete matcher reads invoice
// `status` directly and asks "is this still on the operator's queue?"
// instead of "has the system or the payor moved it on?" Pre-538 the
// gate required `phase` membership in the post-submit / closed buckets,
// which meant a day where every group was Portal Queued / On Hold /
// MAS Eligible (i.e. operator's plate fully cleared, system + payor
// still doing their thing) wouldn't fire — exactly why the celebration
// fired exactly once in PROD before this rewrite.
//
// The vocabulary lives in `@workspace/leg-state/operator-queue` so the
// Queue page's lane filters and this matcher consume one constant —
// see that module's lockstep contract for the rule. We re-export
// `isGroupOperatorDone` here as the API-side name callers already use.

// SQL `IN (...)` literals derived from the same const arrays the JS
// predicate uses, so the JS branch and the CTE in `isDayConcluded`
// can never drift out of sync. The arrays come from a typed shared
// constant (string literals, no user input), so quoting via
// single-quote doubling is sufficient and lets us keep
// `executeSql`-style parameterization out of the picture (drizzle's
// `sql` template would expand each value into its own bound param,
// defeating the readability we want here).
function toSqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
}
const OPERATOR_ON_QUEUE_STATUSES_SQL = toSqlInList(OPERATOR_ON_QUEUE_STATUSES);
const OPERATOR_DONE_OUTCOMES_SQL = toSqlInList(OPERATOR_DONE_OUTCOMES);

/**
 * Predicate: has this group left the operator's queue?
 *
 * Re-exported under the API-side name for callers that already used
 * `isGroupOperatorDone`. Implementation lives in `@workspace/leg-state`
 * so the Queue page and this matcher share one source of truth.
 */
export const isGroupOperatorDone = isInvoiceGroupOperatorDone;

/**
 * Returns the calendar day a given invoice group belongs to. Returns
 * null if the group has no claims or no claims with a date.
 *
 * Reads the typed, indexed `invoice_groups.service_date` column
 * directly — the same canonical value used by the dashboard hero / queue
 * / groups list (Task #350) and maintained on every write path by
 * `recomputeGroupServiceDate`. `to_char` keeps the wire shape stable as
 * ISO YYYY-MM-DD for the day-complete celebration matcher. See Task #356.
 */
export async function getInvoiceGroupDay(
  groupId: number,
  executor?: DbExecutor,
): Promise<string | null> {
  const ex: DbExecutor = executor ?? db;
  const [row] = await ex
    .select({
      earliest: sql<string | null>`to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD')`,
    })
    .from(invoiceGroupsTable)
    .where(sql`${invoiceGroupsTable.id} = ${groupId}`);
  return row?.earliest ?? null;
}

/**
 * Aggregate query — returns true iff every invoice group dated `day`
 * is concluded per the rule above AND at least one such group exists.
 *
 * Single round-trip: reads every group's stored `service_date` alongside
 * its own status/outcome, then counts how many of the rows that map to
 * `day` are NOT concluded.
 */
export async function isDayConcluded(
  day: string,
  executor?: DbExecutor,
): Promise<boolean> {
  const ex: DbExecutor = executor ?? db;
  // Two-step CTE — read every group's stored `service_date` (Task #350)
  // alongside `status` and `outcome`, then count how many of the rows
  // that map to `day` are NOT operator-done. Reading the canonical
  // service-date column instead of recomputing MIN(claims.date) per
  // call (Task #356) means the day-complete matcher and the dashboard
  // "must file today" hero can never disagree about which day a group
  // belongs to.
  //
  // Task #538: predicate is "is the operator done with it?" — i.e.
  // the group's `status` is NOT one of the engagement-needed Queue
  // page statuses, OR its `outcome` is one of the never-needed-to-file
  // outcomes. The status `IN (...)` literal here MUST match the JS
  // `OPERATOR_ON_QUEUE_STATUSES` set above; both are documented at
  // the top of this file.
  const result = await withExecute(ex).execute(sql`
    WITH groups_for_day AS (
      SELECT
        ${invoiceGroupsTable.id}      AS group_id,
        ${invoiceGroupsTable.status}  AS status,
        ${invoiceGroupsTable.outcome} AS outcome,
        -- service_date is a real DATE column maintained by
        -- recomputeGroupServiceDate on every write path; to_char
        -- formats it as YYYY-MM-DD so the comparison key matches the
        -- ISO \`day\` argument.
        to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD') AS earliest_date
      FROM ${invoiceGroupsTable}
      WHERE ${invoiceGroupsTable.serviceDate} IS NOT NULL
    )
    SELECT
      COUNT(*) FILTER (WHERE earliest_date = ${day}) AS total,
      COUNT(*) FILTER (
        WHERE earliest_date = ${day}
          AND NOT (
            -- outcome-driven closure (Non-Issue at triage, or withdrawn).
            -- Literal generated from OPERATOR_DONE_OUTCOMES so the JS
            -- predicate and this CTE share one source of truth.
            outcome::text IN (${sql.raw(OPERATOR_DONE_OUTCOMES_SQL)})
            -- operator-done by status: anything NOT in the
            -- engagement-needed Queue page lanes (Action Required +
            -- Classification Inbox). Literal generated from
            -- OPERATOR_ON_QUEUE_STATUSES so the JS predicate and this
            -- CTE share one source of truth.
            OR status::text NOT IN (${sql.raw(OPERATOR_ON_QUEUE_STATUSES_SQL)})
          )
      ) AS unconcluded
    FROM groups_for_day
  `);
  const row = (result.rows ?? [])[0] as { total?: string | number; unconcluded?: string | number } | undefined;
  if (!row) return false;
  const total = Number(row.total ?? 0);
  const unconcluded = Number(row.unconcluded ?? 0);
  return total > 0 && unconcluded === 0;
}

function formatDayLabel(day: string): string {
  // Render a friendly "April 15, 2026" label. We parse the ISO date in UTC
  // so the label doesn't drift across host time zones (the input is a
  // service-date key, not a timestamp).
  const [yyyy, mm, dd] = day.split("-").map((n) => parseInt(n, 10));
  if (!yyyy || !mm || !dd) return day;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Inserts a `day_completed_celebration` row for the given day and
 * broadcasts the celebration over the global system-events SSE
 * channel. Always emits — Task #495 moved deduplication to the edge
 * check in `checkAndEmitDayCompleteForGroup`, which only invokes this
 * helper on a true false→true transition. Direct callers (admin debug
 * endpoints, tests) are responsible for their own gating.
 *
 * Safe to call from any group transition path. NEVER throws — celebration
 * logging must not block a successful state-machine write.
 */
export async function tryEmitDayCompletedCelebration(opts: {
  day: string;
  triggeredByGroupId: number | null;
  actor: GroupTransitionActor;
  executor?: DbExecutor;
}): Promise<{ emitted: boolean }> {
  const { day, triggeredByGroupId, actor, executor } = opts;
  const ex: DbExecutor = executor ?? db;
  try {
    const dateLabel = formatDayLabel(day);
    const metadata = {
      date: day,
      dateLabel,
      triggeredByGroupId,
      triggeredByUserEmail: actor.userEmail,
      triggeredByUserName: actor.userName,
    };
    const result = await withExecute(ex).execute(sql`
      INSERT INTO ${stateEventsTable} (event_key, actor_user_id, metadata)
      VALUES (
        'day_completed_celebration',
        ${actor.userEmail ?? null},
        ${JSON.stringify(metadata)}::jsonb
      )
      RETURNING id
    `);
    const inserted = (result.rows ?? []).length > 0;
    if (!inserted) return { emitted: false };

    broadcastSystemEvent({
      type: "day_completed",
      date: day,
      dateLabel,
      timestamp: new Date().toISOString(),
    });
    return { emitted: true };
  } catch (err) {
    logger.warn(
      { err, day, triggeredByGroupId },
      "tryEmitDayCompletedCelebration failed (swallowed)",
    );
    return { emitted: false };
  }
}

/**
 * Convenience wrapper called from `transitionGroup*` after a state change
 * commits. The caller MUST capture `priorConcluded` before its UPDATE
 * runs (typically via `snapshotDayConcludedForGroup` below) and pass it
 * in here; we re-compute the post-update state and only emit on the
 * false→true edge. Without the snapshot the helper would re-fire for
 * every status nudge made on an already-concluded day.
 *
 * NEVER throws.
 */
export async function checkAndEmitDayCompleteForGroup(opts: {
  groupId: number;
  actor: GroupTransitionActor;
  priorConcluded: boolean;
  executor?: DbExecutor;
}): Promise<void> {
  const { groupId, actor, priorConcluded, executor } = opts;
  const ex: DbExecutor = executor ?? db;
  try {
    if (priorConcluded) return;
    const day = await getInvoiceGroupDay(groupId, ex);
    if (!day) return;
    const nowConcluded = await isDayConcluded(day, ex);
    if (!nowConcluded) return;
    await tryEmitDayCompletedCelebration({
      day,
      triggeredByGroupId: groupId,
      actor,
      executor: ex,
    });
  } catch (err) {
    logger.warn(
      { err, groupId },
      "checkAndEmitDayCompleteForGroup failed (swallowed)",
    );
  }
}

/**
 * Pre-update snapshot helper for the three `transitionGroup*` paths.
 * Returns whether the group's day was already day-aggregate concluded
 * BEFORE the caller's UPDATE statement runs. NEVER throws; on lookup
 * failure returns `false` so a transient read error can never suppress
 * a legitimate celebration (the post-update edge check still gates).
 */
export async function snapshotDayConcludedForGroup(
  groupId: number,
  executor?: DbExecutor,
): Promise<boolean> {
  const ex: DbExecutor = executor ?? db;
  try {
    const day = await getInvoiceGroupDay(groupId, ex);
    if (!day) return false;
    return await isDayConcluded(day, ex);
  } catch (err) {
    logger.warn(
      { err, groupId },
      "snapshotDayConcludedForGroup failed (returning false)",
    );
    return false;
  }
}
