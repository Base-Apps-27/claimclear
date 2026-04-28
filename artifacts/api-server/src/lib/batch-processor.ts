import { eq, and, or, isNull, isNotNull, lte, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, botActivityLogTable, claimsTable, notesTable, appSettingsTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcastPresenceEvent, broadcastBatchEvent } from "./sse";
import { ObjectStorageService } from "./objectStorage";
import { transitionClaimStatus } from "./claim-transitions";
import { transitionGroupStatus } from "./group-transitions";
import { invoiceGroupsTable } from "@workspace/db";
import { scheduleRetryOrFail } from "./submission-retry";
import { createWorkerGate } from "./worker-gate";

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

/**
 * The currently-running batch job, if any. Used by the /active-batch
 * endpoint so a client loading the page mid-run can hydrate its UI without
 * waiting for the next SSE event.
 */
export function getActiveBatchJob(): BatchJob | undefined {
  for (const job of activeBatches.values()) {
    if (job.status === "running") return job;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// On-demand worker tracking
// ---------------------------------------------------------------------------
// The portal worker is now triggered on demand (cron, admin batch, submission
// queueing, retry sweeper) instead of polling continuously. We keep one
// at-a-time invariant via the in-process gate below so two triggers in close
// succession don't fight for the same Playwright browser.

export interface WorkerRunSummary {
  batchId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed";
  total: number;
  succeeded: number;
  failed: number;
  triggeredBy: string;
  lastError: string | null;
}

const workerGate = createWorkerGate<void>();
let lastWorkerRun: WorkerRunSummary | null = null;
const recentWorkerRuns: WorkerRunSummary[] = [];
const MAX_RECENT_RUNS = 30;

export function isWorkerRunInProgress(): boolean {
  return workerGate.isInProgress();
}

export function getLastWorkerRun(): WorkerRunSummary | null {
  return lastWorkerRun;
}

export function getRecentWorkerRuns(): WorkerRunSummary[] {
  return [...recentWorkerRuns];
}

function snapshotRun(job: BatchJob, lastError: string | null): WorkerRunSummary {
  return {
    batchId: job.id,
    startedAt: job.startedAt,
    finishedAt: job.completedAt ?? null,
    status: job.status,
    total: job.total,
    succeeded: job.succeeded,
    failed: job.failed,
    triggeredBy: job.triggeredBy,
    lastError,
  };
}

export type TriggerWorkerOutcome =
  | { kind: "started"; job: BatchJob; awaited: "completed" | "timeout" | "not_awaited" }
  | { kind: "skipped"; reason: "already_running" | "no_pending" };

/**
 * Trigger an on-demand worker run. Each call launches a fresh Playwright browser
 * via runBatchWorker, processes pending submissions sequentially, then tears down.
 * If a run is already in progress, returns { kind: "skipped" } so callers can
 * coalesce.
 *
 * `awaitCompletion: true` blocks until the run finishes (used by crons so the
 * cron-run row reflects the worker outcome).
 *
 * `awaitTimeoutMs` (only honored when awaitCompletion is true) bounds the wait.
 * If the worker has not finished within the budget the function returns with
 * `awaited: "timeout"` and the run continues in the background — the cron lane
 * is freed so the next sweep doesn't pile up behind a hung Playwright. The
 * stuck-running rollup logic (2x interval grace) will surface the orphaned
 * "running" cron row if the worker never returns.
 */
export async function triggerWorkerRun(opts: {
  triggeredBy: string;
  awaitCompletion?: boolean;
  awaitTimeoutMs?: number;
  /**
   * Optional explicit ID list. When omitted (or "all"), the worker processes
   * the entire pending+due queue. When provided, only those rows are
   * considered (still filtered to pending + due inside startBatchJob).
   */
  submissionIds?: number[] | "all";
}): Promise<TriggerWorkerOutcome> {
  if (workerGate.isInProgress()) {
    return { kind: "skipped", reason: "already_running" };
  }

  // Two-phase pattern: phase 1 (synchronous-ish) claims the queue and either
  // returns the job or throws "no pending"; phase 2 (the long Playwright run)
  // happens inside the gate and is awaited only when caller asks. We need
  // phase 1 to complete *before* we return from this function so callers see
  // a real job (or a "no_pending" skip), not a half-claimed run.
  const ctx: { job: BatchJob | null; err: Error | null } = { job: null, err: null };

  // We capture phase 1 completion via an explicit signal so the outer
  // function can return as soon as the queue is claimed (or "no_pending"
  // is decided), without waiting for the long Playwright run.
  const phase1Resolver: { resolve: () => void } = { resolve: () => undefined };
  const phase1Promise = new Promise<void>((resolve) => {
    phase1Resolver.resolve = resolve;
  });

  const gateOutcome = await workerGate.run(async () => {
    let job: BatchJob;
    try {
      job = await startBatchJob(opts.submissionIds ?? "all", opts.triggeredBy);
      ctx.job = job;
    } catch (err) {
      ctx.err = err instanceof Error ? err : new Error(String(err));
      phase1Resolver.resolve();
      throw err;
    }
    phase1Resolver.resolve();

    await waitForJob(job);
    const lastFailure = job.results.filter(r => r.status === "failed").slice(-1)[0]?.message ?? null;
    const summary = snapshotRun(job, lastFailure);
    lastWorkerRun = summary;
    recentWorkerRuns.unshift(summary);
    if (recentWorkerRuns.length > MAX_RECENT_RUNS) recentWorkerRuns.length = MAX_RECENT_RUNS;
  });

  if (gateOutcome.kind === "skipped") {
    // Race: someone else grabbed the gate between our pre-check and run().
    return { kind: "skipped", reason: "already_running" };
  }

  // Suppress unhandled rejection on the phase-2 promise; we surface errors
  // via lastWorkerRun.lastError instead.
  gateOutcome.result.catch((err) => {
    if (ctx.err && /no pending submissions/i.test(ctx.err.message)) return;
    logger.error({ err }, "triggerWorkerRun: worker run failed");
  });

  // Wait for phase 1 to settle so we can report no_pending vs started.
  await phase1Promise;

  if (ctx.err) {
    if (/no pending submissions/i.test(ctx.err.message)) {
      return { kind: "skipped", reason: "no_pending" };
    }
    throw ctx.err;
  }

  let awaited: "completed" | "timeout" | "not_awaited" = "not_awaited";
  if (opts.awaitCompletion) {
    if (opts.awaitTimeoutMs && opts.awaitTimeoutMs > 0) {
      // Race the worker against the watchdog; whichever wins decides whether
      // we were able to report the per-item outcome to the caller.
      const watchdog = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), opts.awaitTimeoutMs).unref();
      });
      const winner = await Promise.race([
        gateOutcome.result.then(() => "completed" as const).catch(() => "completed" as const),
        watchdog,
      ]);
      awaited = winner;
    } else {
      await gateOutcome.result.catch(() => undefined);
      awaited = "completed";
    }
  }

  return { kind: "started", job: ctx.job!, awaited };
}

