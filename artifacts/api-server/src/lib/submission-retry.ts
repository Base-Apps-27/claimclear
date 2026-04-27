import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

const RETRY_BACKOFF_MINUTES = [5, 30, 240, 480];

export function computeNextRetryDelayMinutes(attemptsSoFar: number): number {
  const idx = Math.min(Math.max(attemptsSoFar - 1, 0), RETRY_BACKOFF_MINUTES.length - 1);
  return RETRY_BACKOFF_MINUTES[idx];
}

export interface ScheduleRetryArgs {
  submissionId: number;
  errorMessage: string;
  source: string;
  userName?: string;
}

export interface ScheduleRetryResult {
  outcome: "retry_scheduled" | "retries_exhausted" | "not_found";
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  updated: typeof portalSubmissionsTable.$inferSelect | null;
}

/**
 * Shared retry-scheduling logic used by both the external bot's `/fail` HTTP
 * endpoint and the in-process batch processor / sandbox runner.
 *
 * IMPORTANT: This helper assumes `attempts` has already been incremented by
 * the caller (when the submission was claimed). It does NOT bump attempts.
 *
 * On attempts 1..maxAttempts-1 the submission is flipped back to `pending`
 * with a `next_retry_at` per the shared backoff schedule, and an audit row
 * with action `submission_retry_scheduled` is written.
 *
 * On the final attempt the submission is marked `failed` with `next_retry_at`
 * cleared, and an audit row with action `submission_retries_exhausted` is
 * written.
 *
 * Callers are still responsible for any `botActivityLog` row they want to
 * record — this helper only owns the submission status, retry scheduling,
 * and the audit-log entry. */
export async function scheduleRetryOrFail({
  submissionId,
  errorMessage,
  source,
  userName,
}: ScheduleRetryArgs): Promise<ScheduleRetryResult> {
  const errMsg = errorMessage || "Unknown error";
  const auditUserName = userName || "Portal Bot";

  const [existing] = await db.select().from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, submissionId));

  if (!existing) {
    return { outcome: "not_found", attempts: 0, maxAttempts: 0, nextRetryAt: null, updated: null };
  }

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
    }).where(eq(portalSubmissionsTable.id, submissionId)).returning();
  } else {
    const delayMin = computeNextRetryDelayMinutes(attemptsSoFar);
    nextRetryAt = new Date(Date.now() + delayMin * 60_000);
    [updated] = await db.update(portalSubmissionsTable).set({
      status: "pending",
      errorMessage: errMsg,
      nextRetryAt,
    }).where(eq(portalSubmissionsTable.id, submissionId)).returning();
  }

  if (!updated) {
    return { outcome: "not_found", attempts: attemptsSoFar, maxAttempts, nextRetryAt: null, updated: null };
  }

  if (exhausted) {
    await db.insert(auditLogsTable).values({
      claimId: updated.claimId,
      invoiceGroupId: updated.invoiceGroupId ?? null,
      action: "submission_retries_exhausted",
      details: `Portal submission #${submissionId} failed after ${attemptsSoFar} attempt${attemptsSoFar === 1 ? "" : "s"} (max ${maxAttempts}) [source: ${source}]: ${errMsg.slice(0, 200)}`,
      metadata: { submissionId, attempts: attemptsSoFar, maxAttempts, source, lastError: errMsg },
      userEmail: null,
      userName: auditUserName,
    });
  } else {
    await db.insert(auditLogsTable).values({
      claimId: updated.claimId,
      invoiceGroupId: updated.invoiceGroupId ?? null,
      action: "submission_retry_scheduled",
      details: `Portal submission #${submissionId} retry ${attemptsSoFar + 1}/${maxAttempts} scheduled for ${nextRetryAt!.toISOString()} [source: ${source}] (after: ${errMsg.slice(0, 200)})`,
      metadata: { submissionId, attempts: attemptsSoFar, maxAttempts, source, nextRetryAt: nextRetryAt!.toISOString(), lastError: errMsg },
      userEmail: null,
      userName: auditUserName,
    });
  }

  logger.info({ submissionId, attempts: attemptsSoFar, maxAttempts, exhausted, source, nextRetryAt }, "scheduleRetryOrFail completed");

  return {
    outcome: exhausted ? "retries_exhausted" : "retry_scheduled",
    attempts: attemptsSoFar,
    maxAttempts,
    nextRetryAt,
    updated,
  };
}
