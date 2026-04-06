import { Router, type IRouter } from "express";
import { eq, sql, gt, and, or, count, sum } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, portalSubmissionsTable, botInstancesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { daysRemaining } from "../lib/dates";

const router: IRouter = Router();

const OPEN_STATUSES = ["New", "Needs Evidence", "Portal Queued", "Generating Email", "Ready to Review", "Awaiting Response", "On Hold"] as const;
const VENDOR_PREPAY_RATE = 0.70;

router.get("/dashboard/summary", asyncHandler(async (_req, res): Promise<void> => {
  const statusCountsRaw = await db
    .select({ status: claimsTable.status, count: count() })
    .from(claimsTable)
    .groupBy(claimsTable.status);

  const statusCounts = Object.fromEntries(statusCountsRaw.map(r => [r.status, r.count]));

  const needsEvidence = (statusCounts["New"] || 0) + (statusCounts["Needs Evidence"] || 0);
  const portalQueued = (statusCounts["Portal Queued"] || 0) + (statusCounts["Generating Email"] || 0) + (statusCounts["Ready to Review"] || 0);
  const awaitingResponse = statusCounts["Awaiting Response"] || 0;
  const total = statusCountsRaw.reduce((s, r) => s + r.count, 0);
  const newCount = statusCounts["New"] || 0;
  const resolved = statusCounts["Resolved"] || 0;
  const denied = statusCounts["Denied"] || 0;
  const onHold = statusCounts["On Hold"] || 0;

  const [amountsResult] = await db
    .select({
      totalClaimed: sum(claimsTable.claimAmount),
      totalApproved: sum(claimsTable.approvedAmount),
    })
    .from(claimsTable);

  const totalClaimed = parseFloat(amountsResult.totalClaimed || "0");
  const totalApproved = parseFloat(amountsResult.totalApproved || "0");
  const totalExposure = totalClaimed * (1 + VENDOR_PREPAY_RATE);

  const openStatusFilter = or(...OPEN_STATUSES.map(s => eq(claimsTable.status, s)));

  const openClaimsWithDates = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      date: claimsTable.date,
      claimAmount: claimsTable.claimAmount,
      status: claimsTable.status,
    })
    .from(claimsTable)
    .where(and(openStatusFilter, sql`${claimsTable.date} IS NOT NULL`));

  const expiringClaims = openClaimsWithDates
    .map(c => {
      const dl = daysRemaining(c.date);
      return { id: c.id, confNumber: c.confNumber, date: c.date!, claimAmount: c.claimAmount, status: c.status, daysLeft: dl! };
    })
    .filter(c => c.daysLeft !== null && c.daysLeft <= 10)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const recentClaims = await db.select().from(claimsTable)
    .orderBy(sql`${claimsTable.createdAt} DESC`)
    .limit(10);

  const submissionCountsRaw = await db
    .select({ status: portalSubmissionsTable.status, count: count() })
    .from(portalSubmissionsTable)
    .groupBy(portalSubmissionsTable.status);

  const subCounts = Object.fromEntries(submissionCountsRaw.map(r => [r.status, r.count]));
  const pending = subCounts["pending"] || 0;
  const submitted = subCounts["submitted"] || 0;
  const failed = subCounts["failed"] || 0;
  const totalSubs = submitted + failed;
  const successRate = totalSubs > 0 ? ((submitted / totalSubs) * 100).toFixed(1) : "0";

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const botInstances = await db.select().from(botInstancesTable)
    .where(gt(botInstancesTable.lastHeartbeat, fiveMinAgo));

  res.json({
    pipeline: { needsEvidence, portalQueued, awaitingResponse },
    stats: { total, new: newCount, resolved, denied, onHold },
    amounts: { totalClaimed: totalClaimed.toFixed(2), totalApproved: totalApproved.toFixed(2), totalExposure: totalExposure.toFixed(2), vendorPrepayRate: VENDOR_PREPAY_RATE },
    expiringClaims,
    recentClaims,
    portalStats: { pending, submitted, failed, successRate },
    botInstances,
  });
}));

export default router;
