// Single source of truth for the cron schedules registered in `index.ts`
// and reasoned about by the System Health rollup, the worker-activity API,
// the dashboard worker tile, and the Portal Submissions queue-status pill.
//
// Everything that needs to know "when does the portal batch sweeper next
// fire?" or "what's our canonical cron expression for X?" must import the
// constants here rather than duplicating the cron string. Drift between
// what actually fires and what the UI claims will fire was the original
// source of the cycle-aware overdue bug — keep it locked down to one place.

import { CronExpressionParser } from "cron-parser";

export interface CronJobSchedule {
  name: string;
  cron: string;
  tz: string;
  // Optional override for the System Health rollup's missed-tick
  // tolerance. The default (DEFAULT_MISSED_TICK_THRESHOLD) treats a
  // single skipped fire as a transient blip — fine for jobs that fire
  // every few minutes. Sweeps that fire only a handful of times per day
  // (like portal_batch_sweeper at 8/11/14/18 ET) cannot afford that
  // tolerance: a single missed fire IS the alert.
  missedTickThreshold?: number;
}

export const PORTAL_BATCH_SWEEPER: CronJobSchedule = {
  name: "portal_batch_sweeper",
  cron: "0 8,11,14,18 * * 1-5",
  tz: "America/New_York",
  // Lower than the global default of 2 because the worker-overdue rule
  // only flags rows when this sweep actually ran (per cron_runs); if we
  // tolerated one missed sweep here, the worker tile and cron tile could
  // both stay green even with stale pending submissions on the floor.
  missedTickThreshold: 1,
};

export const DAILY_BRIEF: CronJobSchedule = {
  name: "daily_brief",
  cron: "0 7 * * 1-5",
  tz: "America/New_York",
};

// Deterministic post-send bounce recheck. Fires 15m after DAILY_BRIEF
// so bounce-backs have time to land + be ingested. Downgrades the prior
// "ok" daily_brief run to "degraded" when the spike thresholds trip.
export const DAILY_BRIEF_BOUNCE_RECHECK: CronJobSchedule = {
  name: "daily_brief_bounce_recheck",
  cron: "15 7 * * 1-5",
  tz: "America/New_York",
};

export const RESPONSE_TRACKER: CronJobSchedule = {
  name: "response_tracker",
  cron: "*/30 8-18 * * 1-5",
  tz: "America/New_York",
};

export const OUTLOOK_HEARTBEAT: CronJobSchedule = {
  name: "outlook_heartbeat",
  cron: "*/15 * * * *",
  tz: "America/New_York",
};

export const STUCK_SUBMISSION_RESET: CronJobSchedule = {
  name: "stuck_submission_reset",
  cron: "*/30 * * * *",
  tz: "America/New_York",
};

// Hourly during the office's working hours (8am – 8pm ET). Records a
// `dashboard_urgent_snapshot` state_event so the Dashboard's "File
// today" hero and the Queue's urgency hero can render an inline
// sparkline of how the count evolves over the day. See Task #298.
export const URGENT_SNAPSHOT: CronJobSchedule = {
  name: "urgent_snapshot",
  cron: "0 8-20 * * *",
  tz: "America/New_York",
};

// Nightly Expired sweep. Fires once at 1 AM ET so eligible rows are
// retired before the office opens — operators see a clean "today"
// queue when they sit down. Past-due rows remain visible (badged
// red) between the moment their effective deadline lands today and
// the next morning's sweep, by design (see `lib/expired-sweep.ts`).
export const EXPIRED_SWEEP: CronJobSchedule = {
  name: "expired_sweep",
  cron: "0 1 * * *",
  tz: "America/New_York",
};

export const KNOWN_CRON_JOBS: CronJobSchedule[] = [
  PORTAL_BATCH_SWEEPER,
  DAILY_BRIEF,
  DAILY_BRIEF_BOUNCE_RECHECK,
  RESPONSE_TRACKER,
  OUTLOOK_HEARTBEAT,
  STUCK_SUBMISSION_RESET,
  URGENT_SNAPSHOT,
  EXPIRED_SWEEP,
];

// Default grace window between a scheduled sweep firing and the moment we
// consider a still-pending row "past its expected batch cycle". 5 minutes
// is enough room for the Playwright run to start and drain the queue
// without flapping the System Health banner on every sweep boundary.
export const DEFAULT_OVERDUE_GRACE_MINUTES = 5;

/**
 * Returns the most recent scheduled fire time for `schedule` whose firing
 * was at least `graceMs` before `now`. Used by the cycle-aware overdue
 * rule: any pending row that became ready at or before this timestamp
 * "should" have been picked up by that sweep.
 *
 * Returns `null` if the cron expression has no fire times before `now` in
 * the lookback window (e.g. the schedule literally hasn't fired yet on
 * this calendar — the helper walks back up to 14 days).
 */
export function getLastDueSweep(
  now: Date,
  schedule: CronJobSchedule,
  graceMs: number,
): Date | null {
  // Walk backwards from `now` and return the first fire that is at least
  // `graceMs` in the past. We loop because in principle the very latest
  // fire could be inside the grace window — in practice the sweeper fires
  // hours apart so the first iteration nearly always matches, but keeping
  // the loop bounded by a generous cap keeps the contract honest.
  try {
    const it = CronExpressionParser.parse(schedule.cron, {
      tz: schedule.tz,
      currentDate: now,
    });
    for (let i = 0; i < 64; i += 1) {
      const fire = it.prev().toDate();
      if (fire.getTime() + graceMs <= now.getTime()) return fire;
    }
  } catch {
    // Fall through and return null on a malformed cron; callers treat
    // null as "no overdue rows".
  }
  return null;
}

/**
 * Convenience wrapper that returns the most recent and the next scheduled
 * fire times for `schedule`, used by the worker-activity API to render
 * "next sweep in 2m" / "last sweep was 18m ago" labels.
 */
export function getSweepBoundaries(
  now: Date,
  schedule: CronJobSchedule,
): { prev: Date | null; next: Date | null } {
  let prev: Date | null = null;
  let next: Date | null = null;
  try {
    const itNext = CronExpressionParser.parse(schedule.cron, {
      tz: schedule.tz,
      currentDate: now,
    });
    next = itNext.next().toDate();
  } catch {
    next = null;
  }
  try {
    const itPrev = CronExpressionParser.parse(schedule.cron, {
      tz: schedule.tz,
      currentDate: now,
    });
    prev = itPrev.prev().toDate();
  } catch {
    prev = null;
  }
  return { prev, next };
}
