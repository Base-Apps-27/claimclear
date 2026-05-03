// Nightly "Expired" sweep.
//
// Walks every invoice group whose status is in the pre-submit
// `GROUP_EXPIRABLE_STATUSES` set and whose effective filing deadline
// (service_date + 30 days, weekend-shifted to the prior Friday) is
// strictly before today in America/New_York, and transitions each
// row to status="Expired" through the standard `transitionGroupStatus`
// path. That path:
//   - cascades the new status down to every disputed leg via
//     `syncChildRides` (Expired children inherit from the group)
//   - writes the canonical `group_status_changed` audit row preserving
//     the previous status in metadata
//   - fires the broadcast/SSE event so any open client view refreshes
//
// `systemOverride: true` is required because:
//   - Generating Email is a SYSTEM_CONTROLLED_GROUP_STATUSES member
//     (cannot be set manually) but a row stuck in that status past
//     the deadline IS by definition the kind of dead row Expired was
//     designed to catch.
//   - the per-status manual transition map only allows Expired from a
//     subset of pre-submit statuses; the override skips that check
//     because the sweep itself is the authority on eligibility.
//
// Source: invoked by both the nightly cron (6 AM ET, registered in
// `index.ts`) and the admin button (`POST /api/admin/expired-sweep`).
// The function is idempotent — re-running it on a database with no
// newly-eligible rows is a cheap no-op.

import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { invoiceGroupsTable } from "@workspace/db";
import { logger } from "./logger";
import {
  GROUP_EXPIRABLE_STATUSES,
  transitionGroupStatus,
  type GroupTransitionActor,
} from "./group-transitions";

export interface ExpiredSweepResult {
  /** Number of groups transitioned to Expired in this run. */
  expired: number;
  /** Per-source-status breakdown so the admin button can show what was retired. */
  byStatus: Record<string, number>;
  /** Sample of the first few group ids transitioned (for the audit toast). */
  sampleGroupIds: number[];
  /** Number of groups skipped due to a transition error (e.g. mid-flight submission). */
  skipped: number;
  /** Dry-run flag echo so the caller can label its UI without re-passing. */
  dryRun: boolean;
}

export interface SweepOptions {
  actor: GroupTransitionActor;
  /** Source string written to the audit row. */
  source: string;
  /** Reason string written to the audit row + status-change note. */
  reason?: string;
  /** When true, identify eligible rows but do not transition them. */
  dryRun?: boolean;
  /**
   * Maximum number of groups to transition per run. Defensive cap so a
   * runaway sweep cannot lock the DB for minutes. The cron will catch
   * any leftovers on the next tick. Defaults to 1000 — well above the
   * realistic per-day eligible count.
   */
  limit?: number;
}

const DEFAULT_REASON =
  "Filing deadline passed with no submission — auto-retired by the nightly Expired sweep.";

/**
 * SQL-side eligibility predicate. Mirrors the JS `isAtOrPastEffectiveDeadline`
 * but uses `<` instead of `<=` so a group whose deadline lands TODAY stays
 * visible (and badged red) for one final business day before the sweep
 * retires it on the next morning's run. This matches the user spec:
 * "past-due rows stay visible until the next sweep fires".
 */
function eligibleWhereClause() {
  const dateExpr = sql`${invoiceGroupsTable.serviceDate}`;
  const effectiveDeadline = sql`(
    CASE EXTRACT(DOW FROM (${dateExpr} + INTERVAL '30 days'))
      WHEN 6 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '1 day')::date
      WHEN 0 THEN ((${dateExpr} + INTERVAL '30 days')::date - INTERVAL '2 days')::date
      ELSE (${dateExpr} + INTERVAL '30 days')::date
    END
  )`;
  return and(
    isNotNull(invoiceGroupsTable.serviceDate),
    or(...GROUP_EXPIRABLE_STATUSES.map((s) => eq(invoiceGroupsTable.status, s))),
    // Strictly before today (ET) — see comment above on the boundary
    // choice. CURRENT_DATE in the API process is interpreted in the
    // session timezone, which the API pins to ET via the `TZ` env var
    // (the same convention the dashboard date helpers rely on).
    lt(effectiveDeadline, sql`CURRENT_DATE`),
  );
}

export async function findExpiredEligibleGroupIds(limit = 1000): Promise<
  Array<{ id: number; status: string }>
> {
  const where = eligibleWhereClause();
  const rows = await db
    .select({
      id: invoiceGroupsTable.id,
      status: invoiceGroupsTable.status,
    })
    .from(invoiceGroupsTable)
    .where(where)
    .limit(limit);
  return rows;
}

export async function sweepExpiredGroups(opts: SweepOptions): Promise<ExpiredSweepResult> {
  const { actor, source, reason = DEFAULT_REASON, dryRun = false, limit = 1000 } = opts;

  const eligible = await findExpiredEligibleGroupIds(limit);
  const byStatus: Record<string, number> = {};
  const sampleGroupIds: number[] = [];
  let expired = 0;
  let skipped = 0;

  if (dryRun) {
    for (const row of eligible) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      if (sampleGroupIds.length < 10) sampleGroupIds.push(row.id);
    }
    return { expired: eligible.length, byStatus, sampleGroupIds, skipped: 0, dryRun: true };
  }

  for (const row of eligible) {
    try {
      await transitionGroupStatus({
        groupId: row.id,
        newStatus: "Expired",
        source,
        reason,
        actor,
        // Required: see header comment. The sweep is the authority on
        // eligibility (the JOIN above already enforced the predicate),
        // so skip the per-status manual transition guard.
        systemOverride: true,
      });
      expired += 1;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      if (sampleGroupIds.length < 10) sampleGroupIds.push(row.id);
    } catch (err) {
      // Most likely cause: a portal submission flipped to in_progress
      // between the SELECT and the UPDATE. The `checkActiveSubmissions`
      // guard inside `transitionGroupStatus` will throw — we record the
      // skip and let the next sweep tick catch it.
      skipped += 1;
      logger.warn(
        { err, groupId: row.id, status: row.status },
        "Expired sweep: skipped group due to transition error",
      );
    }
  }

  return { expired, byStatus, sampleGroupIds, skipped, dryRun: false };
}
