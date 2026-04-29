import { Router, type IRouter } from "express";
import { eq, sql, and, or, count, sum, desc, isNull, lte, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable, portalSubmissionsTable, auditLogsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { daysRemaining, effectiveDaysRemaining, isUrgentDeadline } from "../lib/dates";
import { getLastWorkerRun, isWorkerRunInProgress } from "../lib/batch-processor";

const router: IRouter = Router();

const OPEN_STATUSES = ["New", "Needs Evidence", "Portal Queued", "Generating Email", "Ready to Review", "Awaiting Response", "On Hold"] as const;
// Statuses where the next action is on our team. Excludes "Awaiting Response"
// (ball is in the payor's court) and "On Hold" (we've intentionally paused).
export const EXPIRING_ACTIONABLE_STATUSES = [
  "New",
  "Needs Evidence",
  "Portal Queued",
  "Generating Email",
  "Ready to Review",
] as const;
const VENDOR_PREPAY_RATE = 0.70;
const OVERDUE_THRESHOLD_MINUTES = 15;

export function parseDays(raw: unknown, fallback: number, max = 365): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function startOfWindow(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}

function buildDateBuckets(days: number): string[] {
  const start = startOfWindow(days);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

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

  const expiringStatusFilter = or(
    ...EXPIRING_ACTIONABLE_STATUSES.map(s => eq(invoiceGroupsTable.status, s)),
  );

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
    .where(and(expiringStatusFilter, sql`${claimsTable.date} IS NOT NULL`))
    .groupBy(invoiceGroupsTable.id);

  const expiringNow = new Date();
  const expiringGroups = openGroupsWithDates
    .map(g => {
      const dl = daysRemaining(g.earliestDate);
      const eff = effectiveDaysRemaining(g.earliestDate, expiringNow);
      const urgent = isUrgentDeadline(g.earliestDate, expiringNow);
      return {
        id: g.id,
        invoiceNumber: g.invoiceNumber,
        earliestDate: g.earliestDate!,
        totalAmount: g.totalAmount,
        status: g.status,
        rideCount: g.rideCount,
        daysLeft: dl!,
        effectiveDaysLeft: eff!,
        isUrgent: urgent,
      };
    })
    .filter(g => g.effectiveDaysLeft !== null && g.effectiveDaysLeft <= 10)
    .sort((a, b) => a.effectiveDaysLeft - b.effectiveDaysLeft);

  const urgentCount = expiringGroups.filter(g => g.isUrgent).length;

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

  const now = new Date();
  const overdueCutoff = new Date(now.getTime() - OVERDUE_THRESHOLD_MINUTES * 60 * 1000);

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

  // Overdue rule mirrors `isSubmissionOverdue`.
  const [{ value: overdueCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.status, "pending"),
      or(
        lte(portalSubmissionsTable.nextRetryAt, overdueCutoff),
        and(
          isNull(portalSubmissionsTable.nextRetryAt),
          lte(portalSubmissionsTable.createdAt, overdueCutoff),
        ),
      ),
    ));

  res.json({
    pipeline: { needsEvidence, portalQueued, awaitingResponse },
    stats: { total, new: newCount, resolved, denied, withdrawn, onHold, withdrawnByReason, deniedByReason },
    amounts: { totalClaimed: totalClaimed.toFixed(2), totalApproved: totalApproved.toFixed(2), totalExposure: totalExposure.toFixed(2), vendorPrepayRate: VENDOR_PREPAY_RATE },
    expiringGroups,
    urgentCount,
    recentGroups,
    portalStats: { pending, submitted, failed, successRate },
    portalWorker: {
      lastRun: getLastWorkerRun(),
      isRunning: isWorkerRunInProgress(),
      pendingDueCount,
      overdueCount,
    },
  });
}));

