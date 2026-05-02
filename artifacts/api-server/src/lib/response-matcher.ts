import { db } from "@workspace/db";
import { claimsTable, portalSubmissionsTable, portalResponsesTable, notesTable, auditLogsTable, invoiceGroupsTable } from "@workspace/db";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import type { InboxMessage } from "./outlook";
import { logger } from "./logger";
import { transitionClaimStatus } from "./claim-transitions";
import { transitionGroupStatus } from "./group-transitions";
import { tryClassifyInboundEmail, type ClassifiedDecision, type InboundEmailContext } from "./inbound-email-classifier";
import { classifyByPhrase } from "./email-phrase-classifier";

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

// detectResponseType has been removed in favour of `classifyByPhrase` in
// `./email-phrase-classifier`. The legacy keyword detector matched single
// tokens against subject + body and produced ~85% false positives in the
// production audit because "approved"/"denied" routinely appear in our own
// quoted outbound dispute, in template chrome, or in standard footers.
// The new deterministic classifier looks for full multi-word phrases in the
// NORMALIZED body only and returns an explicit "unknown" abstain so the AI
// backstop only runs on genuinely novel content.

export async function matchEmailToClaim(email: InboxMessage): Promise<MatchResult | null> {
  const fullText = `${email.subject} ${email.bodyPreview} ${email.body?.content || ""}`;
  const { ticketIds, confNumbers, refNumbers, invoiceNumbers } = extractIdentifiers(fullText);

  // Tier 1: Portal ticket ID match — group-aware (returns group match if submission is linked to a group)
  if (ticketIds.length > 0) {
    const submissions = await db.select({
      id: portalSubmissionsTable.id,
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
          claimId: null,
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

  // 1. Deterministic phrase-signature classifier first. The vast majority of
  //    payor traffic on this dataset matches a known template; only call the
  //    AI when the deterministic side abstains. This is the inversion of the
  //    legacy "AI first, keyword fallback" pipeline that produced the
  //    false-positive backlog.
  const phraseResult = classifyByPhrase(bodyText);

  let responseType: ClassifiedDecision;
  let classifierSource: "phrase_signature" | "ai" | "abstain";
  let aiResult: Awaited<ReturnType<typeof tryClassifyInboundEmail>> = null;

  if (phraseResult.outcome !== "unknown") {
    responseType = phraseResult.outcome;
    classifierSource = "phrase_signature";
  } else {
    // Only escalate to the AI on genuinely novel content. If the AI is
    // unavailable, store as "other" + "abstain" so the row shows up in the
    // existing manual-review flow without producing an automatic transition.
    const ctx = await loadInboundContext(match);
    aiResult = await tryClassifyInboundEmail(email.subject || "", bodyText, ctx);
    if (aiResult) {
      responseType = aiResult.decision;
      classifierSource = "ai";
    } else {
      responseType = "other";
      classifierSource = "abstain";
    }
  }

  // 2. Persist the response row, including AI-extracted fields when present.
  //    Phrase-signature acknowledgments are auto-cleared (processed=true) —
  //    there is nothing for an operator to do on those rows, so they should
  //    not carry the yellow "Unprocessed" badge in the conversation thread.
  //    Abstain and AI paths still land processed=false so they show up for
  //    manual review.
  const autoMarkProcessed = shouldAutoMarkProcessed(responseType, classifierSource);

  const [response] = await db.insert(portalResponsesTable).values({
    claimId: match.claimId,
    invoiceGroupId: match.invoiceGroupId,
    submissionId: match.submissionId,
    source: "email",
    responseType,
    subject: email.subject,
    // Persist the full body in `content` (Microsoft Graph's `bodyPreview` is
    // a ~255-char snippet, which forces every downstream surface to truncate
    // the message). `bodyText` was already computed above for the AI
    // classifier and falls back to `bodyPreview` when the full body is
    // missing. `rawContent` continues to hold the raw HTML/text from Graph
    // for the conversations card to render with formatting.
    content: bodyText,
    rawContent: email.body?.content || null,
    bodyFormat,
    senderEmail: email.from?.emailAddress?.address || null,
    senderName: email.from?.emailAddress?.name || null,
    matchedVia: match.matchedVia,
    matchConfidence: match.confidence,
    externalMessageId: email.id,
    conversationId: email.conversationId || null,
    autoLinked: true,
    processed: autoMarkProcessed,
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
      phraseSignature: phraseResult.selectedSignatureId,
      phraseSignatureMatches: phraseResult.matchedSignatureIds,
      // Stamp every row so the LLM-first cohort (Task #314) is
      // distinguishable from earlier classifier generations in audits and
      // backfills (the backfill keys idempotency off this exact value).
      // Bumped to v2 in Task #321 when the AI hint output gained
      // `newInvoiceNumber` + `suggestedPayorDenialReason` so the backfill
      // can re-run rows in v1's cohort and pick up the new fields.
      classifierVersion: "llm-first-v2",
      // Task #321: AI hints surfaced on Responses Awaiting Review. Persisted
      // verbatim from the classifier; UI uses them to pre-fill the operator
      // pickers but never auto-applies. Both null when the AI was
      // unavailable / abstained.
      newInvoiceNumber: aiResult?.newInvoiceNumber ?? null,
      suggestedPayorDenialReason: aiResult?.suggestedPayorDenialReason ?? null,
    },
  }).returning();

  const senderLabel = email.from?.emailAddress?.name || email.from?.emailAddress?.address || "unknown";
  const isAcknowledgment = responseType === "acknowledgment";
  // Abstained rows must NOT trigger a Needs Review transition — that is
  // the whole point of the new abstain path. Operators handle them
  // manually via the existing PATCH /responses/:id/process endpoint.
  const skipTransition = isAcknowledgment || classifierSource === "abstain";

  // 3. Compose a note that surfaces the AI summary when we have one, and is
  //    tagged "Acknowledged" vs. "Response received" vs. "Unclassified" so
  //    the timeline reads naturally for all three deterministic outcomes.
  const noteContent = (() => {
    if (isAcknowledgment) {
      const base = `Acknowledged by ${senderLabel} (proof of receipt — no action required)`;
      return aiResult?.summary ? `${base}: ${aiResult.summary}` : `${base}.`;
    }
    if (classifierSource === "abstain") {
      return `Unclassified response received via email from ${senderLabel} — left for manual review (no signature match and AI unavailable): "${email.subject}"`;
    }
    const headline = `${typeLabelFor(responseType)} response received via email from ${senderLabel}`;
    return aiResult?.summary ? `${headline}: ${aiResult.summary}` : `${headline}: "${email.subject}"`;
  })();

  const sourceTag =
    classifierSource === "phrase_signature"
      ? `phrase: ${phraseResult.selectedSignatureId}`
      : classifierSource === "ai"
      ? `AI confidence: ${aiResult?.confidence}`
      : "abstain (no signature match, AI unavailable)";
  const auditDetails =
    `${responseType} response detected from email (${sourceTag}, match confidence: ${match.confidence})`;

  const auditMetadata = {
    responseId: response.id,
    source: "email",
    responseType,
    matchedVia: match.matchedVia,
    classifierSource,
    phraseSignature: phraseResult.selectedSignatureId,
    phraseSignatureMatches: phraseResult.matchedSignatureIds,
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

    if (!skipTransition) {
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
      phraseSignature: phraseResult.selectedSignatureId,
      acknowledgmentSkipped: isAcknowledgment,
      transitionSkipped: skipTransition,
      autoMarkProcessed,
      matchedVia: match.matchedVia,
    }, skipTransition
      ? (isAcknowledgment
        ? "Acknowledgment received and logged (no status transition)"
        : "Unclassified email response logged (no status transition — abstain)")
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

    if (!skipTransition) {
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
      phraseSignature: phraseResult.selectedSignatureId,
      acknowledgmentSkipped: isAcknowledgment,
      transitionSkipped: skipTransition,
      autoMarkProcessed,
      matchedVia: match.matchedVia,
    }, skipTransition
      ? (isAcknowledgment
        ? "Acknowledgment received and logged (no status transition)"
        : "Unclassified email response logged (no status transition — abstain)")
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

/**
 * Decision rule for whether a freshly-stored inbound response should be
 * pre-marked `processed = true` so it doesn't carry the yellow "Unprocessed"
 * badge in the conversation thread.
 *
 * Only deterministic phrase-signature acknowledgments qualify: the operator
 * has nothing to do on a "we got your dispute" receipt, and we already
 * recognised it with high confidence. Abstain rows still need manual review,
 * and AI-classified rows (even AI-classified acknowledgments) are kept
 * unprocessed so a human can confirm the model's call. Exported for unit
 * testing.
 *
 * Note on `retro_phrase_signature`:
 *   The one-shot `reclassify-confirmation-emails-backfill` retro-relabels
 *   historical mislabelled rows to `acknowledgment` and stamps them with
 *   the distinct source `retro_phrase_signature` so the cohort can be
 *   told apart at a glance. Operationally those rows are identical to
 *   fresh `phrase_signature` acks (same deterministic phrase match,
 *   nothing for an operator to do), so the badge cleanup script
 *   (`2026-05-clear-phrase-signature-ack-processed-backfill.ts`) clears
 *   them too via the `--include-retro` flag (Task #284). This LIVE rule
 *   intentionally matches only `phrase_signature` because production
 *   never produces `retro_phrase_signature` — that source is only ever
 *   stamped by the retro reclassify backfill.
 */
export function shouldAutoMarkProcessed(
  responseType: ClassifiedDecision,
  classifierSource: "phrase_signature" | "ai" | "abstain",
): boolean {
  return responseType === "acknowledgment" && classifierSource === "phrase_signature";
}

export function typeLabelFor(t: ClassifiedDecision): string {
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
  claimId: number | null;
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
  // Post-cutover all portal submissions are group-scoped. Reject any caller
  // still passing a claim-only payload so we surface stragglers immediately.
  if (data.invoiceGroupId === null || data.invoiceGroupId === undefined) {
    throw new Error(
      "processPortalResponse requires invoiceGroupId — claim-only submissions are no longer supported",
    );
  }
  const invoiceGroupId = data.invoiceGroupId;

  const [response] = await db.insert(portalResponsesTable).values({
    claimId: null,
    invoiceGroupId,
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

  await db.insert(notesTable).values({
    claimId: null,
    invoiceGroupId,
    type: "reply_parsed",
    content: `Portal response received for ticket ${data.portalTicketId}: ${data.responseType}`,
    author: "Response Tracker",
  });

  await db.insert(auditLogsTable).values({
    invoiceGroupId,
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
    groupId: invoiceGroupId,
    newStatus: "Needs Review",
    source: "portal_response_matcher",
    reason: `${data.responseType} response received from portal (ticket: ${data.portalTicketId}) — awaiting staff review`,
    actor: { userEmail: "system", userName: "Response Tracker" },
    systemOverride: true,
  });

  logger.info({
    responseId: response.id,
    invoiceGroupId,
    responseType: data.responseType,
    portalTicketId: data.portalTicketId,
  }, "Portal response processed and linked to invoice group");

  return response.id;
}
