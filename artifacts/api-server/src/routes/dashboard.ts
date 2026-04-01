import { Router, type IRouter } from "express";
import { eq, sql, desc, or, gt, and, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, portalSubmissionsTable, botInstancesTable } from "@workspace/db";

const router: IRouter = Router();

function daysRemaining(serviceDate: string | null): number | null {
  if (!serviceDate) return null;
  const deadline = new Date(serviceDate);
  deadline.setDate(deadline.getDate() + 30);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  return Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const allClaims = await db.select().from(claimsTable);

  const needsEvidence = allClaims.filter(c => c.status === "New" || c.status === "Needs Evidence").length;
  const portalQueued = allClaims.filter(c => c.status === "Portal Queued" || c.status === "Generating Email" || c.status === "Ready to Review").length;
  const awaitingResponse = allClaims.filter(c => c.status === "Awaiting Response").length;

  const total = allClaims.length;
  const newCount = allClaims.filter(c => c.status === "New").length;
  const resolved = allClaims.filter(c => c.status === "Resolved").length;
  const denied = allClaims.filter(c => c.status === "Denied").length;
  const onHold = allClaims.filter(c => c.status === "On Hold").length;

  const totalClaimed = allClaims.reduce((sum, c) => sum + (parseFloat(c.claimAmount || "0") || 0), 0);
  const totalApproved = allClaims.reduce((sum, c) => sum + (parseFloat(c.approvedAmount || "0") || 0), 0);

  const openStatuses = ["New", "Needs Evidence", "Portal Queued", "Generating Email", "Ready to Review", "Awaiting Response", "On Hold"];
  const openClaims = allClaims.filter(c => openStatuses.includes(c.status));
  const expiringClaims = openClaims
    .filter(c => c.date)
    .map(c => {
      const dl = daysRemaining(c.date);
      return { id: c.id, confNumber: c.confNumber, date: c.date!, claimAmount: c.claimAmount, status: c.status, daysLeft: dl! };
    })
    .filter(c => c.daysLeft !== null && c.daysLeft <= 10)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const recentClaims = allClaims
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  const allSubmissions = await db.select().from(portalSubmissionsTable);
  const pending = allSubmissions.filter(s => s.status === "pending").length;
  const submitted = allSubmissions.filter(s => s.status === "submitted").length;
  const failed = allSubmissions.filter(s => s.status === "failed").length;
  const totalSubs = submitted + failed;
  const successRate = totalSubs > 0 ? ((submitted / totalSubs) * 100).toFixed(1) : "0";

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const botInstances = await db.select().from(botInstancesTable)
    .where(gt(botInstancesTable.lastHeartbeat, fiveMinAgo));

  res.json({
    pipeline: { needsEvidence, portalQueued, awaitingResponse },
    stats: { total, new: newCount, resolved, denied, onHold },
    amounts: { totalClaimed: totalClaimed.toFixed(2), totalApproved: totalApproved.toFixed(2) },
    expiringClaims,
    recentClaims,
    portalStats: { pending, submitted, failed, successRate },
    botInstances,
  });
});

export default router;
