import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { cronRunsTable, connectorHealthTable, emailBouncesTable } from "@workspace/db";
import { desc, gte, sql } from "drizzle-orm";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAdmin } from "../middlewares/requireAdmin";
import { CronExpressionParser } from "cron-parser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Cron job names + their cron expressions, kept in sync with index.ts
const KNOWN_JOBS: { name: string; cron: string; tz: string }[] = [
  { name: "midnight_portal_processor", cron: "0 0 * * *", tz: "America/New_York" },
  { name: "daily_brief", cron: "0 7 * * 1-5", tz: "America/New_York" },
  { name: "response_tracker", cron: "*/30 8-18 * * 1-5", tz: "America/New_York" },
  { name: "outlook_heartbeat", cron: "*/15 * * * *", tz: "America/New_York" },
];

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

export default router;
