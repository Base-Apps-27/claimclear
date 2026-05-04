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
 *
 * Daily-brief sends are NOT persisted by this helper — use
 * `recordDailyBriefAttempt` instead, which always writes a row (success
 * or failure) for per-recipient observability.
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

// Daily-brief per-recipient logging: persists one outbound_emails row
// per attempted recipient (success OR failure), tagged with
// metadata.briefRunId and roleVariant. Never throws — DB write failures
// are logged but do not abort the brief loop.

export type DailyBriefRoleVariant = "admin" | "operator";

export interface DailyBriefAttemptInput {
  recipientEmail: string;
  subject: string;
  html: string;
  roleVariant: DailyBriefRoleVariant;
  briefRunId: string;
}

export interface DailyBriefAttemptResult {
  ok: boolean;
  messageId: string | null;
  errorExcerpt: string | null;
}

// sendImpl is the seam tests use to swap Outlook for a deterministic stub
// without touching the network. Defaults to the real `sendEmail`.
let dailyBriefSendImpl: (options: SendEmailOptions) => Promise<SendEmailResult> = sendEmail;

/** Test seam — swap the underlying sendEmail. Pass null to restore default. */
export function __setDailyBriefSendImplForTesting(
  impl: ((options: SendEmailOptions) => Promise<SendEmailResult>) | null,
): void {
  dailyBriefSendImpl = impl ?? sendEmail;
}

function excerpt(s: string, max = 500): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function htmlPreview(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

// Persist one outbound_emails row for a daily-brief recipient. Always
// writes — success and failure paths both produce a durable row.
export async function persistDailyBriefRow(input: {
  recipientEmail: string;
  subject: string;
  html: string;
  roleVariant: "admin" | "operator";
  briefRunId: string;
  messageId: string | null;
  conversationId: string | null;
  errorExcerpt: string | null;
}): Promise<void> {
  try {
    await db.insert(outboundEmailsTable).values({
      messageId: input.messageId,
      conversationId: input.conversationId,
      claimId: null,
      invoiceGroupId: null,
      submissionId: null,
      kind: "daily_brief",
      subject: input.subject,
      recipients: [input.recipientEmail],
      bodyPreview: htmlPreview(input.html),
      sentByUserEmail: null,
      sentByUserName: null,
      errorExcerpt: input.errorExcerpt,
      metadata: { roleVariant: input.roleVariant, briefRunId: input.briefRunId },
    });
  } catch (err) {
    logger.error({ err, recipient: input.recipientEmail }, "Failed to persist daily_brief outbound_emails row");
  }
}

// Send via the configured Outlook impl (overridable for tests) and
// persist a per-recipient outbound_emails row regardless of outcome.
export async function recordDailyBriefAttempt(input: DailyBriefAttemptInput): Promise<DailyBriefAttemptResult> {
  let result: SendEmailResult | null = null;
  let errorExcerpt: string | null = null;

  try {
    result = await dailyBriefSendImpl({
      to: input.recipientEmail,
      subject: input.subject,
      html: input.html,
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    errorExcerpt = excerpt(msg, 500);
  }

  await persistDailyBriefRow({
    recipientEmail: input.recipientEmail,
    subject: input.subject,
    html: input.html,
    roleVariant: input.roleVariant,
    briefRunId: input.briefRunId,
    messageId: result?.messageId ?? null,
    conversationId: result?.conversationId ?? null,
    errorExcerpt,
  });

  return {
    ok: errorExcerpt === null && result !== null,
    messageId: result?.messageId ?? null,
    errorExcerpt,
  };
}
