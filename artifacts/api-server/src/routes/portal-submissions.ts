import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, claimsTable, auditLogsTable, botActivityLogTable, errorTypesTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function generatePortalDescription(
  claim: typeof claimsTable.$inferSelect,
  errorType: typeof errorTypesTable.$inferSelect | null,
  disputeReason: string,
): Promise<string> {
  const instructions = errorType?.disputeInstructions || errorType?.emailTemplate || "";

  const prompt = `Write a concise dispute note for an NEMT (Non-Emergency Medical Transportation) claim correction request to be submitted on a support portal.

Claim details:
- Confirmation number: ${claim.confNumber}
- Service date: ${claim.date || "N/A"}
- Reference number: ${claim.refNumber || "N/A"}
- Client number: ${claim.clientNumber || "N/A"}
- Car/vehicle number: ${claim.carNumber || "N/A"}
- Claim amount: $${claim.claimAmount || "0.00"}
- Error type: ${claim.errorTypeName || "N/A"}
- Error details: ${claim.errorDetails || "N/A"}

Reason for dispute (from workflow decision): ${disputeReason}

${claim.evidenceNotes ? `Evidence gathered: ${claim.evidenceNotes}` : ""}
${errorType?.guidance ? `SOP context: ${errorType.guidance}` : ""}

${instructions ? `IMPORTANT — Follow these guidelines for tone and content:\n${instructions}` : ""}

Write a clear, factual portal submission note that:
- States the reason for the dispute/correction request
- References specific evidence
- Is professional but sounds natural and human — vary phrasing
- Is concise (2-4 paragraphs maximum)
- Does NOT include email-style greetings or sign-offs (this goes in a portal text field, not an email)

Return ONLY the note text, no JSON wrapping.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
    system: "You are a professional NEMT claims dispute specialist. Write clear, factual portal submission notes on behalf of a transportation provider. Each note should sound natural — vary sentence structure and word choice so no two notes are identical. Avoid boilerplate or robotic language. Return only the note text.",
  });

  const textBlock = message.content.find((b: { type: string }) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Empty LLM response");
  return (textBlock as { type: "text"; text: string }).text.trim();
}

function buildFallbackDescription(
  claim: typeof claimsTable.$inferSelect,
  disputeReason: string,
): string {
  return `Dispute for Confirmation Number: ${claim.confNumber || "N/A"}
Service Date: ${claim.date || "N/A"}
Reference Number: ${claim.refNumber || "N/A"}
Client Number: ${claim.clientNumber || "N/A"}
Car Number: ${claim.carNumber || "N/A"}
Claim Amount: $${claim.claimAmount || "0.00"}
Error Type: ${claim.errorTypeName || "N/A"}
Error Details: ${claim.errorDetails || "N/A"}

Dispute Reason: ${disputeReason || "N/A"}

Evidence Notes: ${claim.evidenceNotes || "N/A"}`;
}

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.get("/portal-submissions", asyncHandler(async (req, res): Promise<void> => {
  const { status } = req.query;
  const statusStr = typeof status === "string" ? status : undefined;

  const submissions = await db.select().from(portalSubmissionsTable)
    .where(statusStr ? eq(portalSubmissionsTable.status, statusStr as (typeof portalSubmissionsTable.status.enumValues)[number]) : undefined)
    .orderBy(desc(portalSubmissionsTable.createdAt));

  res.json(submissions);
}));

router.post("/portal-submissions", asyncHandler(async (req, res): Promise<void> => {
  const { claimId, issueType, subject, requesterEmail, transportationProviderName,
    phoneNumber, invoiceNumber, gpsBreadcrumbsAvailable, descriptionHtml, disputeReason } = req.body;

  if (!claimId) { res.status(400).json({ error: "claimId is required" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  let errorType: typeof errorTypesTable.$inferSelect | null = null;
  if (claim.errorTypeId) {
    const etId = parseInt(claim.errorTypeId, 10);
    if (!isNaN(etId)) {
      const [et] = await db.select().from(errorTypesTable).where(eq(errorTypesTable.id, etId));
      errorType = et || null;
    }
  }

  const reason = disputeReason || "";

  let generatedDescription = descriptionHtml || "";
  if (!generatedDescription && reason) {
    try {
      generatedDescription = await generatePortalDescription(claim, errorType, reason);
    } catch (err) {
      logger.warn({ err }, "AI portal description generation failed, using fallback");
      generatedDescription = buildFallbackDescription(claim, reason);
    }
  }
  if (!generatedDescription) {
    generatedDescription = buildFallbackDescription(claim, reason);
  }

  let attachmentUrls: string[] = [];
  if (claim.evidenceFiles && Array.isArray(claim.evidenceFiles)) {
    attachmentUrls = (claim.evidenceFiles as Array<Record<string, string> | string>)
      .map((f) => (typeof f === "string" ? f : f.url))
      .filter((u): u is string => typeof u === "string" && u.length > 0);
  }

  const [submission] = await db.insert(portalSubmissionsTable).values({
    claimId: claim.id,
    status: "pending",
    issueType: issueType || "",
    subject: subject || `Dispute - ${claim.confNumber}`,
    requesterEmail: requesterEmail || "",
    transportationProviderName: transportationProviderName || "",
    phoneNumber: phoneNumber || "",
    invoiceNumber: invoiceNumber || claim.refNumber || "",
    gpsBreadcrumbsAvailable: gpsBreadcrumbsAvailable || "",
    descriptionHtml: generatedDescription,
    attachmentUrls: attachmentUrls,
    confNumber: claim.confNumber || "",
    serviceDate: claim.date || "",
    refNumber: claim.refNumber || "",
    clientNumber: claim.clientNumber || "",
    carNumber: claim.carNumber || "",
    claimAmount: claim.claimAmount || null,
    errorTypeName: claim.errorTypeName || "",
    errorDetails: claim.errorDetails || "",
    disputeReason: reason,
    evidenceNotes: claim.evidenceNotes || "",
    evidenceFiles: claim.evidenceFiles || null,
    workflowHistory: claim.workflowProgress || null,
    attempts: 0,
  }).returning();

  await db.update(claimsTable).set({ status: "Portal Queued" }).where(eq(claimsTable.id, claim.id));

  await db.insert(auditLogsTable).values({
    claimId: claim.id,
    action: "portal_submission_created",
    details: `Portal submission queued${reason ? ` — reason: ${reason}` : ""}`,
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });

  res.status(201).json(submission);
}));

router.get("/portal-submissions/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [sub] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }

  res.json(sub);
}));

router.post("/portal-submissions/:id/retry", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [sub] = await db.update(portalSubmissionsTable).set({
    status: "pending",
    errorMessage: null,
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }
  res.json(sub);
}));

router.post("/portal-submissions/:id/cancel", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [sub] = await db.update(portalSubmissionsTable).set({
    status: "cancelled",
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }
  res.json(sub);
}));

router.get("/portal-submissions/:id/activity", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const logs = await db.select().from(botActivityLogTable)
    .where(eq(botActivityLogTable.submissionId, id))
    .orderBy(desc(botActivityLogTable.createdAt));

  res.json(logs);
}));

export default router;