async function waitForJob(job: BatchJob): Promise<void> {
  // Poll the in-memory job state. The batch processor mutates job.status when
  // it finishes; we just await transitions out of "running".
  while (job.status === "running") {
    await new Promise(r => setTimeout(r, 250));
  }
}

/**
 * Pure helper: turn a finished BatchJob into a cron-run severity + message.
 *
 * Severity rules (matters for the rollup banner — see system-health-rollup):
 *  - "throw"     → cron run recorded as "failed" (hard alert).
 *      Fired when (a) processSequentially itself errored out
 *      (`job.status === "failed"`) — even if no per-item failures were
 *      recorded — or (b) the entire processed queue failed
 *      (`succeeded === 0 && failed > 0`).
 *  - "degraded"  → some items failed but others succeeded; the queue moved
 *      forward, but staff still need to look at the failures.
 *  - "ok"        → all items succeeded (or the run had nothing to process).
 *
 * Without rule (a), a fatal error before any item is processed would leave
 * succeeded=0 + failed=0 and we'd silently report "ok", hiding the outage.
 */
export function jobToCronOutcome(
  job: { status: string; total: number; succeeded: number; failed: number },
  message: string,
): { kind: "throw"; message: string } | { kind: "result"; status: "ok" | "degraded"; message: string } {
  // Rule (a): processSequentially blew up — always a hard failure.
  if (job.status === "failed") return { kind: "throw", message };
  // Rule (b): all attempted items failed.
  if (job.total > 0 && job.succeeded === 0 && job.failed > 0) return { kind: "throw", message };
  const status: "ok" | "degraded" = job.failed > 0 ? "degraded" : "ok";
  return { kind: "result", status, message };
}

