import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { cronRunsTable, connectorHealthTable, emailBouncesTable, portalSubmissionsTable, portalResponsesTable, outboundEmailsTable } from "@workspace/db";
import { desc, gte, sql, eq, and, or, isNull, lte, count, inArray } from "drizzle-orm";
import {
  computeClassifierStats,
  type ClassifierStatsRow,
} from "../lib/classifier-stats";
import type { ClassifiedDecision } from "../lib/inbound-email-classifier";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";
import { denyClerk } from "../middlewares/denyClerk";
import { CronExpressionParser } from "cron-parser";
import { logger } from "../lib/logger";
import {
  getLastWorkerRun,
  getRecentWorkerRuns,
  isWorkerRunInProgress,
  getRetriesSuppressedCount,
} from "../lib/batch-processor";
import { computeRollup, type CronRunRow } from "../lib/system-health-rollup";
import { safeRunServiceDateDriftCheck } from "../lib/group-service-date";
import { getBootTime } from "../lib/boot-time";
import { enumerateExpectedFiresSinceBoot } from "../lib/cron-fire-enumeration";
import {
  KNOWN_CRON_JOBS,
  PORTAL_BATCH_SWEEPER,
  PORTAL_RESPONSE_SYNC,
  RESPONSE_TRACKER,
  getSweepBoundaries,
} from "../lib/cron-schedule";
import {
  OVERDUE_GRACE_MINUTES,
  resolveOverdueQueryInputs,
  countOverdueRows,
} from "../lib/overdue-submissions";

const router: IRouter = Router();

// Locked cron schedules — imported from the shared module that the actual
// `cron.schedule(...)` registrations in index.ts also use, so the rollup
// can never reason about a cron string that drifted from what's running.
const KNOWN_JOBS = KNOWN_CRON_JOBS;

router.get("/admin/system-health/cron-runs", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const runs = await db
    .select()
    .from(cronRunsTable)
    .where(gte(cronRunsTable.startedAt, sevenDaysAgo))
    .orderBy(desc(cronRunsTable.startedAt))
    .limit(500);

  const jobMap = new Map<string, {
    jobName: string;
    cron: string | null;
    nextRunAt: string | null;
    lastRun: { startedAt: string; finishedAt: string | null; status: string; message: string | null } | null;
    successRate7d: number;
    runs7d: number;
    failures7d: number;
    recent: { id: number; startedAt: string; finishedAt: string | null; status: string; message: string | null }[];
  }>();

  const computeNext = (cron: string, tz: string): string | null => {
    try {
      const i = CronExpressionParser.parse(cron, { tz });
      return i.next().toDate().toISOString();
    } catch (err) {
      logger.warn({ err, cron, tz }, "Failed to parse cron expression");
      return null;
    }
  };

  for (const known of KNOWN_JOBS) {
    jobMap.set(known.name, {
      jobName: known.name,
      cron: known.cron,
      nextRunAt: computeNext(known.cron, known.tz),
      lastRun: null,
      successRate7d: 0,
      runs7d: 0,
      failures7d: 0,
      recent: [],
    });
  }

  for (const r of runs) {
    if (!jobMap.has(r.jobName)) {
      jobMap.set(r.jobName, {
        jobName: r.jobName,
        cron: null,
        nextRunAt: null,
        lastRun: null,
        successRate7d: 0,
        runs7d: 0,
        failures7d: 0,
        recent: [],
      });
    }
    const entry = jobMap.get(r.jobName)!;
    entry.runs7d++;
    if (r.status === "failed") entry.failures7d++;
    if (entry.recent.length < 20) {
      entry.recent.push({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        status: r.status,
        message: r.message,
      });
    }
    if (!entry.lastRun) {
      entry.lastRun = {
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        status: r.status,
        message: r.message,
      };
    }
  }

  const jobs = Array.from(jobMap.values()).map((j) => ({
    ...j,
    successRate7d: j.runs7d > 0 ? Math.round(((j.runs7d - j.failures7d) / j.runs7d) * 100) : 0,
  }));

  res.json({ jobs });
}));

