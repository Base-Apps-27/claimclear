/**
 * Single source of truth for the per-leg prompt inputs that thread into every
 * Claude prompt site in the API server (portal write-up, email-channel
 * write-up, AI readback preflight, per-claim email).
 *
 * Two pieces of context that the prompt sites historically ignored are
 * threaded here:
 *   1. `per_leg_context` — the worktree-derived narrative the SOP-advance
 *      player persists on each step.
 *   2. Sibling-duplicate annotations — a primary leg with sibling duplicates
 *      rolled under it explicitly says so in the dispute, and the
 *      duplicate's narrative is NOT fed to the model (the primary owns the
 *      trip-bound finding).
 *
 * Per Task #307 guards: every prompt site MUST go through this helper. No
 * ad-hoc reads of `per_leg_context` or `duplicate_of_claim_id` should appear
 * outside this file in the four prompt route files. The leg → role
 * determination uses `outcomeRole` from `@workspace/leg-state` rather than
 * a hand-rolled `duplicateOfClaimId != null` check so the precedence
 * ladder lives in one place.
 *
 * The helper is intentionally output-shape oriented — it returns both
 * structured `inputs` (for fine-grained access) and pre-rendered strings
 * (`ridesBlock`, `perClaimAnnotationLines`) so call sites can drop them
 * into prompt templates verbatim without re-implementing the rendering
 * (which would invite drift between the four prompt surfaces).
 */

