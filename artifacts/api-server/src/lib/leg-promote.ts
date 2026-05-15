// Per-leg "promote draft -> operator_confirmed" orchestrator. Single
// entry point used by /invoice-groups/:id/promote-verdict-drafts and
// /invoice-groups/bulk-approve so both paths produce identical
// claim_verdict + audit + state-event + broadcast + cache-refresh +
// MAS + attestation-delta side effects.

import { eq } from "drizzle-orm";
import { claimsTable, db, type invoiceGroupsTable } from "@workspace/db";
import { refreshClaimDenormalizedCache } from "./denormalized-cache";
import { applyMasDerivationsForLeg } from "./mas-derivations";
import { computeAttestationDelta } from "./attestation";
import { emitStateEvent } from "./state-events";
import { broadcastClaimEvent } from "./sse";
import {
  insertOperatorVerdictRowTx,
  writeLegVerdictAuditTx,
  type LegVerdictActor,
} from "./leg-verdict-writes";

export interface PromoteLegToConfirmedParams {
  claimId: number;
  outcome: string;
  invoiceGroupId: number;
  group: typeof invoiceGroupsTable.$inferSelect;
  actor: LegVerdictActor;
  // Tag merged into audit and state-event metadata.
  reason: "promoted_from_draft" | "bulk_approve";
  // Optional extras to thread through the audit row (e.g.
  // bulkApproveRunId, portalResponseId).
  extraMetadata?: Record<string, unknown>;
  // Whether to also emit the user-facing "verdict_recorded" SSE
  // broadcast — promote-from-drafts does, bulk-approve also does.
  broadcast?: boolean;
}

export interface PromoteLegToConfirmedResult {
  refreshError?: Error;
}

// Runs the per-leg promote pipeline. The verdict insert MUST already
// have happened in the caller's transaction (so per-group atomicity
// is preserved); this function handles the post-commit side effects
// in the canonical order /claims/:id/verdict + /promote-verdict-drafts
// already use.
export async function runPromoteLegToConfirmedSideEffects(
  params: PromoteLegToConfirmedParams,
): Promise<PromoteLegToConfirmedResult> {
  const result: PromoteLegToConfirmedResult = {};

  const [legBefore] = await db.select().from(claimsTable).where(eq(claimsTable.id, params.claimId));
  if (!legBefore) return result;

  try {
    await refreshClaimDenormalizedCache(params.claimId);
  } catch (err) {
    result.refreshError = err instanceof Error ? err : new Error(String(err));
  }
  await applyMasDerivationsForLeg(params.claimId, params.outcome);

  const [legAfter] = await db.select().from(claimsTable).where(eq(claimsTable.id, params.claimId));
  if (legAfter) {
    const attDelta = computeAttestationDelta(legBefore.outcome, legAfter.outcome, params.group);
    if (Object.keys(attDelta).length > 0) {
      await db.update(claimsTable).set(attDelta).where(eq(claimsTable.id, params.claimId));
    }
  }

  await writeLegVerdictAuditTx(db, {
    claimId: params.claimId,
    invoiceGroupId: params.invoiceGroupId,
    action: "leg_verdict_confirmed",
    source: "operator_confirmed",
    outcome: params.outcome,
    reason: params.reason,
    actor: params.actor,
    extraMetadata: params.extraMetadata,
  });
  await emitStateEvent({
    eventKey: "leg.verdict_confirmed",
    claimId: params.claimId,
    invoiceGroupId: params.invoiceGroupId,
    actorUserId: params.actor.userEmail,
    metadata: { source: "operator_confirmed", outcome: params.outcome, reason: params.reason },
  });
  if (params.broadcast !== false) {
    broadcastClaimEvent({
      type: "verdict_recorded",
      claimId: params.claimId,
      userName: params.actor.userName,
      userEmail: params.actor.userEmail,
      timestamp: new Date().toISOString(),
    });
  }

  return result;
}

// Insert + promote in one shot. Used by bulk-approve where no draft
// exists yet, so a draft row is laid down first (mirroring what the
// operator would do via POST /claims/:id/verdict with
// source=operator_draft) and then the standard promote pipeline runs.
// `tx` is the caller's per-group transaction; the side effects run
// after the caller commits it.
export interface DraftAndPromoteLegParams extends PromoteLegToConfirmedParams {
  // Drizzle tx for the verdict inserts. Must be the same transaction
  // the caller uses for the rest of the per-group writes so a failure
  // rolls the verdict rows back atomically with the group.
  tx: Pick<typeof db, "insert" | "update" | "select">;
}

export async function insertLegDraftAndConfirmedVerdictTx(
  params: DraftAndPromoteLegParams,
): Promise<void> {
  await insertOperatorVerdictRowTx(params.tx, {
    claimId: params.claimId,
    source: "operator_draft",
    outcome: params.outcome,
    actor: params.actor,
  });
  await insertOperatorVerdictRowTx(params.tx, {
    claimId: params.claimId,
    source: "operator_confirmed",
    outcome: params.outcome,
    actor: params.actor,
  });
  await writeLegVerdictAuditTx(params.tx, {
    claimId: params.claimId,
    invoiceGroupId: params.invoiceGroupId,
    action: "leg_verdict_drafted",
    source: "operator_draft",
    outcome: params.outcome,
    reason: params.reason,
    actor: params.actor,
    extraMetadata: params.extraMetadata,
  });
}
