import { db } from "@workspace/db";
import { claimsTable, portalSubmissionsTable, portalResponsesTable, notesTable, auditLogsTable, invoiceGroupsTable } from "@workspace/db";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import type { InboxMessage } from "./outlook";
import { logger } from "./logger";
import { transitionClaimStatus } from "./claim-transitions";
import { transitionGroupStatus } from "./group-transitions";

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

export async function processEmailResponse(email: InboxMessage, match: MatchResult): Promise<number> {
  const responseType = detectResponseType(email.subject, email.body?.content || email.bodyPreview);
  const isGroup = match.invoiceGroupId !== null && match.invoiceGroupId !== undefined;

  const [response] = await db.insert(portalResponsesTable).values({
    claimId: match.claimId,
    invoiceGroupId: match.invoiceGroupId,
    submissionId: match.submissionId,
    source: "email",
    responseType,
    subject: email.subject,
    content: email.bodyPreview,
    rawContent: email.body?.content || null,
    senderEmail: email.from?.emailAddress?.address || null,
    senderName: email.from?.emailAddress?.name || null,
    matchedVia: match.matchedVia,
    matchConfidence: match.confidence,
    externalMessageId: email.id,
    autoLinked: true,
    processed: false,
    receivedAt: new Date(email.receivedDateTime),
    metadata: {
      conversationId: email.conversationId,
      isRead: email.isRead,
    },
  }).returning();

  const senderLabel = email.from?.emailAddress?.name || email.from?.emailAddress?.address || "unknown";

  if (isGroup) {
    await db.insert(notesTable).values({
      claimId: null,
      invoiceGroupId: match.invoiceGroupId,
      type: "reply_parsed",
      content: `Response received via email from ${senderLabel}: "${email.subject}"`,
      author: "Response Tracker",
      emailSubject: email.subject,
    });

    await db.insert(auditLogsTable).values({
      invoiceGroupId: match.invoiceGroupId,
      action: "response_received",
      details: `${responseType} response detected from email (confidence: ${match.confidence})`,
      metadata: {
        responseId: response.id,
        source: "email",
        responseType,
        matchedVia: match.matchedVia,
        senderEmail: email.from?.emailAddress?.address,
      },
      userEmail: "system",
      userName: "Response Tracker",
    });

    await transitionGroupStatus({
      groupId: match.invoiceGroupId!,
      newStatus: "Needs Review",
      source: "email_response_matcher",
      reason: `${responseType} response received via email — awaiting staff review (confidence: ${match.confidence}, matched via: ${match.matchedVia})`,
      actor: { userEmail: "system", userName: "Response Tracker" },
      systemOverride: true,
    });

    logger.info({
      responseId: response.id,
      invoiceGroupId: match.invoiceGroupId,
      responseType,
      confidence: match.confidence,
      matchedVia: match.matchedVia,
    }, "Email response processed and linked to invoice group");
  } else {
    await db.insert(notesTable).values({
      claimId: match.claimId,
      type: "reply_parsed",
      content: `Response received via email from ${senderLabel}: "${email.subject}"`,
      author: "Response Tracker",
      emailSubject: email.subject,
    });

    await db.insert(auditLogsTable).values({
      claimId: match.claimId,
      action: "response_received",
      details: `${responseType} response detected from email (confidence: ${match.confidence})`,
      metadata: {
        responseId: response.id,
        source: "email",
        responseType,
        matchedVia: match.matchedVia,
        senderEmail: email.from?.emailAddress?.address,
      },
      userEmail: "system",
      userName: "Response Tracker",
    });

    await transitionClaimStatus({
      claimId: match.claimId!,
      newStatus: "Needs Review",
      source: "email_response_matcher",
      reason: `${responseType} response received via email — awaiting staff review (confidence: ${match.confidence}, matched via: ${match.matchedVia})`,
      actor: { userEmail: "system", userName: "Response Tracker" },
      systemOverride: true,
    });

    logger.info({
      responseId: response.id,
      claimId: match.claimId,
      responseType,
      confidence: match.confidence,
      matchedVia: match.matchedVia,
    }, "Email response processed and linked to claim");
  }

  return response.id;
}

export async function processPortalResponse(data: {
  claimId: number;
  invoiceGroupId?: number | null;
  submissionId: number;
  portalTicketId: string;
  responseType: "approval" | "denial" | "partial_approval" | "info_request" | "acknowledgment" | "other";
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const isGroup = data.invoiceGroupId !== null && data.invoiceGroupId !== undefined;

  const [response] = await db.insert(portalResponsesTable).values({
    claimId: isGroup ? null : data.claimId,
    invoiceGroupId: data.invoiceGroupId ?? null,
    submissionId: data.submissionId,
    source: "portal",
    responseType: data.responseType,
    content: data.content,
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