// Detail panel for the most recent brief cron_run (daily or weekly):
// joins the run to its per-recipient outbound_emails rows (success
// and failure) and any matching bounces in the recheck window.
//
// The same query/payload shape is used for both `daily_brief` and
// `weekly_digest`; the weekly route below is a thin wrapper so the
// admin UI gets a parallel drill-down for the weekly exec digest.
async function buildBriefDetail(
  jobName: "daily_brief" | "weekly_digest",
  res: import("express").Response,
): Promise<void> {
  const [lastRun] = await db
    .select()
    .from(cronRunsTable)
    .where(eq(cronRunsTable.jobName, jobName))
    .orderBy(desc(cronRunsTable.startedAt))
    .limit(1);

  if (!lastRun) {
    res.json({ lastRun: null, recipients: [] });
    return;
  }

  // Pull every outbound_emails row whose metadata.briefRunId matches this
  // run, OR (as a fallback for runs predating the briefRunId stamp) whose
  // sentAt is between the run's started_at and finished_at + small grace.
  // The metadata path is the primary key — the time-window fallback only
  // exists so the panel still renders something for runs from before this
  // migration shipped.
  const briefRunId = (lastRun.metadata as Record<string, unknown> | null)?.briefRunId as string | undefined;
  const startedAt = lastRun.startedAt;
  const windowEnd = lastRun.finishedAt ?? new Date(lastRun.startedAt.getTime() + 5 * 60 * 1000);

  const rows = await db
    .select({
      id: outboundEmailsTable.id,
      messageId: outboundEmailsTable.messageId,
      recipients: outboundEmailsTable.recipients,
      subject: outboundEmailsTable.subject,
      sentAt: outboundEmailsTable.sentAt,
      errorExcerpt: outboundEmailsTable.errorExcerpt,
      metadata: outboundEmailsTable.metadata,
    })
    .from(outboundEmailsTable)
    .where(and(
      eq(outboundEmailsTable.kind, "daily_brief"),
      briefRunId
        ? sql`${outboundEmailsTable.metadata} @> ${JSON.stringify({ briefRunId })}::jsonb`
        : and(
            gte(outboundEmailsTable.sentAt, startedAt),
            lte(outboundEmailsTable.sentAt, windowEnd),
          ),
    ))
    .orderBy(desc(outboundEmailsTable.sentAt))
    .limit(200);

  const recipients = rows.map((r) => {
    const meta = (r.metadata as Record<string, unknown> | null) ?? {};
    const recipientList = (Array.isArray(r.recipients) ? r.recipients : []) as string[];
    return {
      outboundId: r.id,
      email: recipientList[0] ?? "(unknown)",
      ok: r.errorExcerpt === null,
      messageId: r.messageId,
      errorExcerpt: r.errorExcerpt,
      roleVariant: typeof meta.roleVariant === "string" ? meta.roleVariant : null,
      sentAt: r.sentAt.toISOString(),
    };
  });

  // Bounce cross-link: pull bounces that landed in the recheck window
  // matching any recipient on this run, so the panel can flag rows that
  // bounced even though Graph reported the send as successful at the
  // time. Capped to keep the payload small.
  const recipientEmails = new Set(recipients.map((r) => r.email.toLowerCase()).filter((e) => e !== "(unknown)"));
  const bounceRows = recipientEmails.size > 0
    ? await db
        .select({
          id: emailBouncesTable.id,
          recipientEmail: emailBouncesTable.recipientEmail,
          subject: emailBouncesTable.subject,
          receivedAt: emailBouncesTable.receivedAt,
          rawExcerpt: emailBouncesTable.rawExcerpt,
        })
        .from(emailBouncesTable)
        .where(and(
          gte(emailBouncesTable.receivedAt, startedAt),
          lte(emailBouncesTable.receivedAt, new Date(startedAt.getTime() + 60 * 60 * 1000)),
        ))
        .orderBy(desc(emailBouncesTable.receivedAt))
        .limit(50)
    : [];
  const bounces = bounceRows
    .filter((b) => b.recipientEmail && recipientEmails.has(b.recipientEmail.toLowerCase()))
    .map((b) => ({
      id: b.id,
      recipientEmail: b.recipientEmail,
      subject: b.subject,
      receivedAt: b.receivedAt.toISOString(),
      rawExcerpt: b.rawExcerpt,
    }));

  const sentCount = recipients.filter((r) => r.ok).length;
  const failureCount = recipients.length - sentCount;

  res.json({
    lastRun: {
      id: lastRun.id,
      startedAt: lastRun.startedAt.toISOString(),
      finishedAt: lastRun.finishedAt?.toISOString() ?? null,
      status: lastRun.status,
      message: lastRun.message,
      metadata: lastRun.metadata,
    },
    recipients,
    bounces,
    sentCount,
    failureCount,
    recipientCount: recipients.length,
  });
}

router.get("/admin/system-health/daily-brief", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  await buildBriefDetail("daily_brief", res);
}));

