import { Router, type IRouter } from "express";
import { eq, desc, and, or, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalResponsesTable, portalSubmissionsTable, claimsTable, invoiceGroupsTable, notesTable, auditLogsTable, outboundEmailsTable, claimEvidenceTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { searchInboxEmails, isOutlookConnected, replyToMessage } from "../lib/outlook";
import { downloadAttachmentsWithRetry } from "../lib/email-attachments";
import { ObjectStorageService } from "../lib/objectStorage";
import { matchEmailToClaim, processEmailResponse, processPortalResponse, shouldTransitionToNeedsReview, typeLabelFor } from "../lib/response-matcher";
import type { ClassifiedDecision } from "../lib/inbound-email-classifier";
import { broadcastClaimEvent, broadcastGroupEvent } from "../lib/sse";
import { transitionClaimStatus } from "../lib/claim-transitions";
import { transitionGroupStatus } from "../lib/group-transitions";
import { logger } from "../lib/logger";
import { isBounceMessage, recordBounce } from "../lib/bounce-detection";
import {
  buildSiblingLookup,
  inboundToMessage,
  outboundToMessage,
  groupByConversation,
  type ThreadMessage,
} from "../lib/email-thread";

/**
 * Replyable Microsoft Graph caller. Override in tests via
 * `__setReplyImplForTesting` so the reply route can be exercised end-to-end
 * without a real Outlook account.
 */
let replyImpl: typeof replyToMessage = replyToMessage;
export function __setReplyImplForTesting(fn: typeof replyToMessage | null): void {
  replyImpl = fn ?? replyToMessage;
}

const router: IRouter = Router();

router.get("/responses", asyncHandler(async (req, res): Promise<void> => {
  const { claimId, source, processed, limit: limitStr, offset: offsetStr } = req.query;
  const limitVal = parseInt(String(limitStr || "50"), 10);
  const offsetVal = parseInt(String(offsetStr || "0"), 10);

  let query = db.select().from(portalResponsesTable).orderBy(desc(portalResponsesTable.receivedAt)).limit(limitVal).offset(offsetVal).$dynamic();

  const conditions = [];
  if (claimId) conditions.push(eq(portalResponsesTable.claimId, parseInt(String(claimId), 10)));
  const { invoiceGroupId } = req.query;
  if (invoiceGroupId) conditions.push(eq(portalResponsesTable.invoiceGroupId, parseInt(String(invoiceGroupId), 10)));
  if (source) conditions.push(eq(portalResponsesTable.source, source as any));
  if (processed === "true") conditions.push(eq(portalResponsesTable.processed, true));
  if (processed === "false") conditions.push(eq(portalResponsesTable.processed, false));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const responses = await query;
  res.json({ responses });
}));

router.get("/responses/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [response] = await db.select().from(portalResponsesTable).where(eq(portalResponsesTable.id, id));
  if (!response) { res.status(404).json({ error: "Response not found" }); return; }

  res.json(response);
}));

const VALID_RESPONSE_TYPES = [
  "approval", "denial", "partial_approval", "info_request", "acknowledgment", "other",
] as const satisfies readonly ClassifiedDecision[];
const VALID_RESPONSE_TYPE_SET: ReadonlySet<string> = new Set(VALID_RESPONSE_TYPES);
const isClassifiedDecision = (v: unknown): v is ClassifiedDecision =>
  typeof v === "string" && VALID_RESPONSE_TYPE_SET.has(v);

router.patch("/responses/:id/process", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { responseType, claimId, invoiceGroupId } = req.body;

  if (responseType !== undefined && !isClassifiedDecision(responseType)) {
    res.status(400).json({
      error: `Invalid responseType "${responseType}". Must be one of: ${VALID_RESPONSE_TYPES.join(", ")}.`,
    });
    return;
  }

  const updates: Record<string, unknown> = { processed: true };
  if (responseType) updates.responseType = responseType;
  if (claimId) updates.claimId = claimId;
  if (invoiceGroupId) updates.invoiceGroupId = invoiceGroupId;

  const [response] = await db.update(portalResponsesTable).set(updates).where(eq(portalResponsesTable.id, id)).returning();
  if (!response) { res.status(404).json({ error: "Response not found" }); return; }

  // Tagging is a hint, never a verdict: route every non-ack tag to Needs
  // Review + Pending. Mirrors response-matcher's shouldTransitionToNeedsReview.
  const NEEDS_REVIEW: typeof claimsTable.status.enumValues[number] = "Needs Review";
  const PENDING_OUTCOME: typeof claimsTable.outcome.enumValues[number] = "Pending";

  if (responseType && shouldTransitionToNeedsReview(responseType)) {
    const hint = typeLabelFor(responseType);
    const tagDetails = `Response #${response.id} tagged as ${responseType} — AI hint: ${hint}, awaiting human review`;
    const actorEmail = req.user?.email ?? null;
    const actorName = req.user?.displayName ?? "Response Tracker";

    if (response.invoiceGroupId) {
      await db.insert(notesTable).values({
        claimId: null,
        invoiceGroupId: response.invoiceGroupId,
        type: "reply_parsed",
        content: tagDetails,
        author: actorName,
      });
      await db.insert(auditLogsTable).values({
        invoiceGroupId: response.invoiceGroupId,
        action: "response_tagged",
        details: tagDetails,
        metadata: { responseId: response.id, responseType, hint, source: "response_tracker" },
        userEmail: actorEmail,
        userName: actorName,
      });

      await transitionGroupStatus({
        groupId: response.invoiceGroupId,
        newStatus: NEEDS_REVIEW,
        source: "response_tracker",
        reason: tagDetails,
        actor: { userEmail: actorEmail, userName: actorName },
        systemOverride: true,
      });

      // Reset outcome — transition helper only touches status.
      await db.update(invoiceGroupsTable)
        .set({ outcome: PENDING_OUTCOME })
        .where(eq(invoiceGroupsTable.id, response.invoiceGroupId));
    } else if (response.claimId) {
      await db.insert(notesTable).values({
        claimId: response.claimId,
        type: "reply_parsed",
        content: tagDetails,
        author: actorName,
      });
      await db.insert(auditLogsTable).values({
        claimId: response.claimId,
        action: "response_tagged",
        details: tagDetails,
        metadata: { responseId: response.id, responseType, hint, source: "response_tracker" },
        userEmail: actorEmail,
        userName: actorName,
      });

      await transitionClaimStatus({
        claimId: response.claimId,
        newStatus: NEEDS_REVIEW,
        source: "response_tracker",
        reason: tagDetails,
        actor: { userEmail: actorEmail, userName: actorName },
        systemOverride: true,
      });

      // Reset outcome — transition helper only touches status.
      await db.update(claimsTable)
        .set({ outcome: PENDING_OUTCOME })
        .where(eq(claimsTable.id, response.claimId));
    }
  }

  res.json(response);
}));

