import { Router, type IRouter } from "express";
import { eq, or, and, sql, count, gte, lt, lte, desc, inArray, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  claimsTable,
  portalSubmissionsTable,
  cronRunsTable,
  auditLogsTable,
  outboundEmailsTable,
  emailBouncesTable,
} from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { effectiveDaysRemaining, formatServiceDate, isUrgentDeadline } from "../lib/dates";
import { SOON_DAYS, VENDOR_PREPAY_RATE } from "../lib/risk-config";
import { CLAIM_EXPIRING_ACTIONABLE_STATUSES } from "./dashboard";
import { isOutlookConnected } from "../lib/outlook";
import { sendEmailWithContext, recordDailyBriefAttempt, persistDailyBriefRow } from "../lib/email-send";
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
import {
  computeBriefOutcome,
  evaluateBounceDowngrade,
  safeClaimAmountAtRisk,
  BOUNCE_RECHECK_WINDOW_MS,
  type BriefRecipientResult,
} from "../lib/daily-brief-outcome";
import { logger } from "../lib/logger";

// Cap on the actionable-claims select feeding the at-risk dollar reduce.
// Hard cap to prevent a runaway query from OOM-ing the brief loop.
const EXPIRING_CANDIDATES_LIMIT = 1000;

const router: IRouter = Router();

interface ExpiringClaim {
  id: number;
  confNumber: string;
  date: string;
  claimAmount: string | null;
  status: string;
  // `daysLeft` reflects the *effective* deadline (weekend deadlines pulled
  // back to the prior Friday), so it matches the dashboard's
  // `effectiveDaysLeft` and the SQL-side filter on the list pages.
  daysLeft: number;
  isUrgent: boolean;
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
  manualRequeues: ManualRequeueRow[];
}

interface ManualRequeueRow {
  submissionId: number;
  reason: string | null;
  timestamp: string;
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
  const withdrawnDelta = d.thisWeek.withdrawn - d.priorWeek.withdrawn;
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
        <div style="font-size:11px;color:#991b1b;">Denied by payer this week (${fmtDelta(lostDelta)} vs prior)</div>
      </div>
      <div style="flex:1;padding:12px;background:#fef9c3;border-radius:8px;">
        <div style="font-size:20px;font-weight:700;color:#a16207;">${d.thisWeek.withdrawn}</div>
        <div style="font-size:11px;color:#854d0e;">Withdrawn this week (${fmtDelta(withdrawnDelta)} vs prior)</div>
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
  // The deadline list only shows rows that are still actionable (deadline
  // today or in the future). Already-expired claims are surfaced by the
  // "Expired" KPI tile and the at-risk dollar totals — repeating them here
  // just buries the rows staff can still do something about today.
  const actionableExpiring = m.expiring.filter(c => c.daysLeft >= 0);
  const urgentCount = actionableExpiring.filter(c => c.isUrgent).length;
  const base = appBaseUrl();
  const expiringRows = actionableExpiring
    .map(c => {
      const color = c.isUrgent ? "#dc2626" : "#f59e0b";
      const label = c.isUrgent ? "Now" : `${c.daysLeft}d`;
      const claimHref = `${base}/claims/${c.id}`;
      return `<tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><a href="${claimHref}" style="color:#3478F6;text-decoration:none;font-family:monospace;">${c.confNumber}</a></td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${formatServiceDate(c.date)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">$${c.claimAmount || "0.00"}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:${color};font-weight:600;">${label}</td>
    </tr>`;
    })
    .join("");
  const urgentListHref = `${base}/claims?expiring=urgent`;
  const soonListHref = `${base}/claims?expiring=soon`;

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

  const requeueIds = m.manualRequeues.map(r => `#${r.submissionId}`).join(", ");
  const requeueReason = m.manualRequeues.find(r => r.reason)?.reason?.slice(0, 200) || null;
  const requeueNote = m.manualRequeues.length > 0
    ? `<p style="margin:0 0 12px;color:#1e3a8a;font-size:12px;background:#dbeafe;border:1px solid #bfdbfe;border-radius:6px;padding:8px 10px;">
        <strong>Auto re-queued in the last 24h:</strong> ${m.manualRequeues.length} submission${m.manualRequeues.length === 1 ? "" : "s"} (${requeueIds})${requeueReason ? ` — ${requeueReason}` : ""}.
      </p>`
    : "";