// Task #738. Drill-down for the most recent `portal_response_sync`
// run — mirrors `buildBriefDetail` exactly: pull the cron_run, then
// pull every portal_submission whose `last_scraped_at` falls inside
// that run's window. The per-ticket rows include the outcome + error
// excerpt + invoice number / group id so the System Health "Last
// portal scrape" panel can render the same level of detail operators
// are used to seeing on the daily brief panel.
router.get("/admin/system-health/portal-scrape", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  const [lastRun] = await db
    .select()
    .from(cronRunsTable)
    .where(eq(cronRunsTable.jobName, "portal_response_sync"))
    .orderBy(desc(cronRunsTable.startedAt))
    .limit(1);

  if (!lastRun) {
    res.json({ lastRun: null, submissions: [] });
    return;
  }

  // Use the run window (started_at .. finished_at + 60s grace) to scope
  // which portal_submissions rows belong to this sweep. The per-row
  // `last_scraped_at` is stamped inside `syncPortalResponsesForSubmission`
  // for every ticket actually considered, so a window query is the
  // honest answer to "what did this run touch?".
  const startedAt = lastRun.startedAt;
  const windowEnd = lastRun.finishedAt
    ? new Date(lastRun.finishedAt.getTime() + 60 * 1000)
    : new Date(lastRun.startedAt.getTime() + 30 * 60 * 1000);

  const rows = await db
    .select({
      id: portalSubmissionsTable.id,
      invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
      invoiceNumber: portalSubmissionsTable.invoiceNumber,
      portalTicketId: portalSubmissionsTable.portalTicketId,
      lastScrapedAt: portalSubmissionsTable.lastScrapedAt,
      lastScrapeOutcome: portalSubmissionsTable.lastScrapeOutcome,
      lastScrapeError: portalSubmissionsTable.lastScrapeError,
    })
    .from(portalSubmissionsTable)
    .where(and(
      gte(portalSubmissionsTable.lastScrapedAt, startedAt),
      lte(portalSubmissionsTable.lastScrapedAt, windowEnd),
    ))
    .orderBy(desc(portalSubmissionsTable.lastScrapedAt))
    .limit(200);

  // Task #738. Cap the error-row list separately from the overall
  // submission list so a sweep that errored on hundreds of tickets
  // can still surface a meaningful "first N + (M more)" digest in
  // the panel without blowing up the payload. The total count is
  // returned alongside so the UI can render "+N more" overflow.
  const ERROR_CAP = 50;
  const allErrorRows = rows.filter((r) => r.lastScrapeOutcome === "error");
  const cappedErrorRows = allErrorRows.slice(0, ERROR_CAP);

  const submissions = rows.map((r) => ({
    submissionId: r.id,
    invoiceGroupId: r.invoiceGroupId,
    invoiceNumber: r.invoiceNumber,
    portalTicketId: r.portalTicketId,
    lastScrapedAt: r.lastScrapedAt?.toISOString() ?? null,
    outcome: r.lastScrapeOutcome,
    errorExcerpt: r.lastScrapeError,
  }));
  const errors = cappedErrorRows.map((r) => ({
    submissionId: r.id,
    invoiceGroupId: r.invoiceGroupId,
    invoiceNumber: r.invoiceNumber,
    portalTicketId: r.portalTicketId,
    lastScrapedAt: r.lastScrapedAt?.toISOString() ?? null,
    // Task #738: include `outcome` so this row matches the
    // PortalScrapeDetailRow shape (always "error" by construction —
    // the parent list is filtered on lastScrapeOutcome === "error").
    outcome: r.lastScrapeOutcome,
    errorExcerpt: r.lastScrapeError,
  }));
  const errorOverflow = Math.max(0, allErrorRows.length - cappedErrorRows.length);

  // Pull the run's metadata totals so the panel header can render
  // "19/25 scraped, 6 errored" without recomputing from per-row
  // outcome counts (which can drift if rows were re-scraped after
  // the run finished).
  const meta = (lastRun.metadata as Record<string, unknown> | null) ?? {};
  const considered = typeof meta.considered === "number" ? meta.considered : null;
  const scraped = typeof meta.scraped === "number" ? meta.scraped : null;
  const skipped = typeof meta.skipped === "number" ? meta.skipped : null;
  const errored = typeof meta.errored === "number" ? meta.errored : null;
  const newResponses = typeof meta.newResponses === "number" ? meta.newResponses : null;

  res.json({
    lastRun: {
      id: lastRun.id,
      startedAt: lastRun.startedAt.toISOString(),
      finishedAt: lastRun.finishedAt?.toISOString() ?? null,
      status: lastRun.status,
      message: lastRun.message,
    },
    considered,
    scraped,
    skipped,
    errored,
    newResponses,
    submissions,
    // Task #738. Capped error-row digest. `errors` contains at most
    // `ERROR_CAP` entries (most recent first); `errorOverflow` is
    // the number of additional error rows that exist but weren't
    // included so the UI can render a "+N more" affordance.
    errors,
    errorOverflow,
  });
}));

router.get("/admin/system-health/weekly-digest", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  await buildBriefDetail("weekly_digest", res);
}));

router.get("/admin/system-health/connectors", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(connectorHealthTable);
  res.json({
    connectors: rows.map((r) => ({
      connectorName: r.connectorName,
      status: r.status,
      lastCheckedAt: r.lastCheckedAt.toISOString(),
      lastError: r.lastError,
    })),
  });
}));