router.patch("/responses/:id/link", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { claimId, invoiceGroupId } = req.body;
  if (!claimId && !invoiceGroupId) {
    res.status(400).json({ error: "claimId or invoiceGroupId required" });
    return;
  }

  if (invoiceGroupId) {
    const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, invoiceGroupId));
    if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

    const [response] = await db.update(portalResponsesTable).set({
      invoiceGroupId,
      claimId: null,
      autoLinked: false,
      matchedVia: "manual",
      matchConfidence: "high",
    }).where(eq(portalResponsesTable.id, id)).returning();

    if (!response) { res.status(404).json({ error: "Response not found" }); return; }

    await db.insert(notesTable).values({
      claimId: null,
      invoiceGroupId,
      type: "reply_parsed",
      content: `Response manually linked: "${response.subject || "No subject"}"`,
      author: req.user?.displayName ?? "User",
      emailSubject: response.subject,
    });

    res.json(response);
    return;
  }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  const [response] = await db.update(portalResponsesTable).set({
    claimId,
    invoiceGroupId: null,
    autoLinked: false,
    matchedVia: "manual",
    matchConfidence: "high",
  }).where(eq(portalResponsesTable.id, id)).returning();

  if (!response) { res.status(404).json({ error: "Response not found" }); return; }

  await db.insert(notesTable).values({
    claimId,
    type: "reply_parsed",
    content: `Response manually linked: "${response.subject || "No subject"}"`,
    author: req.user?.displayName ?? "User",
    emailSubject: response.subject,
  });

  res.json(response);
}));