  const attentionBlock = (m.needsAttention.length > 0 || m.manualRequeues.length > 0)
    ? `<div style="margin-bottom:24px;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
        <h2 style="font-size:16px;color:#92400e;margin:0 0 8px;">Submissions needing attention (${m.needsAttention.length})</h2>
        <p style="margin:0 0 12px;color:#78350f;font-size:12px;">Failed portal submissions and recently auto-reset stuck submissions from the last 24 hours.</p>
        ${requeueNote}
        ${m.needsAttention.length > 0 ? `<table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;overflow:hidden;">
          <thead><tr style="background:#fef3c7;">
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Conf #</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Reason</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Attempts</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Next retry</th>
            <th style="padding:8px;text-align:left;font-size:12px;color:#92400e;">Last error</th>
          </tr></thead>
          <tbody>${attentionRows}</tbody>
        </table>` : ""}
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
        <p style="margin:0;color:#64748b;font-size:14px;">${m.submitted} submitted, ${m.failed} failed yesterday</p>
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

      ${actionableExpiring.length > 0 ? `
      <div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin:0 0 12px;gap:12px;flex-wrap:wrap;">
          <h2 style="font-size:16px;color:#1e293b;margin:0;">
            Needs filing now
            <span style="font-size:13px;font-weight:500;color:${urgentCount > 0 ? "#dc2626" : "#64748b"};margin-left:6px;">
              · ${urgentCount} must file today${urgentCount > 0 ? `, ${actionableExpiring.length - urgentCount} more in next ${SOON_DAYS} days` : `, ${actionableExpiring.length} approaching deadline`}
            </span>
          </h2>
          <a href="${urgentListHref}" style="font-size:12px;color:#3478F6;text-decoration:none;font-weight:600;">
            Open urgent worklist →
          </a>
        </div>
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
        <p style="margin:8px 0 0;font-size:11px;color:#94a3b8;">
          <a href="${soonListHref}" style="color:#94a3b8;text-decoration:underline;">See full ${SOON_DAYS}-day window</a>
        </p>
      </div>` : "<p style='color:#16a34a;font-size:14px;'>Nothing to file today — no actionable claims approaching their filing deadline.</p>"}

      ${weeklyDigest ? renderWeeklyDigestSection(weeklyDigest) : ""}`;
}

// Public base URL for links rendered into emails. Falls back to the current
// Replit dev domain so links work in development; in production, set
// APP_BASE_URL to the deployed origin (e.g. https://claimclear.replit.app).
function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "";
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