// Task #841. Per-bot health summary for the three risky surfaces:
// submit (portal_batch_sweeper), payor response scan (response_tracker),
// and portal scrape (portal_response_sync). Each card reads from
// `cron_runs` + the bot-specific queue source so System Health surfaces
// "what does each bot look like right now?" without operators having to
// piece it together from the Scheduled Jobs table.
type BotId = "submit" | "payor_response_scan" | "portal_scrape";

interface BotDef {
  id: BotId;
  label: string;
  jobName: string;
  queueLabel: string | null;
}

const BOT_DEFS: BotDef[] = [
  { id: "submit", label: "Submit", jobName: PORTAL_BATCH_SWEEPER.name, queueLabel: "due" },
  { id: "payor_response_scan", label: "Payor response scan", jobName: RESPONSE_TRACKER.name, queueLabel: null },
  { id: "portal_scrape", label: "Portal scrape", jobName: PORTAL_RESPONSE_SYNC.name, queueLabel: null },
];

const BOT_DEF_BY_ID: Record<BotId, BotDef> = Object.fromEntries(
  BOT_DEFS.map((b) => [b.id, b]),
) as Record<BotId, BotDef>;

// Truncate a long error to keep the card excerpt compact. Cron messages
// are sometimes multi-line stack traces; we want a one-liner.
function truncateMessage(msg: string | null): string | null {
  if (!msg) return null;
  const firstLine = msg.split("\n")[0].trim();
  if (firstLine.length <= 160) return firstLine;
  return `${firstLine.slice(0, 157)}…`;
}

// Bot status thresholds — kept inline rather than reusing the existing
// rollup ladder because operators read per-bot cards as "is THIS bot
// alive?" not as part of the global banner. The rules below mirror the
// spirit of the rollup (no successful tick in 24h → escalate) without
// pulling in the cron-tick math that only makes sense for the full set.
//  - Down:     no successful run in the last 24h.
//  - Degraded: most recent run failed OR ≥1 failure in the last 24h.
//  - Healthy:  otherwise.
function computeBotStatus(args: {
  now: Date;
  lastRunStatus: string | null;
  lastSuccessAt: Date | null;
  failuresLast24h: number;
  runs7d: number;
}): { status: "healthy" | "degraded" | "down"; reason: string | null } {
  const { now, lastRunStatus, lastSuccessAt, failuresLast24h, runs7d } = args;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (runs7d === 0) {
    return { status: "down", reason: "No runs in the last 7 days." };
  }
  const successWithin24h = lastSuccessAt !== null && (now.getTime() - lastSuccessAt.getTime()) <= ONE_DAY_MS;
  if (!successWithin24h) {
    return { status: "down", reason: "No successful run in the last 24 hours." };
  }
  if (lastRunStatus === "failed") {
    return { status: "degraded", reason: "Most recent run failed." };
  }
  if (failuresLast24h > 0) {
    return {
      status: "degraded",
      reason: `${failuresLast24h} failed run${failuresLast24h === 1 ? "" : "s"} in the last 24 hours.`,
    };
  }
  return { status: "healthy", reason: null };
}

// Build the seven daily buckets (oldest → newest) of mean duration in ms.
// Days with no completed runs are null so the sparkline can leave a gap
// rather than imply a zero-duration run.
function buildSparkline(now: Date, runs: { finishedAt: Date | null; startedAt: Date; durationMs: number | null }[]): (number | null)[] {
  const buckets: { sum: number; count: number }[] = Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }));
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (const r of runs) {
    if (r.durationMs === null) continue;
    const stampDate = r.finishedAt ?? r.startedAt;
    const stamp = new Date(stampDate);
    stamp.setHours(0, 0, 0, 0);
    const idx = 6 - Math.floor((today.getTime() - stamp.getTime()) / dayMs);
    if (idx < 0 || idx > 6) continue;
    buckets[idx].sum += r.durationMs;
    buckets[idx].count += 1;
  }
  return buckets.map((b) => (b.count === 0 ? null : Math.round(b.sum / b.count)));
}