/**
 * Pure predicate: a `pending` submission is eligible for processing when it
 * has no scheduled retry, or its scheduled retry time is in the past.
 *
 * Exported so the eligibility rule has a single source of truth that we can
 * unit-test independently of Drizzle / the live DB.
 */
export function isSubmissionDue(
  row: { status: string; nextRetryAt: Date | null },
  now: Date,
): boolean {
  if (row.status !== "pending") return false;
  if (row.nextRetryAt === null) return true;
  return row.nextRetryAt.getTime() <= now.getTime();
}

/**
 * Pure predicate: a pending submission is overdue when it should already have
 * been processed by `overdueCutoff` but hasn't been. A row is overdue if
 * either its scheduled `nextRetryAt` is older than the cutoff, or it has no
 * scheduled retry but its `createdAt` is older than the cutoff. Freshly
 * queued rows (`nextRetryAt = null`, recent `createdAt`) are not overdue.
 */
export function isSubmissionOverdue(
  row: { status: string; nextRetryAt: Date | null; createdAt: Date },
  overdueCutoff: Date,
): boolean {
  if (row.status !== "pending") return false;
  if (row.nextRetryAt !== null) {
    return row.nextRetryAt.getTime() <= overdueCutoff.getTime();
  }
  // No scheduled retry → use the row's age.
  return row.createdAt.getTime() <= overdueCutoff.getTime();
}

