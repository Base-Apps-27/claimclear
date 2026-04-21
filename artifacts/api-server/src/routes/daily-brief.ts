import { Router, type IRouter } from "express";
import { eq, or, and, sql, count, gte, lt, desc, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, portalSubmissionsTable, cronRunsTable, auditLogsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { daysRemaining } from "../lib/dates";
import { isOutlookConnected } from "../lib/outlook";
import { sendEmailWithContext } from "../lib/email-send";
import { getConnectorHealth } from "../lib/connector-health";
import {
  OPEN_STATUSES,
  getYesterdayActivity,
  getNeedsYouToday,
  getWeeklyDigest,
  getBriefRecipients,
  isMondayInNewYork,
  type YesterdayActivity,
  type NeedsYouToday,
  type WeeklyDigest,
} from "../lib/brief-personalization";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const VENDOR_PREPAY_RATE = 0.70;

interface ExpiringClaim {
  id: number;
  confNumber: string;
  date: string;
  claimAmount: string | null;
  status: string;
  daysLeft: number;
}

interface AutomationSummary {
  totalRuns: number;
  failures: number;
  byJob: { jobName: string; runs: number; failures: number }[];
}

interface NeedsAttentionRow {
  id: number;
  confNumber: string | null;
  attempts: number;
  maxAttempts: number;
  status: string;
  errorMessage: string | null;
  nextRetryAt: string | null;
  reason: "failed" | "auto_reset";
}

interface AdminMetrics {
  openCount: number;
  expiring: ExpiringClaim[];
  expired: ExpiringClaim[];
  claimAmountAtRisk: number;
  totalAtRisk: number;
  submitted: number;
  failed: number;
  automation: AutomationSummary;
  outlookHealthy: boolean;
  outlookError: string | null;
  needsAttention: NeedsAttentionRow[];
}

function briefShell(title: string, dateLabel: string, body: string, outlookHealthy: boolean, outlookError: string | null): string {
  const outlookBanner = !outlookHealthy
    ? `<div style="background:#fee2e2;border:1px solid #fecaca;color:#991b1b;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;">
        <strong>Outlook connector unhealthy.</strong> Email automation may be delayed or skipped. ${outlookError ? `<br/><span style="font-family:monospace;font-size:11px;opacity:0.8;">${outlookError.slice(0, 240)}</span>` : ""}
      </div>`
    : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#1B2A4A;color:white;padding:24px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:24px;color:white;">${title}</h1>
      <p style="margin:8px 0 0;opacity:0.9;">${dateLabel}</p>
    </div>
    <div style="background:white;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      ${outlookBanner}
      ${body}
    </div>
  </div>
</body>
</html>`;
}

function renderWeeklyDigestSection(d: WeeklyDigest): string {
  const wonDelta = d.thisWeek.won - d.priorWeek.won;
  const lostDelta = d.thisWeek.lost - d.priorWeek.lost;
  const fmtDelta = (n: number) => (n === 0 ? "no change" : n > 0 ? `+${n}` : `${n}`);
  const topRows = d.topErrorTypes.length === 0
    ? `<tr><td colspan="2" style="padding:8px;color:#64748b;font-size:13px;">No recoveries this week.</td></tr>`
    : d.topErrorTypes
        .map(
          (t) => `<tr>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${t.errorTypeName}</td>
            <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">$${t.recoveredAmount.toFixed(2)}</td>
          </tr>`,
        )
        .join("");
  return `
  <div style="margin-top:24px;padding-top:16px;border-top:2px solid #e2e8f0;">
    <h2 style="font-size:16px;color:#1e293b;margin:0 0 12px;">Weekly Digest</h2>
    <div style="display:flex;gap:12px;margin-bottom:16px;">
      <div style="flex:1;padding:12px;background:#f0fdf4;border-radius:8px;">
        <div style="font-size:20px;font-weight:700;color:#16a34a;">${d.thisWeek.won}</div>
        <div style="font-size:11px;color:#166534;">Won this week (${fmtDelta(wonDelta)} vs prior)</div>
      </div>
      <div style="flex:1;padding:12px;background:#fef2f2;border-radius:8px;">
        <div style="font-size:20px;font-weight:700;color:#dc2626;">${d.thisWeek.lost}</div>
        <div style="font-size:11px;color:#991b1b;">Lost this week (${fmtDelta(lostDelta)} vs prior)</div>
      </div>
      <div style="flex:1;padding:12px;background:#EBF0FA;border-radius:8px;">
        <div style="font-size:20px;font-weight:700;color:#1B2A4A;">${d.avgDaysToResolution != null ? d.avgDaysToResolution.toFixed(1) : "—"}</div>
        <div style="font-size:11px;color:#3478F6;">Avg days to resolution</div>
      </div>
    </div>
    <h3 style="font-size:14px;color:#1e293b;margin:0 0 8px;">Top error types by recovered amount</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tbody>${topRows}</tbody>
    </table>
  </div>`;
}

function renderAdminBody(m: AdminMetrics, yesterday: YesterdayActivity, weeklyDigest: WeeklyDigest | null): string {
  const expiringRows = m.expiring
    .map(c => `<tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${c.confNumber}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${c.date}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">$${c.claimAmount || "0.00"}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:${c.daysLeft <= 3 ? "#dc2626" : "#f59e0b"};font-weight:600;">${c.daysLeft} days</td>
    </tr>`)
    .join("");

  const attentionRows = m.needsAttention.map(r => {
    const reasonLabel = r.reason === "auto_reset" ? "Auto-reset (was stuck)" : "Failed";
    const nextRetry = r.nextRetryAt ? `Next retry: ${new Date(r.nextRetryAt).toLocaleString("en-US", { timeZone: "America/New_York" })}` : (r.status === "failed" ? "Retries exhausted" : "");
    const errSnippet = (r.errorMessage || "").slice(0, 140);
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #fde68a;font-family:monospace;font-size:12px;">${r.confNumber || `#${r.id}`}</td>
      <td style="padding:8px;border-bottom:1px solid #fde68a;font-size:12px;">${reasonLabel}</td>
      <td style="padding:8px;border-bottom:1px solid #fde68a;font-size:12px;">${r.attempts}/${r.maxAttempts}</td>
      <td style="padding:8px;border-bottom:1px solid #fde68a;font-size:12px;color:#92400e;">${nextRetry}</td>
      <td style="padding:8px;border-bottom:1px solid #fde68a;font-size:11px;color:#7c2d12;">${errSnippet}</td>
    </tr>`;
  }).join("");

  const attentionBlock = m.needsAttention.length > 0
    ? `<div style="margin-bottom:24px;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
        <h2 style="font-size:16px;color:#92400e;margin:0 0 8px;">Submissions needing attention (${m.needsAttention.length})</h2>
        <p style="margin:0 0 12px;color:#78350f;font-size:12px;">Failed portal submissions and recently auto-reset stuck submissions from the last 24 hours.</p>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;overflow:hidden;">
          <thead><tr style="background:#fef3c7;">
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Conf #</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Reason</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Attempts</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Next retry</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Last error</th>
          </tr></thead>
          <tbody>${attentionRows}</tbody>
        </table>
      </div>`
    : "";

  const automationFooter = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
      Yesterday's automation: <strong>${m.automation.totalRuns} runs, ${m.automation.failures} failure${m.automation.failures === 1 ? "" : "s"}</strong> &mdash;
      <a href="/system-health" style="color:#3478F6;text-decoration:none;">View System Health</a>
    </div>`;

  return `
      <div style="display:flex;gap:16px;margin-bottom:24px;">
        <div style="flex:1;text-align:center;padding:16px;background:#EBF0FA;border-radius:8px;">
          <div style="font-size:28px;font-weight:700;color:#1B2A4A;">${m.openCount}</div>
          <div style="font-size:12px;color:#3478F6;margin-top:4px;">Open Claims</div>
        </div>
        <div style="flex:1;text-align:center;padding:16px;background:${m.expired.length > 0 ? "#fef2f2" : "#f0fdf4"};border-radius:8px;">
          <div style="font-size:28px;font-weight:700;color:${m.expired.length > 0 ? "#dc2626" : "#16a34a"};">${m.expired.length}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Expired</div>
        </div>
        <div style="flex:1;text-align:center;padding:16px;background:#fffbeb;border-radius:8px;">
          <div style="font-size:28px;font-weight:700;color:#d97706;">$${m.totalAtRisk.toFixed(2)}</div>
          <div style="font-size:12px;color:#92400e;margin-top:4px;">Total Exposure (approx.)</div>
          <div style="font-size:10px;color:#92400e;margin-top:2px;">Claims $${m.claimAmountAtRisk.toFixed(2)} + ~70% vendor prepay</div>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <h2 style="font-size:16px;color:#1e293b;margin:0 0 8px;">Portal Submissions</h2>
        <p style="margin:0;color:#64748b;font-size:14px;">${m.submitted} submitted, ${m.failed} failed</p>
      </div>

      <div style="margin-bottom:24px;padding:16px;background:#f8fafc;border-radius:8px;">
        <h2 style="font-size:16px;color:#1e293b;margin:0 0 12px;">Yesterday at a glance</h2>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#475569;">
          <div><strong style="color:#1B2A4A;">${yesterday.claimsCreated}</strong> claims created</div>
          <div><strong style="color:#1B2A4A;">${yesterday.draftsSubmitted}</strong> drafts submitted</div>
          <div><strong style="color:#1B2A4A;">${yesterday.responsesReceived}</strong> responses received</div>
          <div><strong style="color:#1B2A4A;">${yesterday.decisionsLogged}</strong> decisions logged</div>
        </div>
      </div>

      ${attentionBlock}

      ${automationFooter}

      ${m.expiring.length > 0 ? `
      <div>
        <h2 style="font-size:16px;color:#1e293b;margin:0 0 12px;">Expiring Claims (${m.expiring.length})</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Conf #</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Service Date</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Amount</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Time Left</th>
            </tr>
          </thead>
          <tbody>${expiringRows}</tbody>
        </table>
      </div>` : "<p style='color:#16a34a;font-size:14px;'>No claims expiring within 10 days.</p>"}

      ${weeklyDigest ? renderWeeklyDigestSection(weeklyDigest) : ""}`;
}

function renderItemList(title: string, items: { id: number; confNumber: string; status: string; reason: string; href: string }[]): string {
  if (items.length === 0) {
    return `<div style="margin-bottom:20px;">
      <h2 style="font-size:15px;color:#1e293b;margin:0 0 8px;">${title}</h2>
      <p style="margin:0;color:#64748b;font-size:13px;">Nothing here today.</p>
    </div>`;
  }
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><a href="${i.href}" style="color:#3478F6;text-decoration:none;">${i.confNumber}</a></td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px;">${i.status}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:12px;">${i.reason}</td>
      </tr>`,
    )
    .join("");
  return `<div style="margin-bottom:20px;">
    <h2 style="font-size:15px;color:#1e293b;margin:0 0 8px;">${title} (${items.length})</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderOperatorBody(needs: NeedsYouToday, weeklyDigest: WeeklyDigest | null): string {
  const total = needs.recentlyTouched.length + needs.unsubmittedDrafts.length + needs.needsReview.length;
  const intro = total === 0
    ? `<p style="color:#16a34a;font-size:14px;margin:0 0 16px;">You're all caught up — nothing on your worklist today.</p>`
    : `<p style="color:#475569;font-size:14px;margin:0 0 16px;">${total} item${total === 1 ? "" : "s"} need your attention today.</p>`;
  return `
      ${intro}
      ${renderItemList("Drafts you started but haven't submitted", needs.unsubmittedDrafts)}
      ${renderItemList("Recently touched (still open)", needs.recentlyTouched)}
      ${renderItemList("Responses needing review", needs.needsReview)}
      ${weeklyDigest ? renderWeeklyDigestSection(weeklyDigest) : ""}`;
}

async function gatherAdminMetrics(): Promise<AdminMetrics> {
  const openStatusFilter = or(...OPEN_STATUSES.map(s => eq(claimsTable.status, s)));

  const [openCountResult] = await db
    .select({ count: count() })
    .from(claimsTable)
    .where(openStatusFilter);
  const openCount = openCountResult.count;

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

  const expiring: ExpiringClaim[] = openClaimsWithDates
    .filter(c => c.date)
    .map(c => {
      const dl = daysRemaining(c.date);
      return { id: c.id, confNumber: c.confNumber, date: c.date!, claimAmount: c.claimAmount, status: c.status, daysLeft: dl! };
    })
    .filter(c => c.daysLeft !== null && c.daysLeft <= 10)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const expired = expiring.filter(c => c.daysLeft <= 0);
  const claimAmountAtRisk = expiring.reduce((sum, c) => sum + (parseFloat(c.claimAmount || "0") || 0), 0);
  const totalAtRisk = claimAmountAtRisk * (1 + VENDOR_PREPAY_RATE);

  const submissionCountsRaw = await db
    .select({ status: portalSubmissionsTable.status, count: count() })
    .from(portalSubmissionsTable)
    .groupBy(portalSubmissionsTable.status);

  const subCounts = Object.fromEntries(submissionCountsRaw.map(r => [r.status, r.count]));
  const submitted = subCounts["submitted"] || 0;
  const failed = subCounts["failed"] || 0;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const automationRows = await db
    .select({ jobName: cronRunsTable.jobName, status: cronRunsTable.status, count: count() })
    .from(cronRunsTable)
    .where(and(gte(cronRunsTable.startedAt, yesterdayStart), lt(cronRunsTable.startedAt, todayStart)))
    .groupBy(cronRunsTable.jobName, cronRunsTable.status);

  const byJobMap = new Map<string, { runs: number; failures: number }>();
  let totalRuns = 0;
  let totalFailures = 0;
  for (const r of automationRows) {
    const entry = byJobMap.get(r.jobName) ?? { runs: 0, failures: 0 };
    entry.runs += r.count;
    if (r.status === "failed") entry.failures += r.count;
    byJobMap.set(r.jobName, entry);
    totalRuns += r.count;
    if (r.status === "failed") totalFailures += r.count;
  }
  const automation: AutomationSummary = {
    totalRuns,
    failures: totalFailures,
    byJob: Array.from(byJobMap.entries()).map(([jobName, v]) => ({ jobName, runs: v.runs, failures: v.failures })),
  };

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const failedSubs = await db.select({
    id: portalSubmissionsTable.id,
    confNumber: portalSubmissionsTable.confNumber,
    attempts: portalSubmissionsTable.attempts,
    maxAttempts: portalSubmissionsTable.maxAttempts,
    status: portalSubmissionsTable.status,
    errorMessage: portalSubmissionsTable.errorMessage,
    nextRetryAt: portalSubmissionsTable.nextRetryAt,
    updatedAt: portalSubmissionsTable.updatedAt,
  }).from(portalSubmissionsTable)
    .where(and(eq(portalSubmissionsTable.status, "failed"), gte(portalSubmissionsTable.updatedAt, since24h)))
    .orderBy(desc(portalSubmissionsTable.updatedAt))
    .limit(50);

  const stuckResetEvents = await db.select({
    submissionId: sql<number>`(${auditLogsTable.metadata}->>'submissionId')::int`,
    timestamp: auditLogsTable.timestamp,
  }).from(auditLogsTable)
    .where(and(eq(auditLogsTable.action, "submission_stuck_reset"), gte(auditLogsTable.timestamp, since24h)))
    .orderBy(desc(auditLogsTable.timestamp))
    .limit(50);

  const stuckIds = Array.from(new Set(stuckResetEvents.map(e => e.submissionId).filter((v): v is number => typeof v === "number")));
  const failedIdSet = new Set(failedSubs.map(s => s.id));
  const extraStuckIds = stuckIds.filter(id => !failedIdSet.has(id));
  const stuckSubs = extraStuckIds.length > 0
    ? await db.select({
        id: portalSubmissionsTable.id,
        confNumber: portalSubmissionsTable.confNumber,
        attempts: portalSubmissionsTable.attempts,
        maxAttempts: portalSubmissionsTable.maxAttempts,
        status: portalSubmissionsTable.status,
        errorMessage: portalSubmissionsTable.errorMessage,
        nextRetryAt: portalSubmissionsTable.nextRetryAt,
      }).from(portalSubmissionsTable).where(inArray(portalSubmissionsTable.id, extraStuckIds))
    : [];

  const needsAttention: NeedsAttentionRow[] = [
    ...failedSubs.map(s => ({
      id: s.id,
      confNumber: s.confNumber,
      attempts: s.attempts,
      maxAttempts: s.maxAttempts,
      status: s.status,
      errorMessage: s.errorMessage,
      nextRetryAt: s.nextRetryAt ? s.nextRetryAt.toISOString() : null,
      reason: "failed" as const,
    })),
    ...stuckSubs.map(s => ({
      id: s.id,
      confNumber: s.confNumber,
      attempts: s.attempts,
      maxAttempts: s.maxAttempts,
      status: s.status,
      errorMessage: s.errorMessage,
      nextRetryAt: s.nextRetryAt ? s.nextRetryAt.toISOString() : null,
      reason: "auto_reset" as const,
    })),
  ];

  const outlookHealthRow = await getConnectorHealth("outlook");
  const outlookHealthy = outlookHealthRow ? outlookHealthRow.status === "healthy" : await isOutlookConnected();
  const outlookError = outlookHealthRow?.lastError ?? null;

  return { openCount, expiring, expired, claimAmountAtRisk, totalAtRisk, submitted, failed, automation, outlookHealthy, outlookError, needsAttention };
}

router.post("/", asyncHandler(async (req, res): Promise<void> => {
  const recipientsOverride = typeof req.body?.recipients === "string" ? req.body.recipients : undefined;

  const metrics = await gatherAdminMetrics();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const subject = `Agape ClaimClear Daily Brief - ${metrics.openCount} open claims, ${metrics.expired.length} expired`;
  const outlookAvailable = await isOutlookConnected();

  // Legacy/shared mode: single brief to explicit recipients (smoke test path)
  if (recipientsOverride || process.env.DAILY_BRIEF_RECIPIENTS) {
    const recipients = recipientsOverride || process.env.DAILY_BRIEF_RECIPIENTS!;
    const yesterday = await getYesterdayActivity(yesterdayStart, todayStart);
    const weekly = isMondayInNewYork(now) ? await getWeeklyDigest(now) : null;
    const html = briefShell(
      "Agape ClaimClear Daily Brief",
      dateLabel,
      renderAdminBody(metrics, yesterday, weekly),
      metrics.outlookHealthy,
      metrics.outlookError,
    );

    let emailSent = false;
    let emailMethod = "none";
    if (outlookAvailable && recipients) {
      try {
        await sendEmailWithContext({ to: recipients, subject, html }, { kind: "daily_brief" });
        emailSent = true;
        emailMethod = "outlook";
      } catch (err) {
        logger.error({ err }, "[DAILY BRIEF] Outlook send failed");
      }
    }

    if (!emailSent && process.env.SMTP_HOST && process.env.SMTP_USER && recipients) {
      try {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587", 10),
          secure: process.env.SMTP_SECURE === "true",
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: recipients,
          subject,
          html,
        });
        emailSent = true;
        emailMethod = "smtp";
      } catch (err) {
        logger.error({ err }, "[DAILY BRIEF] SMTP send failed");
      }
    }

    const message = `${metrics.openCount} open claims, ${metrics.expired.length} expired, $${metrics.totalAtRisk.toFixed(2)} at risk. ${metrics.submitted} submitted, ${metrics.failed} failed portal submissions.${emailSent ? ` Email sent via ${emailMethod}.` : " Email not sent (no provider configured or no recipients)."}`;
    res.json({ sent: emailSent, method: emailMethod, message });
    return;
  }

  // Personalized mode: one email per approved user
  const recipients = await getBriefRecipients();
  const isMonday = isMondayInNewYork(now);
  const yesterday = await getYesterdayActivity(yesterdayStart, todayStart);
  const weeklyDigest = isMonday ? await getWeeklyDigest(now) : null;

  let totalSent = 0;
  let totalSkipped = 0;
  const failures: { email: string; error: string }[] = [];

  if (!outlookAvailable) {
    res.json({
      sent: false,
      method: "none",
      message: `Outlook unavailable; skipped ${recipients.length} personalized briefs.`,
    });
    return;
  }

  for (const r of recipients) {
    const includeWeekly = isMonday && r.weeklyDigestEnabled ? weeklyDigest : null;
    const isAdmin = r.role === "admin";
    let html: string;
    if (isAdmin) {
      html = briefShell(
        "Agape ClaimClear Daily Brief",
        dateLabel,
        renderAdminBody(metrics, yesterday, includeWeekly),
        metrics.outlookHealthy,
        metrics.outlookError,
      );
    } else {
      const needs = await getNeedsYouToday(r.email, now);
      html = briefShell(
        "Your ClaimClear Worklist",
        dateLabel,
        renderOperatorBody(needs, includeWeekly),
        metrics.outlookHealthy,
        metrics.outlookError,
      );
    }

    try {
      await sendEmailWithContext({ to: r.email, subject, html }, { kind: "daily_brief" });
      totalSent++;
    } catch (err) {
      totalSkipped++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ email: r.email, error: msg.slice(0, 200) });
      logger.error({ err, email: r.email }, "[DAILY BRIEF] per-user send failed");
    }
  }

  const message = `Sent ${totalSent} personalized brief${totalSent === 1 ? "" : "s"}${totalSkipped > 0 ? `, ${totalSkipped} failed` : ""}. ${metrics.openCount} open claims, ${metrics.expired.length} expired.`;
  res.json({
    sent: totalSent > 0,
    method: totalSent > 0 ? "outlook" : "none",
    message,
    recipientCount: recipients.length,
    sentCount: totalSent,
    failedCount: totalSkipped,
    failures,
  });
}));

export default router;