router.get("/admin/system-health/bots", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Pull the last 7d of runs for every tracked job in one query, then
  // bucket per-bot in JS — cheaper than three round trips for what is
  // a small table.
  const trackedJobNames = BOT_DEFS.map((b) => b.jobName);
  const runs = await db
    .select({
      jobName: cronRunsTable.jobName,
      startedAt: cronRunsTable.startedAt,
      finishedAt: cronRunsTable.finishedAt,
      status: cronRunsTable.status,
      message: cronRunsTable.message,
    })
    .from(cronRunsTable)
    .where(and(
      gte(cronRunsTable.startedAt, sevenDaysAgo),
      inArray(cronRunsTable.jobName, trackedJobNames),
    ))
    .orderBy(desc(cronRunsTable.startedAt));

  // Submit-bot queue depth comes from the same pending+due rule used
  // everywhere else (Portal Submissions queue pill, worker-activity
  // endpoint). The other bots don't have a meaningful "queue" — leave
  // them null so the UI hides the row instead of showing a misleading 0.
  const [{ value: submitQueueDepth } = { value: 0 }] = await db
    .select({ value: count() })
    .from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.status, "pending"),
      or(
        isNull(portalSubmissionsTable.nextRetryAt),
        lte(portalSubmissionsTable.nextRetryAt, now),
      ),
    ));

  const bots = BOT_DEFS.map((bot) => {
    const botRuns = runs.filter((r) => r.jobName === bot.jobName);
    const withDuration = botRuns.map((r) => ({
      ...r,
      durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
    }));

    const lastRun = withDuration[0] ?? null;
    // "Success" covers both the canonical `completed` value emitted by
    // `recordCronRun` and the legacy `ok` rows from older producers.
    const isSuccess = (s: string): boolean => s === "completed" || s === "ok";
    const lastSuccess = withDuration.find((r) => isSuccess(r.status)) ?? null;
    const lastFailure = withDuration.find((r) => r.status === "failed") ?? null;

    const failuresLast24h = withDuration.filter(
      (r) => r.status === "failed" && r.startedAt >= oneDayAgo,
    ).length;
    const failures7d = withDuration.filter((r) => r.status === "failed").length;

    const completedDurations = withDuration
      .filter((r) => isSuccess(r.status) && r.durationMs !== null)
      .map((r) => r.durationMs as number);
    const avgDurationMs7d = completedDurations.length > 0
      ? Math.round(completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length)
      : null;

    const { status, reason } = computeBotStatus({
      now,
      lastRunStatus: lastRun?.status ?? null,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      failuresLast24h,
      runs7d: withDuration.length,
    });

    const queueDepth = bot.id === "submit" ? submitQueueDepth : null;

    return {
      id: bot.id,
      label: bot.label,
      jobName: bot.jobName,
      status,
      statusReason: reason,
      lastSuccessAt: lastSuccess?.startedAt.toISOString() ?? null,
      lastFailureAt: lastFailure?.startedAt.toISOString() ?? null,
      lastFailureMessage: truncateMessage(lastFailure?.message ?? null),
      queueDepth,
      queueLabel: bot.queueLabel,
      avgDurationMs7d,
      runs7d: withDuration.length,
      failures7d,
      durationSparkline: buildSparkline(now, withDuration),
    };
  });

  res.json({ bots });
}));

router.get("/admin/system-health/bots/:botId/runs", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const botId = req.params.botId as BotId;
  const def = BOT_DEF_BY_ID[botId];
  if (!def) {
    res.status(404).json({ error: "Unknown bot id" });
    return;
  }

  const rows = await db
    .select({
      id: cronRunsTable.id,
      startedAt: cronRunsTable.startedAt,
      finishedAt: cronRunsTable.finishedAt,
      status: cronRunsTable.status,
      message: cronRunsTable.message,
    })
    .from(cronRunsTable)
    .where(eq(cronRunsTable.jobName, def.jobName))
    .orderBy(desc(cronRunsTable.startedAt))
    .limit(20);

  res.json({
    botId: def.id,
    jobName: def.jobName,
    runs: rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      status: r.status,
      message: r.message,
    })),
  });
}));

router.get("/admin/system-health/bounces", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query?.limit || "50"), 10) || 50, 200);
  const onlyUnmatched = req.query?.onlyUnmatched === "true";

  let q = db.select().from(emailBouncesTable).orderBy(desc(emailBouncesTable.receivedAt)).limit(limit).$dynamic();
  if (onlyUnmatched) {
    q = q.where(sql`${emailBouncesTable.matchedClaimId} IS NULL AND ${emailBouncesTable.matchedInvoiceGroupId} IS NULL`);
  }
  const rows = await q;

  res.json({
    bounces: rows.map((r) => ({
      id: r.id,
      recipientEmail: r.recipientEmail,
      subject: r.subject,
      receivedAt: r.receivedAt.toISOString(),
      rawExcerpt: r.rawExcerpt,
      matchedClaimId: r.matchedClaimId,
      matchedInvoiceGroupId: r.matchedInvoiceGroupId,
      matchedOutboundId: r.matchedOutboundId,
    })),
  });
}));

