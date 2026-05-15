// Server-emitted streak celebrations (Task #780, D).
//
// Two pulses ride on the existing `system_update` SSE channel:
//
//   • `submission_streak` — every multiple of 5 portal submissions
//     confirmed today (across the team).
//   • `approval_streak`   — every multiple of 3 payor responses tagged
//     Approved / Partially Approved today (across the team).
//
// "Today" is the operator's local calendar day pinned to the team's
// working timezone (`America/New_York`) so the count flips at the
// same midnight every operator's daily-brief flips at. Pinning the
// timezone avoids an awkward race where the server's UTC `today`
// would drop out from under a 9pm ET submission.
//
// The pulse is ALWAYS computed against the post-write count: routes
// call `tryEmitSubmissionStreak()` / `tryEmitApprovalStreak()` AFTER
// they've written their state change so the count reflects reality.
// Any error inside the helper is swallowed — celebrations are
// best-effort and must never fail an operator-facing mutation.
//
// Dedup is implicit: each pulse fires on a distinct count threshold
// (5, 10, 15, ...) and the count is monotonic across the day, so
// the same threshold can never be re-emitted within a calendar day
// even under retries. The client also dedups on `${type}:${timestamp}`
// to suppress accidental SSE replays during reconnect.

import { sql } from "drizzle-orm";
import { db, portalSubmissionsTable, portalResponsesTable } from "@workspace/db";
import { broadcastSystemEvent } from "./sse";
import { logger } from "./logger";

const SUBMISSION_STREAK_STEP = 5;
const APPROVAL_STREAK_STEP = 3;

// Edge-trigger memory: per-pulse-type, the highest threshold we've
// already broadcast today. The streak-counting queries are NOT
// monotonic under retries (a retried tag updates the same row;
// the count can stay flat). Without this guard, every retry of a
// tag while the count is sitting on a multiple of N would re-fire
// the same threshold and spam every connected tab.
//
// Memory is in-process on purpose: an api-server restart is rare
// enough that at most ONE duplicate pulse per restart per
// threshold-already-crossed-today is acceptable, and the alternative
// (a DB-backed emitted-thresholds table) would require a migration
// for a strictly-best-effort celebration channel. The map is keyed
// by date so the midnight rollover wipes naturally; we also sweep
// stale dates on every emit to keep the map bounded.
const lastEmittedByType = new Map<string, { date: string; threshold: number }>();

function todayKeyET(): string {
  // ISO YYYY-MM-DD in America/New_York. Matches the SQL window the
  // count queries use so the per-day reset lines up with the count
  // reset itself.
  const d = new Date();
  // `en-CA` returns YYYY-MM-DD by default; the locale is just a
  // formatting trick for ISO-shaped output.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function shouldEmit(pulseType: string, count: number, step: number): boolean {
  if (count <= 0 || count % step !== 0) return false;
  const today = todayKeyET();
  const prev = lastEmittedByType.get(pulseType);
  if (prev && prev.date === today && prev.threshold >= count) {
    // Already broadcast this (or higher) threshold today — short-
    // circuit. Covers the retry-tag-on-flat-count case the architect
    // flagged in #780 review.
    return false;
  }
  lastEmittedByType.set(pulseType, { date: today, threshold: count });
  return true;
}

// Postgres expression for "midnight today in America/New_York,
// projected back to UTC for comparison against UTC-stored timestamps."
//
// Reads as: take `now()` (UTC), project it into ET wall-clock,
// truncate to day, then convert that wall-clock midnight back to a
// UTC instant. Compared against `created_at` (UTC, default) or
// `updated_at` (UTC, default) this captures every row stamped after
// the team's local midnight, regardless of the server's host TZ.
const ET_TODAY_START_SQL = sql`(date_trunc('day', (now() AT TIME ZONE 'America/New_York'))::timestamp AT TIME ZONE 'America/New_York')`;

async function countTodaySubmissionsConfirmed(): Promise<number> {
  // Count submissions whose lifecycle has progressed past `draft` —
  // anything in `pending`, `submitted`, `confirmed`, or post-confirm
  // states represents real shipped work. Drafts are excluded so a
  // half-built submission an operator abandoned can't game the
  // streak. `created_at` is the right anchor because /portal-
  // submissions inserts the row at the moment of submit; nothing
  // later in the lifecycle moves it.
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM ${portalSubmissionsTable}
    WHERE ${portalSubmissionsTable.createdAt} >= ${ET_TODAY_START_SQL}
      AND ${portalSubmissionsTable.status} <> 'draft'
      AND ${portalSubmissionsTable.status} <> 'cancelled'
  `);
  const row = (result.rows ?? [])[0] as { count?: number } | undefined;
  return row?.count ?? 0;
}

async function countTodayApprovalsTagged(): Promise<number> {
  // Approvals = responses tagged `approval` or `partial_approval` and
  // marked `processed` today. `updated_at` is the anchor because the
  // tagging step IS an update — the email itself may have arrived
  // yesterday, but the moment the operator (or AI) tagged it as an
  // approval is what crosses the streak threshold.
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM ${portalResponsesTable}
    WHERE ${portalResponsesTable.processed} = TRUE
      AND ${portalResponsesTable.responseType} IN ('approval', 'partial_approval')
      AND ${portalResponsesTable.updatedAt} >= ${ET_TODAY_START_SQL}
  `);
  const row = (result.rows ?? [])[0] as { count?: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Counts today's confirmed submissions and emits a `submission_streak`
 * SSE pulse if the count is a positive multiple of 5. Safe to call
 * from any post-write code path; never throws — failures are logged
 * and swallowed so a celebration miss can't cascade into a 500 on
 * the operator's submit click.
 *
 * Call AFTER the row insert + transition completes.
 */
export async function tryEmitSubmissionStreak(): Promise<void> {
  try {
    const count = await countTodaySubmissionsConfirmed();
    if (!shouldEmit("submission_streak", count, SUBMISSION_STREAK_STEP)) return;
    broadcastSystemEvent({
      type: "submission_streak",
      count,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn({ err }, "tryEmitSubmissionStreak failed (non-fatal)");
  }
}

/**
 * Counts today's approval/partial-approval tagged responses and emits
 * an `approval_streak` SSE pulse if the count is a positive multiple
 * of 3. Same non-fatal contract as `tryEmitSubmissionStreak`.
 *
 * Call AFTER the response row update + downstream group/claim
 * transition completes.
 */
export async function tryEmitApprovalStreak(): Promise<void> {
  try {
    const count = await countTodayApprovalsTagged();
    if (!shouldEmit("approval_streak", count, APPROVAL_STREAK_STEP)) return;
    broadcastSystemEvent({
      type: "approval_streak",
      count,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn({ err }, "tryEmitApprovalStreak failed (non-fatal)");
  }
}

/**
 * Test-only — clear the in-process emitted-threshold memory so each
 * test case starts from a clean slate. Importing from product code
 * is a smell.
 */
export function __resetStreakPulseMemoryForTests(): void {
  lastEmittedByType.clear();
}
