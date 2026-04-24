import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, botActivityLogTable, claimsTable, notesTable, appSettingsTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcastPresenceEvent } from "./sse";
import { ObjectStorageService } from "./objectStorage";
import { transitionClaimStatus } from "./claim-transitions";
import { transitionGroupStatus } from "./group-transitions";
import { invoiceGroupsTable } from "@workspace/db";
import { scheduleRetryOrFail } from "./submission-retry";

function resolveGps(value: string, issueType: string): string {
  if (["Yes", "No", "Unknown"].includes(value)) return value;
  const isGps = issueType === "GPS Control Deviation";
  return isGps ? "Yes" : "";
}

async function getPortalDefaults() {
  const rows = await db.select().from(appSettingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value || "";
  return {
    providerName: map["portal_provider_name"] || "",
    contactEmail: map["portal_contact_email"] || "",
    contactPhone: map["portal_contact_phone"] || "",
    defaultGpsBreadcrumbs: map["portal_default_gps_breadcrumbs"] || "",
  };
}

export interface BatchJob {
  id: string;
  status: "running" | "completed" | "failed";
  submissionIds: number[];
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  results: { submissionId: number; status: "success" | "failed" | "skipped"; message: string }[];
  startedAt: string;
  completedAt?: string;
  triggeredBy: string;
}

const activeBatches = new Map<string, BatchJob>();

export function getBatchJob(batchId: string): BatchJob | undefined {
  return activeBatches.get(batchId);
}

export function listBatchJobs(): BatchJob[] {
  return Array.from(activeBatches.values()).sort((a, b) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export async function startBatchJob(
  submissionIds: number[] | "all",
  triggeredBy: string,
): Promise<BatchJob> {
  let ids: number[];

  if (submissionIds === "all") {
    const pending = await db.select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.status, "pending"));
    ids = pending.map(s => s.id);
  } else {
    ids = submissionIds;
  }

  if (ids.length === 0) {
    throw new Error("No pending submissions to process");
  }

  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const job: BatchJob = {
    id: batchId,
    status: "running",
    submissionIds: ids,
    total: ids.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    results: [],
    startedAt: new Date().toISOString(),
    triggeredBy,
  };

  activeBatches.set(batchId, job);

  processSequentially(job).catch(err => {
    logger.error({ err, batchId }, "Batch processing fatal error");
    job.status = "failed";
    job.completedAt = new Date().toISOString();
  });

  return job;
}

async function processSequentially(job: BatchJob): Promise<void> {
  logger.info({ batchId: job.id, total: job.total }, "Starting batch processing");

  for (const subId of job.submissionIds) {
    let subClaimId: number | null = null;
    try {
      const [sub] = await db.select().from(portalSubmissionsTable)
        .where(and(
          eq(portalSubmissionsTable.id, subId),
          eq(portalSubmissionsTable.status, "pending"),
        ));

      if (!sub) {
        job.results.push({ submissionId: subId, status: "skipped", message: "Not pending or not found" });
        job.processed++;
        continue;
      }
      subClaimId = sub.claimId;

      await db.update(portalSubmissionsTable).set({
        status: "in_progress",
        attempts: (sub.attempts || 0) + 1,
      }).where(eq(portalSubmissionsTable.id, subId));

      await db.insert(botActivityLogTable).values({
        submissionId: subId,
        botInstanceId: null,
        action: "batch_claimed",
        success: true,
        message: `Claimed by batch job ${job.id} (triggered by ${job.triggeredBy})`,
      });

      broadcastPresenceEvent({
        type: "bot_started",
        claimId: sub.claimId,
        userName: "Batch Processor",
        userEmail: null,
        botProcess: "portal_submission",
        timestamp: new Date().toISOString(),
      });

      await processViaExternalBot(sub);

      broadcastPresenceEvent({
        type: "bot_completed",
        claimId: sub.claimId,
        userName: "Batch Processor",
        userEmail: null,
        botProcess: "portal_submission",
        timestamp: new Date().toISOString(),
      });

      job.results.push({ submissionId: subId, status: "success", message: "Processed successfully" });
      job.succeeded++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, submissionId: subId, batchId: job.id }, "Batch submission processing failed");

      const retryResult = await scheduleRetryOrFail({
        submissionId: subId,
        errorMessage: errMsg,
        source: `batch_processor:${job.id}`,
        userName: "Batch Processor",
      }).catch((helperErr) => {
        logger.error({ err: helperErr, submissionId: subId }, "scheduleRetryOrFail threw — falling back to direct status='failed' write");
        return null;
      });

      // Last-resort fallback: if the helper threw, the row would otherwise
      // stay stuck in `in_progress`. Force it to `failed` so the next
      // batch / stuck-reset sweep doesn't ignore it. The fallback write
      // is best-effort and never throws out of the catch block.
      if (!retryResult) {
        try {
          await db.update(portalSubmissionsTable).set({
            status: "failed",
            errorMessage: errMsg,
            nextRetryAt: null,
          }).where(eq(portalSubmissionsTable.id, subId));
        } catch (fallbackErr) {
          logger.error({ err: fallbackErr, submissionId: subId }, "Fallback status='failed' write also failed — submission may be left in in_progress");
        }
      }

      await db.insert(botActivityLogTable).values({
        submissionId: subId,
        botInstanceId: null,
        action: "batch_failed",
        success: false,
        message: retryResult?.outcome === "retry_scheduled"
          ? `${errMsg} (retry ${retryResult.attempts + 1}/${retryResult.maxAttempts} scheduled for ${retryResult.nextRetryAt!.toISOString()})`
          : retryResult?.outcome === "retries_exhausted"
            ? `${errMsg} (retries exhausted after ${retryResult.attempts}/${retryResult.maxAttempts})`
            : `${errMsg} (retry helper failed; row force-marked failed)`,
      }).catch(() => {});

      if (subClaimId) {
        broadcastPresenceEvent({
          type: "bot_completed",
          claimId: subClaimId,
          userName: "Batch Processor",
          userEmail: null,
          botProcess: "portal_submission",
          timestamp: new Date().toISOString(),
        });
      }

      job.results.push({ submissionId: subId, status: "failed", message: errMsg });
      job.failed++;
    }

    job.processed++;
  }

  job.status = "completed";
  job.completedAt = new Date().toISOString();
  logger.info({
    batchId: job.id,
    total: job.total,
    succeeded: job.succeeded,
    failed: job.failed,
  }, "Batch processing completed");

  setTimeout(() => activeBatches.delete(job.id), 24 * 60 * 60 * 1000);
}