async function gatherAdminMetrics(yesterdayStart: Date, todayStart: Date): Promise<AdminMetrics> {
  const openStatusFilter = or(...OPEN_STATUSES.map(s => eq(claimsTable.status, s)));
  // For the deadline list specifically, narrow to the same "next action is on
  // us" subset the dashboard uses. Claims in "Awaiting Response" / "On Hold"
  // are open, but we can't actually file them today, so listing them in the
  // expiring worklist just adds noise. Open count and yesterday-activity
  // metrics still use the full open set.
  // Wave C reader switch (Task #517): claim-level filter — claims do
  // not have their own `phase` column (phase lives on the parent
  // invoice group), and `claims.disposition` does not by itself encode
  // whether the parent has been submitted (a `disposed_portal` claim
  // can sit under either a pre-submit `ready_to_submit` group or a
  // `submitted` group). The status set IS the per-claim mirror of
  // "parent phase ∈ {triage, ready_to_submit}". Switching to a
  // disposition + parent-phase JOIN here adds a hot-path subquery
  // without changing semantics, so we keep the per-claim status
  // filter for now. Wave D will introduce a `submitted_via` (or
  // equivalent) claim column so this can become a single-column read.
  // See docs/architecture/state-wave-c-continuation-handoff-prompt.md §3.B.
  const expiringStatusFilter = or(
    ...CLAIM_EXPIRING_ACTIONABLE_STATUSES.map(s => eq(claimsTable.status, s)),
  );

  const [openCountResult] = await db
    .select({ count: count() })
    .from(claimsTable)
    .where(openStatusFilter);
  const openCount = openCountResult.count;

  const expiringCandidates = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      date: claimsTable.date,
      claimAmount: claimsTable.claimAmount,
      status: claimsTable.status,
    })
    .from(claimsTable)
    .where(and(expiringStatusFilter, sql`${claimsTable.date} IS NOT NULL`))
    .limit(EXPIRING_CANDIDATES_LIMIT);

  const expiringNow = new Date();
  const expiring: ExpiringClaim[] = expiringCandidates
    .filter(c => c.date)
    .map(c => {
      const dl = effectiveDaysRemaining(c.date, expiringNow);
      const urgent = isUrgentDeadline(c.date, expiringNow);
      return {
        id: c.id,
        confNumber: c.confNumber,
        date: c.date!,
        claimAmount: c.claimAmount,
        status: c.status,
        daysLeft: dl!,
        isUrgent: urgent,
      };
    })
    .filter(c => c.daysLeft !== null && c.daysLeft <= SOON_DAYS)
    // Urgent first (today / next business day), then ascending by days left
    // so the recipient's eye lands on what has to be filed *now*.
    .sort((a, b) => {
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      return a.daysLeft - b.daysLeft;
    });

  const expired = expiring.filter(c => c.daysLeft <= 0);
  // Null/NaN-safe sum — never returns NaN.
  const claimAmountAtRisk = safeClaimAmountAtRisk(expiring);
  const totalAtRisk = claimAmountAtRisk * (1 + VENDOR_PREPAY_RATE);

  // Portal submissions, scoped to the same yesterday window as the rest of the
  // brief. Previously this was an unfiltered GROUP BY status over the whole
  // table, so the "submitted" number was a lifetime total that climbed forever
  // and the label "X submitted, Y failed" was misleading.
  const [submittedRow] = await db
    .select({ count: count() })
    .from(auditLogsTable)
    .where(
      and(
        gte(auditLogsTable.timestamp, yesterdayStart),
        lt(auditLogsTable.timestamp, todayStart),
        eq(auditLogsTable.action, "portal_submission_confirmed"),
      ),
    );
  const submitted = submittedRow?.count ?? 0;

  const [failedRow] = await db
    .select({ count: count() })
    .from(portalSubmissionsTable)
    .where(
      and(
        eq(portalSubmissionsTable.status, "failed"),
        gte(portalSubmissionsTable.updatedAt, yesterdayStart),
        lt(portalSubmissionsTable.updatedAt, todayStart),
      ),
    );
  const failed = failedRow?.count ?? 0;

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

  const manualRequeueEvents = await db.select({
    submissionId: sql<number>`(${auditLogsTable.metadata}->>'submissionId')::int`,
    reason: sql<string | null>`${auditLogsTable.metadata}->>'reason'`,
    timestamp: auditLogsTable.timestamp,
  }).from(auditLogsTable)
    .where(and(eq(auditLogsTable.action, "submission_manual_requeue"), gte(auditLogsTable.timestamp, since24h)))
    .orderBy(desc(auditLogsTable.timestamp))
    .limit(50);

  const seenRequeueIds = new Set<number>();
  const manualRequeues: ManualRequeueRow[] = [];
  for (const e of manualRequeueEvents) {
    if (typeof e.submissionId !== "number" || seenRequeueIds.has(e.submissionId)) continue;
    seenRequeueIds.add(e.submissionId);
    manualRequeues.push({
      submissionId: e.submissionId,
      reason: e.reason ?? null,
      timestamp: e.timestamp ? new Date(e.timestamp as unknown as string).toISOString() : new Date().toISOString(),
    });
  }

  const outlookHealthRow = await getConnectorHealth("outlook");
  const outlookHealthy = outlookHealthRow ? outlookHealthRow.status === "healthy" : await isOutlookConnected();
  const outlookError = outlookHealthRow?.lastError ?? null;

  return { openCount, expiring, expired, claimAmountAtRisk, totalAtRisk, submitted, failed, automation, outlookHealthy, outlookError, needsAttention, manualRequeues };
}