import { db, claimsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { outcomeRole } from "@workspace/leg-state";

export type PromptLegRole = "primary" | "duplicate" | "none";

/**
 * The prompt-relevant slice of a claim row. Call sites shape their loaded
 * rows into this before passing them to `buildPromptLegInputs` — keeps the
 * helper free of any DB type coupling.
 */
export interface PromptLegRowInput {
  id: number;
  confNumber: string;
  date: string | null;
  clientNumber: string | null;
  carNumber: string | null;
  claimAmount: string | null;
  perLegContext: string | null;
  duplicateOfClaimId: number | null;
  sopOutcome?: string | null;
}

/**
 * Per-ride structured output. Mirrors the shape called out in the Task #307
 * spec. Call sites should prefer the pre-rendered `ridesBlock` /
 * `perClaimAnnotationLines` from `PromptLegInputsResult` when assembling
 * prompts so the rendering stays in one place.
 */
export interface PromptLegInput {
  claimId: number;
  confNumber: string;
  date: string | null;
  clientNumber: string | null;
  carNumber: string | null;
  claimAmount: string | null;
  perLegContext: string | null;
  role: PromptLegRole;
  /** Set when role === "primary" and at least one sibling-duplicate points
   *  at this leg. References are confNumbers (matching the rides block). */
  siblingDuplicateRefs?: string[];
  /** Set when role === "duplicate". confNumber of the primary the duplicate
   *  is rolled under. */
  primaryRef?: string;
}

export interface PromptLegInputsContext {
  /** The leg(s) we want included in the prompt. For the group write-up,
   *  these are the rides on the invoice. For the per-claim email path,
   *  this is a single claim. */
  legs: PromptLegRowInput[];
  /** The full set of legs in the parent invoice group. Required so we can
   *  resolve sibling annotations and primary refs even when `legs` is a
   *  narrower subset (e.g. the per-claim email path passes [singleClaim]).
   *  Pass the same array as `legs` when `legs` already covers the entire
   *  group. */
  groupLegs: PromptLegRowInput[];
}

export interface PromptLegInputsResult {
  inputs: PromptLegInput[];
  /**
   * Pre-rendered "Affected rides on this invoice" block ready to drop into
   * the group write-up prompt. Skips rows whose role is `duplicate` (the
   * primary owns the trip-overriding finding); appends per-leg-context
   * lines and a sibling-duplicate annotation line under each visible row.
   * Byte-identical to today's output when no leg has per-leg context and
   * no sibling-duplicate pointers exist (parity guarantee).
   */
  ridesBlock: string;
  /**
   * Per-claim annotation lines (per-leg-context line + sibling/primary
   * annotation), keyed by claim id. Used by the per-claim email and the
   * preflight readback to surface findings without re-rendering the full
   * rides block. Lines are formatted as bullet items ("- ...") so they
   * drop cleanly into bullet-style prompt sections; empty array when there
   * is nothing to annotate.
   */
  perClaimAnnotationLines: Map<number, string[]>;
  // Audit-counter exports — see Task #307 §"Done looks like".
  hasPerLegContext: boolean;
  perLegContextLegCount: number;
  siblingDuplicateCount: number;
}

const RIDE_LINE_INDENT = "  ";
const RIDE_ANNOTATION_INDENT = "     ";

function ridesBlockHead(input: PromptLegInput, n: number): string {
  return `${RIDE_LINE_INDENT}${n}. Conf #${input.confNumber} | Service date: ${input.date || "N/A"} | Client: ${input.clientNumber || "N/A"} | Car: ${input.carNumber || "N/A"} | Amount: $${input.claimAmount || "0.00"}`;
}

function ridesBlockAnnotations(input: PromptLegInput): string[] {
  const lines: string[] = [];
  const ctx = input.perLegContext?.trim();
  if (input.role !== "duplicate" && ctx) {
    lines.push(`${RIDE_ANNOTATION_INDENT}Per-leg finding: ${ctx}`);
  }
  if (input.role === "primary" && input.siblingDuplicateRefs && input.siblingDuplicateRefs.length > 0) {
    const refs = input.siblingDuplicateRefs.map((r) => `Conf #${r}`).join(", ");
    lines.push(`${RIDE_ANNOTATION_INDENT}This same trip-overriding finding also covers ${refs} (rolled under this primary).`);
  }
  if (input.role === "duplicate" && input.primaryRef) {
    lines.push(`${RIDE_ANNOTATION_INDENT}Rolled under primary Conf #${input.primaryRef} (the trip-overriding finding lives there).`);
  }
  return lines;
}

function perClaimAnnotations(input: PromptLegInput): string[] {
  const lines: string[] = [];
  const ctx = input.perLegContext?.trim();
  if (input.role !== "duplicate" && ctx) {
    lines.push(`- Per-leg finding: ${ctx}`);
  }
  if (input.role === "primary" && input.siblingDuplicateRefs && input.siblingDuplicateRefs.length > 0) {
    const refs = input.siblingDuplicateRefs.map((r) => `Conf #${r}`).join(", ");
    lines.push(`- Sibling duplicates rolled under this primary: ${refs} (the same trip-overriding finding covers them).`);
  }
  if (input.role === "duplicate" && input.primaryRef) {
    lines.push(`- Rolled under primary Conf #${input.primaryRef} (the trip-overriding finding lives on the primary; do not re-state it here).`);
  }
  return lines;
}

export function buildPromptLegInputs(ctx: PromptLegInputsContext): PromptLegInputsResult {
  const refsById = new Map<number, string>();
  const siblingsByPrimary = new Map<number, number[]>();
  for (const leg of ctx.groupLegs) {
    refsById.set(leg.id, leg.confNumber);
    if (leg.duplicateOfClaimId != null) {
      const arr = siblingsByPrimary.get(leg.duplicateOfClaimId) ?? [];
      arr.push(leg.id);
      siblingsByPrimary.set(leg.duplicateOfClaimId, arr);
    }
  }

  const inputs: PromptLegInput[] = ctx.legs.map((leg) => {
    const role = outcomeRole({
      sopOutcome: leg.sopOutcome ?? null,
      duplicateOfClaimId: leg.duplicateOfClaimId,
    });
    const base = {
      claimId: leg.id,
      confNumber: leg.confNumber,
      date: leg.date,
      clientNumber: leg.clientNumber,
      carNumber: leg.carNumber,
      claimAmount: leg.claimAmount,
    };
    if (role === "duplicate") {
      const primaryId = leg.duplicateOfClaimId!;
      const primaryRef = refsById.get(primaryId);
      if (!primaryRef) {
        // No silent fallback (Task #307 guard #10): if a duplicate's
        // primary cannot be resolved from the group leg set, the caller
        // loaded an inconsistent slice — fail loud rather than silently
        // dropping the duplicate annotation.
        throw new Error(
          `buildPromptLegInputs: primary claim ${primaryId} for duplicate ${leg.id} not found in groupLegs`,
        );
      }
      return { ...base, perLegContext: null, role: "duplicate" as const, primaryRef };
    }
    const siblings = siblingsByPrimary.get(leg.id) ?? [];
    if (siblings.length > 0) {
      return {
        ...base,
        perLegContext: leg.perLegContext,
        role: "primary" as const,
        siblingDuplicateRefs: siblings.map((sid) => refsById.get(sid) ?? `#${sid}`),
      };
    }
    return { ...base, perLegContext: leg.perLegContext, role: "none" as const };
  });

  // ridesBlock — group write-up: skip duplicates, render head + annotations.
  const visible = inputs.filter((i) => i.role !== "duplicate");
  const ridesBlock = visible
    .map((input, idx) => [ridesBlockHead(input, idx + 1), ...ridesBlockAnnotations(input)].join("\n"))
    .join("\n");

  // Per-claim annotations indexed by claim id for the readback + per-claim
  // paths.
  const perClaimAnnotationLines = new Map<number, string[]>();
  for (const input of inputs) {
    perClaimAnnotationLines.set(input.claimId, perClaimAnnotations(input));
  }

  let perLegContextLegCount = 0;
  let siblingDuplicateCount = 0;
  for (const i of inputs) {
    if (i.perLegContext && i.perLegContext.trim().length > 0) perLegContextLegCount++;
    if (i.siblingDuplicateRefs) siblingDuplicateCount += i.siblingDuplicateRefs.length;
  }

  return {
    inputs,
    ridesBlock,
    perClaimAnnotationLines,
    hasPerLegContext: perLegContextLegCount > 0,
    perLegContextLegCount,
    siblingDuplicateCount,
  };
}

/**
 * Per Task #312: every audit-log event that fires alongside a Claude prompt
 * built from `buildPromptLegInputs` must surface the same three per-leg
 * traceability counters. Centralising the projection here keeps the audit
 * metadata shape consistent across the four prompt sites (portal write-up,
 * portal regenerate, AI readback preflight, per-claim email) and lets call
 * sites spread `...promptLegAuditCounters(promptLegInputs)` into their
 * `metadata` object without duplicating the field names.
 */
export function promptLegAuditCounters(r: PromptLegInputsResult): {
  hasPerLegContext: boolean;
  perLegContextLegCount: number;
  siblingDuplicateCount: number;
} {
  return {
    hasPerLegContext: r.hasPerLegContext,
    perLegContextLegCount: r.perLegContextLegCount,
    siblingDuplicateCount: r.siblingDuplicateCount,
  };
}

const PROMPT_LEG_COLUMNS = {
  id: claimsTable.id,
  confNumber: claimsTable.confNumber,
  date: claimsTable.date,
  clientNumber: claimsTable.clientNumber,
  carNumber: claimsTable.carNumber,
  claimAmount: claimsTable.claimAmount,
  perLegContext: claimsTable.perLegContext,
  duplicateOfClaimId: claimsTable.duplicateOfClaimId,
  sopOutcome: claimsTable.sopOutcome,
} as const;

/**
 * Convenience loader for the per-claim email path: given a claim id, fetch
 * the claim and the full leg set of its parent group so the helper can
 * compute sibling annotations + primary refs. If the claim has no
 * `invoiceGroupId`, returns a degenerate `groupLegs = [singleClaim]`.
 *
 * Throws if the claim cannot be loaded or if the parent group exists but
 * has zero legs (data inconsistency) — per guard #10, no silent fallbacks.
 */
export async function loadGroupLegsForClaim(claimId: number): Promise<{
  claim: PromptLegRowInput;
  groupLegs: PromptLegRowInput[];
}> {
  const [claim] = await db
    .select({ ...PROMPT_LEG_COLUMNS, invoiceGroupId: claimsTable.invoiceGroupId })
    .from(claimsTable)
    .where(eq(claimsTable.id, claimId));
  if (!claim) {
    throw new Error(`loadGroupLegsForClaim: claim ${claimId} not found`);
  }
  if (claim.invoiceGroupId == null) {
    return { claim, groupLegs: [claim] };
  }
  const groupLegs = await db
    .select(PROMPT_LEG_COLUMNS)
    .from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, claim.invoiceGroupId))
    .orderBy(claimsTable.id);
  if (groupLegs.length === 0) {
    throw new Error(
      `loadGroupLegsForClaim: parent group ${claim.invoiceGroupId} for claim ${claimId} has no legs`,
    );
  }
  return { claim, groupLegs };
}
