// Shared cycle-aware overdue check used by the System Health rollup, the
// admin worker-activity endpoint, and the dashboard worker tile. Lives in
// one place so all three callers reason about the exact same definition
// of "this row missed its expected batch cycle".

import { db } from "@workspace/db";
import { cronRunsTable, portalSubmissionsTable } from "@workspace/db";
import { and, count, desc, eq, isNull, lt, or } from "drizzle-orm";

import {
  DEFAULT_OVERDUE_GRACE_MINUTES,
  PORTAL_BATCH_SWEEPER,
  getLastDueSweep,
} from "./cron-schedule";

// Default grace window after a scheduled sweep fires before still-pending
// rows are flagged as past their cycle.
export const OVERDUE_GRACE_MINUTES = DEFAULT_OVERDUE_GRACE_MINUTES;

// Tolerance for "did the sweep actually run at-or-after its scheduled
// fire?". 60 seconds covers cron-parser rounding and clock skew without
// making the worker tile flap when a run starts a handful of seconds
// late.
const SWEEP_RUN_TOLERANCE_MS = 60 * 1000;

export interface OverdueQueryInputs {
  // Most recent expected sweep that already had its grace window. Null
  // when no past sweep has had time to run yet (e.g. brand-new server,
  // or before any business-day fire has occurred).
  lastDueSweep: Date | null;
  // `startedAt` of the most recent recorded `portal_batch_sweeper` cron
  // run, or null if the sweeper has never been recorded.
  lastSweepRunStartedAt: Date | null;
  // True iff a sweep run has actually started at or after `lastDueSweep`
  // (within tolerance). When false, the cron-tile rollup already flags
  // the missed sweep, so callers should treat overdueCount as 0 to avoid
  // double-counting on the worker tile.
  canFlag: boolean;
  // Application-side cutoff to feed into the SQL filter. Equal to
  // `lastDueSweep` when present; null when nothing can be flagged.
  cutoff: Date | null;
}

export async function resolveOverdueQueryInputs(now: Date): Promise<OverdueQueryInputs> {
  const lastDueSweep = getLastDueSweep(
    now,
    PORTAL_BATCH_SWEEPER,
    OVERDUE_GRACE_MINUTES * 60 * 1000,
  );

  // Single source of truth for "did the sweep have its chance" — a row in
  // `cron_runs`, not elapsed time, so we never disagree with what was
  // actually recorded.
  const [lastSweepRun] = await db
    .select({ startedAt: cronRunsTable.startedAt })
    .from(cronRunsTable)
    .where(eq(cronRunsTable.jobName, PORTAL_BATCH_SWEEPER.name))
    .orderBy(desc(cronRunsTable.startedAt))
    .limit(1);
  const lastSweepRunStartedAt = lastSweepRun?.startedAt ?? null;

  if (lastDueSweep === null) {
    return { lastDueSweep: null, lastSweepRunStartedAt, canFlag: false, cutoff: null };
  }
  const canFlag =
    lastSweepRunStartedAt !== null &&
    lastSweepRunStartedAt.getTime() + SWEEP_RUN_TOLERANCE_MS >= lastDueSweep.getTime();
  return { lastDueSweep, lastSweepRunStartedAt, canFlag, cutoff: lastDueSweep };
}

export async function countOverdueRows(cutoff: Date): Promise<number> {
  // Mirrors `isSubmissionOverdue`: a row is overdue when
  // `max(createdAt, nextRetryAt ?? createdAt) < cutoff` (strictly before
  // — a row created exactly at the sweep timestamp could have been
  // picked up by that sweep and we don't punish it on the boundary).
  // Expanded to a SQL-friendly form: createdAt strictly before cutoff
  // AND (no scheduled retry, or that retry is strictly before cutoff).
  // The createdAt clause guards the rare clock-skew/backfill case where
  // nextRetryAt < createdAt and would otherwise let a freshly-created
  // row look overdue.
  const [{ value } = { value: 0 }] = await db
    .select({ value: count() })
    .from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.status, "pending"),
      lt(portalSubmissionsTable.createdAt, cutoff),
      or(
        isNull(portalSubmissionsTable.nextRetryAt),
        lt(portalSubmissionsTable.nextRetryAt, cutoff),
      ),
    ));
  return value;
}

/**
 * Convenience wrapper: returns the cycle-aware overdue count for the
 * portal worker, applying the "sweep actually ran" gate. Callers that
 * also need the schedule context (lastSweepAt, etc.) should use
 * `resolveOverdueQueryInputs` directly.
 */
export async function getOverdueCount(now: Date): Promise<number> {
  const inputs = await resolveOverdueQueryInputs(now);
  if (!inputs.canFlag || inputs.cutoff === null) return 0;
  return countOverdueRows(inputs.cutoff);
}
