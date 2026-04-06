import { Router, type IRouter } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, claimsTable, notesTable, botActivityLogTable, botInstancesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.post("/poll", asyncHandler(async (req, res): Promise<void> => {
  const { botInstanceId } = req.body;

  const submissions = await db.select().from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.status, "pending"))
    .orderBy(portalSubmissionsTable.createdAt)
    .limit(20);

  if (botInstanceId) {
    await db.update(botInstancesTable).set({
      lastPollAt: new Date(),
    }).where(eq(botInstancesTable.id, botInstanceId));
  }

  res.json(submissions);
}));

router.post("/:id/claim", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { botInstanceId } = req.body;

  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT id FROM ${portalSubmissionsTable} WHERE id = ${id} AND status = 'pending' FOR UPDATE SKIP LOCKED`
    );

    if (!locked.rows || locked.rows.length === 0) return null;

    const [sub] = await tx.update(portalSubmissionsTable).set({
      status: "in_progress",
      attempts: sql`${portalSubmissionsTable.attempts} + 1`,
    }).where(and(eq(portalSubmissionsTable.id, id), eq(portalSubmissionsTable.status, "pending"))).returning();

    if (!sub) return null;

    if (botInstanceId) {
      await tx.insert(botActivityLogTable).values({
        submissionId: id,
        botInstanceId,
        action: "claimed",
        success: true,
        message: "Submission claimed for processing",
      });
    }

    return sub;
  });

  if (!result) { res.status(409).json({ error: "Submission not found or already claimed" }); return; }

  res.json(result);
}));

router.post("/:id/complete", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { portalTicketId, botInstanceId, screenshotPath, pageHtmlPath } = req.body;

  const [sub] = await db.update(portalSubmissionsTable).set({
    status: "submitted",
    portalTicketId: portalTicketId || "",
    submittedAt: new Date().toISOString(),
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }

  await db.update(claimsTable).set({
    status: "Awaiting Response",
    disputeEmailSent: true,
    disputeEmailSentAt: new Date().toISOString(),
  }).where(eq(claimsTable.id, sub.claimId));

  await db.insert(notesTable).values({
    claimId: sub.claimId,
    type: "email_sent",
    content: `Portal ticket submitted successfully${portalTicketId ? ` - Ticket ID: ${portalTicketId}` : ""}`,
    author: "Portal Bot",
  });

  if (botInstanceId) {
    await db.update(botInstancesTable).set({
      successCount: sql`${botInstancesTable.successCount} + 1`,
      submissionsToday: sql`${botInstancesTable.submissionsToday} + 1`,
    }).where(eq(botInstancesTable.id, botInstanceId));
  }

  await db.insert(botActivityLogTable).values({
    submissionId: id,
    botInstanceId: botInstanceId || null,
    action: "completed",
    success: true,
    message: `Submitted successfully${portalTicketId ? ` - Ticket: ${portalTicketId}` : ""}`,
    screenshotPath: screenshotPath || null,
    pageHtmlPath: pageHtmlPath || null,
  });

  res.json(sub);
}));

router.post("/:id/retry", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [sub] = await db.update(portalSubmissionsTable).set({
    status: "pending",
    errorMessage: null,
  }).where(
    and(
      eq(portalSubmissionsTable.id, id),
      inArray(portalSubmissionsTable.status, ["failed", "in_progress"])
    )
  ).returning();

  if (!sub) { res.status(404).json({ error: "Submission not found or not in retryable state" }); return; }

  await db.insert(botActivityLogTable).values({
    submissionId: id,
    botInstanceId: req.body.botInstanceId || null,
    action: "retried",
    success: true,
    message: "Submission reset to pending for retry",
  });

  res.json(sub);
}));

router.post("/:id/fail", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { errorMessage, botInstanceId, screenshotPath, pageHtmlPath } = req.body;

  const [sub] = await db.update(portalSubmissionsTable).set({
    status: "failed",
    errorMessage: errorMessage || "Unknown error",
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }

  if (botInstanceId) {
    await db.update(botInstancesTable).set({
      failCount: sql`${botInstancesTable.failCount} + 1`,
    }).where(eq(botInstancesTable.id, botInstanceId));
  }

  await db.insert(botActivityLogTable).values({
    submissionId: id,
    botInstanceId: botInstanceId || null,
    action: "failed",
    success: false,
    message: errorMessage || "Unknown error",
    screenshotPath: screenshotPath || null,
    pageHtmlPath: pageHtmlPath || null,
  });

  res.json(sub);
}));

export default router;
