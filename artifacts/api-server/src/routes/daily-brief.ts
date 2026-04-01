import { Router, type IRouter } from "express";
import { isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, portalSubmissionsTable, usersTable } from "@workspace/db";

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

interface ExpiringClaim {
  id: number;
  confNumber: string;
  date: string;
  claimAmount: string | null;
  status: string;
  daysLeft: number;
}

function generateBriefHtml(
  openClaims: number,
  expiring: ExpiringClaim[],
  expired: ExpiringClaim[],
  totalAtRisk: number,
  submittedCount: number,
  failedCount: number,
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

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#4338ca;color:white;padding:24px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:24px;">ClaimClear Daily Brief</h1>
      <p style="margin:8px 0 0;opacity:0.9;">${today}</p>
    </div>
    <div style="background:white;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <div style="display:flex;gap:16px;margin-bottom:24px;">
        <div style="flex:1;text-align:center;padding:16px;background:#eef2ff;border-radius:8px;">
          <div style="font-size:28px;font-weight:700;color:#4338ca;">${openClaims}</div>
          <div style="font-size:12px;color:#6366f1;margin-top:4px;">Open Claims</div>
        </div>
        <div style="flex:1;text-align:center;padding:16px;background:${expired.length > 0 ? "#fef2f2" : "#f0fdf4"};border-radius:8px;">
          <div style="font-size:28px;font-weight:700;color:${expired.length > 0 ? "#dc2626" : "#16a34a"};">${expired.length}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Expired</div>
        </div>
        <div style="flex:1;text-align:center;padding:16px;background:#fffbeb;border-radius:8px;">
          <div style="font-size:28px;font-weight:700;color:#d97706;">$${totalAtRisk.toFixed(2)}</div>
          <div style="font-size:12px;color:#92400e;margin-top:4px;">At Risk</div>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <h2 style="font-size:16px;color:#1e293b;margin:0 0 8px;">Portal Submissions</h2>
        <p style="margin:0;color:#64748b;font-size:14px;">${submittedCount} submitted, ${failedCount} failed</p>
      </div>

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

router.post("/", async (_req, res): Promise<void> => {
  const allClaims = await db.select().from(claimsTable);
  const openStatuses = ["New", "Needs Evidence", "Portal Queued", "Ready to Review", "Awaiting Response", "On Hold"];
  const openClaims = allClaims.filter(c => openStatuses.includes(c.status));

  const expiring: ExpiringClaim[] = openClaims
    .filter(c => c.date)
    .map(c => {
      const dl = daysRemaining(c.date);
      return { id: c.id, confNumber: c.confNumber, date: c.date!, claimAmount: c.claimAmount, status: c.status, daysLeft: dl! };
    })
    .filter(c => c.daysLeft !== null && c.daysLeft <= 10)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const expired = expiring.filter(c => c.daysLeft <= 0);
  const totalAtRisk = expiring.reduce((sum, c) => sum + (parseFloat(c.claimAmount || "0") || 0), 0);

  const allSubmissions = await db.select().from(portalSubmissionsTable);
  const submitted = allSubmissions.filter(s => s.status === "submitted").length;
  const failed = allSubmissions.filter(s => s.status === "failed").length;

  const html = generateBriefHtml(openClaims.length, expiring, expired, totalAtRisk, submitted, failed);

  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
  let emailSent = false;

  if (smtpConfigured) {
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

      let recipients = process.env.DAILY_BRIEF_RECIPIENTS;
      if (!recipients) {
        const usersWithEmail = await db.select({ email: usersTable.email }).from(usersTable).where(isNotNull(usersTable.email));
        const emails = usersWithEmail.map(u => u.email).filter(Boolean);
        recipients = emails.length > 0 ? emails.join(",") : process.env.SMTP_USER;
      }

      if (recipients) {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: recipients,
          subject: `ClaimClear Daily Brief - ${openClaims.length} open claims, ${expired.length} expired`,
          html,
        });
        emailSent = true;
      }
    } catch (err) {
      console.error("[DAILY BRIEF] Failed to send email:", err);
    }
  }

  const message = `${openClaims.length} open claims, ${expired.length} expired, $${totalAtRisk.toFixed(2)} at risk. ${submitted} submitted, ${failed} failed portal submissions.${emailSent ? " Email sent." : smtpConfigured ? " Email failed." : " SMTP not configured."}`;
  res.json({
    sent: emailSent,
    message,
  });
});

export default router;