// Resilient wrappers around the gather steps: catch throws, log, and
// return a placeholder so the brief still ships in degraded form rather
// than 500-ing the whole cron.

interface BriefDegradationNote {
  source: "admin_metrics" | "yesterday_activity" | "weekly_digest" | "operator_needs";
  message: string;
}

function emptyAdminMetrics(): AdminMetrics {
  return {
    openCount: 0,
    expiring: [],
    expired: [],
    claimAmountAtRisk: 0,
    totalAtRisk: 0,
    submitted: 0,
    failed: 0,
    automation: { totalRuns: 0, failures: 0, byJob: [] },
    outlookHealthy: false,
    outlookError: "Metrics gather failed — outlook health unknown",
    needsAttention: [],
    manualRequeues: [],
  };
}

function emptyYesterdayActivity(): YesterdayActivity {
  return { claimsCreated: 0, draftsSubmitted: 0, responsesReceived: 0, decisionsLogged: 0 };
}

async function safeGatherAdminMetrics(
  yesterdayStart: Date,
  todayStart: Date,
  notes: BriefDegradationNote[],
): Promise<AdminMetrics> {
  try {
    return await gatherAdminMetrics(yesterdayStart, todayStart);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ err }, "[DAILY BRIEF] gatherAdminMetrics threw — using placeholder metrics");
    notes.push({ source: "admin_metrics", message: msg.slice(0, 240) });
    return emptyAdminMetrics();
  }
}

async function safeGetYesterdayActivity(
  yesterdayStart: Date,
  todayStart: Date,
  notes: BriefDegradationNote[],
): Promise<YesterdayActivity> {
  try {
    return await getYesterdayActivity(yesterdayStart, todayStart);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ err }, "[DAILY BRIEF] getYesterdayActivity threw — zeroing tile");
    notes.push({ source: "yesterday_activity", message: msg.slice(0, 240) });
    return emptyYesterdayActivity();
  }
}

async function safeGetWeeklyDigest(
  now: Date,
  notes: BriefDegradationNote[],
): Promise<WeeklyDigest | null> {
  try {
    return await getWeeklyDigest(now);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ err }, "[DAILY BRIEF] getWeeklyDigest threw — dropping weekly section");
    notes.push({ source: "weekly_digest", message: msg.slice(0, 240) });
    return null;
  }
}

async function safeGetNeedsYouToday(
  email: string,
  now: Date,
  notes: BriefDegradationNote[],
): Promise<NeedsYouToday> {
  try {
    return await getNeedsYouToday(email, now);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ err, email }, "[DAILY BRIEF] getNeedsYouToday threw — empty operator brief");
    notes.push({ source: "operator_needs", message: `${email}: ${msg.slice(0, 200)}` });
    return { recentlyTouched: [], unsubmittedDrafts: [], needsReview: [] };
  }
}

