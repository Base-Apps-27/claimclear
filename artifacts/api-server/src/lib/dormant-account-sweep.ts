// Nightly dormant-account sweep.
//
// Task #880. Walks every user whose status is "approved" and whose
// `last_login_at` is older than the configured threshold (default 60
// days, overridable in app_settings via `dormant_auto_pause_days`)
// and flips them to status="paused". A pause is reversible — an
// admin clicking Approve on the paused row in Settings sets status
// back to "approved" and nulls `pausedAt`.
//
// The sweep is idempotent: re-running it on a database with no
// newly-eligible rows is a cheap no-op, and rows already in
// status="paused" or status="denied" are never touched.
//
// Every paused row writes a canonical `account_auto_paused` audit
// log entry so the activity feed shows who/when/why, and the daily
// brief reads either the `pausedAt >= now-24h` recency window or
// these audit rows to surface "Paused overnight" to admins.
//
// Disabling: setting `dormant_auto_pause_enabled` = "false" in
// app_settings short-circuits the sweep. The cron still records a
// cron_runs row (so System Health stays green) with a message that
// reflects the disabled state.

import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db, usersTable, auditLogsTable, appSettingsTable } from "@workspace/db";
import { logger } from "./logger";

export const DEFAULT_DORMANT_PAUSE_DAYS = 60;
export const MIN_DORMANT_PAUSE_DAYS = 7;
export const MAX_DORMANT_PAUSE_DAYS = 365;

export interface DormantSweepResult {
  /** Whether the feature is enabled (false → sweep was a no-op). */
  enabled: boolean;
  /** Threshold (in days) used for this run. */
  thresholdDays: number;
  /** Number of users transitioned approved → paused this run. */
  paused: number;
  /** Sample of paused user ids/emails for the audit toast + brief. */
  sample: Array<{ id: string; email: string | null; lastLoginAt: string | null }>;
  /** Dry-run flag echo. */
  dryRun: boolean;
}

export interface DormantSweepOptions {
  /** Operator/system actor identifying the sweep in the audit row. */
  actorUserEmail?: string | null;
  actorUserName?: string | null;
  /** When true, identify eligible rows but do not transition them. */
  dryRun?: boolean;
  /**
   * Override the threshold without reading app_settings (used by the
   * admin "Run now" button when previewing a different value).
   */
  thresholdDaysOverride?: number;
  /** Override the enabled flag (admin button always runs even if disabled). */
  forceEnabled?: boolean;
}

interface ResolvedSettings {
  enabled: boolean;
  thresholdDays: number;
}

export async function readDormantSettings(): Promise<ResolvedSettings> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable);
  const map = new Map(rows.map((r) => [r.key, r.value] as const));
  const rawEnabled = map.get("dormant_auto_pause_enabled");
  const enabled = rawEnabled == null ? true : rawEnabled !== "false";
  const rawDays = map.get("dormant_auto_pause_days");
  const parsed = rawDays == null ? NaN : Number(rawDays);
  const thresholdDays = Number.isFinite(parsed) && parsed >= MIN_DORMANT_PAUSE_DAYS
    ? Math.min(MAX_DORMANT_PAUSE_DAYS, Math.floor(parsed))
    : DEFAULT_DORMANT_PAUSE_DAYS;
  return { enabled, thresholdDays };
}

export async function sweepDormantAccounts(
  opts: DormantSweepOptions = {},
): Promise<DormantSweepResult> {
  const settings = await readDormantSettings();
  const enabled = opts.forceEnabled ?? settings.enabled;
  const thresholdDays = opts.thresholdDaysOverride ?? settings.thresholdDays;
  const dryRun = !!opts.dryRun;

  if (!enabled) {
    return {
      enabled: false,
      thresholdDays,
      paused: 0,
      sample: [],
      dryRun,
    };
  }

  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

  const eligible = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      lastLoginAt: usersTable.lastLoginAt,
    })
    .from(usersTable)
    .where(and(
      eq(usersTable.status, "approved"),
      isNotNull(usersTable.lastLoginAt),
      lt(usersTable.lastLoginAt, cutoff),
    ));

  if (eligible.length === 0 || dryRun) {
    return {
      enabled: true,
      thresholdDays,
      paused: 0,
      sample: eligible.slice(0, 10).map((u) => ({
        id: u.id,
        email: u.email,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      })),
      dryRun,
    };
  }

  const now = new Date();
  let paused = 0;
  const sample: DormantSweepResult["sample"] = [];

  for (const u of eligible) {
    try {
      const [updated] = await db
        .update(usersTable)
        .set({ status: "paused", pausedAt: now, updatedAt: now })
        .where(and(eq(usersTable.id, u.id), eq(usersTable.status, "approved")))
        .returning({ id: usersTable.id });
      if (!updated) continue;
      paused += 1;
      if (sample.length < 10) {
        sample.push({
          id: u.id,
          email: u.email,
          lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        });
      }
      const lastLoginLabel = u.lastLoginAt
        ? `last sign-in ${u.lastLoginAt.toISOString().slice(0, 10)}`
        : "never signed in";
      await db.insert(auditLogsTable).values({
        action: "account_auto_paused",
        details: `Auto-paused ${u.email ?? u.id} for inactivity (${lastLoginLabel}, threshold ${thresholdDays}d).`,
        metadata: {
          targetUserId: u.id,
          targetUserEmail: u.email,
          lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
          thresholdDays,
          previousStatus: "approved",
          nextStatus: "paused",
        },
        userEmail: opts.actorUserEmail ?? null,
        userName: opts.actorUserName ?? "Dormant account sweep",
      });
    } catch (err) {
      logger.error({ err, userId: u.id }, "[DORMANT SWEEP] failed to pause user");
    }
  }

  return {
    enabled: true,
    thresholdDays,
    paused,
    sample,
    dryRun: false,
  };
}

/**
 * Reads the rows paused inside the recency window. Used by the daily
 * brief to surface "Accounts paused overnight" to admins.
 */
export async function getRecentlyPausedUsers(
  withinMs: number,
): Promise<Array<{ id: string; email: string | null; pausedAt: Date; lastLoginAt: Date | null }>> {
  const since = new Date(Date.now() - withinMs);
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      pausedAt: usersTable.pausedAt,
      lastLoginAt: usersTable.lastLoginAt,
    })
    .from(usersTable)
    .where(and(
      eq(usersTable.status, "paused"),
      isNotNull(usersTable.pausedAt),
      sql`${usersTable.pausedAt} >= ${since.toISOString()}`,
    ));
  return rows
    .filter((r): r is typeof r & { pausedAt: Date } => r.pausedAt !== null)
    .sort((a, b) => b.pausedAt.getTime() - a.pausedAt.getTime());
}
