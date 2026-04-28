import { eq, and, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, botActivityLogTable, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";
import { computeNextRetryDelayMinutes } from "./submission-retry";

const STUCK_THRESHOLD_MINUTES = parseInt(process.env.PORTAL_STUCK_THRESHOLD_MINUTES || "120", 10);

export interface StuckResetResult {
  reset: number;
  ids: number[];
}

export async function resetStuckSubmissions(): Promise<StuckResetResult> {
  const cutoffMs = Date.now() - STUCK_THRESHOLD_MINUTES * 60_000;
  const cutoff = new Date(cutoffMs);

  const candidates = await db.execute(sql`
    SELECT ps.id, ps.claim_id, ps.invoice_group_id, ps.attempts, ps.max_attempts, ps.updated_at
    FROM ${portalSubmissionsTable} ps
    WHERE ps.status = 'in_progress'
      AND ps.updated_at <= ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM ${botActivityLogTable} bal
        WHERE bal.submission_id = ps.id
          AND bal.created_at > ${cutoff}
      )
  `);

  const rows = (candidates.rows ?? []) as Array<{
    id: number;
    claim_id: number;
    invoice_group_id: number | null;
    attempts: number;
    max_attempts: number;
    updated_at: string | Date;
  }>;

  const resetIds: number[] = [];

  for (const row of rows) {
    const attemptsSoFar = row.attempts || 0;
    const maxAttempts = row.max_attempts || 4;
    const nextAttemptNumber = attemptsSoFar + 1;
    const exhausted = nextAttemptNumber > maxAttempts;
    const delayMin = computeNextRetryDelayMinutes(attemptsSoFar);
    const nextRetryAt = new Date(Date.now() + delayMin * 60_000);

    if (exhausted) {
      await db.update(portalSubmissionsTable).set({
        status: "failed",
        errorMessage: `Auto-reset from stuck in_progress (no activity for ${STUCK_THRESHOLD_MINUTES} minutes); retry attempts exhausted.`,
        nextRetryAt: null,
      }).where(eq(portalSubmissionsTable.id, row.id));

      await db.insert(auditLogsTable).values({
        claimId: row.claim_id,
        invoiceGroupId: row.invoice_group_id ?? null,
        action: "submission_stuck_reset",
        details: `Portal submission #${row.id} stuck in_progress for >${STUCK_THRESHOLD_MINUTES}m; retry attempts exhausted, marked failed`,
        metadata: { submissionId: row.id, attempts: attemptsSoFar, maxAttempts, exhausted: true, thresholdMinutes: STUCK_THRESHOLD_MINUTES },
        userEmail: null,
        userName: "System (stuck reset)",
      });
    } else {
      await db.update(portalSubmissionsTable).set({
        status: "pending",
        nextRetryAt,
      }).where(and(eq(portalSubmissionsTable.id, row.id), eq(portalSubmissionsTable.status, "in_progress")));

      await db.insert(auditLogsTable).values({
        claimId: row.claim_id,
        invoiceGroupId: row.invoice_group_id ?? null,
        action: "submission_stuck_reset",
        details: `Portal submission #${row.id} stuck in_progress for >${STUCK_THRESHOLD_MINUTES}m; reset to pending, retry scheduled at ${nextRetryAt.toISOString()}`,
        metadata: { submissionId: row.id, attempts: attemptsSoFar, maxAttempts, nextRetryAt: nextRetryAt.toISOString(), thresholdMinutes: STUCK_THRESHOLD_MINUTES },
        userEmail: null,
        userName: "System (stuck reset)",
      });
    }

    await db.insert(botActivityLogTable).values({
      submissionId: row.id,
      botInstanceId: null,
      action: "stuck_reset",
      success: true,
      message: `Auto-reset by stuck-submission watcher after ${STUCK_THRESHOLD_MINUTES} minutes of no activity`,
    });

    resetIds.push(row.id);
  }

  if (resetIds.length > 0) {
    logger.info({ resetIds, count: resetIds.length, thresholdMinutes: STUCK_THRESHOLD_MINUTES }, "Stuck portal submissions auto-reset");
  }

  return { reset: resetIds.length, ids: resetIds };
}
