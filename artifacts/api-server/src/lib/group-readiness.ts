import { eq } from "drizzle-orm";
import { db, claimsTable } from "@workspace/db";
import { deriveLegSubStatus } from "@workspace/leg-state";
import { verifyBotToken } from "./bot-token";
import type { Request } from "express";

export const RESOLVED_LEG_SUB_STATUSES = new Set(["ready", "dropped", "excluded"]);

export async function allDisputedLegsResolved(invoiceGroupId: number): Promise<{ ok: boolean; unresolved: number }> {
  const legs = await db.select().from(claimsTable).where(eq(claimsTable.invoiceGroupId, invoiceGroupId));
  const disputed = legs.filter((l) => l.includedInDispute);
  let unresolved = 0;
  for (const l of disputed) {
    const sub = deriveLegSubStatus(l);
    if (!RESOLVED_LEG_SUB_STATUSES.has(sub)) unresolved++;
  }
  return { ok: unresolved === 0 && disputed.length > 0, unresolved };
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
