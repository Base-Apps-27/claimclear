// MAS Action derivation: post-payor-response cancel-in-MAS flow.
// Computes the implied `mas_action_required` value from the leg's
// state so contract endpoints don't repeat the conditional ladder.

import { eq } from "drizzle-orm";
import { claimsTable, type Claim } from "@workspace/db";
import type { DbExecutor } from "./claim-transitions";
import { db } from "@workspace/db";

/**
 * Derive `mas_action_required` from the leg's current state.
 *
 *   • SOP terminal == 'cannot_dispute' → 'cancel'
 *   • Operator-confirmed verdict == 'Denied' → 'cancel'
 *   • SOP terminal == 'non_issue'    → 'none'
 *   • Otherwise → null (caller should leave the column untouched).
 *
 * Note: Approved/Partial verdicts are intentionally null here — they
 * neither imply a cancel requirement nor clear an existing one. The
 * caller decides what to do with the existing column value.
 */
export function deriveMasActionRequired(input: {
  sopOutcome?: string | null;
  latestOperatorVerdictOutcome?: string | null;
}): "cancel" | "none" | null {
  if (input.sopOutcome === "cannot_dispute") return "cancel";
  if (input.latestOperatorVerdictOutcome === "Denied") return "cancel";
  if (input.sopOutcome === "non_issue") return "none";
  return null;
}

/**
 * Apply the MAS derivation to a leg row. Idempotent.
 *
 * For Approved/Partial operator verdicts, leaves `mas_action_required`
 * as-is unless it is currently null, in which case it sets 'none' so
 * the UI's checklist row renders. This preserves a previously-set
 * 'cancel' (e.g. from a `cannot_dispute` SOP terminal) when a later
 * Approved verdict lands.
 */
export async function applyMasDerivationsForLeg(
  claimId: number,
  latestOperatorVerdictOutcome: string | null,
  executor?: DbExecutor,
): Promise<Claim | null> {
  const ex: DbExecutor = executor ?? db;
  const [leg] = await ex.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!leg) return null;

  // A row already marked complete is terminal; never clobber.
  if (leg.masActionCompletedAt != null) return leg;

  const derived = deriveMasActionRequired({
    sopOutcome: leg.sopOutcome,
    latestOperatorVerdictOutcome,
  });

  let next: "cancel" | "none" | null = derived;
  if (
    derived == null &&
    (latestOperatorVerdictOutcome === "Approved" ||
      latestOperatorVerdictOutcome === "Partial") &&
    leg.masActionRequired == null
  ) {
    // Approved/Partial with no prior MAS requirement → render as 'none'
    // so the checklist row exists with a strikethrough.
    next = "none";
  }

  if (next == null) return leg;
  if (next === leg.masActionRequired) return leg;

  const [updated] = await ex
    .update(claimsTable)
    .set({ masActionRequired: next })
    .where(eq(claimsTable.id, claimId))
    .returning();
  return updated ?? null;
}
