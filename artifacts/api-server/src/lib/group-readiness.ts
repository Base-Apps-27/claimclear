import { eq } from "drizzle-orm";
import { db, claimsTable } from "@workspace/db";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";
import { verifyBotToken } from "./bot-token";
import type { Request } from "express";

// Terminal sub-statuses that satisfy the readiness gate. A `duplicate` leg
// is conditionally resolved — it satisfies the gate iff its primary is in
// this set. See `allDisputedLegsResolved` below.
export const RESOLVED_LEG_SUB_STATUSES: ReadonlySet<LegSubStatus> = new Set([
  "ready",
  "dropped",
  "excluded",
]);

/**
 * Pure resolution check used by the portal-submission gate. Exposed for
 * unit testing — callers in production should use `allDisputedLegsResolved`
 * which loads the rows from the DB. See the integration test for the
 * `duplicate→excluded-primary` regression that motivated this split.
 */
export function evaluateDisputedLegsResolved<
  L extends Parameters<typeof deriveLegSubStatus>[0] & {
    id: number;
    includedInDispute: boolean | null;
    duplicateOfClaimId: number | null;
  },
>(legs: readonly L[]): { ok: boolean; unresolved: number } {
  // Pre-compute every leg's sub-status — NOT just the disputed subset —
  // because a `duplicate` leg's gate is checked against its primary, and
  // the primary may legitimately be excluded (`includedInDispute=false`).
  // If we only mapped disputed legs, an excluded primary would look
  // "missing" and the duplicate would be falsely counted as unresolved.
  const subStatusById = new Map<number, LegSubStatus>();
  for (const l of legs) {
    subStatusById.set(l.id, deriveLegSubStatus(l));
  }

  const disputed = legs.filter((l) => l.includedInDispute);

  let unresolved = 0;
  for (const l of disputed) {
    const sub = subStatusById.get(l.id)!;
    if (sub === "duplicate") {
      // A sibling duplicate satisfies the gate only when its primary has
      // reached a terminal sub-status. If the primary is mid-walk (or
      // gets reclassified back), the gate naturally re-locks.
      const primaryId = l.duplicateOfClaimId;
      const primarySub = primaryId != null ? subStatusById.get(primaryId) : undefined;
      if (!primarySub || !RESOLVED_LEG_SUB_STATUSES.has(primarySub)) {
        unresolved++;
      }
      continue;
    }
    if (!RESOLVED_LEG_SUB_STATUSES.has(sub)) unresolved++;
  }
  return { ok: unresolved === 0 && disputed.length > 0, unresolved };
}

export async function allDisputedLegsResolved(invoiceGroupId: number): Promise<{ ok: boolean; unresolved: number }> {
  const legs = await db.select().from(claimsTable).where(eq(claimsTable.invoiceGroupId, invoiceGroupId));
  return evaluateDisputedLegsResolved(legs);
}

export type SubmissionActorKind = "operator" | "system";

export interface SubmissionActor {
  kind: SubmissionActorKind;
  identity: string;
}

export function resolveSubmissionActor(
  req: Request,
  body: { actorType?: string },
): { actor: SubmissionActor } | { error: string; status: number } {
  const requestedType = body.actorType;

  if (requestedType === "system") {
    const hasBotToken = verifyBotToken(req.headers["x-bot-token"]);
    if (!hasBotToken) {
      return {
        error: "Bot actorType requires service-token authentication",
        status: 403,
      };
    }
    const tokenHeader = req.headers["x-bot-token"];
    const identity = typeof tokenHeader === "string" ? `bot:${tokenHeader.slice(0, 8)}…` : "bot:unknown";
    return {
      actor: { kind: "system", identity },
    };
  }

  return {
    actor: {
      kind: "operator",
      identity: req.user?.email ?? "unknown-operator",
    },
  };
}
