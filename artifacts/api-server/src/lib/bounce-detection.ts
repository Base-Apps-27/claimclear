import { db } from "@workspace/db";
import { emailBouncesTable, portalSubmissionsTable, claimsTable, invoiceGroupsTable, auditLogsTable, portalResponsesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { InboxMessage } from "./outlook";
import { logger } from "./logger";

const POSTMASTER_PATTERNS = [
  /postmaster@/i,
  /mailer-daemon@/i,
  /microsoftexchange/i,
  /no-?reply.*microsoft/i,
];

const NDR_SUBJECT_PATTERNS = [
  /^undeliverable:/i,
  /^undelivered mail returned/i,
  /^delivery status notification/i,
  /^mail delivery failed/i,
  /failure notice/i,
];

export function isBounceMessage(email: InboxMessage): boolean {
  const sender = (email.from?.emailAddress?.address || "").toLowerCase();
  if (POSTMASTER_PATTERNS.some((p) => p.test(sender))) return true;
  const subject = email.subject || "";
  return NDR_SUBJECT_PATTERNS.some((p) => p.test(subject));
}

const EMAIL_RX = /[\w.+\-]+@[\w-]+(?:\.[\w-]+)+/g;

export function parseFailedRecipient(email: InboxMessage): string | null {
  const haystack = `${email.subject || ""}\n${email.body?.content || email.bodyPreview || ""}`;

  // Common Microsoft NDR markers
  const markerPatterns = [
    /(?:recipient|to|failed recipient|original recipient|delivery has failed to these recipients)[^a-z0-9]*([\w.+\-]+@[\w.\-]+\.[\w]+)/i,
    /<([\w.+\-]+@[\w.\-]+\.[\w]+)>/,
  ];

  for (const p of markerPatterns) {
    const m = p.exec(haystack);
    if (m) return m[1].toLowerCase();
  }

  const matches = haystack.match(EMAIL_RX);
  if (!matches) return null;
  // Filter out the postmaster sender itself
  const senderAddr = (email.from?.emailAddress?.address || "").toLowerCase();
  const candidate = matches.find((m) => {
    const lower = m.toLowerCase();
    return lower !== senderAddr && !POSTMASTER_PATTERNS.some((p) => p.test(lower));
  });
  return candidate ? candidate.toLowerCase() : null;
}

export interface RecordedBounce {
  bounceId: number;
  matchedClaimId: number | null;
  matchedInvoiceGroupId: number | null;
  matchedSubmissionId: number | null;
}

export async function recordBounce(email: InboxMessage): Promise<RecordedBounce | null> {
  try {
    const recipient = parseFailedRecipient(email);
    const excerpt = (email.body?.content || email.bodyPreview || "").slice(0, 2000);

    // Try to link to an outbound submission via conversation thread or recipient match
    let matchedSubmissionId: number | null = null;
    let matchedClaimId: number | null = null;
    let matchedInvoiceGroupId: number | null = null;

    // 1) Look for a portal_response we sent in the same conversation.
    // portal_responses stores externalMessageId = email.id and conversationId
    // inside metadata jsonb, so match against metadata->>'conversationId'.
    if (email.conversationId) {
      const [related] = await db
        .select({
          claimId: portalResponsesTable.claimId,
          invoiceGroupId: portalResponsesTable.invoiceGroupId,
          submissionId: portalResponsesTable.submissionId,
        })
        .from(portalResponsesTable)
        .where(sql`${portalResponsesTable.metadata}->>'conversationId' = ${email.conversationId}`)
        .limit(1);
      if (related) {
        matchedClaimId = related.claimId ?? null;
        matchedInvoiceGroupId = related.invoiceGroupId ?? null;
        matchedSubmissionId = related.submissionId ?? null;
      }
    }

    // 2) Fall back to claim payor email match
    if (!matchedClaimId && !matchedInvoiceGroupId && recipient) {
      const [byPayor] = await db
        .select({ id: claimsTable.id, invoiceGroupId: claimsTable.invoiceGroupId })
        .from(claimsTable)
        .where(eq(claimsTable.payorEmail, recipient))
        .limit(1);
      if (byPayor) {
        matchedClaimId = byPayor.invoiceGroupId ? null : byPayor.id;
        matchedInvoiceGroupId = byPayor.invoiceGroupId ?? null;
      }
    }

    const [row] = await db
      .insert(emailBouncesTable)
      .values({
        recipientEmail: recipient,
        originalMessageId: email.id,
        conversationId: email.conversationId ?? null,
        subject: email.subject ?? null,
        rawExcerpt: excerpt,
        matchedOutboundId: matchedSubmissionId != null ? String(matchedSubmissionId) : null,
        matchedClaimId: matchedClaimId != null ? String(matchedClaimId) : null,
        matchedInvoiceGroupId: matchedInvoiceGroupId != null ? String(matchedInvoiceGroupId) : null,
        receivedAt: email.receivedDateTime ? new Date(email.receivedDateTime) : new Date(),
        metadata: { sender: email.from?.emailAddress?.address ?? null },
      })
      .returning();

    if (matchedClaimId || matchedInvoiceGroupId) {
      try {
        await db.insert(auditLogsTable).values({
          claimId: matchedClaimId,
          invoiceGroupId: matchedInvoiceGroupId,
          action: "bounce_received",
          details: `Email to ${recipient || "unknown recipient"} bounced: "${email.subject || "(no subject)"}"`,
          metadata: {
            bounceId: row.id,
            recipient,
            sender: email.from?.emailAddress?.address ?? null,
          },
          userEmail: "system",
          userName: "Response Tracker",
        });
      } catch (e) {
        logger.warn({ err: e }, "Failed to write bounce_received audit log");
      }
    }

    return {
      bounceId: row.id,
      matchedClaimId,
      matchedInvoiceGroupId,
      matchedSubmissionId,
    };
  } catch (err) {
    logger.error({ err }, "recordBounce failed");
    return null;
  }
}