// Task #738. At-a-glance summary of the most recent
// `portal_response_sync` cron_run plus per-row outcome counts derived
// from `portal_submissions.last_scrape_outcome`. Lives behind a helper
// because both `/worker-activity` (admin drill-down) and `/rollup`
// (auth-only summary banner) embed the same shape so the System Health
// "Last portal scrape" panel header can render before the drill-down
// fetch finishes.
async function buildLastPortalScrapeSummary(): Promise<{
  startedAt: string;
  finishedAt: string | null;
  status: string;
  message: string | null;
  considered: number | null;
  scraped: number | null;
  skipped: number | null;
  errored: number | null;
  newResponses: number | null;
} | null> {
  const [lastRun] = await db
    .select()
    .from(cronRunsTable)
    .where(eq(cronRunsTable.jobName, "portal_response_sync"))
    .orderBy(desc(cronRunsTable.startedAt))
    .limit(1);
  if (!lastRun) return null;
  const meta = (lastRun.metadata as Record<string, unknown> | null) ?? {};
  const numOrNull = (k: string): number | null =>
    typeof meta[k] === "number" ? (meta[k] as number) : null;
  return {
    startedAt: lastRun.startedAt.toISOString(),
    finishedAt: lastRun.finishedAt?.toISOString() ?? null,
    status: lastRun.status,
    message: lastRun.message,
    considered: numOrNull("considered"),
    scraped: numOrNull("scraped"),
    skipped: numOrNull("skipped"),
    errored: numOrNull("errored"),
    newResponses: numOrNull("newResponses"),
  };
}

router.get("/admin/system-health/worker-activity", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  const now = new Date();
  // Cycle-aware overdue cutoff: the most recent scheduled sweep that
  // already had its grace window to run. Rows whose ready time is at or
  // before this point should have been drained; if they're still pending,
  // they've missed a cycle.
  const overdueInputs = await resolveOverdueQueryInputs(now);
  const overdueCount = overdueInputs.canFlag
    ? await countOverdueRows(overdueInputs.cutoff!)
    : 0;

  const [{ value: pendingDueCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.status, "pending"),
      or(
        isNull(portalSubmissionsTable.nextRetryAt),
        lte(portalSubmissionsTable.nextRetryAt, now),
      ),
    ));

  // Last successful submission — we treat "submitted" as success (the portal
  // accepted the row and assigned a confirmation number).
  const [lastSuccess] = await db
    .select({
      id: portalSubmissionsTable.id,
      invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
      submittedAt: portalSubmissionsTable.submittedAt,
      updatedAt: portalSubmissionsTable.updatedAt,
      confNumber: portalSubmissionsTable.confNumber,
    })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.status, "submitted"))
    .orderBy(desc(portalSubmissionsTable.updatedAt))
    .limit(1);

  // Last failed submission — exhausted retries, error preserved on the row.
  const [lastFailed] = await db
    .select({
      id: portalSubmissionsTable.id,
      invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
      attempts: portalSubmissionsTable.attempts,
      maxAttempts: portalSubmissionsTable.maxAttempts,
      errorMessage: portalSubmissionsTable.errorMessage,
      updatedAt: portalSubmissionsTable.updatedAt,
    })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.status, "failed"))
    .orderBy(desc(portalSubmissionsTable.updatedAt))
    .limit(1);

  // Next + previous scheduled sweeper fires — derived from the locked
  // schedule so the UI can render "next sweep in 2m" / "last sweep was
  // 18m ago" without polling cron internals.
  const { prev: prevSweepFire, next: nextSweepFire } = getSweepBoundaries(now, PORTAL_BATCH_SWEEPER);
  if (nextSweepFire === null) {
    logger.warn("worker-activity: failed to compute nextSweepAt");
  }

  const lastPortalScrape = await buildLastPortalScrapeSummary();

  // Task #809 — surface the dedupe-guard hit count so admins can verify
  // in prod that the late-failure / portal-index guards are actually
  // firing. 24h window matches the worker-activity drill-down's
  // "recent activity" framing.
  const retriesSuppressed24h = await getRetriesSuppressedCount(
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
  ).catch((err) => {
    logger.warn({ err }, "worker-activity: getRetriesSuppressedCount failed");
    return 0;
  });

  res.json({
    isRunning: isWorkerRunInProgress(),
    lastRun: getLastWorkerRun(),
    recentRuns: getRecentWorkerRuns(),
    pendingDueCount,
    overdueCount,
    overdueGraceMinutes: OVERDUE_GRACE_MINUTES,
    nextSweepAt: nextSweepFire?.toISOString() ?? null,
    lastSweepAt: prevSweepFire?.toISOString() ?? null,
    lastPortalScrape,
    retriesSuppressed24h,
    lastSuccessfulSubmission: lastSuccess
      ? {
          submissionId: lastSuccess.id,
          invoiceGroupId: lastSuccess.invoiceGroupId,
          confNumber: lastSuccess.confNumber,
          submittedAt: lastSuccess.submittedAt,
          at: lastSuccess.updatedAt.toISOString(),
        }
      : null,
    lastFailedSubmission: lastFailed
      ? {
          submissionId: lastFailed.id,
          invoiceGroupId: lastFailed.invoiceGroupId,
          attempts: lastFailed.attempts,
          maxAttempts: lastFailed.maxAttempts,
          errorMessage: lastFailed.errorMessage,
          at: lastFailed.updatedAt.toISOString(),
        }
      : null,
  });
}));

