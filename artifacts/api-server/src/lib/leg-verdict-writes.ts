// Shared writes for leg-verdict and per-leg attestation queue.
// Used by /claims/:id/verdict, /promote-verdict-drafts,
// /reattest/queue, and /invoice-groups/bulk-approve.

import { eq } from "drizzle-orm";
import {
  claimVerdictTable,
  auditLogsTable,
  claimsTable,
  type db as DbType,
} from "@workspace/db";

type Tx = Pick<typeof DbType, "insert" | "update" | "select">;

export type VerdictSource = "ai_suggested" | "operator_draft" | "operator_confirmed";

export interface LegVerdictActor {
  userEmail: string | null;
  userName: string | null;
}

export interface InsertOperatorVerdictRowParams {
  claimId: number;
  source: VerdictSource;
  outcome: string;
  actor: LegVerdictActor;
  note?: string | null;
  confidence?: string | null;
  reasoning?: string | null;
  inspectionTimeMs?: number | null;
}

export async function insertOperatorVerdictRowTx(
  tx: Tx,
  params: InsertOperatorVerdictRowParams,
): Promise<typeof claimVerdictTable.$inferSelect> {
  const isDraft = params.source === "operator_draft";
  const [row] = await tx.insert(claimVerdictTable).values({
    claimId: params.claimId,
    source: params.source,
    outcome: params.outcome,
    note: isDraft ? null : (params.note ?? null),
    confidence:
      !isDraft && params.confidence != null ? String(params.confidence) : null,
    reasoning: isDraft ? null : (params.reasoning ?? null),
    createdBy: params.actor.userEmail,
    inspectionTimeMs:
      !isDraft && params.inspectionTimeMs != null
        ? Number(params.inspectionTimeMs)
        : null,
  }).returning();
  return row;
}

export type LegVerdictAuditAction =
  | "leg_verdict_drafted"
  | "leg_verdict_confirmed"
  | "leg_verdict_suggested";

export interface WriteLegVerdictAuditParams {
  claimId: number;
  invoiceGroupId?: number | null;
  action: LegVerdictAuditAction;
  source: VerdictSource;
  outcome: string;
  reason?: string | null;
  actor: LegVerdictActor;
  extraMetadata?: Record<string, unknown>;
  details?: string;
}

export async function writeLegVerdictAuditTx(
  tx: Tx,
  params: WriteLegVerdictAuditParams,
): Promise<void> {
  const reasonSuffix = params.reason ? `, ${params.reason}` : "";
  const details =
    params.details ?? `Verdict ${params.outcome} (${params.source}${reasonSuffix})`;
  const metadata: Record<string, unknown> = {
    source: params.source,
    outcome: params.outcome,
    ...(params.reason ? { reason: params.reason } : {}),
    ...(params.extraMetadata ?? {}),
  };
  await tx.insert(auditLogsTable).values({
    claimId: params.claimId,
    invoiceGroupId: params.invoiceGroupId ?? null,
    action: params.action,
    details,
    metadata,
    userEmail: params.actor.userEmail,
    userName: params.actor.userName,
  });
}

export interface QueueLegForReattestParams {
  leg: typeof claimsTable.$inferSelect;
  invoiceGroupId: number;
  actor: LegVerdictActor;
  actorIdentity: string;
  now: Date;
  attestationNote?: string | null;
  sourceTag: "group_reattest_queue" | "bulk_approve";
  details?: string;
  extraMetadata?: Record<string, unknown>;
}

export async function queueLegForReattestTx(
  tx: Tx,
  params: QueueLegForReattestParams,
): Promise<void> {
  const updateSet: {
    attestationState: "queued";
    attestationQueuedAt: Date;
    attestationQueuedBy: string;
    attestationNote?: string | null;
  } = {
    attestationState: "queued",
    attestationQueuedAt: params.now,
    attestationQueuedBy: params.actorIdentity,
  };
  if (params.attestationNote !== undefined) {
    updateSet.attestationNote = params.attestationNote;
  }
  await tx.update(claimsTable)
    .set(updateSet)
    .where(eq(claimsTable.id, params.leg.id));

  const detailsLine =
    params.details
    ?? `Queued for re-attestation by ${params.actorIdentity}`;
  await tx.insert(auditLogsTable).values({
    claimId: params.leg.id,
    invoiceGroupId: params.invoiceGroupId,
    action: "attestation_queued",
    details: detailsLine,
    metadata: {
      from: params.leg.attestationState,
      to: "queued",
      bulk: true,
      source: params.sourceTag,
      invoiceGroupId: params.invoiceGroupId,
      ...(params.extraMetadata ?? {}),
    },
    userEmail: params.actor.userEmail,
    userName: params.actor.userName,
  });
}
