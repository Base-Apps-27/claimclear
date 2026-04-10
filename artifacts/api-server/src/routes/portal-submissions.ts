import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, claimsTable, auditLogsTable, botActivityLogTable, errorTypesTable, appSettingsTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface PortalSettings {
  providerName: string;
  contactEmail: string;
  contactPhone: string;
  defaultGpsBreadcrumbs: string;
  defaultDisputeInstructions: string;
}

async function getPortalSettings(): Promise<PortalSettings> {
  const rows = await db.select().from(appSettingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value || "";
  return {
    providerName: map["portal_provider_name"] || "",
    contactEmail: map["portal_contact_email"] || "",
    contactPhone: map["portal_contact_phone"] || "",
    defaultGpsBreadcrumbs: map["portal_default_gps_breadcrumbs"] || "",
    defaultDisputeInstructions: map["default_dispute_instructions"] || "",
  };
}

function extractInvoiceNumber(refNumber: string | null): string {
  if (!refNumber) return "";
  const parts = refNumber.trim().split(/\s+/);
  return parts[0] || "";
}

function determineIssueType(errorTypeName: string | null): string {
  if (!errorTypeName) return "Other Issue or Question";
  const lower = errorTypeName.toLowerCase();
  if (lower.includes("gps") || lower.includes("deviation") || lower.includes("breadcrumb")) {
    return "GPS Control Deviation";
  }
  return "Other Issue or Question";
}

async function generatePortalDescription(
  claim: typeof claimsTable.$inferSelect,
  errorType: typeof errorTypesTable.$inferSelect | null,
  disputeReason: string,
  settings: PortalSettings,
): Promise<string> {
  const instructions = errorType?.disputeInstructions || errorType?.emailTemplate || settings.defaultDisputeInstructions;

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

router.post("/portal-submissions/generate-preview", asyncHandler(async (req, res): Promise<void> => {
  const { claimId, disputeReason } = req.body;
  if (!claimId) { res.status(400).json({ error: "claimId is required" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  const existingDrafts = await db.select().from(portalSubmissionsTable)
    .where(and(eq(portalSubmissionsTable.claimId, claimId), eq(portalSubmissionsTable.status, "draft")));
  for (const draft of existingDrafts) {
    await db.update(portalSubmissionsTable).set({ status: "cancelled" })
      .where(eq(portalSubmissionsTable.id, draft.id));
  }

  const settings = await getPortalSettings();

  let errorType: typeof errorTypesTable.$inferSelect | null = null;
  if (claim.errorTypeId) {
    const etId = parseInt(claim.errorTypeId, 10);
    if (!isNaN(etId)) {
      const [et] = await db.select().from(errorTypesTable).where(eq(errorTypesTable.id, etId));
      errorType = et || null;
    }
  }

  const reason = disputeReason || "";
  const issueType = determineIssueType(claim.errorTypeName);
  const invoiceNumber = extractInvoiceNumber(claim.refNumber);
  const subject = `Dispute - Conf #${claim.confNumber || "N/A"} - ${claim.errorTypeName || "Claim Correction"}`;

  let generatedDescription = "";
  try {
    generatedDescription = await generatePortalDescription(claim, errorType, reason, settings);
  } catch (err) {
    logger.warn({ err }, "AI portal description generation failed, using fallback");
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
    status: "draft",
    issueType,
    subject,
    requesterEmail: settings.contactEmail,
    transportationProviderName: settings.providerName,
    phoneNumber: settings.contactPhone,
    invoiceNumber,
    gpsBreadcrumbsAvailable: settings.defaultGpsBreadcrumbs,
    descriptionHtml: generatedDescription,
    attachmentUrls,
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

  await db.insert(auditLogsTable).values({
    claimId: claim.id,
    action: "portal_draft_created",
    details: `Portal submission draft generated for review`,
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });

  res.json(submission);
}));

router.put("/portal-submissions/:id/update-draft", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }
  const editableStatuses = ["draft", "pending", "failed"];
  if (!editableStatuses.includes(existing.status)) {
    res.status(400).json({ error: "Only draft, pending, or failed submissions can be edited" });
    return;
  }

  const updates: Record<string, string> = {};
  if (req.body.subject !== undefined) updates.subject = req.body.subject;
  if (req.body.descriptionHtml !== undefined) updates.descriptionHtml = req.body.descriptionHtml;
  if (req.body.issueType !== undefined) updates.issueType = req.body.issueType;
  if (req.body.gpsBreadcrumbsAvailable !== undefined) updates.gpsBreadcrumbsAvailable = req.body.gpsBreadcrumbsAvailable;
  if (req.body.requesterEmail !== undefined) updates.requesterEmail = req.body.requesterEmail;
  if (req.body.transportationProviderName !== undefined) updates.transportationProviderName = req.body.transportationProviderName;
  if (req.body.phoneNumber !== undefined) updates.phoneNumber = req.body.phoneNumber;
  if (req.body.invoiceNumber !== undefined) updates.invoiceNumber = req.body.invoiceNumber;

  const [sub] = await db.update(portalSubmissionsTable).set(updates)
    .where(eq(portalSubmissionsTable.id, id)).returning();

  res.json(sub);
}));

router.post("/portal-submissions/:id/regenerate", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }

  const editableStatuses = ["draft", "pending", "failed"];
  if (!editableStatuses.includes(existing.status)) {
    res.status(400).json({ error: "Cannot regenerate text for submissions in this status" });
    return;
  }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, existing.claimId));
  if (!claim) { res.status(404).json({ error: "Associated claim not found" }); return; }

  const settings = await getPortalSettings();

  let errorType: typeof errorTypesTable.$inferSelect | null = null;
  if (claim.errorTypeId) {
    const etId = parseInt(claim.errorTypeId, 10);
    if (!isNaN(etId)) {
      const [et] = await db.select().from(errorTypesTable).where(eq(errorTypesTable.id, etId));
      errorType = et || null;
    }
  }

  let generatedDescription = "";
  try {
    generatedDescription = await generatePortalDescription(claim, errorType, existing.disputeReason || "", settings);
  } catch (err) {
    logger.warn({ err }, "AI portal description regeneration failed, using fallback");
    generatedDescription = buildFallbackDescription(claim, existing.disputeReason || "");
  }

  const [sub] = await db.update(portalSubmissionsTable).set({
    descriptionHtml: generatedDescription,
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  res.json(sub);
}));

