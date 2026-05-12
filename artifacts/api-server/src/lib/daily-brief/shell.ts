// HTML shell shared by all brief variants. Email-safe inline CSS,
// 600px-wide table layout, ClaimClear branding. The Outlook health
// banner is rendered inline at the top of the body so a degraded
// connector never silently stops emails — admins see the warning
// in the same email they're reading.

import { escapeHtml } from "./partials";

export interface BriefShellInput {
  title: string;
  dateLabel: string;
  bodyHtml: string;
  outlookHealthy: boolean;
  outlookError: string | null;
  // Subtitle under the title; e.g. "Daily ops brief" / "Weekly exec digest".
  variantLabel: string;
}

function outlookBanner(healthy: boolean, error: string | null): string {
  if (healthy) return "";
  const msg = error
    ? `Outlook connector unhealthy: ${error.slice(0, 200)}`
    : "Outlook connector unhealthy — outbound sends may be degraded.";
  return `
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 14px;margin:12px 0;font-size:12px;color:#92400e;">
      <strong>Heads up:</strong> ${escapeHtml(msg)}
    </div>
  `;
}

export function briefShell(input: BriefShellInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr><td style="padding:20px 24px 8px;border-bottom:1px solid #f1f1f1;">
          <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.08em;">Agape ClaimClear</div>
          <h1 style="font-size:20px;color:#1a1a1a;margin:4px 0 0;font-weight:600;">${escapeHtml(input.title)}</h1>
          <div style="font-size:12px;color:#888;margin-top:2px;">${escapeHtml(input.variantLabel)} · ${escapeHtml(input.dateLabel)}</div>
        </td></tr>
        <tr><td style="padding:8px 24px 24px;">
          ${outlookBanner(input.outlookHealthy, input.outlookError)}
          ${input.bodyHtml}
        </td></tr>
        <tr><td style="padding:14px 24px;background:#fafafa;border-top:1px solid #f1f1f1;font-size:11px;color:#888;">
          You're receiving this because you have brief notifications enabled. Manage in your Settings.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