router.get("/dashboard/timeseries", asyncHandler(async (req, res): Promise<void> => {
  const days = parseDays(req.query.days, 30);
  const start = startOfWindow(days);
  const buckets = buildDateBuckets(days);

  const createdRows = await db
    .select({
      bucket: sql<string>`to_char((${claimsTable.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(claimsTable)
    .where(gte(claimsTable.createdAt, start))
    .groupBy(sql`1`);

  const resolvedRows = await db
    .select({
      bucket: sql<string>`to_char((${auditLogsTable.timestamp}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(auditLogsTable)
    .where(and(
      gte(auditLogsTable.timestamp, start),
      inArray(auditLogsTable.action, ["group_resolved", "group_denied"]),
    ))
    .groupBy(sql`1`);

  const recoveredRows = await db
    .select({
      bucket: sql<string>`to_char((${invoiceGroupsTable.updatedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      total: sum(invoiceGroupsTable.approvedAmount),
    })
    .from(invoiceGroupsTable)
    .where(and(
      gte(invoiceGroupsTable.updatedAt, start),
      isNotNull(invoiceGroupsTable.approvedAmount),
      inArray(invoiceGroupsTable.outcome, ["Approved", "Partially Approved"]),
    ))
    .groupBy(sql`1`);

  const createdMap = new Map(createdRows.map(r => [r.bucket, r.count]));
  const resolvedMap = new Map(resolvedRows.map(r => [r.bucket, r.count]));
  const recoveredMap = new Map(recoveredRows.map(r => [r.bucket, parseFloat(r.total || "0")]));

  const points = buckets.map(date => ({
    date,
    claimsCreated: createdMap.get(date) ?? 0,
    claimsResolved: resolvedMap.get(date) ?? 0,
    dollarsRecovered: Number((recoveredMap.get(date) ?? 0).toFixed(2)),
  }));

  res.json({ days, points });
}));

export function parseLimit(raw: unknown, fallback: number, max = 50): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export type RepeatOffenderTrend = "up" | "down" | "flat";

export function trendFromCounts(current: number, previous: number): RepeatOffenderTrend {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

export type RepeatOffenderAggRow = {
  key: string;
  rejectionCount: number;       // Only outcome=Denied
  atRiskAmount: number;         // Sum of claimAmount for Denied claims
  approvedCount: number;        // For winRate (across all resolved)
  deniedCount: number;          // For winRate (across all resolved)
  lastRejectionDate: string | null;
  errorTypeCounts: Map<string, number>; // Only counted from Denied claims
  mostRecentInvoice: { date: string | null; invoiceNumber: string | null };
};

export type RepeatOffenderGroupingKey = "carNumber" | "clientNumber";

export type RepeatOffenderInputRow = {
  key: string | null;
  claimAmount: string | null;
  outcome: string;
  date: string | null;
  errorTypeName: string | null;
  invoiceNumber: string | null;
};

export function aggregateRepeatOffenders(rows: RepeatOffenderInputRow[]): Map<string, RepeatOffenderAggRow> {
  const map = new Map<string, RepeatOffenderAggRow>();
  for (const row of rows) {
    if (!row.key) continue;
    let agg = map.get(row.key);
    if (!agg) {
      agg = {
        key: row.key,
        rejectionCount: 0,
        atRiskAmount: 0,
        approvedCount: 0,
        deniedCount: 0,
        lastRejectionDate: null,
        errorTypeCounts: new Map(),
        mostRecentInvoice: { date: null, invoiceNumber: null },
      };
      map.set(row.key, agg);
    }
    const isDenied = row.outcome === "Denied";
    const isApproved = row.outcome === "Approved" || row.outcome === "Partially Approved";
    if (isApproved) agg.approvedCount += 1;
    if (isDenied) {
      agg.deniedCount += 1;
      agg.rejectionCount += 1;
      const amt = parseFloat(row.claimAmount || "0");
      if (Number.isFinite(amt)) agg.atRiskAmount += amt;
      if (row.date) {
        if (!agg.lastRejectionDate || row.date > agg.lastRejectionDate) {
          agg.lastRejectionDate = row.date;
        }
      }
      if (row.errorTypeName) {
        agg.errorTypeCounts.set(row.errorTypeName, (agg.errorTypeCounts.get(row.errorTypeName) ?? 0) + 1);
      }
    }
    // Track most-recent invoice across ALL claims for this key (used as
    // "last invoice / driver descriptor"), not just Denied ones.
    if (
      row.date &&
      row.invoiceNumber &&
      (!agg.mostRecentInvoice.date || row.date >= agg.mostRecentInvoice.date)
    ) {
      agg.mostRecentInvoice = { date: row.date, invoiceNumber: row.invoiceNumber };
    }
  }
  return map;
}

export function topErrorType(counts: Map<string, number>): string | null {
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of counts) {
    if (!best || count > best.count) best = { name, count };
  }
  return best?.name ?? null;
}

export type RepeatOffenderShapedRow = {
  rejectionCount: number;
  previousRejectionCount: number;
  atRiskAmount: string;
  topErrorTypeName: string | null;
  winRate: number | null;
  trend: RepeatOffenderTrend;
  lastRejectionDate: string | null;
  carNumber?: string;
  lastInvoiceNumber?: string | null;
  clientNumber?: string;
};

export function shapeRepeatOffenders(
  map: Map<string, RepeatOffenderAggRow>,
  priorMap: Map<string, RepeatOffenderAggRow>,
  keyName: RepeatOffenderGroupingKey,
  limit: number,
): RepeatOffenderShapedRow[] {
  const list = Array.from(map.values())
    .sort((a, b) => b.rejectionCount - a.rejectionCount || b.atRiskAmount - a.atRiskAmount)
    .slice(0, limit);
  return list.map(agg => {
    const priorCount = priorMap.get(agg.key)?.rejectionCount ?? 0;
    const resolved = agg.approvedCount + agg.deniedCount;
    const winRate = resolved > 0 ? Number((agg.approvedCount / resolved).toFixed(4)) : null;
    const base = {
      rejectionCount: agg.rejectionCount,
      previousRejectionCount: priorCount,
      atRiskAmount: agg.atRiskAmount.toFixed(2),
      topErrorTypeName: topErrorType(agg.errorTypeCounts),
      winRate,
      trend: trendFromCounts(agg.rejectionCount, priorCount),
      lastRejectionDate: agg.lastRejectionDate,
    };
    if (keyName === "carNumber") {
      return {
        ...base,
        carNumber: agg.key,
        lastInvoiceNumber: agg.mostRecentInvoice.invoiceNumber,
      };
    }
    return {
      ...base,
      clientNumber: agg.key,
    };
  });
}

router.get("/dashboard/repeat-offenders", asyncHandler(async (req, res): Promise<void> => {
  const days = parseDays(req.query.days, 30);
  const limit = parseLimit(req.query.limit, 10);
  const start = startOfWindow(days);
  const priorStart = new Date(start);
  priorStart.setUTCDate(priorStart.getUTCDate() - days);

  // Pull both periods in one query, partition by key.
  const allRows = await db
    .select({
      carNumber: claimsTable.carNumber,
      clientNumber: claimsTable.clientNumber,
      claimAmount: claimsTable.claimAmount,
      outcome: claimsTable.outcome,
      date: claimsTable.date,
      errorTypeName: claimsTable.errorTypeName,
      createdAt: claimsTable.createdAt,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
    })
    .from(claimsTable)
    .leftJoin(invoiceGroupsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(gte(claimsTable.createdAt, priorStart));

  const currentDriverRows: RepeatOffenderInputRow[] = [];
  const priorDriverRows: RepeatOffenderInputRow[] = [];
  const currentMemberRows: RepeatOffenderInputRow[] = [];
  const priorMemberRows: RepeatOffenderInputRow[] = [];

  for (const r of allRows) {
    const inCurrent = r.createdAt && r.createdAt >= start;
    const driverPayload: RepeatOffenderInputRow = {
      key: r.carNumber,
      claimAmount: r.claimAmount,
      outcome: r.outcome,
      date: r.date,
      errorTypeName: r.errorTypeName,
      invoiceNumber: r.invoiceNumber,
    };
    const memberPayload: RepeatOffenderInputRow = { ...driverPayload, key: r.clientNumber };
    if (inCurrent) {
      currentDriverRows.push(driverPayload);
      currentMemberRows.push(memberPayload);
    } else {
      priorDriverRows.push(driverPayload);
      priorMemberRows.push(memberPayload);
    }
  }

  const currentDrivers = aggregateRepeatOffenders(currentDriverRows);
  const priorDrivers = aggregateRepeatOffenders(priorDriverRows);
  const currentMembers = aggregateRepeatOffenders(currentMemberRows);
  const priorMembers = aggregateRepeatOffenders(priorMemberRows);

  res.json({
    days,
    previousPeriodDays: days,
    drivers: shapeRepeatOffenders(currentDrivers, priorDrivers, "carNumber", limit),
    members: shapeRepeatOffenders(currentMembers, priorMembers, "clientNumber", limit),
    driverGroupsTotal: currentDrivers.size,
    memberGroupsTotal: currentMembers.size,
  });
}));

router.get("/dashboard/user-productivity", asyncHandler(async (req, res): Promise<void> => {
  const days = parseDays(req.query.days, 30);
  const start = startOfWindow(days);

  const ACTION_BUCKETS: Record<string, "triaged" | "resolved" | "denied" | "drafts" | "submissions"> = {
    group_triaged: "triaged",
    group_resolved: "resolved",
    group_denied: "denied",
    portal_draft_edited: "drafts",
    portal_draft_regenerated: "drafts",
    portal_submission_submitted: "submissions",
  };

  const rows = await db
    .select({
      userEmail: auditLogsTable.userEmail,
      userName: auditLogsTable.userName,
      action: auditLogsTable.action,
      count: count(),
    })
    .from(auditLogsTable)
    .where(and(
      gte(auditLogsTable.timestamp, start),
      isNotNull(auditLogsTable.userEmail),
      inArray(auditLogsTable.action, Object.keys(ACTION_BUCKETS)),
    ))
    .groupBy(auditLogsTable.userEmail, auditLogsTable.userName, auditLogsTable.action);

  const byUser = new Map<string, {
    userEmail: string;
    userName: string;
    triaged: number;
    resolved: number;
    denied: number;
    drafts: number;
    submissions: number;
    total: number;
  }>();

  for (const r of rows) {
    if (!r.userEmail) continue;
    const bucket = ACTION_BUCKETS[r.action];
    if (!bucket) continue;
    const key = r.userEmail;
    let agg = byUser.get(key);
    if (!agg) {
      agg = {
        userEmail: r.userEmail,
        userName: r.userName ?? "",
        triaged: 0, resolved: 0, denied: 0, drafts: 0, submissions: 0, total: 0,
      };
      byUser.set(key, agg);
    }
    agg[bucket] += r.count;
    agg.total += r.count;
    if (!agg.userName && r.userName) agg.userName = r.userName;
  }

  const users = Array.from(byUser.values()).sort((a, b) => b.total - a.total);

  res.json({ days, users });
}));

export default router;
