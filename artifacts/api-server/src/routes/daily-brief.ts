import { Router, type IRouter } from "express";
import { isNotNull, eq, or, and, sql, count, gte, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, portalSubmissionsTable, usersTable, cronRunsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { daysRemaining } from "../lib/dates";
import { isOutlookConnected } from "../lib/outlook";
import { sendEmailWithContext } from "../lib/email-send";
import { getConnectorHealth } from "../lib/connector-health";

const router: IRouter = Router();

const OPEN_STATUSES = ["New", "Needs Evidence", "Portal Queued", "Ready to Review", "Awaiting Response", "On Hold"] as const;
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

function generateBriefHtml(
  openClaims: number,
  expiring: ExpiringClaim[],
  expired: ExpiringClaim[],
  claimAmountAtRisk: number,
  totalAtRisk: number,
  submittedCount: number,
  failedCount: number,
  automation: AutomationSummary,
  outlookHealthy: boolean,
  outlookError: string | null,
): string {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const expiringRows = expiring
    .map(c => `<tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${c.confNumber}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${c.date}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;">$${c.claimAmount || "0.00"}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:${c.daysLeft <= 3 ? "#dc2626" : "#f59e0b"};font-weight:600;">${c.daysLeft} days</td>
    </tr>`)
    .join("");

  const outlookBanner = !outlookHealthy
    ? `<div style="background:#fee2e2;border:1px solid #fecaca;color:#991b1b;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;">
        <strong>Outlook connector unhealthy.</strong> Email automation may be delayed or skipped. ${outlookError ? `<br/><span style="font-family:monospace;font-size:11px;opacity:0.8;">${outlookError.slice(0, 240)}</span>` : ""}
      </div>`
    : "";

  const automationFooter = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
      Yesterday's automation: <strong>${automation.totalRuns} runs, ${automation.failures} failure${automation.failures === 1 ? "" : "s"}</strong> &mdash;
      <a href="/system-health" style="color:#3478F6;text-decoration:none;">View System Health</a>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#1B2A4A;color:white;padding:24px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:24px;color:white;">Agape ClaimClear Daily Brief</h1>
      <p style="margin:8px 0 0;opacity:0.9;">${today}</p>
    </div>
    <div style="background:white;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      ${outlookBanner}
      <div style="display:flex;gap:16px;margin-bottom:24px;">
        <div style="flex:1;text-align:center;padding:16px;background:#EBF0FA;border-radius:8px;">
          <div style="font-size:28px;font-weight:700;color:#1B2A4A;">${openClaims}</div>
          <div style="font-size:12px;color:#3478F6;margin-top:4px;">Open Claims</div>
        </div>
        <div style="flex:1;text-align:center;padding:16px;background:${expired.length > 0 ? "#fef2f2" : "#f0fdf4"};border-radius:8px;">
          <div style="font-size:28px;font-weight:700;color:${expired.length > 0 ? "#dc2626" : "#16a34a"};">${expired.length}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Expired</div>
        </div>
        <div style="flex:1;text-align:center;padding:16px;background:#fffbeb;border-radius:8px;">
          <div style="font-size:28px;font-weight:700;color:#d97706;">$${totalAtRisk.toFixed(2)}</div>
          <div style="font-size:12px;color:#92400e;margin-top:4px;">Total Exposure (approx.)</div>
          <div style="font-size:10px;color:#92400e;margin-top:2px;">Claims $${claimAmountAtRisk.toFixed(2)} + ~70% vendor prepay</div>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <h2 style="font-size:16px;color:#1e293b;margin:0 0 8px;">Portal Submissions</h2>
        <p style="margin:0;color:#64748b;font-size:14px;">${submittedCount} submitted, ${failedCount} failed</p>
      </div>

      ${automationFooter}

      ${expiring.length > 0 ? `
      <div>
        <h2 style="font-size:16px;color:#1e293b;margin:0 0 12px;">Expiring Claims (${expiring.length})</h2>
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
    </div>
  </div>
</body>
</html>`;
}

router.post("/", asyncHandler(async (req, res): Promise<void> => {
  const recipientsOverride = typeof req.body?.recipients === "string" ? req.body.recipients : undefined;
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
  const automation = {
    totalRuns,
    failures: totalFailures,
    byJob: Array.from(byJobMap.entries()).map(([jobName, v]) => ({ jobName, runs: v.runs, failures: v.failures })),
  };

  const outlookHealthRow = await getConnectorHealth("outlook");
  const outlookHealthy = outlookHealthRow ? outlookHealthRow.status === "healthy" : await isOutlookConnected();
  const outlookError = outlookHealthRow?.lastError ?? null;

  const html = generateBriefHtml(openCount, expiring, expired, claimAmountAtRisk, totalAtRisk, submitted, failed, automation, outlookHealthy, outlookError);

  let emailSent = false;
  let emailMethod = "none";

  let recipients = recipientsOverride || process.env.DAILY_BRIEF_RECIPIENTS;
  if (!recipients) {
    const usersWithEmail = await db.select({ email: usersTable.email }).from(usersTable).where(isNotNull(usersTable.email));
    const emails = usersWithEmail.map(u => u.email).filter(Boolean);
    recipients = emails.length > 0 ? emails.join(",") : undefined;
  }

  const subject = `Agape ClaimClear Daily Brief - ${openCount} open claims, ${expired.length} expired`;

  const outlookAvailable = await isOutlookConnected();

  if (outlookAvailable && recipients) {
    try {
      await sendEmailWithContext({ to: recipients, subject, html }, { kind: "daily_brief" });
      emailSent = true;
      emailMethod = "outlook";
    } catch (err) {
      console.error("[DAILY BRIEF] Outlook send failed:", err);
    }
  }

  if (!emailSent && process.env.SMTP_HOST && process.env.SMTP_USER && recipients) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
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
      console.error("[DAILY BRIEF] SMTP send failed:", err);
    }
  }

  const message = `${openCount} open claims, ${expired.length} expired, $${totalAtRisk.toFixed(2)} at risk. ${submitted} submitted, ${failed} failed portal submissions.${emailSent ? ` Email sent via ${emailMethod}.` : " Email not sent (no provider configured or no recipients)."}`;
  res.json({
    sent: emailSent,
    method: emailMethod,
    message,
  });
}));

export default router;