// Rollup is intentionally available to any authenticated user (not requireAdmin).
// Non-admin users see WorkerHealthBanner on Dashboard / Portal Submissions; if
// this endpoint required admin, the banner would silently disappear for them
// (the rollup query would 401 and React Query would just return undefined).
// The payload is summarized component health — no PII, no secrets, no per-row
// data — so widening read access is safe. Per-component detail endpoints
// (/admin/system-health/cron-runs, /worker-activity, /connectors, /bounces)
// remain admin-only.
router.get("/admin/system-health/rollup", requireAuth, denyClerk, asyncHandler(async (_req, res): Promise<void> => {
  // Connector health
  const connectors = await db.select().from(connectorHealthTable);

  // Recent cron runs (last 7d) → most-recent per job
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentRuns = await db
    .select()
    .from(cronRunsTable)
    .where(gte(cronRunsTable.startedAt, sevenDaysAgo))
    .orderBy(desc(cronRunsTable.startedAt))
    .limit(500);

  // The DB column is typed as `string`, but `recordCronRun` only ever
  // writes the canonical {running | completed | failed} values (legacy
  // "ok"/"degraded" rows from before the collapse may also exist). Narrow
  // here so the rollup's stricter `CronRunRow.status` union holds.
  const lastRunByJob = new Map<string, CronRunRow>();
  for (const r of recentRuns) {
    if (!lastRunByJob.has(r.jobName)) {
      lastRunByJob.set(r.jobName, {
        jobName: r.jobName,
        startedAt: r.startedAt,
        status: r.status as CronRunRow["status"],
        message: r.message,
      });
    }
  }

  // Server boot time gates the missed-tick math: any expected fire that
  // landed before this process started is silently ignored, so a fresh
  // deploy doesn't look like a degraded job until the next tick lands.
  const bootTime = getBootTime();
  const nowForCron = new Date();

  // Resolve each known cron's previous expected fire time + the list of
  // expected fires since boot. Enumeration is bounded by the same 7-day
  // window we use for pulling lastRun, so the list always contains the
  // most recent ticks (not just the oldest ones after long uptime).
  const knownJobs = KNOWN_JOBS.map((known) => {
    let prevExpected: Date | null = null;
    try {
      prevExpected = CronExpressionParser.parse(known.cron, { tz: known.tz }).prev().toDate();
    } catch (err) {
      logger.warn({ err, cron: known.cron }, "Cron parse failed in rollup");
    }
    let expectedFiresSinceBoot: Date[] = [];
    try {
      expectedFiresSinceBoot = enumerateExpectedFiresSinceBoot({
        cron: known.cron,
        tz: known.tz,
        bootTime,
        now: nowForCron,
      });
    } catch (err) {
      logger.warn({ err, cron: known.cron }, "Cron parse failed enumerating fires since boot");
    }
    return {
      name: known.name,
      prevExpected,
      expectedFiresSinceBoot,
      // Pass per-job override through so low-frequency sweeps can opt
      // out of the global "tolerate one missed tick" behavior.
      missedTickThreshold: known.missedTickThreshold,
    };
  });

  // Same cycle-aware overdue rule as the worker-activity endpoint and the
  // dashboard tile. When the most recent scheduled sweep didn't actually
  // run, we deliberately leave overdueCount at 0 — the cron tile already
  // flags the missed sweep, and double-counting on the worker tile just
  // duplicates the alert.
  const now = new Date();
  const overdueInputs = await resolveOverdueQueryInputs(now);
  const overdueCount = overdueInputs.canFlag
    ? await countOverdueRows(overdueInputs.cutoff!)
    : 0;
  const { prev: prevSweepFire, next: nextSweepFire } = getSweepBoundaries(now, PORTAL_BATCH_SWEEPER);

  const lastWorkerRun = getLastWorkerRun();

  // Task #350: cheap JS-side recompute of `invoice_groups.service_date`
  // for every group. Two flat reads + a Map merge — well within the
  // health-rollup budget. `safeRunServiceDateDriftCheck` swallows its
  // own errors and returns `null` so a transient DB hiccup never kills
  // the rollup; `computeRollup` then surfaces that as an informational
  // note instead of a hard alert.
  const driftReport = await safeRunServiceDateDriftCheck();

  const { overall, components } = computeRollup({
    now,
    bootTime,
    connectors: connectors.map((c) => ({
      connectorName: c.connectorName,
      status: c.status,
      lastError: c.lastError,
    })),
    knownJobs,
    lastRunByJob,
    overdueCount,
    overdueGraceMinutes: OVERDUE_GRACE_MINUTES,
    lastWorkerRun: lastWorkerRun
      ? {
          status: lastWorkerRun.status,
          finishedAt: lastWorkerRun.finishedAt,
          startedAt: lastWorkerRun.startedAt,
          batchId: lastWorkerRun.batchId,
          lastError: lastWorkerRun.lastError,
        }
      : null,
    serviceDateDrift: driftReport === null
      ? null
      : { totalGroups: driftReport.totalGroups, driftCount: driftReport.driftCount },
  });

  const lastPortalScrape = await buildLastPortalScrapeSummary();

  // Task #809 — expose the count of retries the dedupe guards suppressed
  // in the last 24h. Read-only count; if it throws we report 0 rather
  // than fail the whole rollup.
  const retriesSuppressed24h = await getRetriesSuppressedCount(
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
  ).catch((err) => {
    logger.warn({ err }, "rollup: getRetriesSuppressedCount failed");
    return 0;
  });

  res.json({
    overall,
    components,
    lastWorkerRun,
    workerRunning: isWorkerRunInProgress(),
    overdueCount,
    overdueGraceMinutes: OVERDUE_GRACE_MINUTES,
    nextSweepAt: nextSweepFire?.toISOString() ?? null,
    lastSweepAt: prevSweepFire?.toISOString() ?? null,
    lastPortalScrape,
    retriesSuppressed24h,
    generatedAt: now.toISOString(),
    bootedAt: bootTime.toISOString(),
  });
}));

