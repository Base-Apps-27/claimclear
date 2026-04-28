import { Router, type IRouter } from "express";
import { eq, sql, gt, and, or, count, sum, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable, portalSubmissionsTable, botInstancesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { daysRemaining } from "../lib/dates";

const router: IRouter = Router();

const OPEN_STATUSES = ["New", "Needs Evidence", "Portal Queued", "Generating Email", "Ready to Review", "Awaiting Response", "On Hold"] as const;
const VENDOR_PREPAY_RATE = 0.70;

router.get("/dashboard/summary", asyncHandler(async (_req, res): Promise<void> => {
  const statusCountsRaw = await db
    .select({ status: invoiceGroupsTable.status, count: count() })
    .from(invoiceGroupsTable)
    .groupBy(invoiceGroupsTable.status);

  const statusCounts = Object.fromEntries(statusCountsRaw.map(r => [r.status, r.count]));

  const withdrawnByReasonRaw = await db
    .select({ closureReason: invoiceGroupsTable.closureReason, count: count() })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.outcome, "Withdrawn"))
    .groupBy(invoiceGroupsTable.closureReason);
  const withdrawnByReason = {
    not_contestable: 0,
    accepted_loss: 0,
    other: 0,
  };
  for (const row of withdrawnByReasonRaw) {
    if (row.closureReason === "not_contestable") withdrawnByReason.not_contestable = row.count;
    else if (row.closureReason === "accepted_loss") withdrawnByReason.accepted_loss = row.count;
    else withdrawnByReason.other += row.count;
  }
  const withdrawn = withdrawnByReason.not_contestable + withdrawnByReason.accepted_loss + withdrawnByReason.other;

  const deniedByReasonRaw = await db
    .select({ closureReason: invoiceGroupsTable.closureReason, count: count() })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.outcome, "Denied"))
    .groupBy(invoiceGroupsTable.closureReason);
  const deniedByReason = { payer_denied: 0, other: 0 };
  for (const row of deniedByReasonRaw) {
    if (row.closureReason === "payer_denied") deniedByReason.payer_denied = row.count;
    else deniedByReason.other += row.count;
  }

  const needsEvidence = (statusCounts["New"] || 0) + (statusCounts["Needs Evidence"] || 0);
  const portalQueued = (statusCounts["Portal Queued"] || 0) + (statusCounts["Generating Email"] || 0) + (statusCounts["Ready to Review"] || 0);
  const awaitingResponse = statusCounts["Awaiting Response"] || 0;
  const total = statusCountsRaw.reduce((s, r) => s + r.count, 0);
  const newCount = statusCounts["New"] || 0;
  const resolvedAll = statusCounts["Resolved"] || 0;
  const resolved = Math.max(0, resolvedAll - withdrawn);
  const denied = statusCounts["Denied"] || 0;
  const onHold = statusCounts["On Hold"] || 0;

  const [amountsResult] = await db
    .select({
      totalClaimed: sum(invoiceGroupsTable.totalAmount),
      totalApproved: sum(invoiceGroupsTable.approvedAmount),
    })
    .from(invoiceGroupsTable);

  const totalClaimed = parseFloat(amountsResult.totalClaimed || "0");
  const totalApproved = parseFloat(amountsResult.totalApproved || "0");
  const totalExposure = totalClaimed * (1 + VENDOR_PREPAY_RATE);

  const openStatusFilter = or(...OPEN_STATUSES.map(s => eq(invoiceGroupsTable.status, s)));

  const openGroupsWithDates = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      totalAmount: invoiceGroupsTable.totalAmount,
      status: invoiceGroupsTable.status,
      rideCount: invoiceGroupsTable.rideCount,
      earliestDate: sql<string | null>`MIN(${claimsTable.date})`,
    })
    .from(invoiceGroupsTable)
    .leftJoin(claimsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(and(openStatusFilter, sql`${claimsTable.date} IS NOT NULL`))
    .groupBy(invoiceGroupsTable.id);

  const expiringGroups = openGroupsWithDates
    .map(g => {
      const dl = daysRemaining(g.earliestDate);
      return {
        id: g.id,
        invoiceNumber: g.invoiceNumber,
        earliestDate: g.earliestDate!,
        totalAmount: g.totalAmount,
        status: g.status,
        rideCount: g.rideCount,
        daysLeft: dl!,
      };
    })
    .filter(g => g.daysLeft !== null && g.daysLeft <= 10)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const recentGroups = await db.select().from(invoiceGroupsTable)
    .orderBy(desc(invoiceGroupsTable.updatedAt))
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
    stats: { total, new: newCount, resolved, denied, withdrawn, onHold, withdrawnByReason, deniedByReason },
    amounts: { totalClaimed: totalClaimed.toFixed(2), totalApproved: totalApproved.toFixed(2), totalExposure: totalExposure.toFixed(2), vendorPrepayRate: VENDOR_PREPAY_RATE },
    expiringGroups,
    recentGroups,
    portalStats: { pending, submitted, failed, successRate },
    botInstances,
  });
}));

export default router;
