import { db } from "@workspace/db";
import { outboundEmailsTable } from "@workspace/db";
import { sendEmail, type SendEmailOptions, type SendEmailResult } from "./outlook";
import { logger } from "./logger";

export type OutboundEmailKind = "dispute" | "follow_up" | "manual" | "daily_brief";

export interface SendEmailContext {
  claimId?: number | null;
  invoiceGroupId?: number | null;
  submissionId?: number | null;
  kind: OutboundEmailKind;
  sentByUserEmail?: string | null;
  sentByUserName?: string | null;
}

/**
 * Sends an email via Outlook, then (unless kind === "daily_brief") persists an
 * outbound_emails row capturing the messageId / conversationId returned by
 * Microsoft Graph so we can stitch together email threads later.
 */
export async function sendEmailWithContext(
  options: SendEmailOptions,
  context: SendEmailContext,
): Promise<SendEmailResult> {
  const result = await sendEmail(options);

  if (context.kind === "daily_brief") {
    return result;
  }

  try {
    const recipients = Array.isArray(options.to)
      ? options.to
      : String(options.to).split(",").map((e) => e.trim()).filter(Boolean);

    const bodyPreview = options.html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    await db.insert(outboundEmailsTable).values({
      messageId: result.messageId,
      conversationId: result.conversationId,
      claimId: context.claimId ?? null,
      invoiceGroupId: context.invoiceGroupId ?? null,
      submissionId: context.submissionId ?? null,
      kind: context.kind,
      subject: options.subject,
      recipients,
      bodyPreview,
      sentByUserEmail: context.sentByUserEmail ?? null,
      sentByUserName: context.sentByUserName ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to persist outbound_emails row");
  }

  return result;
}