// Retro-downgrade the prior daily_brief cron_run from "ok" → "degraded"
// if the bounce-spike thresholds are tripped. Called by the dedicated
// daily_brief_bounce_recheck cron and opportunistically at the start of
// the next brief. Keyed by metadata.briefRunId (jsonb @>) with a
// sentAt-window fallback for legacy rows; 7-day backstop guards against
// ancient rows. Failures are logged and swallowed.
export async function recheckPreviousRunBounces(): Promise<{ runId: number; downgrade: "ok" | "degraded" } | null> {
  try {
    const [prevRun] = await db
      .select({
        id: cronRunsTable.id,
        startedAt: cronRunsTable.startedAt,
        status: cronRunsTable.status,
        message: cronRunsTable.message,
        metadata: cronRunsTable.metadata,
      })
      .from(cronRunsTable)
      .where(eq(cronRunsTable.jobName, "daily_brief"))
      .orderBy(desc(cronRunsTable.startedAt))
      .limit(1);
    if (!prevRun) return null;
    // Already-degraded / failed runs don't need re-downgrading.
    if (prevRun.status !== "ok") return null;
    // Defensive 7-day backstop: if the most recent ok run is older than
    // a week, treat it as not-our-problem.
    const ageMs = Date.now() - prevRun.startedAt.getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) return null;
    // The recheck window has to have elapsed before bounces could have
    // landed; calling this earlier just no-ops cleanly.
    if (ageMs < BOUNCE_RECHECK_WINDOW_MS) return null;

    const briefRunId = (prevRun.metadata as Record<string, unknown> | null)?.briefRunId as string | undefined;

    // PRIMARY: lookup attempted recipients by briefRunId (jsonb @>).
    // FALLBACK: time window for legacy rows that predate the briefRunId
    // stamp (rows written before this migration shipped).
    const recipientRows = briefRunId
      ? await db
          .select({ recipients: outboundEmailsTable.recipients, subject: outboundEmailsTable.subject })
          .from(outboundEmailsTable)
          .where(and(
            eq(outboundEmailsTable.kind, "daily_brief"),
            sql`${outboundEmailsTable.metadata} @> ${JSON.stringify({ briefRunId })}::jsonb`,
          ))
      : await db
          .select({ recipients: outboundEmailsTable.recipients, subject: outboundEmailsTable.subject })
          .from(outboundEmailsTable)
          .where(and(
            eq(outboundEmailsTable.kind, "daily_brief"),
            gte(outboundEmailsTable.sentAt, prevRun.startedAt),
            lte(outboundEmailsTable.sentAt, new Date(prevRun.startedAt.getTime() + BOUNCE_RECHECK_WINDOW_MS)),
          ));

    const attemptedEmails = new Set<string>();
    let attemptedSubject: string | null = null;
    for (const r of recipientRows) {
      attemptedSubject = attemptedSubject ?? (r.subject ?? null);
      const list = (Array.isArray(r.recipients) ? r.recipients : []) as unknown[];
      for (const e of list) {
        if (typeof e === "string" && e.length > 0) attemptedEmails.add(e.toLowerCase());
      }
    }
    if (attemptedEmails.size === 0) return null;

    // Generous 1-hour bounce window (the spike-share threshold prevents a
    // single late bounce from over-firing).
    const bounceWindowEnd = new Date(prevRun.startedAt.getTime() + 60 * 60 * 1000);
    const bounceRows = await db
      .select({ recipientEmail: emailBouncesTable.recipientEmail, subject: emailBouncesTable.subject })
      .from(emailBouncesTable)
      .where(and(
        gte(emailBouncesTable.receivedAt, prevRun.startedAt),
        lte(emailBouncesTable.receivedAt, bounceWindowEnd),
      ));
    let bounceCount = 0;
    for (const b of bounceRows) {
      const email = (b.recipientEmail ?? "").toLowerCase();
      if (!email) continue;
      const subjectMatches = attemptedSubject ? (b.subject ?? "").includes(attemptedSubject.split(" - ")[0] ?? "") : true;
      if (attemptedEmails.has(email) && subjectMatches) bounceCount += 1;
    }

    const downgrade = evaluateBounceDowngrade({ recipientCount: attemptedEmails.size, bounceCount });
    if (downgrade === "degraded") {
      const note = `Bounce spike: ${bounceCount} of ${attemptedEmails.size} recipients bounced within ${Math.round(BOUNCE_RECHECK_WINDOW_MS / 60000)}m of send`;
      await db.update(cronRunsTable)
        .set({
          status: "degraded",
          message: prevRun.message ? `${prevRun.message} | ${note}` : note,
        })
        .where(eq(cronRunsTable.id, prevRun.id));
      logger.warn({ runId: prevRun.id, briefRunId, bounceCount, recipientCount: attemptedEmails.size }, "[DAILY BRIEF] retroactively downgraded prior run for bounce spike");
    }
    return { runId: prevRun.id, downgrade };
  } catch (err) {
    logger.error({ err }, "[DAILY BRIEF] bounce recheck failed (non-fatal)");
    return null;
  }
}

