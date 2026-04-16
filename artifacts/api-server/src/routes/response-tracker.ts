import { Router, type IRouter } from "express";
import { eq, desc, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalResponsesTable, portalSubmissionsTable, claimsTable, notesTable, auditLogsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { searchInboxEmails, isOutlookConnected } from "../lib/outlook";
import { matchEmailToClaim, processEmailResponse, processPortalResponse } from "../lib/response-matcher";
import { broadcastClaimEvent } from "../lib/sse";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/responses", asyncHandler(async (req, res): Promise<void> => {
  const { claimId, source, processed, limit: limitStr, offset: offsetStr } = req.query;
  const limitVal = parseInt(String(limitStr || "50"), 10);
  const offsetVal = parseInt(String(offsetStr || "0"), 10);

  let query = db.select().from(portalResponsesTable).orderBy(desc(portalResponsesTable.receivedAt)).limit(limitVal).offset(offsetVal).$dynamic();

  const conditions = [];
  if (claimId) conditions.push(eq(portalResponsesTable.claimId, parseInt(String(claimId), 10)));
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
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [response] = await db.select().from(portalResponsesTable).where(eq(portalResponsesTable.id, id));
  if (!response) { res.status(404).json({ error: "Response not found" }); return; }

  res.json(response);
}));

router.patch("/responses/:id/process", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { responseType, claimId } = req.body;

  const updates: Record<string, unknown> = { processed: true };
  if (responseType) updates.responseType = responseType;
  if (claimId) updates.claimId = claimId;

  const [response] = await db.update(portalResponsesTable).set(updates).where(eq(portalResponsesTable.id, id)).returning();
  if (!response) { res.status(404).json({ error: "Response not found" }); return; }

  if (response.claimId && responseType) {
    const statusMap: Record<string, { status: string; outcome: string }> = {
      approval: { status: "Resolved", outcome: "Approved" },
      denial: { status: "Denied", outcome: "Denied" },
      partial_approval: { status: "Resolved", outcome: "Partially Approved" },
      info_request: { status: "Needs Review", outcome: "Pending" },
    };

    const mapping = statusMap[responseType];
    if (mapping) {
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

  res.json(response);
}));

router.patch("/responses/:id/link", asyncHandler(async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { claimId } = req.body;
  if (!claimId) { res.status(400).json({ error: "claimId required" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  const [response] = await db.update(portalResponsesTable).set({
    claimId,
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

router.post("/responses/check-email", asyncHandler(async (req, res): Promise<void> => {
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
  const results: { emailSubject: string; status: string; claimId?: number; responseType?: string }[] = [];

  for (const email of emails) {
    if (existingMessageIds.has(email.id)) {
      skipped++;
      continue;
    }

    const match = await matchEmailToClaim(email);
    if (match) {
      const responseId = await processEmailResponse(email, match);
      matched++;
      results.push({
        emailSubject: email.subject,
        status: "matched",
        claimId: match.claimId,
      });

      broadcastClaimEvent({
        type: "response_received",
        claimId: match.claimId,
        userName: "Response Tracker",
        userEmail: null,
        timestamp: new Date().toISOString(),
      });
    } else {
      unmatched++;
    }
  }

  logger.info({ matched, unmatched, skipped }, "Email response check completed");

  res.json({
    checked: emails.length,
    matched,
    unmatched,
    skipped,
    results,
  });
}));

router.post("/responses/record-portal", asyncHandler(async (req, res): Promise<void> => {
  const { submissionId, responseType, content } = req.body;

  if (!submissionId || !responseType) {
    res.status(400).json({ error: "submissionId and responseType are required" });
    return;
  }

  const [submission] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, submissionId));
  if (!submission) { res.status(404).json({ error: "Submission not found" }); return; }

  const responseId = await processPortalResponse({
    claimId: submission.claimId,
    submissionId: submission.id,
    portalTicketId: submission.portalTicketId || "",
    responseType,
    content: content || "",
    metadata: req.body.metadata || null,
  });

  broadcastClaimEvent({
    type: "response_received",
    claimId: submission.claimId,
    userName: "Response Tracker",
    userEmail: null,
    timestamp: new Date().toISOString(),
  });

  res.json({ responseId, claimId: submission.claimId });
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

export default router;
