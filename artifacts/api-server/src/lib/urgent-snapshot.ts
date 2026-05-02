// "How many invoice groups must be filed today?" — the single source of
// truth for the Dashboard's "File today" hero, the Queue's urgency hero,
// and the periodic snapshot we drop into `state_events` so we can draw a
// sparkline of how the count moves over the day. See Task #298.
//
// Keep this module the only place that combines {actionable status set}
// + {ET-anchored urgency}. The route handlers and the snapshot cron
// both call into it so they cannot drift.

import { inArray, isNotNull, and, sql } from "drizzle-orm";
import { db, invoiceGroupsTable } from "@workspace/db";
import { isUrgentDeadline, serverTodayKey } from "./dates";
import { GROUP_EXPIRING_ACTIONABLE_STATUSES } from "../routes/dashboard";
import { emitStateEvent } from "./state-events";
import { logger } from "./logger";

export interface UrgentSnapshot {
  urgentCount: number;
  totalActionable: number;
  byStatus: Record<string, number>;
  // Set of group IDs that are currently urgent. Lets the transitions
  // endpoint reuse this without a second query.
  urgentGroupIds: number[];
  // The ET-anchored "today" key the snapshot is computed against. Same
  // value `serverTodayKey` returns; embedded here so callers/snapshots
  // record the day the count belongs to.
  todayKey: string;
}

interface ActionableRow {
  id: number;
  status: string;
  earliestDate: string | null;
}

async function loadActionableRows(): Promise<ActionableRow[]> {
  // Read the typed, indexed `invoice_groups.service_date` column
  // directly — no JOIN, no GROUP BY, no per-request MIN(). The column
  // is the canonical source maintained by `recomputeGroupServiceDate`
  // (lib/group-service-date.ts) on every write path; see Task #350.
  // `to_char` keeps the wire shape stable as ISO YYYY-MM-DD regardless
  // of whether the `pg` driver returns `date` columns as Date or string.
  const rows = await db
    .select({
      id: invoiceGroupsTable.id,
      status: invoiceGroupsTable.status,
      earliestDate: sql<string | null>`to_char(${invoiceGroupsTable.serviceDate}, 'YYYY-MM-DD')`,
    })
    .from(invoiceGroupsTable)
    .where(
      and(
        inArray(invoiceGroupsTable.status, [...GROUP_EXPIRING_ACTIONABLE_STATUSES]),
        isNotNull(invoiceGroupsTable.serviceDate),
      ),
    );
  return rows;
}

/**
 * Compute the "must file today" snapshot from a single read of the
 * actionable groups. `now` is accepted for deterministic testing; in
 * production it defaults to the current ET instant.
 */
export async function computeUrgentSnapshot(now: Date = new Date()): Promise<UrgentSnapshot> {
  const rows = await loadActionableRows();
  const todayKey = serverTodayKey(now);

  const byStatus: Record<string, number> = {};
  const urgentGroupIds: number[] = [];
  let urgentCount = 0;

  for (const row of rows) {
    if (isUrgentDeadline(row.earliestDate, now)) {
      urgentCount++;
      urgentGroupIds.push(row.id);
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    }
  }

  return {
    urgentCount,
    totalActionable: rows.length,
    byStatus,
    urgentGroupIds,
    todayKey,
  };
}

/**
 * Compute the urgent snapshot and append it to `state_events` under the
 * key `dashboard_urgent_snapshot`. Fire-and-forget — never throws,
 * never blocks the caller. The cron firings (hourly + before each
 * batch sweep + before the daily brief) all call this; the snapshots
 * back the inline sparkline rendered next to the "File today" hero.
 *
 * Returns the snapshot it wrote so a caller can both record AND read in
 * one shot (used by the transitions endpoint when no snapshot exists
 * yet for the current day).
 */
export async function snapshotUrgentCounts(now: Date = new Date()): Promise<UrgentSnapshot | null> {
  try {
    const snap = await computeUrgentSnapshot(now);
    await emitStateEvent({
      eventKey: "dashboard_urgent_snapshot",
      metadata: {
        urgentCount: snap.urgentCount,
        totalActionable: snap.totalActionable,
        byStatus: snap.byStatus,
        todayKey: snap.todayKey,
      },
    });
    return snap;
  } catch (err) {
    // The snapshot is observability — never let it break the caller.
    logger.warn({ err }, "snapshotUrgentCounts failed (swallowed)");
    return null;
  }
}