export async function startBatchJob(
  submissionIds: number[] | "all",
  triggeredBy: string,
): Promise<BatchJob> {
  let ids: number[];

  // Only claim rows that are pending AND due. If next_retry_at is in the
  // future, the row is on backoff (set by submission-retry.ts) and must be
  // skipped — otherwise frequent triggers (create/confirm/retry + sweeper +
  // midnight) would defeat the backoff schedule and bombard the portal.
  // The DB filter here is the canonical claim; isSubmissionDue() above is
  // the same rule expressed in code so it can be unit-tested. The same
  // filter applies to explicit ID lists ("Process Selected") so a stale
  // selection can never bypass backoff or pull in non-pending rows.
  const now = new Date();
  const dueClause = and(
    eq(portalSubmissionsTable.status, "pending"),
    or(
      isNull(portalSubmissionsTable.nextRetryAt),
      lte(portalSubmissionsTable.nextRetryAt, now),
    ),
  );

  if (submissionIds === "all") {
    const pending = await db.select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(dueClause);
    ids = pending.map(s => s.id);
  } else {
    if (submissionIds.length === 0) {
      throw new Error("No pending submissions to process");
    }
    const pending = await db.select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(and(
        inArray(portalSubmissionsTable.id, submissionIds),
        dueClause,
      ));
    ids = pending.map(s => s.id);
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

  // Mark every selected row as Queued under the triggering user so other
  // viewers of the Portal Submissions page see the row as locked to this
  // batch immediately (still status='pending' until the worker picks it up).
  // We narrow the WHERE to status='pending' to avoid clobbering any row
  // whose status raced ahead between the SELECT above and this UPDATE.
  await db.update(portalSubmissionsTable).set({
    claimedByBatchId: batchId,
    claimedByUserName: triggeredBy,
    claimedAt: new Date(),
  }).where(and(
    inArray(portalSubmissionsTable.id, ids),
    eq(portalSubmissionsTable.status, "pending"),
  ));

  broadcastBatchEvent({
    type: "batch_started",
    batchId,
    triggeredBy,
    startedAt: job.startedAt,
    total: job.total,
    submissionIds: ids,
  });
  for (const subId of ids) {
    broadcastBatchEvent({
      type: "row_status_changed",
      batchId,
      submissionId: subId,
      newStatus: "queued",
    });
  }

  processSequentially(job).catch(err => {
    logger.error({ err, batchId }, "Batch processing fatal error");
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    void releaseClaimedRows(batchId).catch((releaseErr) => {
      logger.error({ err: releaseErr, batchId }, "Failed to release claimed rows after fatal error");
    });
    broadcastBatchEvent({
      type: "batch_failed",
      batchId,
      completedAt: job.completedAt,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      total: job.total,
      message: err instanceof Error ? err.message : String(err),
    });
  });

  return job;
}

/**
 * Clear `claimed_by_batch_id` from any rows still attributed to this batch.
 * Called when a run completes / fails / aborts so rows that never made it to
 * `in_progress` revert to plain Pending and can be picked up by the next run.
 * Returns the IDs that were released so we can broadcast `row_status_changed`
 * for each one.
 */
async function releaseClaimedRows(batchId: string): Promise<number[]> {
  const released = await db.update(portalSubmissionsTable).set({
    claimedByBatchId: null,
    claimedByUserName: null,
    claimedAt: null,
  }).where(eq(portalSubmissionsTable.claimedByBatchId, batchId))
    .returning({ id: portalSubmissionsTable.id, status: portalSubmissionsTable.status });

  for (const row of released) {
    // Only broadcast as "pending" for rows that are actually back in pending;
    // rows that already moved to in_progress / submitted / failed have their
    // own row_status_changed broadcasts from the worker loop.
    if (row.status === "pending") {
      broadcastBatchEvent({
        type: "row_status_changed",
        batchId,
        submissionId: row.id,
        newStatus: "pending",
      });
    }
  }
  return released.map((r) => r.id);
}

/**
 * Boot-time cleanup: any `claimed_by_batch_id` set in the DB is from a prior
 * process whose in-memory batch state is gone, so the rows are effectively
 * orphaned. Clear the claim so they appear as plain Pending again. Called
 * once on server start.
 */
export async function clearOrphanedBatchClaims(): Promise<number> {
  const cleared = await db.update(portalSubmissionsTable).set({
    claimedByBatchId: null,
    claimedByUserName: null,
    claimedAt: null,
  }).where(isNotNull(portalSubmissionsTable.claimedByBatchId))
    .returning({ id: portalSubmissionsTable.id });
  if (cleared.length > 0) {
    logger.info({ count: cleared.length, ids: cleared.map((r) => r.id) }, "Boot cleanup: cleared orphaned batch claims");
  }
  return cleared.length;
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
        // Clear the queue claim — the row is now actively being worked on, so
        // the In-Progress treatment kicks in for everyone, not the Queued one.
        claimedByBatchId: null,
        claimedByUserName: null,
        claimedAt: null,
      }).where(eq(portalSubmissionsTable.id, subId));

      broadcastBatchEvent({
        type: "row_status_changed",
        batchId: job.id,
        submissionId: subId,
        newStatus: "in_progress",
      });

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

      broadcastBatchEvent({
        type: "row_status_changed",
        batchId: job.id,
        submissionId: subId,
        newStatus: "submitted",
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

      // The retry helper may have rescheduled (status='pending' with
      // next_retry_at) or exhausted retries (status='failed'). Either way the
      // row is no longer in_progress, so emit a row_status_changed so other
      // viewers update their badges.
      broadcastBatchEvent({
        type: "row_status_changed",
        batchId: job.id,
        submissionId: subId,
        newStatus: retryResult?.outcome === "retry_scheduled" ? "pending" : "failed",
      });

      job.results.push({ submissionId: subId, status: "failed", message: errMsg });
      job.failed++;
    }

    job.processed++;

    broadcastBatchEvent({
      type: "batch_progress",
      batchId: job.id,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      total: job.total,
    });
  }

  // Release any rows that were claimed but never reached in_progress (e.g.
  // status raced ahead between SELECT and UPDATE, or row was deleted). This
  // is the normal happy-path cleanup; the fatal-error path also calls it.
  await releaseClaimedRows(job.id).catch((err) => {
    logger.error({ err, batchId: job.id }, "Failed to release claimed rows on completion");
  });

  job.status = "completed";
  job.completedAt = new Date().toISOString();
  logger.info({
    batchId: job.id,
    total: job.total,
    succeeded: job.succeeded,
    failed: job.failed,
  }, "Batch processing completed");

  broadcastBatchEvent({
    type: "batch_completed",
    batchId: job.id,
    completedAt: job.completedAt,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    total: job.total,
  });

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
