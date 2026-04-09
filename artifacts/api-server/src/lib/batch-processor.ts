import { eq, inArray, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, botActivityLogTable, claimsTable, notesTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcastPresenceEvent } from "./sse";

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

      job.results.push({ submissionId: subId, status: "success", message: "Processed successfully" });
      job.succeeded++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, submissionId: subId, batchId: job.id }, "Batch submission processing failed");

      await db.update(portalSubmissionsTable).set({
        status: "failed",
        errorMessage: errMsg,
      }).where(eq(portalSubmissionsTable.id, subId)).catch(() => {});

      await db.insert(botActivityLogTable).values({
        submissionId: subId,
        botInstanceId: null,
        action: "batch_failed",
        success: false,
        message: errMsg,
      }).catch(() => {});

      broadcastPresenceEvent({
        type: "bot_completed",
        claimId: 0,
        userName: "Batch Processor",
        userEmail: null,
        botProcess: "portal_submission",
        timestamp: new Date().toISOString(),
      });

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
  const { spawn } = await import("child_process");
  const path = await import("path");

  return new Promise((resolve, reject) => {
    const botScript = path.resolve(
      import.meta.dirname, "..", "bot", "batch-worker.ts"
    );

    const child = spawn("npx", ["tsx", botScript], {
      env: {
        ...process.env,
        BATCH_SUBMISSION_ID: String(sub.id),
        MAS_PORTAL_USERNAME: process.env.MAS_PORTAL_USERNAME || "",
        MAS_PORTAL_PASSWORD: process.env.MAS_PORTAL_PASSWORD || "",
        API_BASE_URL: `http://localhost:${process.env.PORT || 8080}/api`,
        BOT_SERVICE_TOKEN: process.env.BOT_SERVICE_TOKEN || "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        logger.info({ submissionId: sub.id }, "Batch worker completed successfully");
        resolve();
      } else {
        const msg = stderr.trim() || stdout.trim() || `Worker exited with code ${code}`;
        logger.error({ submissionId: sub.id, code, stderr: stderr.slice(-500) }, "Batch worker failed");
        reject(new Error(msg.slice(0, 500)));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn batch worker: ${err.message}`));
    });
  });
}