export const checkEmailRouter: IRouter = Router();
checkEmailRouter.post("/responses/check-email", asyncHandler(async (req, res): Promise<void> => {
  const connected = await isOutlookConnected();
  if (!connected) {
    res.status(503).json({ error: "Outlook not connected" });
    return;
  }

  const hoursBack = parseInt(String(req.body?.hoursBack || "4"), 10);
  const afterDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  logger.info({ hoursBack, afterDate }, "Starting email response check");

  const emails = await searchInboxEmails({ afterDate, top: 100 });
  logger.info({ emailCount: emails.length }, "Fetched inbox emails");

  const existingMessageIds = new Set(
    (await db.select({ externalMessageId: portalResponsesTable.externalMessageId })
      .from(portalResponsesTable)
      .where(eq(portalResponsesTable.source, "email")))
      .map(r => r.externalMessageId)
      .filter(Boolean)
  );

  let matched = 0;
  let unmatched = 0;
  let skipped = 0;
  let bounces = 0;
  const results: { emailSubject: string; status: string; claimId?: number; responseType?: string }[] = [];

  for (const email of emails) {
    if (existingMessageIds.has(email.id)) {
      skipped++;
      continue;
    }

    if (isBounceMessage(email)) {
      const bounce = await recordBounce(email);
      bounces++;
      results.push({
        emailSubject: email.subject,
        status: bounce ? (bounce.matchedClaimId || bounce.matchedInvoiceGroupId ? "bounce_matched" : "bounce_unmatched") : "bounce_error",
      });
      continue;
    }

    const match = await matchEmailToClaim(email);
    if (match) {
      await processEmailResponse(email, match);
      matched++;
      results.push({
        emailSubject: email.subject,
        status: "matched",
        claimId: match.claimId ?? undefined,
      });

      if (match.invoiceGroupId) {
        broadcastGroupEvent({
          type: "response_received",
          invoiceGroupId: match.invoiceGroupId,
          userName: "Response Tracker",
          userEmail: null,
          timestamp: new Date().toISOString(),
        });
      } else if (match.claimId) {
        broadcastClaimEvent({
          type: "response_received",
          claimId: match.claimId,
          userName: "Response Tracker",
          userEmail: null,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      unmatched++;
    }
  }

  logger.info({ matched, unmatched, skipped, bounces }, "Email response check completed");

  res.json({
    checked: emails.length,
    matched,
    unmatched,
    skipped,
    bounces,
    results,
  });
}));

/**
 * Records a portal response captured by the scraper bot.
 *
 * Required:
 * - `submissionId`: id of the portal submission this response belongs to.
 * - `responseType`: detected outcome category.
 *
 * Optional fields the bot may send so reviewers can see the actual message:
 * - `content`: short preview / summary of the response (kept for backwards compat).
 * - `rawContent`: full body text of the portal response (preserves line breaks).
 * - `subject`: subject / title of the portal message.
 * - `senderEmail` / `senderName`: portal user that posted the response.
 * - `metadata`: free-form JSON for any additional bot-side context.
 */
router.post("/responses/record-portal", asyncHandler(async (req, res): Promise<void> => {
  const { submissionId, responseType, content, rawContent, bodyFormat, subject, senderEmail, senderName } = req.body;

  if (!submissionId || !responseType) {
    res.status(400).json({ error: "submissionId and responseType are required" });
    return;
  }

  const normalizedBodyFormat: "html" | "text" | undefined =
    bodyFormat === "html" ? "html" : bodyFormat === "text" ? "text" : undefined;

  const [submission] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, submissionId));
  if (!submission) { res.status(404).json({ error: "Submission not found" }); return; }

  const responseId = await processPortalResponse({
    claimId: null,
    invoiceGroupId: submission.invoiceGroupId,
    submissionId: submission.id,
    portalTicketId: submission.portalTicketId || "",
    responseType,
    content: content || "",
    rawContent: typeof rawContent === "string" ? rawContent : undefined,
    bodyFormat: normalizedBodyFormat,
    subject: typeof subject === "string" ? subject : undefined,
    senderEmail: typeof senderEmail === "string" ? senderEmail : undefined,
    senderName: typeof senderName === "string" ? senderName : undefined,
    metadata: req.body.metadata || null,
  });

  broadcastGroupEvent({
    type: "response_received",
    invoiceGroupId: submission.invoiceGroupId,
    userName: "Response Tracker",
    userEmail: null,
    timestamp: new Date().toISOString(),
  });

  res.json({ responseId, invoiceGroupId: submission.invoiceGroupId });
}));

router.get("/responses/stats", asyncHandler(async (_req, res): Promise<void> => {
  const allResponses = await db.select().from(portalResponsesTable).orderBy(desc(portalResponsesTable.receivedAt));

  const total = allResponses.length;
  const unprocessed = allResponses.filter(r => !r.processed).length;
  const unlinked = allResponses.filter(r => r.claimId === null).length;
  const bySource = {
    email: allResponses.filter(r => r.source === "email").length,
    portal: allResponses.filter(r => r.source === "portal").length,
    manual: allResponses.filter(r => r.source === "manual").length,
  };
  const byType = {
    approval: allResponses.filter(r => r.responseType === "approval").length,
    denial: allResponses.filter(r => r.responseType === "denial").length,
    partial_approval: allResponses.filter(r => r.responseType === "partial_approval").length,
    info_request: allResponses.filter(r => r.responseType === "info_request").length,
    acknowledgment: allResponses.filter(r => r.responseType === "acknowledgment").length,
    other: allResponses.filter(r => r.responseType === "other").length,
  };

  const connected = await isOutlookConnected().catch(() => false);

  res.json({
    total,
    unprocessed,
    unlinked,
    bySource,
    byType,
    outlookConnected: connected,
  });
}));

router.post("/responses/:id/reassign", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { targetClaimId, targetGroupId, unmatch } = req.body ?? {};
  const wantsUnmatch = unmatch === true;
  const wantsClaim = typeof targetClaimId === "number";
  const wantsGroup = typeof targetGroupId === "number";

  const provided = [wantsUnmatch, wantsClaim, wantsGroup].filter(Boolean).length;
  if (provided !== 1) {
    res.status(400).json({ error: "Provide exactly one of targetClaimId, targetGroupId, or unmatch:true" });
    return;
  }

  const [response] = await db.select().from(portalResponsesTable).where(eq(portalResponsesTable.id, id));
  if (!response) { res.status(404).json({ error: "Response not found" }); return; }

  const sourceClaimId = response.claimId;
  const sourceGroupId = response.invoiceGroupId;
  const actor = {
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? "User",
  };

  // Reverse the original "Needs Review" transition on the source if it
  // still sits in Needs Review and was triggered by this response's match.
  if (sourceClaimId) {
    const [src] = await db.select().from(claimsTable).where(eq(claimsTable.id, sourceClaimId));
    if (src && src.status === "Needs Review") {
      try {
        await transitionClaimStatus({
          claimId: sourceClaimId,
          newStatus: "Awaiting Response",
          source: "response_reassign",
          reason: `Response #${response.id} reassigned away — reverting to Awaiting Response`,
          actor,
          systemOverride: true,
        });
      } catch (err) {
        logger.warn({ err, claimId: sourceClaimId }, "Could not reverse claim status on reassign");
      }
    }
  }
  if (sourceGroupId) {
    const [src] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, sourceGroupId));
    if (src && src.status === "Needs Review") {
      try {
        await transitionGroupStatus({
          groupId: sourceGroupId,
          newStatus: "Awaiting Response",
          source: "response_reassign",
          reason: `Response #${response.id} reassigned away — reverting to Awaiting Response`,
          actor,
          systemOverride: true,
        });
      } catch (err) {
        logger.warn({ err, groupId: sourceGroupId }, "Could not reverse group status on reassign");
      }
    }
  }

  let updated;
  let targetDescription: string;
  if (wantsUnmatch) {
    [updated] = await db.update(portalResponsesTable).set({
      claimId: null,
      invoiceGroupId: null,
      submissionId: null,
      autoLinked: false,
      matchedVia: "manual_unmatched",
      matchConfidence: "low",
      processed: false,
    }).where(eq(portalResponsesTable.id, id)).returning();
    targetDescription = "unmatched";
  } else if (wantsClaim) {
    const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, targetClaimId));
    if (!claim) { res.status(404).json({ error: "Target claim not found" }); return; }
    [updated] = await db.update(portalResponsesTable).set({
      claimId: targetClaimId,
      invoiceGroupId: null,
      autoLinked: false,
      matchedVia: "manual_reassign",
      matchConfidence: "high",
    }).where(eq(portalResponsesTable.id, id)).returning();
    targetDescription = `claim #${targetClaimId} (${claim.confNumber})`;
  } else {
    const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, targetGroupId));
    if (!group) { res.status(404).json({ error: "Target group not found" }); return; }
    [updated] = await db.update(portalResponsesTable).set({
      claimId: null,
      invoiceGroupId: targetGroupId,
      autoLinked: false,
      matchedVia: "manual_reassign",
      matchConfidence: "high",
    }).where(eq(portalResponsesTable.id, id)).returning();
    targetDescription = `invoice group #${targetGroupId} (${group.invoiceNumber})`;
  }

  const auditAction = wantsUnmatch ? "response_unmatched" : "response_reassigned";
  const sharedMetadata = {
    responseId: id,
    fromClaimId: sourceClaimId,
    fromGroupId: sourceGroupId,
    toClaimId: wantsClaim ? targetClaimId : null,
    toGroupId: wantsGroup ? targetGroupId : null,
    target: targetDescription,
  };

  if (sourceClaimId) {
    await db.insert(auditLogsTable).values({
      claimId: sourceClaimId,
      action: auditAction,
      details: `Response #${response.id} ${wantsUnmatch ? "unlinked" : `reassigned to ${targetDescription}`}`,
      metadata: sharedMetadata,
      userEmail: actor.userEmail,
      userName: actor.userName,
    });
  }
  if (sourceGroupId) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: sourceGroupId,
      action: auditAction,
      details: `Response #${response.id} ${wantsUnmatch ? "unlinked" : `reassigned to ${targetDescription}`}`,
      metadata: sharedMetadata,
      userEmail: actor.userEmail,
      userName: actor.userName,
    });
  }
  if (wantsClaim) {
    await db.insert(auditLogsTable).values({
      claimId: targetClaimId,
      action: auditAction,
      details: `Response #${response.id} reassigned here from ${sourceClaimId ? `claim #${sourceClaimId}` : sourceGroupId ? `group #${sourceGroupId}` : "unmatched pool"}`,
      metadata: sharedMetadata,
      userEmail: actor.userEmail,
      userName: actor.userName,
    });
  }
  if (wantsGroup) {
    await db.insert(auditLogsTable).values({
      invoiceGroupId: targetGroupId,
      action: auditAction,
      details: `Response #${response.id} reassigned here from ${sourceClaimId ? `claim #${sourceClaimId}` : sourceGroupId ? `group #${sourceGroupId}` : "unmatched pool"}`,
      metadata: sharedMetadata,
      userEmail: actor.userEmail,
      userName: actor.userName,
    });
  }

  res.json(updated);
}));