async function processViaExternalBot(
  sub: typeof portalSubmissionsTable.$inferSelect,
): Promise<void> {
  const { runBatchWorker } = await import("../bot/batch-worker");
  const defaults = await getPortalDefaults();

  const issueType = sub.issueType || "Other Issue or Question";

  const workerSub: import("../bot/batch-worker").PortalSubmission = {
    id: sub.id,
    confNumber: sub.confNumber || "",
    serviceDate: sub.serviceDate || "",
    refNumber: sub.refNumber || "",
    clientNumber: sub.clientNumber || "",
    carNumber: sub.carNumber || "",
    claimAmount: sub.claimAmount,
    errorTypeName: sub.errorTypeName || "",
    errorDetails: sub.errorDetails || "",
    issueType,
    subject: sub.subject || `Dispute - Conf #${sub.confNumber || "N/A"} - ${sub.errorTypeName || "Claim Correction"}`,
    requesterEmail: sub.requesterEmail || defaults.contactEmail,
    transportationProviderName: sub.transportationProviderName || defaults.providerName,
    phoneNumber: sub.phoneNumber || defaults.contactPhone,
    invoiceNumber: sub.invoiceNumber || "",
    gpsBreadcrumbsAvailable: resolveGps(sub.gpsBreadcrumbsAvailable || defaults.defaultGpsBreadcrumbs, issueType),
    descriptionHtml: sub.descriptionHtml || "",
    disputeReason: sub.disputeReason || "",
    evidenceNotes: sub.evidenceNotes || "",
    attachmentUrls: Array.isArray(sub.attachmentUrls)
      ? (sub.attachmentUrls as string[]).filter((u): u is string => typeof u === "string")
      : [],
  };

  logger.info({ submissionId: sub.id, issueType, attachmentCount: workerSub.attachmentUrls.length }, "processViaExternalBot: resolved submission data");

  const dryRun = process.env.BOT_DRY_RUN === "true";
  const result = await runBatchWorker(workerSub, dryRun);

  if (dryRun) {
    await db.update(portalSubmissionsTable).set({
      status: "dry_run",
    }).where(eq(portalSubmissionsTable.id, sub.id));

    await db.insert(botActivityLogTable).values({
      submissionId: sub.id,
      botInstanceId: null,
      action: "dry_run_complete",
      success: true,
      message: `Dry run screenshot saved: ${result.screenshotPath}`,
    });
  } else {
    await db.update(portalSubmissionsTable).set({
      status: "submitted",
      portalTicketId: result.ticketId || null,
      submittedAt: new Date().toISOString(),
    }).where(eq(portalSubmissionsTable.id, sub.id));

    const submittedAtIso = new Date().toISOString();
    if (sub.invoiceGroupId) {
      await transitionGroupStatus({
        groupId: sub.invoiceGroupId,
        newStatus: "Awaiting Response",
        source: "batch_processor",
        reason: `Portal ticket submitted successfully${result.ticketId ? ` - Ticket ID: ${result.ticketId}` : ""}`,
        actor: { userEmail: null, userName: "Batch Processor" },
        systemOverride: true,
        extraFields: {
          disputeEmailSent: true,
          disputeEmailSentAt: submittedAtIso,
        },
      });
    } else {
      await transitionClaimStatus({
        claimId: sub.claimId,
        newStatus: "Awaiting Response",
        source: "batch_processor",
        reason: `Portal ticket submitted successfully${result.ticketId ? ` - Ticket ID: ${result.ticketId}` : ""}`,
        actor: { userEmail: null, userName: "Batch Processor" },
        systemOverride: true,
        extraFields: {
          disputeEmailSent: true,
          disputeEmailSentAt: submittedAtIso,
        },
      });
    }

    await db.insert(botActivityLogTable).values({
      submissionId: sub.id,
      botInstanceId: null,
      action: "submission_complete",
      success: true,
      message: `Submitted successfully. Ticket: ${result.ticketId || "N/A"}`,
    });
  }

  logger.info({ submissionId: sub.id, ticketId: result.ticketId, dryRun }, "Batch worker completed successfully");
}

