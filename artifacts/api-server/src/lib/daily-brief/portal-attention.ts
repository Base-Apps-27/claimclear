// Portal-submission attention rows for the daily admin brief.
//
// "Needs your attention now" surfaces two classes of submission from the
// last 24h that the dashboard does not yet expose at row-level granularity:
//
//   1. Failed portal submissions (status='failed').
//   2. Auto-reset events — submissions the system pulled out of a stuck
//      state and re-queued, recorded as `submission_stuck_reset` audit rows.
//
// This is the same data the legacy inline brief gathered, lifted into the
// brief module so the renderer in `daily-body.ts` only consumes structured
// rows. We deliberately do NOT extend /dashboard/summary for this — admins
// rarely look at this list outside the morning brief, and it would balloon
// the dashboard payload.

import { db } from "@workspace/db";
import { portalSubmissionsTable, auditLogsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

export interface PortalAttentionRow {
  id: number;
  confNumber: string | null;
  attempts: number;
  maxAttempts: number;
  status: string;
  errorMessage: string | null;
  nextRetryAt: string | null;
  reason: "failed" | "auto_reset";
}

export interface ManualRequeueRow {
  submissionId: number;
  reason: string | null;
  timestamp: string;
}

export interface PortalAttentionBundle {
  needsAttention: PortalAttentionRow[];
  manualRequeues: ManualRequeueRow[];
}

const SINCE_HOURS = 24;
const ROW_LIMIT = 50;

export async function gatherPortalAttention(): Promise<PortalAttentionBundle> {
  const since = new Date(Date.now() - SINCE_HOURS * 60 * 60 * 1000);

  const failedSubs = await db
    .select({
      id: portalSubmissionsTable.id,
      confNumber: portalSubmissionsTable.confNumber,
      attempts: portalSubmissionsTable.attempts,
      maxAttempts: portalSubmissionsTable.maxAttempts,
      status: portalSubmissionsTable.status,
      errorMessage: portalSubmissionsTable.errorMessage,
      nextRetryAt: portalSubmissionsTable.nextRetryAt,
    })
    .from(portalSubmissionsTable)
    .where(
      and(
        eq(portalSubmissionsTable.status, "failed"),
        gte(portalSubmissionsTable.updatedAt, since),
      ),
    )
    .orderBy(desc(portalSubmissionsTable.updatedAt))
    .limit(ROW_LIMIT);

  const stuckResetEvents = await db
    .select({
      submissionId: sql<number>`(${auditLogsTable.metadata}->>'submissionId')::int`,
    })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.action, "submission_stuck_reset"),
        gte(auditLogsTable.timestamp, since),
      ),
    )
    .orderBy(desc(auditLogsTable.timestamp))
    .limit(ROW_LIMIT);

  const failedIdSet = new Set(failedSubs.map((s) => s.id));
  const extraStuckIds = Array.from(
    new Set(
      stuckResetEvents
        .map((e) => e.submissionId)
        .filter((v): v is number => typeof v === "number" && !failedIdSet.has(v)),
    ),
  );

  const stuckSubs = extraStuckIds.length
    ? await db
        .select({
          id: portalSubmissionsTable.id,
          confNumber: portalSubmissionsTable.confNumber,
          attempts: portalSubmissionsTable.attempts,
          maxAttempts: portalSubmissionsTable.maxAttempts,
          status: portalSubmissionsTable.status,
          errorMessage: portalSubmissionsTable.errorMessage,
          nextRetryAt: portalSubmissionsTable.nextRetryAt,
        })
        .from(portalSubmissionsTable)
        .where(inArray(portalSubmissionsTable.id, extraStuckIds))
    : [];

  const needsAttention: PortalAttentionRow[] = [
    ...failedSubs.map((s) => ({
      id: s.id,
      confNumber: s.confNumber,
      attempts: s.attempts,
      maxAttempts: s.maxAttempts,
      status: s.status,
      errorMessage: s.errorMessage,
      nextRetryAt: s.nextRetryAt ? s.nextRetryAt.toISOString() : null,
      reason: "failed" as const,
    })),
    ...stuckSubs.map((s) => ({
      id: s.id,
      confNumber: s.confNumber,
      attempts: s.attempts,
      maxAttempts: s.maxAttempts,
      status: s.status,
      errorMessage: s.errorMessage,
      nextRetryAt: s.nextRetryAt ? s.nextRetryAt.toISOString() : null,
      reason: "auto_reset" as const,
    })),
  ];

  const requeueRows = await db
    .select({
      submissionId: sql<number>`(${auditLogsTable.metadata}->>'submissionId')::int`,
      reason: sql<string | null>`${auditLogsTable.metadata}->>'reason'`,
      timestamp: auditLogsTable.timestamp,
    })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.action, "submission_manual_requeue"),
        gte(auditLogsTable.timestamp, since),
      ),
    )
    .orderBy(desc(auditLogsTable.timestamp))
    .limit(ROW_LIMIT);

  const seen = new Set<number>();
  const manualRequeues: ManualRequeueRow[] = [];
  for (const r of requeueRows) {
    if (typeof r.submissionId !== "number" || seen.has(r.submissionId)) continue;
    seen.add(r.submissionId);
    manualRequeues.push({
      submissionId: r.submissionId,
      reason: r.reason ?? null,
      timestamp: r.timestamp
        ? new Date(r.timestamp as unknown as string).toISOString()
        : new Date().toISOString(),
    });
  }

  return { needsAttention, manualRequeues };
}

export async function safeGatherPortalAttention(
  notes: { source: string; message: string }[],
): Promise<PortalAttentionBundle> {
  try {
    return await gatherPortalAttention();
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    notes.push({ source: "portal_attention", message: msg.slice(0, 240) });
    return { needsAttention: [], manualRequeues: [] };
  }
}