router.get("/claims/:id/email-thread", asyncHandler(async (req, res): Promise<void> => {
  const claimId = parseInt(String(req.params.id), 10);
  if (isNaN(claimId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  // Pull all messages tied to this claim (any conversation, including null)
  // PLUS any sibling-claim messages that share a conversation with this
  // claim. Doing it in one OR ensures null-conversationId messages on the
  // current claim are never dropped just because the claim also has
  // threaded conversations.
  const inboundForClaim = await db.select().from(portalResponsesTable)
    .where(eq(portalResponsesTable.claimId, claimId));
  const outboundForClaim = await db.select().from(outboundEmailsTable)
    .where(eq(outboundEmailsTable.claimId, claimId));

  const conversationIds = new Set<string>();
  for (const r of inboundForClaim) if (r.conversationId) conversationIds.add(r.conversationId);
  for (const o of outboundForClaim) if (o.conversationId) conversationIds.add(o.conversationId);

  const convIdList = Array.from(conversationIds);
  const allInbound = convIdList.length > 0
    ? await db.select().from(portalResponsesTable).where(
        or(
          eq(portalResponsesTable.claimId, claimId),
          inArray(portalResponsesTable.conversationId, convIdList),
        ),
      )
    : inboundForClaim;
  const allOutbound = convIdList.length > 0
    ? await db.select().from(outboundEmailsTable).where(
        or(
          eq(outboundEmailsTable.claimId, claimId),
          inArray(outboundEmailsTable.conversationId, convIdList),
        ),
      )
    : outboundForClaim;

  // Sibling-claim refs (one round trip) for the "↳ also covers INV-…" pill.
  const siblingClaimIds = new Set<number>();
  for (const r of allInbound) if (r.claimId !== null && r.claimId !== claimId) siblingClaimIds.add(r.claimId);
  for (const o of allOutbound) if (o.claimId !== null && o.claimId !== claimId) siblingClaimIds.add(o.claimId);
  const siblingClaims = siblingClaimIds.size > 0
    ? await db.select({
        id: claimsTable.id,
        refNumber: claimsTable.refNumber,
        confNumber: claimsTable.confNumber,
      }).from(claimsTable).where(inArray(claimsTable.id, Array.from(siblingClaimIds)))
    : [];
  const lookup = buildSiblingLookup(siblingClaims);

  const messages: ThreadMessage[] = [
    ...allInbound.map((r) => inboundToMessage(r, claimId, lookup)),
    ...allOutbound.map((o) => outboundToMessage(o, claimId, lookup)),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const isClaimResolved =
    claim.status === "Resolved" ||
    claim.status === "Denied" ||
    (claim.outcome !== "Pending" && claim.outcome !== null);
  const conversations = groupByConversation(messages, isClaimResolved);

  res.json({
    messages,
    conversationIds: Array.from(conversationIds),
    conversations,
  });
}));

router.post("/claims/:id/email-thread/:conversationId/reply", asyncHandler(async (req, res): Promise<void> => {
  const claimId = parseInt(String(req.params.id), 10);
  if (isNaN(claimId)) { res.status(400).json({ error: "Invalid claim id" }); return; }

  const conversationId = String(req.params.conversationId || "").trim();
  if (!conversationId) { res.status(400).json({ error: "Missing conversationId" }); return; }

  const { subject, bodyText, to, cc, evidenceIds } = req.body ?? {};
  if (typeof subject !== "string" || subject.trim().length === 0) {
    res.status(400).json({ error: "subject is required" });
    return;
  }
  if (typeof bodyText !== "string" || bodyText.trim().length === 0) {
    res.status(400).json({ error: "bodyText is required" });
    return;
  }
  const toList = Array.isArray(to)
    ? (to as unknown[]).map((v) => String(v).trim()).filter(Boolean)
    : [];
  const ccList = Array.isArray(cc)
    ? (cc as unknown[]).map((v) => String(v).trim()).filter(Boolean)
    : [];
  if (toList.length === 0) {
    res.status(400).json({ error: "At least one 'to' recipient is required" });
    return;
  }

  // Evidence ids → unique positive ints. Anything else (negatives, NaN,
  // non-array) is treated as "no attachments" so a malformed picker payload
  // can never leak unrelated evidence into the outgoing reply.
  const evidenceIdList = Array.isArray(evidenceIds)
    ? Array.from(
        new Set(
          (evidenceIds as unknown[])
            .map((v) => Number(v))
            .filter((n) => Number.isInteger(n) && n > 0),
        ),
      )
    : [];

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  // Authorize: conversation must be anchored to this claim (inbound or
  // outbound), else replies could be spoofed across claims.
  const claimInbound = await db.select().from(portalResponsesTable)
    .where(and(
      eq(portalResponsesTable.conversationId, conversationId),
      eq(portalResponsesTable.claimId, claimId),
    ))
    .orderBy(desc(portalResponsesTable.receivedAt))
    .limit(1);
  const claimOutbound = await db.select().from(outboundEmailsTable)
    .where(and(
      eq(outboundEmailsTable.conversationId, conversationId),
      eq(outboundEmailsTable.claimId, claimId),
    ))
    .orderBy(desc(outboundEmailsTable.sentAt))
    .limit(1);

  if (claimInbound.length === 0 && claimOutbound.length === 0) {
    res.status(404).json({ error: "Conversation not found for this claim" });
    return;
  }

  // Pivot for Graph createReply: prefer latest inbound on this claim, else
  // latest outbound on this claim. Sibling-claim rows are deliberately
  // excluded so we never leak message IDs across claims.
  const originalMessageId: string | null =
    claimInbound[0]?.externalMessageId ?? claimOutbound[0]?.messageId ?? null;

  if (!originalMessageId) {
    res.status(404).json({ error: "No prior message found for this conversation" });
    return;
  }

  // Resolve evidence ids → downloadable URLs. We require every requested
  // id to belong to the current claim so a malicious or stale picker can't
  // attach evidence from a different claim onto an outgoing reply. We also
  // restrict the URLs we'll fetch from: only object-storage references
  // (`/objects/...`) are accepted — never arbitrary http(s) URLs that some
  // legacy evidence row might be carrying. This blocks an authenticated
  // staff account from steering the server into fetching internal
  // metadata services or private network resources via the reply path
  // (i.e. SSRF / data-exfiltration).
  let attachmentNamesForRow: string[] = [];
  let attachmentsForGraph: Awaited<ReturnType<typeof downloadAttachmentsWithRetry>> = [];
  if (evidenceIdList.length > 0) {
    const evidenceRows = await db.select()
      .from(claimEvidenceTable)
      .where(and(
        inArray(claimEvidenceTable.id, evidenceIdList),
        eq(claimEvidenceTable.claimId, claimId),
      ));
    if (evidenceRows.length !== evidenceIdList.length) {
      res.status(400).json({
        error: "One or more evidence ids do not belong to this claim",
      });
      return;
    }
    const orderedRows = evidenceIdList
      .map((id) => evidenceRows.find((r) => r.id === id))
      .filter((r): r is typeof evidenceRows[number] => Boolean(r));
    const urls: string[] = [];
    // Mirror the inline cap enforced inside `outlook.replyToMessage` so we
    // can fail before touching the network when staff pick a single file
    // that's already known to be too large for Graph's inline path.
    const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
    const objectStorage = new ObjectStorageService();
    for (const row of orderedRows) {
      if (!row.imageUrl || row.imageUrl.trim().length === 0) {
        res.status(400).json({
          error: `Evidence #${row.id} (${row.evidenceTypeName}) has no file to attach`,
        });
        return;
      }
      const trimmedUrl = row.imageUrl.trim();
      if (!trimmedUrl.startsWith("/objects/")) {
        res.status(400).json({
          error: `Evidence #${row.id} (${row.evidenceTypeName}) cannot be attached: only files stored in app object storage are allowed.`,
        });
        return;
      }
      // Pre-flight size check via object metadata so we never buffer a
      // multi-megabyte (or attacker-suggested huge) blob just to reject
      // it after the bytes have already arrived.
      try {
        const file = await objectStorage.getObjectEntityFile(trimmedUrl);
        const [metadata] = await file.getMetadata();
        const size = typeof metadata.size === "number"
          ? metadata.size
          : Number(metadata.size ?? 0);
        if (size > MAX_ATTACHMENT_BYTES) {
          res.status(400).json({
            error: `Evidence #${row.id} (${row.evidenceTypeName}) is ${(size / (1024 * 1024)).toFixed(1)}MB. Max attachment size is 3MB.`,
          });
          return;
        }
      } catch (metaErr) {
        logger.error({ err: metaErr, evidenceId: row.id, url: trimmedUrl }, "Failed to stat evidence object before reply");
        res.status(502).json({
          error: `Could not read evidence #${row.id} (${row.evidenceTypeName}) — try again in a moment.`,
        });
        return;
      }
      urls.push(trimmedUrl);
    }
    try {
      attachmentsForGraph = await downloadAttachmentsWithRetry(urls, `claim-${claim.confNumber || claim.id}`);
    } catch (err) {
      logger.error({ err, claimId, evidenceIdList }, "Failed to download evidence for reply");
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to download evidence",
      });
      return;
    }
    attachmentNamesForRow = attachmentsForGraph.map((a) => a.name);
  }

  // Send via Graph. Failures bubble up as 502 so the composer can retry.
  let sendResult: { messageId: string | null; conversationId: string | null };
  try {
    sendResult = await replyImpl({
      originalMessageId,
      subject,
      bodyText,
      to: toList,
      cc: ccList.length > 0 ? ccList : undefined,
      attachments: attachmentsForGraph.length > 0 ? attachmentsForGraph : undefined,
    });
  } catch (err) {
    logger.error({ err, claimId, conversationId }, "Failed to send reply via Outlook");
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to send reply",
    });
    return;
  }

  // Persist with the route's conversationId (NOT Graph's echo) so the new
  // outbound stays grouped with the same thread on the UI.
  const persistConversationId = conversationId;
  const bodyPreview = bodyText.replace(/\s+/g, " ").trim().slice(0, 500);
  const [persisted] = await db.insert(outboundEmailsTable).values({
    messageId: sendResult.messageId,
    conversationId: persistConversationId,
    claimId,
    invoiceGroupId: null,
    submissionId: null,
    kind: "manual",
    subject,
    recipients: [...toList, ...ccList],
    bodyPreview,
    attachmentNames: attachmentNamesForRow.length > 0 ? attachmentNamesForRow : null,
    sentByUserEmail: req.user?.email ?? null,
    sentByUserName: req.user?.displayName ?? null,
  }).returning();

  // Audit row.
  await db.insert(auditLogsTable).values({
    claimId,
    action: "email_reply_sent",
    details: `Reply sent to ${toList.join(", ")}: "${subject}"`,
    metadata: {
      outboundEmailId: persisted.id,
      conversationId: persistConversationId,
      messageId: sendResult.messageId,
      to: toList,
      cc: ccList,
      subject,
      attachmentNames: attachmentNamesForRow,
      evidenceIds: evidenceIdList,
    },
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? "User",
  });

  // Thread-shaped echo for optimistic UI append.
  const message: ThreadMessage = {
    id: `out-${persisted.id}`,
    direction: "outbound",
    conversationId: persistConversationId,
    subject: persisted.subject,
    sender: persisted.sentByUserName || persisted.sentByUserEmail || "ClaimClear",
    senderEmail: persisted.sentByUserEmail,
    bodyPreview: persisted.bodyPreview,
    timestamp: persisted.sentAt.toISOString(),
    responseId: null,
    responseType: null,
    processed: null,
    aiSummary: null,
    extractedAmount: null,
    extractedDeadline: null,
    requestedAction: null,
    classifierSource: null,
    matchedVia: null,
    matchConfidence: null,
    claimId,
    siblingClaimRef: null,
    siblingClaimId: null,
    attachmentNames: attachmentNamesForRow.length > 0 ? attachmentNamesForRow : null,
  };

  res.json(message);
}));

