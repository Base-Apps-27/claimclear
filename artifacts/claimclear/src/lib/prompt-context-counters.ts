// Mirrors the api-server `buildPromptLegInputs` accounting (see
// artifacts/api-server/src/lib/prompt-leg-inputs.ts) so the UI can show
// reviewers, at a glance, what extra per-leg context the AI prompt
// actually saw and which sibling duplicates were rolled under a primary.
//
// Pure projection — no I/O, no side effects. Lives in the claimclear
// lib (not the api-server lib) because the rides shape the React app
// already consumes (`ClaimResponse`) carries everything we need:
// `confNumber`, `perLegContext`, `duplicateOfClaimId`, `sopOutcome`.
// Keeping the helper client-side avoids round-tripping a redundant
// audit-counter field on every group GET.

import { outcomeRole } from "@workspace/leg-state";

export interface PromptContextLegRow {
  id: number;
  confNumber: string;
  perLegContext?: string | null;
  duplicateOfClaimId?: number | null;
  sopOutcome?: string | null;
}

export interface PerLegContextEntry {
  /** Source claim id — handy as a key in lists. */
  claimId: number;
  /** Confirmation number rendered in prompts/UI. */
  confNumber: string;
  /** Trimmed per-leg finding text. Always non-empty. */
  perLegContext: string;
}

export interface SiblingDuplicateEntry {
  /** Duplicate leg's claim id. */
  duplicateClaimId: number;
  /** Duplicate leg's confirmation number. */
  duplicateConfNumber: string;
  /** Primary leg's claim id (the leg that owns the trip-bound finding). */
  primaryClaimId: number;
  /** Primary leg's confirmation number, or `#<id>` if the primary is not
   *  in the supplied row set (an inconsistent slice — surfaced as-is so
   *  the operator can spot it rather than being hidden). */
  primaryConfNumber: string;
}

export interface PromptContextCounters {
  /** Visible (non-duplicate) legs that contributed a per-leg finding to
   *  the prompt. Order preserved from the input row order. */
  perLegContextLegs: PerLegContextEntry[];
  /** Sibling duplicates rolled under a primary. Order preserved. */
  siblingDuplicates: SiblingDuplicateEntry[];
  /** Convenience: visible legs the prompt would render (i.e. excluding
   *  rolled-under duplicates). Used for the "X of N" denominator. */
  visibleLegCount: number;
  /** Convenience: same as `perLegContextLegs.length`. */
  perLegContextLegCount: number;
  /** Convenience: same as `siblingDuplicates.length`. */
  siblingDuplicateCount: number;
  /** True when at least one of the two counters is non-zero. The badge
   *  surfaces only when this flag flips to true. */
  hasContext: boolean;
}

/**
 * Compute the per-leg-context + sibling-duplicate counters for a set of
 * rides. Mirrors `buildPromptLegInputs` in the api-server: a leg's
 * per-leg context is suppressed in the prompt when the leg's role is
 * `duplicate` (the primary owns the trip-overriding finding).
 *
 * Pass the same array as both `legs` and `groupLegs` for the group
 * write-up surface (the gauntlet badge). The split mirrors the api-
 * server helper so callers that only want to highlight a subset of
 * legs (e.g. a single-claim view) can still resolve sibling annotations
 * against the full parent group.
 */
export function computePromptContextCounters(
  legs: PromptContextLegRow[],
  groupLegs: PromptContextLegRow[] = legs,
): PromptContextCounters {
  const refsById = new Map<number, string>();
  for (const leg of groupLegs) refsById.set(leg.id, leg.confNumber);

  const perLegContextLegs: PerLegContextEntry[] = [];
  const siblingDuplicates: SiblingDuplicateEntry[] = [];
  let visibleLegCount = 0;

  for (const leg of legs) {
    const role = outcomeRole({
      sopOutcome: leg.sopOutcome ?? null,
      duplicateOfClaimId: leg.duplicateOfClaimId ?? null,
    });
    if (role === "duplicate") {
      const primaryId = leg.duplicateOfClaimId;
      if (primaryId != null) {
        siblingDuplicates.push({
          duplicateClaimId: leg.id,
          duplicateConfNumber: leg.confNumber,
          primaryClaimId: primaryId,
          primaryConfNumber: refsById.get(primaryId) ?? `#${primaryId}`,
        });
      }
      continue;
    }
    visibleLegCount += 1;
    const ctx = (leg.perLegContext ?? "").trim();
    if (ctx.length > 0) {
      perLegContextLegs.push({
        claimId: leg.id,
        confNumber: leg.confNumber,
        perLegContext: ctx,
      });
    }
  }

  return {
    perLegContextLegs,
    siblingDuplicates,
    visibleLegCount,
    perLegContextLegCount: perLegContextLegs.length,
    siblingDuplicateCount: siblingDuplicates.length,
    hasContext: perLegContextLegs.length > 0 || siblingDuplicates.length > 0,
  };
}

/**
 * Human-readable summary line, e.g.
 *   "2 of 4 legs had per-leg findings; 1 sibling duplicate rolled up"
 *
 * Returns `null` when there is no extra context to surface so callers
 * can short-circuit the badge.
 */
export function summarizePromptContext(counters: PromptContextCounters): string | null {
  const parts: string[] = [];
  if (counters.perLegContextLegCount > 0) {
    parts.push(
      `${counters.perLegContextLegCount} of ${counters.visibleLegCount} ${
        counters.visibleLegCount === 1 ? "leg" : "legs"
      } had per-leg findings`,
    );
  }
  if (counters.siblingDuplicateCount > 0) {
    parts.push(
      `${counters.siblingDuplicateCount} sibling ${
        counters.siblingDuplicateCount === 1 ? "duplicate" : "duplicates"
      } rolled up`,
    );
  }
  if (parts.length === 0) return null;
  return parts.join("; ");
}

/**
 * Compact summary built from the audit-log metadata persisted on the
 * `portal_understanding_preflight` row. Mirrors `summarizePromptContext`
 * but works off the raw counter fields the api-server records, since
 * the audit row doesn't store the per-leg detail (only counts).
 *
 * Returns `null` when neither counter is present and non-zero so the
 * activity feed can hide the line entirely on legacy rows.
 */
export function summarizePreflightMetadata(metadata: unknown): {
  text: string;
  perLegContextLegCount: number;
  siblingDuplicateCount: number;
} | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const perLegRaw = m.perLegContextLegCount;
  const sibRaw = m.siblingDuplicateCount;
  const perLegContextLegCount =
    typeof perLegRaw === "number" && Number.isFinite(perLegRaw) ? perLegRaw : 0;
  const siblingDuplicateCount =
    typeof sibRaw === "number" && Number.isFinite(sibRaw) ? sibRaw : 0;
  if (perLegContextLegCount === 0 && siblingDuplicateCount === 0) return null;
  const parts: string[] = [];
  if (perLegContextLegCount > 0) {
    parts.push(
      `${perLegContextLegCount} ${
        perLegContextLegCount === 1 ? "leg" : "legs"
      } contributed per-leg findings`,
    );
  }
  if (siblingDuplicateCount > 0) {
    parts.push(
      `${siblingDuplicateCount} sibling ${
        siblingDuplicateCount === 1 ? "duplicate" : "duplicates"
      } rolled up`,
    );
  }
  return {
    text: parts.join("; "),
    perLegContextLegCount,
    siblingDuplicateCount,
  };
}
