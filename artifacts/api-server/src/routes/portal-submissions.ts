import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, claimsTable, auditLogsTable, botActivityLogTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

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
    descriptionHtml: descriptionHtml || "",
    attachmentUrls: attachmentUrls,
    confNumber: claim.confNumber || "",
    serviceDate: claim.date || "",
    refNumber: claim.refNumber || "",
    clientNumber: claim.clientNumber || "",
    carNumber: claim.carNumber || "",
    claimAmount: claim.claimAmount || null,
    errorTypeName: claim.errorTypeName || "",
    errorDetails: claim.errorDetails || "",
    disputeReason: disputeReason || "",
    evidenceNotes: claim.evidenceNotes || "",
    evidenceFiles: claim.evidenceFiles || null,
    workflowHistory: claim.workflowProgress || null,
    attempts: 0,
  }).returning();

  await db.update(claimsTable).set({ status: "Portal Queued" }).where(eq(claimsTable.id, claim.id));

  await db.insert(auditLogsTable).values({
    claimId: claim.id,
    action: "portal_submission_created",
    details: "Portal submission queued",
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