router.post("/portal-submissions/:id/confirm", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }
  if (existing.status !== "draft") {
    res.status(400).json({ error: "Only draft submissions can be confirmed" });
    return;
  }

  const [sub] = await db.update(portalSubmissionsTable).set({ status: "pending" })
    .where(eq(portalSubmissionsTable.id, id)).returning();

  await db.update(claimsTable).set({ status: "Portal Queued" }).where(eq(claimsTable.id, existing.claimId));

  await db.insert(auditLogsTable).values({
    claimId: existing.claimId,
    action: "portal_submission_confirmed",
    details: `Portal submission confirmed and queued for processing`,
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });

  res.json(sub);
}));

router.post("/portal-submissions", asyncHandler(async (req, res): Promise<void> => {
  const { claimId, issueType, subject, requesterEmail, transportationProviderName,
    phoneNumber, invoiceNumber, gpsBreadcrumbsAvailable, descriptionHtml, disputeReason } = req.body;

  if (!claimId) { res.status(400).json({ error: "claimId is required" }); return; }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }

  const settings = await getPortalSettings();

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
      generatedDescription = await generatePortalDescription(claim, errorType, reason, settings);
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
    issueType: issueType || determineIssueType(claim.errorTypeName),
    subject: subject || `Dispute - Conf #${claim.confNumber || "N/A"} - ${claim.errorTypeName || "Claim Correction"}`,
    requesterEmail: requesterEmail || settings.contactEmail,
    transportationProviderName: transportationProviderName || settings.providerName,
    phoneNumber: phoneNumber || settings.contactPhone,
    invoiceNumber: invoiceNumber || extractInvoiceNumber(claim.refNumber),
    gpsBreadcrumbsAvailable: gpsBreadcrumbsAvailable || settings.defaultGpsBreadcrumbs,
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

router.post("/portal-submissions/:id/sandbox-run", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { runSandboxForSubmission } = await import("../lib/batch-processor");
  const updated = await runSandboxForSubmission(id);
  res.json(updated);
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
