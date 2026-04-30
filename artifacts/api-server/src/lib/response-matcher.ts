import { db } from "@workspace/db";
import { claimsTable, portalSubmissionsTable, portalResponsesTable, notesTable, auditLogsTable, invoiceGroupsTable } from "@workspace/db";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import type { InboxMessage } from "./outlook";
import { logger } from "./logger";
import { transitionClaimStatus } from "./claim-transitions";
import { transitionGroupStatus } from "./group-transitions";
import { tryClassifyInboundEmail, type ClassifiedDecision, type InboundEmailContext } from "./inbound-email-classifier";

interface MatchResult {
  claimId: number | null;
  invoiceGroupId: number | null;
  submissionId: number | null;
  matchedVia: string;
  confidence: "high" | "medium" | "low";
}

function extractIdentifiers(text: string): { ticketIds: string[]; confNumbers: string[]; refNumbers: string[]; invoiceNumbers: string[] } {
  const ticketIds: string[] = [];
  const confNumbers: string[] = [];
  const refNumbers: string[] = [];
  const invoiceNumbers: string[] = [];

  const ticketPatterns = [
    /ticket[:\s#]*([A-Z0-9-]+)/gi,
    /case[:\s#]*([A-Z0-9-]+)/gi,
    /reference[:\s#]*([A-Z0-9-]+)/gi,
    /ID[:\s#]*([A-Z0-9-]+)/g,
  ];
  for (const pattern of ticketPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      ticketIds.push(match[1].trim());
    }
  }

  const confPattern = /(?:confirmation|conf)[:\s#]*([A-Z0-9-]+)/gi;
  let match;
  while ((match = confPattern.exec(text)) !== null) {
    confNumbers.push(match[1].trim());
  }

  const refPattern = /(?:ref|reference)[:\s#]*([A-Z0-9-]+)/gi;
  while ((match = refPattern.exec(text)) !== null) {
    refNumbers.push(match[1].trim());
  }

  const invoicePattern = /(?:invoice(?:\s*(?:number|no|#))?|inv)[:\s#]*([0-9][0-9-]{3,})/gi;
  while ((match = invoicePattern.exec(text)) !== null) {
    invoiceNumbers.push(match[1].trim());
  }

  return { ticketIds, confNumbers, refNumbers, invoiceNumbers };
}

function detectResponseType(subject: string, body: string): "approval" | "denial" | "partial_approval" | "info_request" | "acknowledgment" | "other" {
  const text = `${subject} ${body}`.toLowerCase();

  if (/\bapproved\b|\bapproval\b|\bgranted\b|\baccepted\b/.test(text)) {
    if (/\bpartial\b|\bpartially\b/.test(text)) return "partial_approval";
    return "approval";
  }
  if (/\bdenied\b|\bdenial\b|\brejected\b|\bdeclined\b/.test(text)) return "denial";
  if (/\badditional information\b|\bmore info\b|\bplease provide\b|\brequesting\b|\bneeded\b/.test(text)) return "info_request";
  if (/\breceived\b|\backnowledge\b|\bunder review\b|\bin process\b/.test(text)) return "acknowledgment";

  return "other";
}

export async function matchEmailToClaim(email: InboxMessage): Promise<MatchResult | null> {
  const fullText = `${email.subject} ${email.bodyPreview} ${email.body?.content || ""}`;
  const { ticketIds, confNumbers, refNumbers, invoiceNumbers } = extractIdentifiers(fullText);

  // Tier 1: Portal ticket ID match — group-aware (returns group match if submission is linked to a group)
  if (ticketIds.length > 0) {
    const submissions = await db.select({
      id: portalSubmissionsTable.id,
      claimId: portalSubmissionsTable.claimId,
      invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
      portalTicketId: portalSubmissionsTable.portalTicketId,
    }).from(portalSubmissionsTable)
      .where(
        and(
          eq(portalSubmissionsTable.status, "submitted"),
          isNotNull(portalSubmissionsTable.portalTicketId)
        )
      );

    for (const sub of submissions) {
      if (sub.portalTicketId && ticketIds.some(t =>
        t.toLowerCase() === sub.portalTicketId!.toLowerCase()
      )) {
        return {
          claimId: sub.invoiceGroupId ? null : sub.claimId,
          invoiceGroupId: sub.invoiceGroupId,
          submissionId: sub.id,
          matchedVia: `portal_ticket_id:${sub.portalTicketId}`,
          confidence: "high",
        };
      }
    }
  }

  // Tier 2: Invoice number match against invoice groups awaiting response
  if (invoiceNumbers.length > 0) {
    const groups = await db.select({
      id: invoiceGroupsTable.id,
      invoiceNumber: invoiceGroupsTable.invoiceNumber,
    }).from(invoiceGroupsTable)
      .where(
        and(
          inArray(invoiceGroupsTable.status, ["Awaiting Response", "On Hold"]),
          inArray(invoiceGroupsTable.invoiceNumber, invoiceNumbers)
        )
      );

    if (groups.length === 1) {
      return {
        claimId: null,
        invoiceGroupId: groups[0].id,
        submissionId: null,
        matchedVia: `invoice_number:${groups[0].invoiceNumber}`,
        confidence: "high",
      };
    }
  }

  if (confNumbers.length > 0) {
    const claims = await db.select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      invoiceGroupId: claimsTable.invoiceGroupId,
    }).from(claimsTable)
      .where(
        and(
          inArray(claimsTable.status, ["Awaiting Response", "On Hold"]),
          inArray(claimsTable.confNumber, confNumbers)
        )
      );

    if (claims.length === 1) {
      return {
        claimId: claims[0].invoiceGroupId ? null : claims[0].id,
        invoiceGroupId: claims[0].invoiceGroupId,
        submissionId: null,
        matchedVia: `conf_number:${claims[0].confNumber}`,
        confidence: "high",
      };
    }
  }

  if (refNumbers.length > 0) {
    const claims = await db.select({
      id: claimsTable.id,
      refNumber: claimsTable.refNumber,
      invoiceGroupId: claimsTable.invoiceGroupId,
    }).from(claimsTable)
      .where(
        and(
          inArray(claimsTable.status, ["Awaiting Response", "On Hold"]),
          inArray(claimsTable.refNumber, refNumbers)
        )
      );

    if (claims.length === 1) {
      return {
        claimId: claims[0].invoiceGroupId ? null : claims[0].id,
        invoiceGroupId: claims[0].invoiceGroupId,
        submissionId: null,
        matchedVia: `ref_number:${claims[0].refNumber}`,
        confidence: "medium",
      };
    }
  }

  const awaitingClaims = await db.select({
    id: claimsTable.id,
    confNumber: claimsTable.confNumber,
    refNumber: claimsTable.refNumber,
    payorEmail: claimsTable.payorEmail,
    invoiceGroupId: claimsTable.invoiceGroupId,
  }).from(claimsTable)
    .where(inArray(claimsTable.status, ["Awaiting Response", "On Hold"]));

  const senderEmail = email.from?.emailAddress?.address?.toLowerCase() || "";
  for (const claim of awaitingClaims) {
    if (claim.payorEmail && senderEmail === claim.payorEmail.toLowerCase()) {
      const bodyLower = fullText.toLowerCase();
      if (
        (claim.confNumber && bodyLower.includes(claim.confNumber.toLowerCase())) ||
        (claim.refNumber && bodyLower.includes(claim.refNumber.toLowerCase()))
      ) {
        return {
          claimId: claim.invoiceGroupId ? null : claim.id,
          invoiceGroupId: claim.invoiceGroupId,
          submissionId: null,
          matchedVia: `payor_email+identifier`,
          confidence: "medium",
        };
      }
    }
  }

  return null;
}

/**
 * Build the small context payload the AI classifier uses to ground its output
 * (payor name, conf number, amount, etc.). Best-effort; missing context is fine.
 */
async function loadInboundContext(match: MatchResult): Promise<InboundEmailContext> {
  try {
    if (match.claimId) {
      const [row] = await db.select({
        confNumber: claimsTable.confNumber,
        claimAmount: claimsTable.claimAmount,
        date: claimsTable.date,
        errorTypeName: claimsTable.errorTypeName,
        payorEmail: claimsTable.payorEmail,
      }).from(claimsTable).where(eq(claimsTable.id, match.claimId)).limit(1);
      if (row) {
        return {
          confNumber: row.confNumber,
          claimAmount: row.claimAmount ?? null,
          serviceDate: row.date ?? null,
          errorTypeName: row.errorTypeName ?? null,
          payorName: row.payorEmail ?? null,
        };
      }
    }
    if (match.invoiceGroupId) {
      const [row] = await db.select({
        payorEmail: invoiceGroupsTable.payorEmail,
        errorTypeName: invoiceGroupsTable.errorTypeName,
      }).from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, match.invoiceGroupId)).limit(1);
      if (row) return { payorName: row.payorEmail ?? null, errorTypeName: row.errorTypeName ?? null };
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Failed to load inbound context for AI classifier");
  }
  return {};
}

/**
 * Process a matched inbound email: persist it as a portal_response, run the AI
 * classifier (best-effort), and decide whether to push the claim/group into
 * Needs Review.
 *
 * Behavior split:
 * - "acknowledgment" → silent receipt. Stored, an "Acknowledged" note is added
 *   to the claim/group timeline as proof, but status is NOT moved to
 *   Needs Review (otherwise every "we got your request" reply spams the queue).
 * - everything else  → existing behavior: full note + Needs Review transition.
 */
export async function processEmailResponse(email: InboxMessage, match: MatchResult): Promise<number> {
  const isGroup = match.invoiceGroupId !== null && match.invoiceGroupId !== undefined;
  const bodyText = email.body?.content || email.bodyPreview || "";

  // Outlook reports the original body content type; preserve it so the UI can
  // render formatted bodies safely instead of dumping raw HTML as text.
  const bodyFormat: "html" | "text" =
    (email.body?.contentType || "").toLowerCase() === "html" ? "html" : "text";

  // 1. Run AI classifier (best-effort). Falls back to keyword detector if it fails.
  const ctx = await loadInboundContext(match);
  const aiResult = await tryClassifyInboundEmail(email.subject || "", bodyText, ctx);

  const keywordType = detectResponseType(email.subject, bodyText);
  const responseType: ClassifiedDecision = aiResult ? aiResult.decision : keywordType;
  const classifierSource = aiResult ? "ai" : "keyword";

  // 2. Persist the response row, including AI-extracted fields when present.
  const [response] = await db.insert(portalResponsesTable).values({
    claimId: match.claimId,
    invoiceGroupId: match.invoiceGroupId,
    submissionId: match.submissionId,
    source: "email",
    responseType,
    subject: email.subject,
    content: email.bodyPreview,
    rawContent: email.body?.content || null,
    bodyFormat,
    senderEmail: email.from?.emailAddress?.address || null,
    senderName: email.from?.emailAddress?.name || null,
    matchedVia: match.matchedVia,
    matchConfidence: match.confidence,
    externalMessageId: email.id,
    conversationId: email.conversationId || null,
    autoLinked: true,
    processed: false,
    aiSummary: aiResult?.summary ?? null,
    extractedAmount: aiResult?.amount ?? null,
    extractedDeadline: aiResult?.deadline ?? null,
    requestedAction: aiResult?.requestedAction ?? null,
    classifierSource,
    classifierConfidence: aiResult?.confidence ?? null,
    receivedAt: new Date(email.receivedDateTime),
    metadata: {
      conversationId: email.conversationId,
      isRead: email.isRead,
      keywordClassification: keywordType,
    },
  }).returning();

  const senderLabel = email.from?.emailAddress?.name || email.from?.emailAddress?.address || "unknown";
  const isAcknowledgment = responseType === "acknowledgment";

  // 3. Compose a note that surfaces the AI summary when we have one, and is
  //    tagged "Acknowledged" vs. "Response received" so the timeline reads naturally.
  const noteContent = (() => {
    if (isAcknowledgment) {
      const base = `Acknowledged by ${senderLabel} (proof of receipt — no action required)`;
      return aiResult?.summary ? `${base}: ${aiResult.summary}` : `${base}.`;
    }
    const headline = `${typeLabelFor(responseType)} response received via email from ${senderLabel}`;
    return aiResult?.summary ? `${headline}: ${aiResult.summary}` : `${headline}: "${email.subject}"`;
  })();

  const auditDetails = aiResult
    ? `${responseType} response (AI confidence: ${aiResult.confidence}, match confidence: ${match.confidence})`
    : `${responseType} response detected from email (confidence: ${match.confidence})`;

  const auditMetadata = {
    responseId: response.id,
    source: "email",
    responseType,
    matchedVia: match.matchedVia,
    classifierSource,
    senderEmail: email.from?.emailAddress?.address,
    aiSummary: aiResult?.summary,
  };

  if (isGroup) {
    await db.insert(notesTable).values({
      claimId: null,
      invoiceGroupId: match.invoiceGroupId,
      type: "reply_parsed",
      content: noteContent,
      author: "Response Tracker",
      emailSubject: email.subject,
    });

    await db.insert(auditLogsTable).values({
      invoiceGroupId: match.invoiceGroupId,
      action: isAcknowledgment ? "response_acknowledged" : "response_received",
      details: auditDetails,
      metadata: auditMetadata,
      userEmail: "system",
      userName: "Response Tracker",
    });

    if (!isAcknowledgment) {
      await transitionGroupStatus({
        groupId: match.invoiceGroupId!,
        newStatus: "Needs Review",
        source: "email_response_matcher",
        reason: `${responseType} response received via email — awaiting staff review (confidence: ${match.confidence}, matched via: ${match.matchedVia})`,
        actor: { userEmail: "system", userName: "Response Tracker" },
        systemOverride: true,
      });
    }

    logger.info({
      responseId: response.id,
      invoiceGroupId: match.invoiceGroupId,
      responseType,
      classifierSource,
      acknowledgmentSkipped: isAcknowledgment,
      matchedVia: match.matchedVia,
    }, isAcknowledgment
      ? "Acknowledgment received and logged (no status transition)"
      : "Email response processed and linked to invoice group");
  } else {
    await db.insert(notesTable).values({
      claimId: match.claimId,
      type: "reply_parsed",
      content: noteContent,
      author: "Response Tracker",
      emailSubject: email.subject,
    });

    await db.insert(auditLogsTable).values({
      claimId: match.claimId,
      action: isAcknowledgment ? "response_acknowledged" : "response_received",
      details: auditDetails,
      metadata: auditMetadata,
      userEmail: "system",
      userName: "Response Tracker",
    });

    if (!isAcknowledgment) {
      await transitionClaimStatus({
        claimId: match.claimId!,
        newStatus: "Needs Review",
        source: "email_response_matcher",
        reason: `${responseType} response received via email — awaiting staff review (confidence: ${match.confidence}, matched via: ${match.matchedVia})`,
        actor: { userEmail: "system", userName: "Response Tracker" },
        systemOverride: true,
      });
    }

    logger.info({
      responseId: response.id,
      claimId: match.claimId,
      responseType,
      classifierSource,
      acknowledgmentSkipped: isAcknowledgment,
      matchedVia: match.matchedVia,
    }, isAcknowledgment
      ? "Acknowledgment received and logged (no status transition)"
      : "Email response processed and linked to claim");
  }

  return response.id;
}

/**
 * Decision rule for whether an inbound classified response should push the
 * claim/group into "Needs Review". Acknowledgments are silent (proof of
 * receipt only); everything else is actionable. Exported for unit testing.
 */
export function shouldTransitionToNeedsReview(responseType: ClassifiedDecision): boolean {
  return responseType !== "acknowledgment";
}

function typeLabelFor(t: ClassifiedDecision): string {
  switch (t) {
    case "approval": return "Approval";
    case "denial": return "Denial";
    case "partial_approval": return "Partial-approval";
    case "info_request": return "Info-request";
    case "acknowledgment": return "Acknowledgment";
    case "other": return "Other";
  }
}

export async function processPortalResponse(data: {
  claimId: number;
  invoiceGroupId?: number | null;
  submissionId: number;
  portalTicketId: string;
  responseType: "approval" | "denial" | "partial_approval" | "info_request" | "acknowledgment" | "other";
  content: string;
  /** Full body of the portal message; preserved verbatim for UI display. */
  rawContent?: string;
  /**
   * Whether `rawContent`/`content` is HTML or plain text. Defaults to `text`
   * when omitted to preserve behaviour for bots that have not been updated.
   */
  bodyFormat?: "html" | "text";
  /** Subject / title of the portal message, if available. */
  subject?: string;
  /** Email of the portal user that posted the response, if available. */
  senderEmail?: string;
  /** Display name of the portal user that posted the response, if available. */
  senderName?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<number> {
  const isGroup = data.invoiceGroupId !== null && data.invoiceGroupId !== undefined;

  const [response] = await db.insert(portalResponsesTable).values({
    claimId: isGroup ? null : data.claimId,
    invoiceGroupId: data.invoiceGroupId ?? null,
    submissionId: data.submissionId,
    source: "portal",
    responseType: data.responseType,
    subject: data.subject ?? null,
    content: data.content,
    rawContent: data.rawContent ?? null,
    bodyFormat: data.bodyFormat ?? "text",
    senderEmail: data.senderEmail ?? null,
    senderName: data.senderName ?? null,
    portalTicketId: data.portalTicketId,
    matchedVia: `portal_ticket_id:${data.portalTicketId}`,
    matchConfidence: "high",
    autoLinked: true,
    processed: false,
    metadata: data.metadata || null,
  }).returning();

  if (isGroup) {
    await db.insert(notesTable).values({
      claimId: null,
      invoiceGroupId: data.invoiceGroupId,
      type: "reply_parsed",
      content: `Portal response received for ticket ${data.portalTicketId}: ${data.responseType}`,
      author: "Response Tracker",
    });

    await db.insert(auditLogsTable).values({
      invoiceGroupId: data.invoiceGroupId,
      action: "response_received",
      details: `${data.responseType} response from portal (ticket: ${data.portalTicketId})`,
      metadata: {
        responseId: response.id,
        source: "portal",
        responseType: data.responseType,
        portalTicketId: data.portalTicketId,
      },
      userEmail: "system",
      userName: "Response Tracker",
    });

    await transitionGroupStatus({
      groupId: data.invoiceGroupId!,
      newStatus: "Needs Review",
      source: "portal_response_matcher",
      reason: `${data.responseType} response received from portal (ticket: ${data.portalTicketId}) — awaiting staff review`,
      actor: { userEmail: "system", userName: "Response Tracker" },
      systemOverride: true,
    });

    logger.info({
      responseId: response.id,
      invoiceGroupId: data.invoiceGroupId,
      responseType: data.responseType,
      portalTicketId: data.portalTicketId,
    }, "Portal response processed and linked to invoice group");
  } else {
    await db.insert(notesTable).values({
      claimId: data.claimId,
      type: "reply_parsed",
      content: `Portal response received for ticket ${data.portalTicketId}: ${data.responseType}`,
      author: "Response Tracker",
    });

    await db.insert(auditLogsTable).values({
      claimId: data.claimId,
      action: "response_received",
      details: `${data.responseType} response from portal (ticket: ${data.portalTicketId})`,
      metadata: {
        responseId: response.id,
        source: "portal",
        responseType: data.responseType,
        portalTicketId: data.portalTicketId,
      },
      userEmail: "system",
      userName: "Response Tracker",
    });

    await transitionClaimStatus({
      claimId: data.claimId,
      newStatus: "Needs Review",
      source: "portal_response_matcher",
      reason: `${data.responseType} response received from portal (ticket: ${data.portalTicketId}) — awaiting staff review`,
      actor: { userEmail: "system", userName: "Response Tracker" },
      systemOverride: true,
    });

    logger.info({
      responseId: response.id,
      claimId: data.claimId,
      responseType: data.responseType,
      portalTicketId: data.portalTicketId,
    }, "Portal response processed and linked to claim");
  }

  return response.id;
}
