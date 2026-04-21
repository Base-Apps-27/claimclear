import { Router, type IRouter } from "express";
import { eq, and, sql, inArray, or, isNull, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, claimsTable, invoiceGroupsTable, notesTable, botActivityLogTable, botInstancesTable, auditLogsTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { broadcastPresenceEvent } from "../lib/sse";
import { transitionClaimStatus } from "../lib/claim-transitions";
import { transitionGroupStatus } from "../lib/group-transitions";

const router: IRouter = Router();

const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60];

export function computeNextRetryDelayMinutes(attemptsSoFar: number): number {
  const idx = Math.min(Math.max(attemptsSoFar - 1, 0), RETRY_BACKOFF_MINUTES.length - 1);
  return RETRY_BACKOFF_MINUTES[idx];
}

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.post("/poll", asyncHandler(async (req, res): Promise<void> => {
  const { botInstanceId } = req.body;

  const submissions = await db.select().from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.status, "pending"),
      or(isNull(portalSubmissionsTable.nextRetryAt), lte(portalSubmissionsTable.nextRetryAt, new Date())),
    ))
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
      nextRetryAt: null,
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

  broadcastPresenceEvent({
    type: "bot_started",
    claimId: result.claimId,
    userName: "Portal Bot",
    userEmail: null,
    botProcess: "portal_submission",
    timestamp: new Date().toISOString(),
  });

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

  const finalOutcomes = ["Approved", "Partially Approved", "Denied", "Non-Issue"];
  const submittedAtIso = new Date().toISOString();

  if (sub.invoiceGroupId) {
    const [currentGroup] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, sub.invoiceGroupId));
    const groupResolved = currentGroup && finalOutcomes.includes(currentGroup.outcome);
    if (currentGroup && !groupResolved) {
      await transitionGroupStatus({
        groupId: sub.invoiceGroupId,
        newStatus: "Awaiting Response",
        source: "portal_bot_complete",
        reason: `Portal ticket submitted successfully${portalTicketId ? ` - Ticket ID: ${portalTicketId}` : ""}`,
        actor: { userEmail: null, userName: "Portal Bot" },
        systemOverride: true,
        extraFields: {
          disputeEmailSent: true,
          disputeEmailSentAt: submittedAtIso,
        },
      });
    } else if (currentGroup) {
      await db.update(invoiceGroupsTable).set({
        disputeEmailSent: true,
        disputeEmailSentAt: submittedAtIso,
      }).where(eq(invoiceGroupsTable.id, sub.invoiceGroupId));
    }
  } else {
    const [currentClaim] = await db.select().from(claimsTable).where(eq(claimsTable.id, sub.claimId));
    const hasResolvedOutcome = currentClaim && finalOutcomes.includes(currentClaim.outcome);
    if (!hasResolvedOutcome) {
      await transitionClaimStatus({
        claimId: sub.claimId,
        newStatus: "Awaiting Response",
        source: "portal_bot_complete",
        reason: `Portal ticket submitted successfully${portalTicketId ? ` - Ticket ID: ${portalTicketId}` : ""}`,
        actor: { userEmail: null, userName: "Portal Bot" },
        systemOverride: true,
        extraFields: {
          disputeEmailSent: true,
          disputeEmailSentAt: submittedAtIso,
        },
      });
    } else {
      await db.update(claimsTable).set({
        disputeEmailSent: true,
        disputeEmailSentAt: submittedAtIso,
      }).where(eq(claimsTable.id, sub.claimId));
    }
  }

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

  broadcastPresenceEvent({
    type: "bot_completed",
    claimId: sub.claimId,
    userName: "Portal Bot",
    userEmail: null,
    botProcess: "portal_submission",
    timestamp: new Date().toISOString(),
  });

  res.json(sub);
}));

router.post("/:id/retry", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [sub] = await db.update(portalSubmissionsTable).set({
    status: "pending",
    errorMessage: null,
    nextRetryAt: null,
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

router.post("/:id/complete-dry-run", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { botInstanceId, screenshotPath } = req.body;

  const [sub] = await db.update(portalSubmissionsTable).set({
    status: "dry_run",
    submittedAt: new Date().toISOString(),
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }

  if (botInstanceId) {
    await db.update(botInstancesTable).set({
      successCount: sql`${botInstancesTable.successCount} + 1`,
      submissionsToday: sql`${botInstancesTable.submissionsToday} + 1`,
    }).where(eq(botInstancesTable.id, botInstanceId));
  }

  await db.insert(botActivityLogTable).values({
    submissionId: id,
    botInstanceId: botInstanceId || null,
    action: "dry_run",
    success: true,
    message: "Dry run completed — form filled but not submitted",
    screenshotPath: screenshotPath || null,
  });

  res.json(sub);
}));

router.post("/:id/fail", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { errorMessage, botInstanceId, screenshotPath, pageHtmlPath } = req.body;
  const errMsg = errorMessage || "Unknown error";

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }

  const attemptsSoFar = existing.attempts || 0;
  const maxAttempts = existing.maxAttempts || 4;
  const exhausted = attemptsSoFar >= maxAttempts;

  let updated: typeof portalSubmissionsTable.$inferSelect | undefined;
  let nextRetryAt: Date | null = null;

  if (exhausted) {
    [updated] = await db.update(portalSubmissionsTable).set({
      status: "failed",
      errorMessage: errMsg,
      nextRetryAt: null,
    }).where(eq(portalSubmissionsTable.id, id)).returning();
  } else {
    const delayMin = computeNextRetryDelayMinutes(attemptsSoFar);
    nextRetryAt = new Date(Date.now() + delayMin * 60_000);
    [updated] = await db.update(portalSubmissionsTable).set({
      status: "pending",
      errorMessage: errMsg,
      nextRetryAt,
    }).where(eq(portalSubmissionsTable.id, id)).returning();
  }

  if (!updated) { res.status(404).json({ error: "Submission not found" }); return; }

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
    message: errMsg,
    screenshotPath: screenshotPath || null,
    pageHtmlPath: pageHtmlPath || null,
  });

  if (exhausted) {
    await db.insert(auditLogsTable).values({
      claimId: updated.claimId,
      invoiceGroupId: updated.invoiceGroupId ?? null,
      action: "submission_retries_exhausted",
      details: `Portal submission #${id} failed after ${attemptsSoFar} attempt${attemptsSoFar === 1 ? "" : "s"} (max ${maxAttempts}): ${errMsg.slice(0, 200)}`,
      metadata: { submissionId: id, attempts: attemptsSoFar, maxAttempts, lastError: errMsg },
      userEmail: null,
      userName: "Portal Bot",
    });
  } else {
    await db.insert(auditLogsTable).values({
      claimId: updated.claimId,
      invoiceGroupId: updated.invoiceGroupId ?? null,
      action: "submission_retry_scheduled",
      details: `Portal submission #${id} retry ${attemptsSoFar + 1}/${maxAttempts} scheduled for ${nextRetryAt!.toISOString()} (after: ${errMsg.slice(0, 200)})`,
      metadata: { submissionId: id, attempts: attemptsSoFar, maxAttempts, nextRetryAt: nextRetryAt!.toISOString(), lastError: errMsg },
      userEmail: null,
      userName: "Portal Bot",
    });
  }

  broadcastPresenceEvent({
    type: "bot_completed",
    claimId: updated.claimId,
    userName: "Portal Bot",
    userEmail: null,
    botProcess: "portal_submission",
    timestamp: new Date().toISOString(),
  });

  res.json(updated);
}));

export default router;