/**
 * Group-level email thread (Task #240).
 *
 * Aggregates every inbound payor message and outbound staff reply that is
 * either pinned directly to the invoice group or that lives on one of the
 * group's child claims. Then walks any conversation IDs found in that scope
 * outward so we don't drop sibling-claim messages that share a single
 * Outlook thread (a common pattern for group disputes covering several
 * legs). Returns the same `EmailThreadResponse` shape as the per-claim
 * route — the response review UI consumes it identically.
 */
router.get("/invoice-groups/:id/email-thread", asyncHandler(async (req, res): Promise<void> => {
  const groupId = parseInt(String(req.params.id), 10);
  if (isNaN(groupId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  // Pull the group's claim ids; messages may be anchored on any of them.
  const groupClaims = await db.select({
    id: claimsTable.id,
    refNumber: claimsTable.refNumber,
    confNumber: claimsTable.confNumber,
  }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, groupId));
  const groupClaimIds = groupClaims.map((c) => c.id);

  // Seed: rows attached to the group itself OR to any of its child claims.
  const seedInbound = await db.select().from(portalResponsesTable).where(
    or(
      eq(portalResponsesTable.invoiceGroupId, groupId),
      groupClaimIds.length > 0 ? inArray(portalResponsesTable.claimId, groupClaimIds) : undefined,
    ),
  );
  const seedOutbound = await db.select().from(outboundEmailsTable).where(
    or(
      eq(outboundEmailsTable.invoiceGroupId, groupId),
      groupClaimIds.length > 0 ? inArray(outboundEmailsTable.claimId, groupClaimIds) : undefined,
    ),
  );

  // Walk outward by conversationId so any sibling-claim rows that share a
  // thread with the group's scope come along too. Mirrors the per-claim
  // endpoint's pattern.
  const conversationIds = new Set<string>();
  for (const r of seedInbound) if (r.conversationId) conversationIds.add(r.conversationId);
  for (const o of seedOutbound) if (o.conversationId) conversationIds.add(o.conversationId);
  const convIdList = Array.from(conversationIds);

  const allInbound = convIdList.length > 0
    ? await db.select().from(portalResponsesTable).where(
        or(
          eq(portalResponsesTable.invoiceGroupId, groupId),
          groupClaimIds.length > 0 ? inArray(portalResponsesTable.claimId, groupClaimIds) : undefined,
          inArray(portalResponsesTable.conversationId, convIdList),
        ),
      )
    : seedInbound;
  const allOutbound = convIdList.length > 0
    ? await db.select().from(outboundEmailsTable).where(
        or(
          eq(outboundEmailsTable.invoiceGroupId, groupId),
          groupClaimIds.length > 0 ? inArray(outboundEmailsTable.claimId, groupClaimIds) : undefined,
          inArray(outboundEmailsTable.conversationId, convIdList),
        ),
      )
    : seedOutbound;

  // Build the sibling lookup from every claim id we saw — group's own claims
  // PLUS any sibling claims pulled in via the conversation join — so the
  // `claimId` -> human-readable ref mapping the UI uses for "leg" tags
  // covers both.
  const seenClaimIds = new Set<number>(groupClaimIds);
  for (const r of allInbound) if (r.claimId !== null) seenClaimIds.add(r.claimId);
  for (const o of allOutbound) if (o.claimId !== null) seenClaimIds.add(o.claimId);
  const extraClaimIds = Array.from(seenClaimIds).filter((id) => !groupClaimIds.includes(id));
  const extraClaims = extraClaimIds.length > 0
    ? await db.select({
        id: claimsTable.id,
        refNumber: claimsTable.refNumber,
        confNumber: claimsTable.confNumber,
      }).from(claimsTable).where(inArray(claimsTable.id, extraClaimIds))
    : [];
  const lookup = buildSiblingLookup([...groupClaims, ...extraClaims]);

  // Group context: every row tied to one of the group's child claims (or to
  // the group itself) is in-scope, so we use the group's own claim ids as
  // the "current" set when deciding whether a row is sibling. We pass `-1`
  // as the per-claim "currentClaimId" — anything in `groupClaimIds` is
  // resolved out below by overwriting `siblingClaimId` / `siblingClaimRef`.
  const messages: ThreadMessage[] = [
    ...allInbound.map((r) => inboundToMessage(r, -1, lookup)),
    ...allOutbound.map((o) => outboundToMessage(o, -1, lookup)),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // In group context, "sibling" means out-of-group. Any claimId already in
  // the group's child-claim set is part of the primary thread, not a
  // sibling — clear those flags so the UI doesn't render leg-internal
  // messages as out-of-scope. claimId == null (group-only attached) is
  // never a sibling either.
  const groupClaimIdSet = new Set(groupClaimIds);
  for (const m of messages) {
    if (m.claimId === null || groupClaimIdSet.has(m.claimId)) {
      m.siblingClaimId = null;
      m.siblingClaimRef = null;
    }
  }

  const isGroupResolved =
    group.status === "Resolved" ||
    group.status === "Denied" ||
    (group.outcome !== "Pending" && group.outcome !== null);
  const conversations = groupByConversation(messages, isGroupResolved);

  res.json({
    messages,
    conversationIds: Array.from(conversationIds),
    conversations,
  });
}));

router.post("/invoice-groups/:id/email-thread/:conversationId/reply", asyncHandler(async (req, res): Promise<void> => {
  const groupId = parseInt(String(req.params.id), 10);
  if (isNaN(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }

  const conversationId = String(req.params.conversationId || "").trim();
  if (!conversationId) { res.status(400).json({ error: "Missing conversationId" }); return; }

  const { subject, bodyText, to, cc } = req.body ?? {};
  if (typeof subject !== "string" || subject.trim().length === 0) {
    res.status(400).json({ error: "subject is required" });
    return;
  }
  if (typeof bodyText !== "string" || bodyText.trim().length === 0) {
    res.status(400).json({ error: "bodyText is required" });
    return;
  }
  const toList = Array.isArray(to)
    ? (to as unknown[]).map((v) => String(v).trim()).filter(Boolean)
    : [];
  const ccList = Array.isArray(cc)
    ? (cc as unknown[]).map((v) => String(v).trim()).filter(Boolean)
    : [];
  if (toList.length === 0) {
    res.status(400).json({ error: "At least one 'to' recipient is required" });
    return;
  }

  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }

  // Authorize: the conversation must include at least one row pinned to
  // this group OR to one of its child claims. Sibling-claim rows alone
  // are NOT sufficient — replying via a group page should never reach
  // through a shared thread to send mail on a claim that isn't ours.
  const groupClaimRows = await db.select({ id: claimsTable.id })
    .from(claimsTable).where(eq(claimsTable.invoiceGroupId, groupId));
  const groupClaimIds = groupClaimRows.map((c) => c.id);

  const inboundForGroup = await db.select().from(portalResponsesTable)
    .where(and(
      eq(portalResponsesTable.conversationId, conversationId),
      or(
        eq(portalResponsesTable.invoiceGroupId, groupId),
        groupClaimIds.length > 0 ? inArray(portalResponsesTable.claimId, groupClaimIds) : undefined,
      ),
    ))
    .orderBy(desc(portalResponsesTable.receivedAt))
    .limit(1);
  const outboundForGroup = await db.select().from(outboundEmailsTable)
    .where(and(
      eq(outboundEmailsTable.conversationId, conversationId),
      or(
        eq(outboundEmailsTable.invoiceGroupId, groupId),
        groupClaimIds.length > 0 ? inArray(outboundEmailsTable.claimId, groupClaimIds) : undefined,
      ),
    ))
    .orderBy(desc(outboundEmailsTable.sentAt))
    .limit(1);

  if (inboundForGroup.length === 0 && outboundForGroup.length === 0) {
    res.status(404).json({ error: "Conversation not found for this group" });
    return;
  }

  // Pivot for Graph createReply: prefer the latest in-scope inbound, else
  // fall back to the latest in-scope outbound. Out-of-scope sibling-claim
  // rows are deliberately excluded so we never leak a message id across
  // groups.
  const originalMessageId: string | null =
    inboundForGroup[0]?.externalMessageId ?? outboundForGroup[0]?.messageId ?? null;
  if (!originalMessageId) {
    res.status(404).json({ error: "No prior message found for this conversation" });
    return;
  }

  // Default the persisted-row's claimId to whichever child-claim the latest
  // in-scope message was anchored on; falls back to null when the row was
  // group-only. This keeps the per-claim email-thread route's siblings join
  // consistent across both views.
  const persistClaimId: number | null =
    inboundForGroup[0]?.claimId ?? outboundForGroup[0]?.claimId ?? null;

  let sendResult: { messageId: string | null; conversationId: string | null };
  try {
    sendResult = await replyImpl({
      originalMessageId,
      subject,
      bodyText,
      to: toList,
      cc: ccList.length > 0 ? ccList : undefined,
    });
  } catch (err) {
    logger.error({ err, groupId, conversationId }, "Failed to send group reply via Outlook");
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to send reply",
    });
    return;
  }

  // Persist with the route's conversationId (NOT Graph's echo) so the new
  // outbound stays grouped with the same thread on the UI.
  const persistConversationId = conversationId;
  const bodyPreview = bodyText.replace(/\s+/g, " ").trim().slice(0, 500);
  const [persisted] = await db.insert(outboundEmailsTable).values({
    messageId: sendResult.messageId,
    conversationId: persistConversationId,
    claimId: persistClaimId,
    invoiceGroupId: groupId,
    submissionId: null,
    kind: "manual",
    subject,
    recipients: [...toList, ...ccList],
    bodyPreview,
    attachmentNames: null,
    sentByUserEmail: req.user?.email ?? null,
    sentByUserName: req.user?.displayName ?? null,
  }).returning();

  await db.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    claimId: persistClaimId,
    action: "email_reply_sent",
    details: `Reply sent to ${toList.join(", ")}: "${subject}"`,
    metadata: {
      outboundEmailId: persisted.id,
      conversationId: persistConversationId,
      messageId: sendResult.messageId,
      to: toList,
      cc: ccList,
      subject,
      scope: "invoice_group",
    },
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? "User",
  });

  // Thread-shaped echo for optimistic UI append.
  const message: ThreadMessage = {
    id: `out-${persisted.id}`,
    direction: "outbound",
    conversationId: persistConversationId,
    subject: persisted.subject,
    sender: persisted.sentByUserName || persisted.sentByUserEmail || "ClaimClear",
    senderEmail: persisted.sentByUserEmail,
    bodyPreview: persisted.bodyPreview,
    timestamp: persisted.sentAt.toISOString(),
    responseId: null,
    responseType: null,
    processed: null,
    aiSummary: null,
    extractedAmount: null,
    extractedDeadline: null,
    requestedAction: null,
    classifierSource: null,
    matchedVia: null,
    matchConfidence: null,
    claimId: persistClaimId,
    siblingClaimRef: null,
    siblingClaimId: null,
    attachmentNames: null,
  };

  res.json(message);
}));

export default router;
