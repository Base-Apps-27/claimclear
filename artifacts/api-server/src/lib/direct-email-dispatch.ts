import { sendEmailWithContext } from "./email-send";
import type { EmailAttachment } from "./outlook";
import { downloadAttachment } from "./email-attachments";
import { logger } from "./logger";

export interface DirectEmailRecipientConfig {
  to: string;
  cc?: string;
}

export interface DirectEmailSubmission {
  id: number;
  confNumber: string;
  subject: string;
  descriptionHtml: string;
  attachmentUrls: string[];
  claimId: number;
  invoiceGroupId: number | null;
}

export interface DirectEmailResult {
  messageId: string | null;
  conversationId: string | null;
  attachmentCount: number;
}

/**
 * Wrap an AI-generated dispute body (which is plain text or lightly-formatted
 * HTML) into a complete email document. The portal-side description prompt
 * specifically tells the model NOT to add greetings/sign-offs because it
 * lands in a portal text field — for email we add minimal framing so the
 * recipient sees a normal-looking message.
 */
export function buildDirectEmailHtml(opts: {
  descriptionHtml: string;
  providerName: string;
  contactEmail: string;
  contactPhone: string;
}): string {
  const body = opts.descriptionHtml.trim();
  // If the body is already a full document with paragraphs, keep it as-is;
  // otherwise wrap each line in <p> so single-line text reads naturally.
  const looksLikeHtml = /<\/(p|div|ul|ol|h\d)>/i.test(body);
  const paragraphBody = looksLikeHtml
    ? body
    : body
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("\n");

  const signatureLines = [
    opts.providerName,
    opts.contactEmail,
    opts.contactPhone,
  ].filter((s) => s && s.length > 0);

  const signature = signatureLines.length > 0
    ? `<p>Thank you,<br>${signatureLines.map((l) => escapeHtml(l)).join("<br>")}</p>`
    : `<p>Thank you,</p>`;

  return `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
<p>Hello,</p>
${paragraphBody}
${signature}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Send a portal_submission as a direct email. Caller is responsible for
 * marking the submission as submitted on success (mirrors how
 * processViaExternalBot returns control to its caller).
 *
 * Throws if the recipient is not configured, if any attachment fails to
 * download, or if Outlook rejects the send. Callers should wrap in the
 * same try/catch retry path used for portal Playwright failures.
 */
export async function sendDirectEmailDispute(
  sub: DirectEmailSubmission,
  recipient: DirectEmailRecipientConfig,
  providerDefaults: { providerName: string; contactEmail: string; contactPhone: string },
): Promise<DirectEmailResult> {
  if (!recipient.to || recipient.to.trim().length === 0) {
    throw new Error("Direct email recipient is not configured. Set direct_email_recipient in Settings.");
  }
  if (!sub.descriptionHtml || sub.descriptionHtml.trim().length === 0) {
    throw new Error("Direct email submission has no body — cannot send an empty dispute email.");
  }

  const label = `claim-${sub.confNumber || sub.id}`;
  const attachments: EmailAttachment[] = [];
  for (let i = 0; i < sub.attachmentUrls.length; i++) {
    const url = sub.attachmentUrls[i];
    let lastErr: unknown = null;
    let downloaded: EmailAttachment | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        downloaded = await downloadAttachment(url, i, label);
        break;
      } catch (err) {
        lastErr = err;
        logger.warn(
          { submissionId: sub.id, url, attempt, err: err instanceof Error ? err.message : String(err) },
          "direct-email: evidence download attempt failed",
        );
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    if (!downloaded) {
      throw new Error(`Evidence download failed for ${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    }
    attachments.push(downloaded);
  }

  const html = buildDirectEmailHtml({
    descriptionHtml: sub.descriptionHtml,
    providerName: providerDefaults.providerName,
    contactEmail: providerDefaults.contactEmail,
    contactPhone: providerDefaults.contactPhone,
  });

  logger.info(
    {
      submissionId: sub.id,
      to: recipient.to,
      cc: recipient.cc || null,
      attachmentCount: attachments.length,
      attachmentBytes: attachments.reduce((s, a) => s + a.content.length, 0),
    },
    "direct-email: sending dispute email",
  );

  const result = await sendEmailWithContext(
    {
      to: recipient.to,
      cc: recipient.cc && recipient.cc.length > 0 ? recipient.cc : undefined,
      subject: sub.subject,
      html,
      attachments,
    },
    {
      kind: "dispute",
      claimId: sub.claimId,
      invoiceGroupId: sub.invoiceGroupId,
      submissionId: sub.id,
      sentByUserName: "Batch Processor",
    },
  );

  return {
    messageId: result.messageId,
    conversationId: result.conversationId,
    attachmentCount: attachments.length,
  };
}