// LLM email-classifier monitoring (Task #320). Filters portal_responses to
// the LLM-first cohort (rows stamped `metadata.classifierVersion` of
// 'llm-first-v1' or 'llm-first-v2' by `response-matcher.ts` — v2 was
// introduced by Task #321 when the AI hint output gained
// `newInvoiceNumber` + `suggestedPayorDenialReason`; the dashboard
// unions both versions so spend continues to roll up across the
// version bump) and rolls them up by day so
// the System Health page can show verdict mix, daily Anthropic spend, and
// alert when the most recent complete day's "other"/"abstain" rate
// spikes vs the trailing baseline.
//
// Pure aggregation lives in `classifier-stats.ts` (covered by unit tests);
// this handler is just the SQL fetch + projection into the rollup input.
router.get("/admin/system-health/classifier-stats", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const rawDays = Number(req.query.days);
  // Clamp to a sensible window: 1..90 days, default 14. Anything beyond
  // 90 days is both expensive to scan and not useful for a "yesterday vs
  // baseline" alert — operators want an at-a-glance view, not a long
  // tail.
  const windowDays = Number.isFinite(rawDays)
    ? Math.min(90, Math.max(1, Math.floor(rawDays)))
    : 14;

  const now = new Date();
  // Pull from (windowDays - 1) days ago, midnight UTC, so the bucket
  // builder has a complete first day to anchor on.
  const sinceUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (windowDays - 1),
  ));

  // Project just the columns the rollup needs. Filtering by the
  // classifierVersion stamp keeps the cohort honest — historical rows
  // from earlier classifier generations are excluded from spend +
  // verdict math even though they share the same table.
  const rows = await db
    .select({
      receivedAt: portalResponsesTable.receivedAt,
      classifierSource: portalResponsesTable.classifierSource,
      responseType: portalResponsesTable.responseType,
      // Numeric coercion happens server-side so the rollup math doesn't
      // have to defensively parse strings out of the metadata blob.
      costUsd: sql<number | null>`(${portalResponsesTable.metadata}->'classifierUsage'->>'costUsd')::numeric`,
      inputTokens: sql<number | null>`(${portalResponsesTable.metadata}->'classifierUsage'->>'inputTokens')::int`,
      outputTokens: sql<number | null>`(${portalResponsesTable.metadata}->'classifierUsage'->>'outputTokens')::int`,
    })
    .from(portalResponsesTable)
    .where(and(
      gte(portalResponsesTable.receivedAt, sinceUtc),
      sql`${portalResponsesTable.metadata}->>'classifierVersion' IN ('llm-first-v1', 'llm-first-v2')`,
    ));

  const projected: ClassifierStatsRow[] = rows.map((r) => ({
    receivedAt: r.receivedAt,
    classifierSource: r.classifierSource,
    // responseType is the DB enum; the rollup keys by ClassifiedDecision
    // which is the same string set.
    responseType: r.responseType as ClassifiedDecision,
    costUsd: r.costUsd === null ? null : Number(r.costUsd),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  }));

  const stats = computeClassifierStats({ windowDays, now, rows: projected });

  if (stats.alerts.length > 0) {
    // Log alerts so an outage shows up in the worker logs even if no one
    // is looking at the dashboard. Operators get the human-readable
    // message; structured fields stay queryable.
    for (const alert of stats.alerts) {
      logger.warn({
        kind: alert.kind,
        recentRate: alert.recentRate,
        baselineRate: alert.baselineRate,
        recentSample: alert.recentSample,
      }, `Classifier alert: ${alert.message}`);
    }
  }

  res.json({
    ...stats,
    generatedAt: now.toISOString(),
  });
}));

export default router;
