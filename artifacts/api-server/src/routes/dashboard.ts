import { Router, type IRouter } from "express";
import { eq, sql, and, or, count, sum, desc, isNull, lte, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable, portalSubmissionsTable, auditLogsTable, stateEventsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { addDaysToYMD, daysRemaining, effectiveDaysRemaining, isUrgentDeadline, serverTodayKey } from "../lib/dates";
import { SOON_DAYS, VENDOR_PREPAY_RATE } from "../lib/risk-config";
import { getLastWorkerRun, isWorkerRunInProgress } from "../lib/batch-processor";
import { humanizeAuditRow } from "../lib/activity-humanizer";
import { getOverdueCount } from "../lib/overdue-submissions";
import { computeUrgentSnapshot } from "../lib/urgent-snapshot";

const router: IRouter = Router();

const OPEN_STATUSES = ["New", "Needs Evidence", "Processed", "Portal Queued", "Generating Email", "Ready to Review", "Awaiting Response", "On Hold"] as const;

// Operating rule for both sets below:
//   A row is "urgent today" iff its filing deadline is `<=` today AND its
//   status is neither already-submitted nor concluded.
//
// The two sets diverge because that rule lands on different statuses at
// the claim level vs. the invoice-group level (Task #290):
//
// • Group level — `GROUP_EXPIRING_ACTIONABLE_STATUSES`. A group's status
//   represents the operator's progress toward submission. Once the group
//   is `Portal Queued` the operator has submitted via the portal and the
//   filing clock is satisfied from the office's POV; its post-submit
//   timeline (response-by, review-by) lives on the Responses Awaiting
//   Review surface, not the filing-deadline hero. `Awaiting Response`,
//   `Needs Review`, and `Ready to Review` are likewise post-submit.
//   `Resolved` and `Denied` are concluded. `Processed` is a CLAIM-only
//   transition state and never lands on `invoice_groups.status`, so
//   listing it here is dead weight that only mislead readers. The
//   actual pre-submit, on-clock statuses are exactly:
//     { New, Needs Evidence, On Hold, Generating Email }
//   `Generating Email` is the state set by `POST /invoice-groups/:id/
//   package` when the operator clicks "Ready to package" — it satisfies
//   the urgency rule (not yet submitted, not concluded) and must be
//   spelled out so the Dashboard hero count and the Queue
//   `?expiring=urgent` view can never disagree.
//
// • Claim level — `CLAIM_EXPIRING_ACTIONABLE_STATUSES`. The 30-day clock
//   keeps running on individual CLAIMS in `Portal Queued` and `Processed`
//   even after their parent group has moved on (a stuck Portal Queued
//   claim, or a Processed leg whose worktree is done but whose invoice
//   hasn't been packaged yet, must still escalate before the deadline
//   slips). Those leg-level escalations are surfaced via the daily brief
//   and the claim list, not the Queue, so this set retains them.
//
// Both sets exclude `Awaiting Response` (once we've filed, the 30-day
// rule is satisfied), the queue-managed review statuses
// (`Needs Review`, `Ready to Review` — those are post-submit response
// triage, not filing-clock urgency), and the concluded statuses
// (`Resolved`, `Denied`). Both sets include `On Hold` (pausing
// internally does not pause the deadline — if we don't unpause and file
// in time, we lose the window).
export const GROUP_EXPIRING_ACTIONABLE_STATUSES = [
  "New",
  "Needs Evidence",
  "On Hold",
  "Generating Email",
] as const;

export const CLAIM_EXPIRING_ACTIONABLE_STATUSES = [
  "New",
  "Needs Evidence",
  "Processed",
  "Portal Queued",
  "Generating Email",
  "On Hold",
] as const;

// "Submitted but unconfirmed" — Task #352. The pre-submit ACTIONABLE
// sets above answer "what must we file today?". The sets below answer
// the parallel question: "what did we already file but never got an
// acknowledgement back on, and is now past the 30-day window?". The
// two tiers are reconciled side-by-side on the Dashboard, Queue, and
// per-row badges so the operator can never read "0 to file today" and
// still see TODAY-style badges scattered across the list — those rows
// are now the explicit `submittedStuck` tier with their own variant.
//
// Why these statuses:
// - `Portal Queued` (group + claim level): the operator submitted via
//   the portal but the payor hasn't confirmed receipt. The filing
//   clock was satisfied at submission, but if the deadline passes
//   without a confirmation we still want to surface the row — it
//   means the submission may have failed silently and needs a chase.
// - `Processed` (claim-only — never lands on `invoice_groups.status`):
//   the worktree on the leg is done but the parent invoice hasn't
//   been packaged yet. Same shape as Portal Queued for our purposes.
//
// Both sets are strict subsets of the parent ACTIONABLE set above;
// the per-row `submittedStuck` flag is computed exactly as
//   `<set>.has(row.status) && effectiveDaysRemaining(date, today) <= 0`
// so the same date math drives both tiers — only the status filter
// differs.
export const GROUP_SUBMITTED_STUCK_STATUSES = ["Portal Queued"] as const;

export const CLAIM_SUBMITTED_STUCK_STATUSES = [
  "Portal Queued",
  "Processed",
] as const;

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
    cannot_dispute: 0,
    other: 0,
  };
  for (const row of withdrawnByReasonRaw) {
    if (row.closureReason === "cannot_dispute") withdrawnByReason.cannot_dispute = row.count;
    else withdrawnByReason.other += row.count;
  }
  const withdrawn = withdrawnByReason.cannot_dispute + withdrawnByReason.other;

  const deniedByReasonRaw = await db
    .select({ closureReason: invoiceGroupsTable.closureReason, count: count() })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.outcome, "Denied"))
    .groupBy(invoiceGroupsTable.closureReason);
  const deniedByReason = { denied_by_payor: 0, other: 0 };
  for (const row of deniedByReasonRaw) {
    if (row.closureReason === "denied_by_payor") deniedByReason.denied_by_payor = row.count;
    else deniedByReason.other += row.count;
  }

  const needsEvidence = (statusCounts["New"] || 0) + (statusCounts["Needs Evidence"] || 0);
  const portalQueued = (statusCounts["Portal Queued"] || 0) + (statusCounts["Generating Email"] || 0) + (statusCounts["Ready to Review"] || 0);
  const awaitingResponse = statusCounts["Awaiting Response"] || 0;
  const total = statusCountsRaw.reduce((s, r) => s + r.count, 0);
  const newCount = statusCounts["New"] || 0;
  const resolvedAll = statusCounts["Resolved"] || 0;
  const denied = statusCounts["Denied"] || 0;
  const onHold = statusCounts["On Hold"] || 0;

  // "Awaiting attestation" = Approved-family CLAIMS whose off-system
  // re-attestation step in the payor portal is still owed (state=pending)
  // or parked for someone with portal access (state=queued). Counted at
  // the CLAIM level so multi-claim groups don't undercount the workload —
  // each outstanding attestation step is its own unit of work for the team.
  const [{ value: awaitingAttestation } = { value: 0 }] = await db
    .select({ value: count() })
    .from(claimsTable)
    .where(and(
      inArray(claimsTable.outcome, ["Approved", "Partially Approved"]),
      inArray(claimsTable.attestationState, ["pending", "queued"]),
    ));

  // Resolved tile excludes groups that still have outstanding attestation
  // claims, so an Approved group only counts as fully resolved once every
  // claim has been attested. Groups (not claims) are the unit here so the
  // math lines up with the rest of the dashboard, which is group-keyed.
  const resolvedAttestationGroupRows = await db
    .select({ id: invoiceGroupsTable.id })
    .from(invoiceGroupsTable)
    .innerJoin(claimsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(and(
      eq(invoiceGroupsTable.status, "Resolved"),
      inArray(invoiceGroupsTable.outcome, ["Approved", "Partially Approved"]),
      inArray(claimsTable.attestationState, ["pending", "queued"]),
    ))
    .groupBy(invoiceGroupsTable.id);
  const resolved = Math.max(0, resolvedAll - withdrawn - resolvedAttestationGroupRows.length);

  const [amountsResult] = await db
    .select({
      totalClaimed: sum(invoiceGroupsTable.totalAmount),
      totalApproved: sum(invoiceGroupsTable.approvedAmount),
    })
    .from(invoiceGroupsTable);

  const totalClaimed = parseFloat(amountsResult.totalClaimed || "0");
  const totalApproved = parseFloat(amountsResult.totalApproved || "0");
  const totalExposure = totalClaimed * (1 + VENDOR_PREPAY_RATE);

  const [lostResult] = await db
    .select({ totalLost: sum(invoiceGroupsTable.totalAmount) })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.outcome, "Denied"));
  const totalLost = parseFloat(lostResult?.totalLost || "0");

  const openStatusFilter = or(...OPEN_STATUSES.map(s => eq(invoiceGroupsTable.status, s)));

  const expiringStatusFilter = or(
    ...GROUP_EXPIRING_ACTIONABLE_STATUSES.map(s => eq(invoiceGroupsTable.status, s)),
  );

  const openGroupsWithDates = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      totalAmount: invoiceGroupsTable.totalAmount,
      status: invoiceGroupsTable.status,
      rideCount: invoiceGroupsTable.rideCount,
      // claims.date is a typed DATE column (Task #351, migration 0022);
      // MIN() yields a date directly. ::text formats as YYYY-MM-DD via
      // postgres' ISO datestyle for the JS deadline helpers.
      earliestDate: sql<string | null>`MIN(${claimsTable.date})::text`,
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
    .filter(g => g.effectiveDaysLeft !== null && g.effectiveDaysLeft <= SOON_DAYS)
    .sort((a, b) => a.effectiveDaysLeft - b.effectiveDaysLeft);

  const urgentCount = expiringGroups.filter(g => g.isUrgent).length;

  // "Stuck after submission" tier (Task #352). Same date math as the
  // expiring/urgent computation above; the only difference is the
  // status filter (Portal Queued at the group level — Processed is
  // claim-only and can't appear here). A group lands in this list
  // when the operator already submitted via the portal but the
  // deadline has slipped without an acknowledgement, so the row
  // needs a chase rather than a fresh filing. Surfaced alongside
  // `urgentCount` so the dashboard never reads "0 to file today"
  // while the same data renders TODAY-style badges in lower tiers.
  const stuckStatusFilter = or(
    ...GROUP_SUBMITTED_STUCK_STATUSES.map(s => eq(invoiceGroupsTable.status, s)),
  );
  const stuckGroupsWithDates = await db
    .select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      totalAmount: invoiceGroupsTable.totalAmount,
      status: invoiceGroupsTable.status,
      rideCount: invoiceGroupsTable.rideCount,
      earliestDate: sql<string | null>`to_char(MIN(NULLIF(${claimsTable.date}, '')::date), 'YYYY-MM-DD')`,
    })
    .from(invoiceGroupsTable)
    .leftJoin(claimsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
    .where(and(stuckStatusFilter, sql`${claimsTable.date} IS NOT NULL AND ${claimsTable.date} <> ''`))
    .groupBy(invoiceGroupsTable.id);

  const submittedStuckGroups = stuckGroupsWithDates
    .map(g => {
      const dl = daysRemaining(g.earliestDate);
      const eff = effectiveDaysRemaining(g.earliestDate, expiringNow);
      return {
        id: g.id,
        invoiceNumber: g.invoiceNumber,
        earliestDate: g.earliestDate!,
        totalAmount: g.totalAmount,
        status: g.status,
        rideCount: g.rideCount,
        daysLeft: dl!,
        effectiveDaysLeft: eff!,
        // Stuck rows are by definition past the effective deadline —
        // we still emit the flag so list consumers can short-circuit
        // if they want to render the deadline pill identically.
        isUrgent: eff != null && eff <= 0,
      };
    })
    // The defining cut: the row is "stuck" only when the effective
    // deadline has actually slipped. A Portal Queued group with a
    // healthy deadline is still working as designed — no escalation.
    .filter(g => g.effectiveDaysLeft !== null && g.effectiveDaysLeft <= 0)
    .sort((a, b) => a.effectiveDaysLeft - b.effectiveDaysLeft);

  const submittedStuckCount = submittedStuckGroups.length;

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

  // Cycle-aware overdue count: shared with the worker-activity endpoint
  // and the system-health rollup so the dashboard tile, the System Health
  // page, and the worker banner can never disagree.
  const overdueCount = await getOverdueCount(now);

  res.json({
    pipeline: { needsEvidence, portalQueued, awaitingResponse },
    stats: { total, new: newCount, resolved, denied, withdrawn, onHold, awaitingAttestation, withdrawnByReason, deniedByReason },
    amounts: { totalClaimed: totalClaimed.toFixed(2), totalApproved: totalApproved.toFixed(2), totalExposure: totalExposure.toFixed(2), totalLost: totalLost.toFixed(2), vendorPrepayRate: VENDOR_PREPAY_RATE },
    expiringGroups,
    urgentCount,
    submittedStuckGroups,
    submittedStuckCount,
    recentGroups,
    portalStats: { pending, submitted, failed, successRate },
    portalWorker: {
      lastRun: getLastWorkerRun(),
      isRunning: isWorkerRunInProgress(),
      pendingDueCount,
      overdueCount,
    },
    // Server-clock "today" stamp (Task #294). The deadline math above
    // (`isUrgentDeadline` / `effectiveDaysRemaining`) was computed
    // against `expiringNow`; embedding the matching `today` key lets the
    // client detect day rollover via a server signal — when a future
    // response carries a different `today`, the client invalidates
    // sister deadline-driven queries so the cache can never stay pinned
    // to yesterday's "must file today" math. See
    // `artifacts/claimclear/src/lib/server-day-rollover.ts`.
    today: serverTodayKey(expiringNow),
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

// Office wall-clock fallback. The streak pip is anchored to the user's
// local timezone (taken from the client query param), but if the client
// sends nothing — or sends garbage we can't validate — we fall back to
// the operations team's office tz so the count is never empty by accident.
const PIP_DEFAULT_TZ = "America/New_York";

function isValidIanaTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function dayKeyInTz(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Streak pip on the user avatar (Task #317). Returns the count of claims
// the calling user transitioned into "Processed" since the start of
// "today" in their local timezone. Drawn straight from the per-claim
// status-transition history (`audit_logs.action IN ('status_changed',
// 'claim_status_changed')` with `metadata->>'to' = 'Processed'`), so
// both direct manual transitions and group-cascaded ones initiated by
// the user count toward their personal momentum. Never exposes anything
// about other users — the actor filter is pinned to `req.user.email`.
router.get("/dashboard/my-processed-today", asyncHandler(async (req, res): Promise<void> => {
  const userEmail = req.user?.email;
  if (!userEmail) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const rawTz = typeof req.query.tz === "string" ? req.query.tz : "";
  const tz = rawTz && isValidIanaTz(rawTz) ? rawTz : PIP_DEFAULT_TZ;
  const now = new Date();
  const dayKey = dayKeyInTz(now, tz);

  // Compare the audit-log timestamp's calendar date *in the user's tz*
  // against the resolved dayKey. Postgres's `timestamptz AT TIME ZONE`
  // returns a wall-clock timestamp in that zone; casting to `date`
  // strips the time, giving us the local YYYY-MM-DD. This avoids any
  // off-by-one from doing the math in JS and round-tripping bounds.
  const [{ value } = { value: 0 }] = await db
    .select({ value: count() })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.userEmail, userEmail),
      inArray(auditLogsTable.action, ["status_changed", "claim_status_changed"]),
      sql`${auditLogsTable.metadata}->>'to' = 'Processed'`,
      sql`(${auditLogsTable.timestamp} AT TIME ZONE ${tz})::date = ${dayKey}::date`,
    ));

  res.json({ count: Number(value) || 0, timezone: tz, dayKey });
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
  // Raw count of rejected claims for this driver/member in the window. EVERY
  // imported claim represents a payor rejection (this is a claims-DISPUTE
  // tool — claims only land here because the payor rejected them); we count
  // them all except outcome=Non-Issue (which means "actually wasn't a
  // rejection" and should not appear in repeat-offender stats). This means
  // freshly-imported Pending claims show up here, not just downstream
  // Denied resolutions.
  rejectionCount: number;
  atRiskAmount: number;         // Sum of claimAmount across all rejection rows.
  approvedCount: number;        // For winRate — counts Approved + Partially Approved.
  deniedCount: number;          // For winRate — counts outcome=Denied only.
  lastRejectionDate: string | null;     // Max date across all rejection rows.
  errorTypeCounts: Map<string, number>; // Tally across all rejection rows.
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
    const isNonIssue = row.outcome === "Non-Issue";
    if (isApproved) agg.approvedCount += 1;
    if (isDenied) agg.deniedCount += 1;
    // Repeat-offender stats roll up EVERY claim a driver/member appears on
    // (except outcome=Non-Issue, which is the explicit "actually wasn't a
    // rejection" escape hatch). Counting only outcome=Denied would ignore
    // freshly-imported (Pending) claims and Withdrawn losses — but the
    // operator needs the full picture of how often this driver/member
    // generates rejected claims, not just resolved denials.
    if (!isNonIssue) {
      agg.rejectionCount += 1;
      const amt = parseFloat(row.claimAmount || "0");
      if (Number.isFinite(amt)) agg.atRiskAmount += amt;
      if (row.date && (!agg.lastRejectionDate || row.date > agg.lastRejectionDate)) {
        agg.lastRejectionDate = row.date;
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

// Actions we never want to surface in the dashboard activity feed because
// they're either too noisy or duplicate something else we already show.
const ACTIVITY_FEED_EXCLUDED_ACTIONS = [
  // Status sync rows are auto-generated alongside group_status_changed and
  // would otherwise drown out everything else.
  "status_changed",
  "outcome_changed",
  "status_and_outcome_changed",
  // Per-batch bot rows are extremely chatty and only meaningful in aggregate
  // (which is already on the System Health and Batches pages).
  "batch_claimed",
  "submission_complete",
  "dry_run_complete",
] as const;

router.get("/dashboard/activity", asyncHandler(async (req, res): Promise<void> => {
  const limit = parseLimit(req.query.limit, 15, 50);

  // Pull recent rows. We intentionally fetch a wider window than `limit` so
  // that filtering out child-claim sync rows still leaves us with a full feed.
  const fetchLimit = Math.max(limit * 4, 50);

  const rows = await db
    .select({
      id: auditLogsTable.id,
      action: auditLogsTable.action,
      details: auditLogsTable.details,
      metadata: auditLogsTable.metadata,
      userEmail: auditLogsTable.userEmail,
      userName: auditLogsTable.userName,
      timestamp: auditLogsTable.timestamp,
      claimId: auditLogsTable.claimId,
      invoiceGroupId: auditLogsTable.invoiceGroupId,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
      claimConfNumber: claimsTable.confNumber,
    })
    .from(auditLogsTable)
    .leftJoin(invoiceGroupsTable, eq(auditLogsTable.invoiceGroupId, invoiceGroupsTable.id))
    .leftJoin(claimsTable, eq(auditLogsTable.claimId, claimsTable.id))
    .orderBy(desc(auditLogsTable.timestamp), desc(auditLogsTable.id))
    .limit(fetchLimit);

  const events = rows
    .filter((r) => !(ACTIVITY_FEED_EXCLUDED_ACTIONS as readonly string[]).includes(r.action))
    .slice(0, limit)
    .map((r) => humanizeAuditRow(r));

  res.json({ events });
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

// ─────────────────────────────────────────────────────────────────────
// /dashboard/urgent-today/transitions
//
// Powers the "Why?" line and activity panel rendered next to the
// File-today hero on the Dashboard and the urgency hero on the Queue.
// Returns:
//   • currentlyUrgent: groups with an urgent (today-or-earlier) ET
//     deadline AND a status in the actionable set.
//   • clearedToday: rows in audit_logs from this ET day where a
//     `group_status_changed` moved a group OUT of the actionable set
//     (e.g. an operator filed it / packaged it). The point is to show
//     the team what already cleared today, so a low "File today" count
//     reads as "we did the work" rather than "we forgot".
//   • snapshots: the last 24 `dashboard_urgent_snapshot` rows from
//     state_events for the inline sparkline.
//   • todayKey: the ET day this response is anchored to (mirrors
//     `today` on /dashboard/summary; lets the rollover signal flip the
//     activity panel atomically too).
//
// See Task #298 for the design doc.
// ─────────────────────────────────────────────────────────────────────
router.get("/dashboard/urgent-today/transitions", asyncHandler(async (_req, res): Promise<void> => {
  const now = new Date();
  const todayKey = serverTodayKey(now);

  const snap = await computeUrgentSnapshot(now);

  // Hydrate the urgent-group rows with the columns the UI needs.
  // (computeUrgentSnapshot only returns IDs to keep the snapshot record
  // small.)
  const currentlyUrgentRows = snap.urgentGroupIds.length === 0
    ? []
    : await db
        .select({
          id: invoiceGroupsTable.id,
          invoiceNumber: invoiceGroupsTable.invoiceNumber,
          clientNumber: invoiceGroupsTable.clientNumber,
          status: invoiceGroupsTable.status,
          totalAmount: invoiceGroupsTable.totalAmount,
          earliestDate: sql<string | null>`MIN(${claimsTable.date})::text`,
        })
        .from(invoiceGroupsTable)
        .leftJoin(claimsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
        .where(inArray(invoiceGroupsTable.id, snap.urgentGroupIds))
        .groupBy(invoiceGroupsTable.id);

  // ET-anchored today window for audit_logs. We can't use a SQL
  // expression keyed on the host process's TZ (the db is UTC); convert
  // the ET day boundaries to UTC instants here and filter by them.
  // DST safety: dayEnd is the *next* ET midnight, NOT dayStart + 24h.
  // On spring-forward Sundays the ET day is 23h long; on fall-back it
  // is 25h. Computing both endpoints from `etMidnightUtcInstant`
  // delegates the offset math to Intl and keeps the window correct
  // across the boundary.
  const dayStartET = etMidnightUtcInstant(todayKey);
  const dayEndET = etMidnightUtcInstant(addDaysToYMD(todayKey, 1));

  // Pull every group_status_changed for the day, then filter in JS to
  // keep the SQL boring. Also include the parent group's earliest
  // claim date so the panel can render "(was urgent)" badges.
  const auditRows = await db
    .select({
      id: auditLogsTable.id,
      invoiceGroupId: auditLogsTable.invoiceGroupId,
      metadata: auditLogsTable.metadata,
      userName: auditLogsTable.userName,
      userEmail: auditLogsTable.userEmail,
      timestamp: auditLogsTable.timestamp,
    })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.action, "group_status_changed"),
        gte(auditLogsTable.timestamp, dayStartET),
        lte(auditLogsTable.timestamp, dayEndET),
      ),
    )
    .orderBy(desc(auditLogsTable.timestamp));

  type ClearedRow = {
    id: number;
    invoiceGroupId: number | null;
    invoiceNumber: string | null;
    /** Payor identifier (invoice_groups.client_number). */
    clientNumber: string | null;
    actor: string | null;
    /** Where did the change come from: operator UI / bot / classifier? */
    source: string | null;
    /** Free-text reason recorded on the audit row (operator note, etc.). */
    reason: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    timestamp: string;
    /** ET wall-clock formatting for the panel ("3:14 PM ET"). */
    timestampET: string;
  };

  const ACTIONABLE = new Set<string>(GROUP_EXPIRING_ACTIONABLE_STATUSES);
  const candidateRows: ClearedRow[] = [];
  for (const row of auditRows) {
    const meta = (row.metadata ?? {}) as {
      from?: string;
      to?: string;
      source?: string;
      reason?: string;
    };
    const fromStatus = meta.from ?? null;
    const toStatus = meta.to ?? null;
    // Only count transitions that LEFT the actionable set — those
    // genuinely cleared filing-clock work. (A New → Needs Evidence
    // move is a re-categorisation; the row is still on the clock.)
    if (!fromStatus || !toStatus) continue;
    if (!ACTIONABLE.has(fromStatus)) continue;
    if (ACTIONABLE.has(toStatus)) continue;
    candidateRows.push({
      id: row.id,
      invoiceGroupId: row.invoiceGroupId,
      invoiceNumber: null, // joined below
      clientNumber: null, // joined below
      actor: row.userName ?? row.userEmail ?? null,
      source: meta.source ?? null,
      reason: meta.reason ?? null,
      fromStatus,
      toStatus,
      timestamp: row.timestamp.toISOString(),
      timestampET: formatEtTimeOfDay(row.timestamp),
    });
  }

  // Join invoice_number, client_number (payor), and the earliest
  // service date for each parent group. The earliest service date
  // determines whether the group was actually urgent today (deadline
  // ≤ today ET) — without this guard, the panel would surface an
  // unrelated New→Closed transition as "cleared today" even though
  // the row was nowhere near the file-today clock.
  const groupMeta = new Map<number, { invoiceNumber: string | null; clientNumber: string | null; earliestDate: string | null }>();
  if (candidateRows.length > 0) {
    const ids = Array.from(new Set(candidateRows.map(r => r.invoiceGroupId).filter((x): x is number => x != null)));
    if (ids.length > 0) {
      const groups = await db
        .select({
          id: invoiceGroupsTable.id,
          invoiceNumber: invoiceGroupsTable.invoiceNumber,
          clientNumber: invoiceGroupsTable.clientNumber,
          earliestDate: sql<string | null>`MIN(${claimsTable.date})::text`,
        })
        .from(invoiceGroupsTable)
        .leftJoin(claimsTable, eq(claimsTable.invoiceGroupId, invoiceGroupsTable.id))
        .where(inArray(invoiceGroupsTable.id, ids))
        .groupBy(invoiceGroupsTable.id, invoiceGroupsTable.invoiceNumber, invoiceGroupsTable.clientNumber);
      for (const g of groups) {
        groupMeta.set(g.id, {
          invoiceNumber: g.invoiceNumber,
          clientNumber: g.clientNumber,
          earliestDate: g.earliestDate,
        });
      }
    }
  }

  // Final filter: only include rows whose group was urgent (by
  // deadline math) at some point today. We use the earliest service
  // date as the proxy — if `effectiveDaysRemaining(earliestDate, now) <= 0`
  // the group was on the file-today clock immediately before this row
  // moved it out of the actionable set.
  const clearedRowsRaw: ClearedRow[] = [];
  for (const c of candidateRows) {
    const meta = c.invoiceGroupId != null ? groupMeta.get(c.invoiceGroupId) : undefined;
    const earliestDate = meta?.earliestDate ?? null;
    const eff = effectiveDaysRemaining(earliestDate, now);
    if (eff == null || eff > 0) continue; // group wasn't urgent today, skip
    clearedRowsRaw.push({
      ...c,
      invoiceNumber: meta?.invoiceNumber ?? null,
      clientNumber: meta?.clientNumber ?? null,
    });
  }

  const byToStatus: Record<string, number> = {};
  const actorSet = new Set<string>();
  for (const r of clearedRowsRaw) {
    byToStatus[r.toStatus ?? "?"] = (byToStatus[r.toStatus ?? "?"] ?? 0) + 1;
    if (r.actor) actorSet.add(r.actor);
  }

  // Inline sparkline data — last 24 snapshots for the current ET day.
  // The cron records hourly during business hours; on a fresh deploy
  // the series may be empty and the UI will degrade gracefully.
  const snapshotRows = await db
    .select({
      createdAt: stateEventsTable.createdAt,
      metadata: stateEventsTable.metadata,
    })
    .from(stateEventsTable)
    .where(
      and(
        eq(stateEventsTable.eventKey, "dashboard_urgent_snapshot"),
        gte(stateEventsTable.createdAt, dayStartET),
        lte(stateEventsTable.createdAt, dayEndET),
      ),
    )
    .orderBy(stateEventsTable.createdAt);

  type SnapPoint = { at: string; urgentCount: number; totalActionable: number };
  const snapshots: SnapPoint[] = snapshotRows.map(r => {
    const meta = (r.metadata ?? {}) as { urgentCount?: number; totalActionable?: number };
    return {
      at: r.createdAt.toISOString(),
      urgentCount: typeof meta.urgentCount === "number" ? meta.urgentCount : 0,
      totalActionable: typeof meta.totalActionable === "number" ? meta.totalActionable : 0,
    };
  });

  // Today-was-urgent guard for the UI: the "Why?" line should
  // suppress itself entirely on calm days where nothing was ever
  // urgent. Compute the max urgentCount we saw today across the
  // snapshot series so the frontend can render nothing when both
  // urgentCount AND cleared AND maxUrgentToday are zero.
  const maxUrgentToday = Math.max(
    snap.urgentCount,
    clearedRowsRaw.length,
    ...snapshots.map(s => s.urgentCount),
  );
  const wasUrgentToday = maxUrgentToday > 0;

  res.json({
    today: todayKey,
    urgentCount: snap.urgentCount,
    totalActionable: snap.totalActionable,
    byStatus: snap.byStatus,
    /** True when the file-today queue was ≥1 at any point today (snapshot series, current count, or cleared rows). */
    wasUrgentToday,
    /** Highest urgent count we saw today, used for the "peaked at N" sentence in the panel. */
    maxUrgentToday,
    currentlyUrgent: currentlyUrgentRows.map(r => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      clientNumber: r.clientNumber,
      status: r.status,
      totalAmount: r.totalAmount,
      earliestDate: r.earliestDate,
    })),
    clearedToday: clearedRowsRaw.slice(0, 50),
    clearedSummary: {
      total: clearedRowsRaw.length,
      byToStatus,
      actors: Array.from(actorSet).sort(),
    },
    snapshots,
  });
}));

// "3:14 PM ET" — the wall-clock the operators read off the clock on
// the wall. Used in the cleared-today rows so the panel doesn't have
// to do its own client-side TZ math.
function formatEtTimeOfDay(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${fmt.format(d)} ET`;
}

// Convert a YYYY-MM-DD ET calendar key to the UTC `Date` representing
// midnight at the start of that ET day. Handles DST automatically by
// asking Intl what the UTC offset is at the requested instant.
export function etMidnightUtcInstant(ymd: string): Date {
  // Build the candidate UTC midnight for the date, then ask what the
  // ET offset is at that instant. Subtract that offset to land on the
  // true ET midnight. This is correct on both sides of DST because
  // `Intl.DateTimeFormat` reports the offset at the queried instant.
  const utcGuess = new Date(`${ymd}T00:00:00Z`);
  // Compute ET offset (in minutes) at the guess instant.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
    hour: "numeric",
  });
  const parts = fmt.formatToParts(utcGuess);
  const tzPart = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT-5";
  // tzPart is like "GMT-5" or "GMT-4". Parse the hour offset.
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzPart);
  const sign = m && m[1] === "-" ? -1 : 1;
  const hours = m ? parseInt(m[2], 10) : 5;
  const mins = m && m[3] ? parseInt(m[3], 10) : 0;
  const offsetMin = sign * (hours * 60 + mins);
  // ET midnight = UTC midnight - offset. (When ET is UTC-5, ET midnight
  // == UTC 05:00, so we add 5h.)
  return new Date(utcGuess.getTime() - offsetMin * 60 * 1000);
}

export default router;
