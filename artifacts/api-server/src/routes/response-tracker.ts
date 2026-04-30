import { Router, type IRouter } from "express";
import { eq, desc, and, or, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalResponsesTable, portalSubmissionsTable, claimsTable, invoiceGroupsTable, notesTable, auditLogsTable, outboundEmailsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { searchInboxEmails, isOutlookConnected, replyToMessage } from "../lib/outlook";
import { matchEmailToClaim, processEmailResponse, processPortalResponse } from "../lib/response-matcher";
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

router.patch("/responses/:id/process", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { responseType, claimId, invoiceGroupId } = req.body;

  const updates: Record<string, unknown> = { processed: true };
  if (responseType) updates.responseType = responseType;
  if (claimId) updates.claimId = claimId;
  if (invoiceGroupId) updates.invoiceGroupId = invoiceGroupId;

  const [response] = await db.update(portalResponsesTable).set(updates).where(eq(portalResponsesTable.id, id)).returning();
  if (!response) { res.status(404).json({ error: "Response not found" }); return; }

  if (responseType) {
    const statusMap: Record<string, { status: string; outcome: string }> = {
      approval: { status: "Resolved", outcome: "Approved" },
      denial: { status: "Denied", outcome: "Denied" },
      partial_approval: { status: "Resolved", outcome: "Partially Approved" },
      info_request: { status: "Needs Review", outcome: "Pending" },
    };

    const mapping = statusMap[responseType];
    if (mapping) {
      if (response.invoiceGroupId) {
        const { transitionGroupStatus } = await import("../lib/group-transitions");
        await transitionGroupStatus({
          groupId: response.invoiceGroupId,
          newStatus: "Needs Review",
          source: "response_tracker",
          reason: `Response #${response.id} processed as ${responseType} — awaiting staff post-response action`,
          actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? "Response Tracker" },
          systemOverride: true,
        });
      } else if (response.claimId) {
        const { transitionClaimStatus } = await import("../lib/claim-transitions");
        await transitionClaimStatus({
          claimId: response.claimId,
          newStatus: "Needs Review",
          source: "response_tracker",
          reason: `Response #${response.id} processed as ${responseType} — awaiting staff post-response action`,
          actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? "Response Tracker" },
          systemOverride: true,
        });
      }
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
    claimId: submission.claimId,
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

  if (submission.invoiceGroupId) {
    broadcastGroupEvent({
      type: "response_received",
      invoiceGroupId: submission.invoiceGroupId,
      userName: "Response Tracker",
      userEmail: null,
      timestamp: new Date().toISOString(),
    });
  } else {
    broadcastClaimEvent({
      type: "response_received",
      claimId: submission.claimId,
      userName: "Response Tracker",
      userEmail: null,
      timestamp: new Date().toISOString(),
    });
  }

  res.json({ responseId, claimId: submission.claimId, invoiceGroupId: submission.invoiceGroupId });
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

  // Send via Graph. Failures bubble up as 502 so the composer can retry.
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
  };

  res.json(message);
}));

export default router;