export async function runSandboxForSubmission(subId: number): Promise<typeof portalSubmissionsTable.$inferSelect> {
  const [sub] = await db.select().from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, subId));

  if (!sub) throw new Error("Submission not found");

  const allowedStatuses = ["draft", "pending", "failed", "dry_run"];
  if (!allowedStatuses.includes(sub.status)) {
    throw new Error(`Cannot sandbox-run a submission in "${sub.status}" status`);
  }

  const previousStatus = sub.status;

  await db.update(portalSubmissionsTable).set({
    status: "in_progress",
    attempts: (sub.attempts || 0) + 1,
  }).where(eq(portalSubmissionsTable.id, subId));

  broadcastPresenceEvent({
    type: "bot_started",
    claimId: sub.claimId,
    userName: "Sandbox Runner",
    userEmail: null,
    botProcess: "portal_sandbox",
    timestamp: new Date().toISOString(),
  });

  try {
    const { runBatchWorker } = await import("../bot/batch-worker");
    const defaults = await getPortalDefaults();

    const issueType = sub.issueType || "Other Issue or Question";

    const workerSub: import("../bot/batch-worker").PortalSubmission = {
      id: sub.id,
      confNumber: sub.confNumber || "",
      serviceDate: sub.serviceDate || "",
      refNumber: sub.refNumber || "",
      clientNumber: sub.clientNumber || "",
      carNumber: sub.carNumber || "",
      claimAmount: sub.claimAmount,
      errorTypeName: sub.errorTypeName || "",
      errorDetails: sub.errorDetails || "",
      issueType,
      subject: sub.subject || `Dispute - Conf #${sub.confNumber || "N/A"} - ${sub.errorTypeName || "Claim Correction"}`,
      requesterEmail: sub.requesterEmail || defaults.contactEmail,
      transportationProviderName: sub.transportationProviderName || defaults.providerName,
      phoneNumber: sub.phoneNumber || defaults.contactPhone,
      invoiceNumber: sub.invoiceNumber || "",
      gpsBreadcrumbsAvailable: resolveGps(sub.gpsBreadcrumbsAvailable || defaults.defaultGpsBreadcrumbs, issueType),
      descriptionHtml: sub.descriptionHtml || "",
      disputeReason: sub.disputeReason || "",
      evidenceNotes: sub.evidenceNotes || "",
      attachmentUrls: Array.isArray(sub.attachmentUrls)
        ? (sub.attachmentUrls as string[]).filter((u): u is string => typeof u === "string")
        : [],
    };

    logger.info({ submissionId: sub.id, issueType, attachmentCount: workerSub.attachmentUrls.length }, "runSandboxForSubmission: resolved submission data");

    const result = await runBatchWorker(workerSub, true);

    let screenshotUrl: string | null = null;
    if (result.screenshotPath) {
      try {
        const storage = new ObjectStorageService();
        screenshotUrl = await storage.uploadLocalFile(result.screenshotPath, "image/png");
        const fs = await import("fs");
        try { fs.unlinkSync(result.screenshotPath); } catch {}
      } catch (uploadErr) {
        logger.warn({ err: uploadErr, submissionId: subId }, "Failed to upload sandbox screenshot to object storage");
      }
    }

    const [updated] = await db.update(portalSubmissionsTable).set({
      status: "dry_run",
      screenshotUrl,
      submittedAt: new Date().toISOString(),
      errorMessage: null,
    }).where(eq(portalSubmissionsTable.id, subId)).returning();

    await db.insert(botActivityLogTable).values({
      submissionId: subId,
      botInstanceId: null,
      action: "sandbox_run_complete",
      success: true,
      message: `Sandbox dry run completed${screenshotUrl ? " — screenshot saved" : ""}`,
      screenshotPath: screenshotUrl || result.screenshotPath || null,
    });

    broadcastPresenceEvent({
      type: "bot_completed",
      claimId: sub.claimId,
      userName: "Sandbox Runner",
      userEmail: null,
      botProcess: "portal_sandbox",
      timestamp: new Date().toISOString(),
    });

    return updated;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, submissionId: subId }, "Sandbox run failed");

    let updated: typeof portalSubmissionsTable.$inferSelect;
    let activityMessage = errMsg;

    if (previousStatus === "dry_run") {
      // Sandbox-only re-run from a prior dry_run; do not consume retry budget.
      [updated] = await db.update(portalSubmissionsTable).set({
        status: "dry_run",
        errorMessage: `Sandbox run failed: ${errMsg}`,
      }).where(eq(portalSubmissionsTable.id, subId)).returning();
    } else {
      const retryResult = await scheduleRetryOrFail({
        submissionId: subId,
        errorMessage: `Sandbox run failed: ${errMsg}`,
        source: "sandbox_runner",
        userName: "Sandbox Runner",
      }).catch((helperErr) => {
        logger.error({ err: helperErr, submissionId: subId }, "scheduleRetryOrFail threw in sandbox runner");
        return null;
      });

      if (retryResult?.updated) {
        updated = retryResult.updated;
        activityMessage = retryResult.outcome === "retry_scheduled"
          ? `${errMsg} (retry ${retryResult.attempts + 1}/${retryResult.maxAttempts} scheduled for ${retryResult.nextRetryAt!.toISOString()})`
          : `${errMsg} (retries exhausted after ${retryResult.attempts}/${retryResult.maxAttempts})`;
      } else {
        // Helper failed — fall back to direct status write so we never leave the row in_progress.
        [updated] = await db.update(portalSubmissionsTable).set({
          status: "failed",
          errorMessage: `Sandbox run failed: ${errMsg}`,
        }).where(eq(portalSubmissionsTable.id, subId)).returning();
      }
    }

    await db.insert(botActivityLogTable).values({
      submissionId: subId,
      botInstanceId: null,
      action: "sandbox_run_failed",
      success: false,
      message: activityMessage,
    });

    broadcastPresenceEvent({
      type: "bot_completed",
      claimId: sub.claimId,
      userName: "Sandbox Runner",
      userEmail: null,
      botProcess: "portal_sandbox",
      timestamp: new Date().toISOString(),
    });

    return updated;
  }
}
