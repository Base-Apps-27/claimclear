// AI calibration metrics for the operator verdict picker.
//
// Per spec: window on `ai_suggested.created_at` (not the operator's
// timestamp) over the last `windowDays` days, pair each AI suggestion
// with the *next* operator confirmation on the same leg whose
// `created_at` is strictly greater, and roll up agreement per error
// type.

import { eq, and, asc, gte, gt } from "drizzle-orm";
import { db, claimVerdictTable, claimsTable } from "@workspace/db";
import type { DbExecutor } from "./claim-transitions";

export interface CalibrationStats {
  errorTypeId: string;
  totalConfirmations: number;
  agreementCount: number;
  perOutcomeAgreement: { Approved: number; Denied: number; Partial: number };
  windowDays: number;
}

const DEFAULT_WINDOW_DAYS = 90;

export async function getAiCalibration(args: {
  errorTypeId: string;
  windowDays?: number;
  executor?: DbExecutor;
}): Promise<CalibrationStats> {
  const { errorTypeId, windowDays = DEFAULT_WINDOW_DAYS, executor } = args;
  const ex: DbExecutor = executor ?? db;
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // All AI suggestions in the window for this error type, ordered so
  // the per-leg "next operator confirmation" pairing is deterministic
  // when the same leg has multiple AI suggestions.
  const aiSuggestions = await ex
    .select({
      id: claimVerdictTable.id,
      claimId: claimVerdictTable.claimId,
      outcome: claimVerdictTable.outcome,
      createdAt: claimVerdictTable.createdAt,
    })
    .from(claimVerdictTable)
    .innerJoin(claimsTable, eq(claimsTable.id, claimVerdictTable.claimId))
    .where(and(
      eq(claimVerdictTable.source, "ai_suggested"),
      eq(claimsTable.errorTypeId, errorTypeId),
      gte(claimVerdictTable.createdAt, cutoff),
    ))
    .orderBy(asc(claimVerdictTable.createdAt));

  const perOutcome: CalibrationStats["perOutcomeAgreement"] = {
    Approved: 0,
    Denied: 0,
    Partial: 0,
  };
  let totalConfirmations = 0;
  let agreementCount = 0;

  // Track per-leg pairing cursors so we never double-count an operator
  // confirmation across multiple AI suggestions on the same leg.
  const consumedOperatorIds = new Set<number>();

  for (const ai of aiSuggestions) {
    const aiCreatedAt = ai.createdAt;
    if (!aiCreatedAt) continue;

    const candidates = await ex
      .select({
        id: claimVerdictTable.id,
        outcome: claimVerdictTable.outcome,
        createdAt: claimVerdictTable.createdAt,
      })
      .from(claimVerdictTable)
      .where(and(
        eq(claimVerdictTable.claimId, ai.claimId),
        eq(claimVerdictTable.source, "operator_confirmed"),
        gt(claimVerdictTable.createdAt, aiCreatedAt),
      ))
      .orderBy(asc(claimVerdictTable.createdAt));

    const operator = candidates.find((c) => !consumedOperatorIds.has(c.id));
    if (!operator) continue;
    consumedOperatorIds.add(operator.id);
    totalConfirmations++;

    if (ai.outcome !== operator.outcome) continue;
    agreementCount++;
    if (
      operator.outcome === "Approved" ||
      operator.outcome === "Denied" ||
      operator.outcome === "Partial"
    ) {
      perOutcome[operator.outcome]++;
    }
  }

  return {
    errorTypeId,
    totalConfirmations,
    agreementCount,
    perOutcomeAgreement: perOutcome,
    windowDays,
  };
}
