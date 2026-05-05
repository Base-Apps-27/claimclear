import { eq } from "drizzle-orm";
import { db, claimsTable } from "@workspace/db";
import {
  buildLegResolvedIndex,
  RESOLVED_LEG_SUB_STATUSES,
  type LegForResolvedCheck,
} from "@workspace/leg-state";
import { verifyBotToken } from "./bot-token";
import type { Request } from "express";

// Re-export the terminal-status set for the few places (currently
// `routes/invoice-groups.ts`) that import it from here. The set itself
// lives in `@workspace/leg-state` so the React client and the
// api-server cannot drift on what counts as a concluded leg.
export { RESOLVED_LEG_SUB_STATUSES };

/**
 * Pure resolution check used by the portal-submission gate. Exposed for
 * unit testing — callers in production should use `allDisputedLegsResolved`
 * which loads the rows from the DB. The per-leg "is this concluded?" rule
 * (including the sibling-duplicate→primary fan-out) lives in
 * `@workspace/leg-state`'s `buildLegResolvedIndex`; this function only
 * adds the gate aggregation (`disputed` filter + unresolved count + the
 * "must have at least one disputed leg" requirement) on top of it.
 */
export function evaluateDisputedLegsResolved<
  L extends LegForResolvedCheck & { includedInDispute: boolean | null },
>(legs: readonly L[]): { ok: boolean; unresolved: number } {
  // Hand the FULL leg list to the shared index — NOT just the disputed
  // subset — because a `duplicate` leg's gate is checked against its
  // primary, and the primary may legitimately be excluded
  // (`includedInDispute=false`). Limiting the index to disputed legs
  // would make an excluded primary look "missing" and the duplicate
  // would be falsely counted as unresolved. Pinned by
  // `disputed-legs-resolved.test.ts`.
  const index = buildLegResolvedIndex(legs);
  const disputed = legs.filter((l) => l.includedInDispute);
  let unresolved = 0;
  for (const l of disputed) {
    if (!index.isLegResolved(l)) unresolved++;
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