router.post("/", asyncHandler(async (req, res): Promise<void> => {
  // Top-level try/catch returns a structured outcome on every path so
  // the cron handler always gets a status to record (no silent 500s).
  const briefRunId = `brief-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const degradationNotes: BriefDegradationNote[] = [];

  try {
    // Re-check the previous run's bounces opportunistically; this updates
    // the prior cron_runs row out-of-band but never blocks the new send.
    await recheckPreviousRunBounces();

    const recipientsOverride = typeof req.body?.recipients === "string" ? req.body.recipients : undefined;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const metrics = await safeGatherAdminMetrics(yesterdayStart, todayStart, degradationNotes);

    const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const subject = `Agape ClaimClear Daily Brief - ${metrics.openCount} open claims, ${metrics.expired.length} expired`;
    const outlookAvailable = await isOutlookConnected();

    // Override/shared mode: single brief layout sent to an explicit
    // recipient list. Persists one outbound_emails row per recipient so
    // System Health and bounce recheck behave identically to the
    // personalized path.
    if (recipientsOverride || process.env.DAILY_BRIEF_RECIPIENTS) {
      const rawRecipients = recipientsOverride || process.env.DAILY_BRIEF_RECIPIENTS!;
      const yesterday = await safeGetYesterdayActivity(yesterdayStart, todayStart, degradationNotes);
      const weekly = isMondayInNewYork(now) ? await safeGetWeeklyDigest(now, degradationNotes) : null;
      const html = briefShell(
        "Agape ClaimClear Daily Brief",
        dateLabel,
        renderAdminBody(metrics, yesterday, weekly),
        metrics.outlookHealthy,
        metrics.outlookError,
      );

      const recipientList: string[] = String(rawRecipients)
        .split(/[,;]/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);

      const overrideResults: BriefRecipientResult[] = [];
      let usedOutlook = false;

      if (outlookAvailable && recipientList.length > 0) {
        for (const email of recipientList) {
          const attempt = await recordDailyBriefAttempt({
            recipientEmail: email,
            subject,
            html,
            roleVariant: "admin",
            briefRunId,
          });
          overrideResults.push({ email, ok: attempt.ok, errorExcerpt: attempt.errorExcerpt });
          if (attempt.ok) usedOutlook = true;
        }
      }

      // SMTP fallback when Outlook is unavailable. Persists one
      // outbound_emails row per recipient via persistDailyBriefRow so
      // the System Health detail panel sees this path identically.
      if (!usedOutlook && process.env.SMTP_HOST && process.env.SMTP_USER && recipientList.length > 0) {
        let smtpOk = false;
        let smtpError: string | null = null;
        let smtpMessageId: string | null = null;
        try {
          const nodemailer = await import("nodemailer");
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || "587", 10),
            secure: process.env.SMTP_SECURE === "true",
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          });
          const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: recipientList.join(", "),
            subject,
            html,
          });
          smtpOk = true;
          smtpMessageId = typeof info?.messageId === "string" ? info.messageId : null;
        } catch (err) {
          smtpError = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 200);
          logger.error({ err }, "[DAILY BRIEF] SMTP send failed");
        }

        for (const email of recipientList) {
          await persistDailyBriefRow({
            recipientEmail: email,
            subject,
            html,
            roleVariant: "admin",
            briefRunId,
            messageId: smtpOk ? smtpMessageId : null,
            conversationId: null,
            errorExcerpt: smtpOk ? null : smtpError,
          });
          const idx = overrideResults.findIndex((r) => r.email === email);
          const next = { email, ok: smtpOk, errorExcerpt: smtpOk ? null : smtpError };
          if (idx >= 0) overrideResults[idx] = next;
          else overrideResults.push(next);
        }
      }

      const overrideSummary = computeBriefOutcome({
        recipientCount: recipientList.length,
        results: overrideResults,
      });
      const method = overrideResults.some((r) => r.ok) ? (usedOutlook ? "outlook" : "smtp") : "none";
      const message = `${overrideSummary.message}. ${metrics.openCount} open claims, ${metrics.expired.length} expired, $${metrics.totalAtRisk.toFixed(2)} at risk.`;
      res.json({
        outcome: overrideSummary.outcome,
        sent: overrideSummary.sentCount > 0,
        method,
        message,
        sentCount: overrideSummary.sentCount,
        recipientCount: overrideSummary.recipientCount,
        failedCount: overrideSummary.failureCount,
        failures: overrideSummary.failures,
        briefRunId,
        degradationNotes,
      });
      return;
    }

    // Personalized mode: one email per approved user.
    let recipients: Awaited<ReturnType<typeof getBriefRecipients>> = [];
    try {
      recipients = await getBriefRecipients();
    } catch (err) {
      logger.error({ err }, "[DAILY BRIEF] getBriefRecipients threw — failing brief outcome");
      degradationNotes.push({
        source: "admin_metrics",
        message: `recipient query: ${err instanceof Error ? err.message : String(err)}`.slice(0, 240),
      });
    }
    const isMonday = isMondayInNewYork(now);
    const yesterday = await safeGetYesterdayActivity(yesterdayStart, todayStart, degradationNotes);
    const weeklyDigest = isMonday ? await safeGetWeeklyDigest(now, degradationNotes) : null;

    if (!outlookAvailable) {
      // Outlook is the only send path in personalized mode. Treat this as
      // top-level failure so the cron records "failed" rather than silently
      // reporting 0/N sent as "ok".
      const summary = computeBriefOutcome({
        recipientCount: recipients.length,
        results: [],
        topLevelFailure: true,
      });
      res.json({
        outcome: summary.outcome,
        sent: false,
        method: "none",
        message: `Outlook unavailable; skipped ${recipients.length} personalized briefs.`,
        sentCount: 0,
        recipientCount: recipients.length,
        failures: recipients.map((r) => ({ email: r.email, error: "Outlook connector unavailable" })),
        briefRunId,
        degradationNotes,
      });
      return;
    }

    const results: BriefRecipientResult[] = [];
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
        const needs = await safeGetNeedsYouToday(r.email, now, degradationNotes);
        html = briefShell(
          "Your ClaimClear Worklist",
          dateLabel,
          renderOperatorBody(needs, includeWeekly),
          metrics.outlookHealthy,
          metrics.outlookError,
        );
      }

      // recordDailyBriefAttempt always writes one outbound_emails row per
      // recipient — success rows carry the Graph messageId, failure rows
      // carry error_excerpt. The brief loop never throws here.
      const attempt = await recordDailyBriefAttempt({
        recipientEmail: r.email,
        subject,
        html,
        roleVariant: isAdmin ? "admin" : "operator",
        briefRunId,
      });
      results.push({ email: r.email, ok: attempt.ok, errorExcerpt: attempt.errorExcerpt });
      if (!attempt.ok) {
        logger.error({ email: r.email, error: attempt.errorExcerpt }, "[DAILY BRIEF] per-user send failed");
      }
    }

    const summary = computeBriefOutcome({
      recipientCount: recipients.length,
      results,
      topLevelFailure: false,
    });

    res.json({
      outcome: summary.outcome,
      sent: summary.sentCount > 0,
      method: summary.sentCount > 0 ? "outlook" : "none",
      message: `${summary.message}. ${metrics.openCount} open claims, ${metrics.expired.length} expired.`,
      sentCount: summary.sentCount,
      recipientCount: summary.recipientCount,
      failedCount: summary.failureCount,
      failures: summary.failures,
      briefRunId,
      degradationNotes,
    });
  } catch (err) {
    // Top-level guard: return 200 with outcome="failed" instead of 500.
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ err }, "[DAILY BRIEF] route threw at top level — degrading to failed outcome");
    res.json({
      outcome: "failed" as const,
      sent: false,
      method: "none",
      message: `Daily brief failed before send: ${msg.slice(0, 240)}`,
      sentCount: 0,
      recipientCount: 0,
      failures: [],
      briefRunId,
      degradationNotes,
    });
  }
}));

export default router;
