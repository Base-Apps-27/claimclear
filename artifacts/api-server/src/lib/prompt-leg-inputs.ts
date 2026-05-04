/**
 * Single source of truth for the per-leg prompt inputs that thread into every
 * Claude prompt site in the API server (portal write-up, email-channel
 * write-up, AI readback preflight, per-claim email).
 *
 * Three pieces of context that the prompt sites historically ignored are
 * threaded here:
 *   1. `per_leg_context` — the operator-authored unique narrative captured
 *      at the end-of-walk Include terminal (with an AI-clarification gate).
 *   2. Sibling-duplicate annotations — a primary leg with sibling duplicates
 *      rolled under it explicitly says so in the dispute, and the
 *      duplicate's narrative is NOT fed to the model (the primary owns the
 *      trip-bound finding).
 *   3. SOP walk transcript — the read-only "Question — Answer" trail derived
 *      from each leg's `sopAnswers` jsonb + the loaded decision tree (see
 *      `buildSopTranscript` in `@workspace/leg-state`). This surfaces the
 *      operator's walk-through reasoning to the LLM separately from the
 *      unique per-leg finding so the model has both: the SOP background
 *      ("how did we get here?") and the human-authored finding ("what
 *      makes this leg disputable?").
 *
 * Per Task #307 guards: every prompt site MUST go through this helper. No
 * ad-hoc reads of `per_leg_context`, `duplicate_of_claim_id`, or
 * `sop_answers` should appear outside this file in the four prompt route
 * files. The leg → role determination uses `outcomeRole` from
 * `@workspace/leg-state` rather than a hand-rolled
 * `duplicateOfClaimId != null` check so the precedence ladder lives in one
 * place.
 *
 * The helper is intentionally output-shape oriented — it returns both
 * structured `inputs` (for fine-grained access) and pre-rendered strings
 * (`ridesBlock`, `perClaimAnnotationLines`) so call sites can drop them
 * into prompt templates verbatim without re-implementing the rendering
 * (which would invite drift between the four prompt surfaces).
 */

import { db, claimsTable, errorTypesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  outcomeRole,
  isLegacyDerivedContext,
  buildSopTranscript,
  type SopTranscriptTree,
  type TranscriptLine,
} from "@workspace/leg-state";

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
  /** Append-only SOP walk audit trail (jsonb on the wire). The helper
   *  narrows malformed payloads to an empty transcript via
   *  `normalizeAnswers`; safe to pass `unknown`. Optional so legacy
   *  test fixtures that don't seed it still work. */
  sopAnswers?: unknown;
  /** Pinned to look up the leg's decision tree (jsonb on `error_types`)
   *  for transcript derivation. String to match the schema (`error_type_id`
   *  is text on `claims`). Optional so legacy fixtures stay terse. */
  errorTypeId?: string | null;
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
  /** Per-leg SOP walk transcript derived from `sopAnswers` + the leg's
   *  decision tree. Always present (default empty array). Suppressed for
   *  duplicates — the primary owns the trip-bound finding and the
   *  duplicate's transcript would just echo it back. */
  sopTranscript: TranscriptLine[];
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
  /** Decision trees keyed by leg id, used to derive the SOP walk transcript
   *  per leg. Build with `loadDecisionTreesForLegs`. Optional: when
   *  omitted (or a leg's entry is missing/null), that leg's transcript is
   *  empty — preserves the parity guarantee for callers that haven't been
   *  upgraded to thread the trees yet. */
  treesByLegId?: ReadonlyMap<number, SopTranscriptTree | null>;
}

export interface PromptLegInputsResult {
  inputs: PromptLegInput[];
  /**
   * Pre-rendered "Affected rides on this invoice" block ready to drop into
   * the group write-up prompt. Skips rows whose role is `duplicate` (the
   * primary owns the trip-overriding finding); appends per-leg-context,
   * SOP walk transcript, and sibling-duplicate annotation lines under each
   * visible row. Byte-identical to today's output when no leg has per-leg
   * context, no transcript, and no sibling-duplicate pointers exist
   * (parity guarantee).
   */
  ridesBlock: string;
  /**
   * Per-claim annotation lines (per-leg-context line + SOP transcript
   * block + sibling/primary annotation), keyed by claim id. Used by the
   * per-claim email and the preflight readback to surface findings without
   * re-rendering the full rides block. Lines are formatted as bullet items
   * ("- ...") so they drop cleanly into bullet-style prompt sections; empty
   * array when there is nothing to annotate.
   */
  perClaimAnnotationLines: Map<number, string[]>;
  // Audit-counter exports — see Task #307 §"Done looks like" + Task #377
  // §"Audit counters distinguish has transcript vs has unique context".
  hasPerLegContext: boolean;
  perLegContextLegCount: number;
  siblingDuplicateCount: number;
  hasSopTranscript: boolean;
  sopTranscriptLegCount: number;
}

const RIDE_LINE_INDENT = "  ";
const RIDE_ANNOTATION_INDENT = "     ";
const RIDE_TRANSCRIPT_BULLET_INDENT = "       ";

function ridesBlockHead(input: PromptLegInput, n: number): string {
  // Task #398: dollar amounts are deliberately omitted from prompt rides
  // — the dispute write-up never reasons about money, and including them
  // invites the model to make irrelevant cost-minimisation arguments.
  return `${RIDE_LINE_INDENT}${n}. Conf #${input.confNumber} | Service date: ${input.date || "N/A"} | Client: ${input.clientNumber || "N/A"} | Car: ${input.carNumber || "N/A"}`;
}

function transcriptBulletLine(line: TranscriptLine, indent: string): string {
  // Match the leg-page UI: `Question (node removed from tree) — Answer`
  // when the row is unresolved, otherwise just `Question — Answer`.
  const qSuffix = line.resolved ? "" : " (node removed from tree)";
  return `${indent}• ${line.question}${qSuffix} — ${line.answer}`;
}

function ridesBlockAnnotations(input: PromptLegInput): string[] {
  const lines: string[] = [];
  if (input.role !== "duplicate" && input.sopTranscript.length > 0) {
    lines.push(`${RIDE_ANNOTATION_INDENT}SOP walk transcript:`);
    for (const line of input.sopTranscript) {
      lines.push(transcriptBulletLine(line, RIDE_TRANSCRIPT_BULLET_INDENT));
    }
  }
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
  if (input.role !== "duplicate" && input.sopTranscript.length > 0) {
    // One bullet item whose body is multi-line — the transcript block.
    // Bullet-list children are indented two spaces under the "- " marker
    // so the LLM reads them as continuation of the same item.
    const bullets = input.sopTranscript
      .map((line) => transcriptBulletLine(line, "  "))
      .join("\n");
    lines.push(`- SOP walk transcript:\n${bullets}`);
  }
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

function transcriptForLeg(
  leg: PromptLegRowInput,
  treesByLegId: ReadonlyMap<number, SopTranscriptTree | null> | undefined,
): TranscriptLine[] {
  // Two early-exits keep the parity guarantee crisp:
  //   - No tree map provided (caller hasn't been upgraded yet) → []
  //   - Tree for this leg is null/missing (no errorTypeId or tree
  //     couldn't be loaded) → [], rather than feeding raw nodeIds to
  //     the LLM which would just be gibberish.
  if (!treesByLegId) return [];
  const tree = treesByLegId.get(leg.id);
  if (!tree) return [];
  return buildSopTranscript(leg.sopAnswers, tree);
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
    // Task #372: drop legacy auto-derived "• Q — A" breadcrumbs at the
    // helper boundary. Pre-#372 SOP-advance writes look like genuine
    // captured context but are really the bot reading its own walk back
    // to itself. A `null` here makes them invisible to every downstream
    // consumer (rides block annotations, per-claim annotations, audit
    // counters) without altering the stored value.
    const effectivePerLegContext = isLegacyDerivedContext(leg.perLegContext)
      ? null
      : leg.perLegContext;
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
      // Duplicates inherit the primary's finding — their own transcript
      // is suppressed so it doesn't echo the primary's walk back.
      return { ...base, perLegContext: null, role: "duplicate" as const, primaryRef, sopTranscript: [] };
    }
    const sopTranscript = transcriptForLeg(leg, ctx.treesByLegId);
    const siblings = siblingsByPrimary.get(leg.id) ?? [];
    if (siblings.length > 0) {
      return {
        ...base,
        perLegContext: effectivePerLegContext,
        role: "primary" as const,
        siblingDuplicateRefs: siblings.map((sid) => refsById.get(sid) ?? `#${sid}`),
        sopTranscript,
      };
    }
    return { ...base, perLegContext: effectivePerLegContext, role: "none" as const, sopTranscript };
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
  let sopTranscriptLegCount = 0;
  for (const i of inputs) {
    if (i.perLegContext && i.perLegContext.trim().length > 0) perLegContextLegCount++;
    if (i.siblingDuplicateRefs) siblingDuplicateCount += i.siblingDuplicateRefs.length;
    // Transcript counter: only count legs that contribute a transcript to
    // the prompt. Duplicates already have `sopTranscript: []` (see above)
    // so this naturally excludes them — same projection rule as the
    // per-leg-context counter (we count what the LLM actually sees).
    if (i.sopTranscript.length > 0) sopTranscriptLegCount++;
  }

  return {
    inputs,
    ridesBlock,
    perClaimAnnotationLines,
    hasPerLegContext: perLegContextLegCount > 0,
    perLegContextLegCount,
    siblingDuplicateCount,
    hasSopTranscript: sopTranscriptLegCount > 0,
    sopTranscriptLegCount,
  };
}

/**
 * Per Task #312 / #377: every audit-log event that fires alongside a Claude
 * prompt built from `buildPromptLegInputs` must surface the per-leg
 * traceability counters. Centralising the projection here keeps the audit
 * metadata shape consistent across the four prompt sites (portal write-up,
 * portal regenerate, AI readback preflight, per-claim email) and lets call
 * sites spread `...promptLegAuditCounters(promptLegInputs)` into their
 * `metadata` object without duplicating the field names.
 *
 * The transcript counters (`hasSopTranscript`, `sopTranscriptLegCount`)
 * are deliberately distinct from the per-leg-context counters
 * (`hasPerLegContext`, `perLegContextLegCount`) so analytics can answer
 * the two separate questions the audit log is asked: did the AI see the
 * SOP walk-through trail, and did it see the operator's authored unique
 * finding? A leg can carry one, the other, both, or neither.
 */
export function promptLegAuditCounters(r: PromptLegInputsResult): {
  hasPerLegContext: boolean;
  perLegContextLegCount: number;
  siblingDuplicateCount: number;
  hasSopTranscript: boolean;
  sopTranscriptLegCount: number;
} {
  return {
    hasPerLegContext: r.hasPerLegContext,
    perLegContextLegCount: r.perLegContextLegCount,
    siblingDuplicateCount: r.siblingDuplicateCount,
    hasSopTranscript: r.hasSopTranscript,
    sopTranscriptLegCount: r.sopTranscriptLegCount,
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
  // Task #377: surface the SOP walk + its anchoring tree id so the prompt
  // helper can derive per-leg transcripts. `errorTypeId` is selected here
  // (rather than re-loaded by callers) so every prompt-leg loader produces
  // the same row shape.
  sopAnswers: claimsTable.sopAnswers,
  errorTypeId: claimsTable.errorTypeId,
} as const;

/**
 * Validate a row's `decisionTree` jsonb into the minimal
 * `SopTranscriptTree` shape. Tolerant of malformed payloads (returns
 * `null` rather than throwing) — the caller's transcript will simply be
 * empty for the affected leg.
 *
 * Returns `null` (not `{nodes:[]}`) when the parsed node set is empty
 * after filtering: the helper's `tree==null` short-circuit then fully
 * suppresses the transcript for that leg, so a malformed jsonb can't
 * leak raw nodeIds (every walked answer would otherwise resolve
 * unresolved → "nodeId — answer") into the LLM prompt.
 */
export function normalizeTree(raw: unknown): SopTranscriptTree | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { nodes?: unknown };
  if (!Array.isArray(candidate.nodes)) return null;
  const nodes = candidate.nodes.filter(
    (n): n is { id: string; question: string } =>
      !!n &&
      typeof n === "object" &&
      typeof (n as { id?: unknown }).id === "string" &&
      typeof (n as { question?: unknown }).question === "string",
  );
  if (nodes.length === 0) return null;
  return { nodes };
}

/**
 * Task #377: build the `treesByLegId` map for `buildPromptLegInputs` from
 * a leg set. Batches the `error_types` lookup (one IN-list query, dedup'd
 * by `errorTypeId`) so the helper isn't pulling N rows for an N-leg
 * group. Returns an empty map when no leg has an `errorTypeId` — a
 * legitimate state for not-yet-classified legs.
 */
export async function loadDecisionTreesForLegs(
  legs: ReadonlyArray<PromptLegRowInput>,
): Promise<ReadonlyMap<number, SopTranscriptTree | null>> {
  const errorTypeIds = new Set<number>();
  for (const leg of legs) {
    if (!leg.errorTypeId) continue;
    const id = parseInt(leg.errorTypeId, 10);
    if (!isNaN(id)) errorTypeIds.add(id);
  }
  const treesByErrorTypeId = new Map<number, SopTranscriptTree | null>();
  if (errorTypeIds.size > 0) {
    const rows = await db
      .select({ id: errorTypesTable.id, decisionTree: errorTypesTable.decisionTree })
      .from(errorTypesTable)
      .where(inArray(errorTypesTable.id, Array.from(errorTypeIds)));
    for (const row of rows) {
      treesByErrorTypeId.set(row.id, normalizeTree(row.decisionTree));
    }
  }
  const treesByLegId = new Map<number, SopTranscriptTree | null>();
  for (const leg of legs) {
    if (!leg.errorTypeId) continue;
    const id = parseInt(leg.errorTypeId, 10);
    if (isNaN(id)) continue;
    treesByLegId.set(leg.id, treesByErrorTypeId.get(id) ?? null);
  }
  return treesByLegId;
}

/**
 * Convenience loader for the per-claim email path: given a claim id, fetch
 * the claim and the full leg set of its parent group so the helper can
 * compute sibling annotations + primary refs. If the claim has no
 * `invoiceGroupId`, returns a degenerate `groupLegs = [singleClaim]`.
 *
 * Also returns the `treesByLegId` map already built from the loaded leg
 * set — call sites then pass it straight into `buildPromptLegInputs` so
 * the SOP walk transcript is threaded through automatically.
 *
 * Throws if the claim cannot be loaded or if the parent group exists but
 * has zero legs (data inconsistency) — per guard #10, no silent fallbacks.
 */
export async function loadGroupLegsForClaim(claimId: number): Promise<{
  claim: PromptLegRowInput;
  groupLegs: PromptLegRowInput[];
  treesByLegId: ReadonlyMap<number, SopTranscriptTree | null>;
}> {
  const [claim] = await db
    .select({ ...PROMPT_LEG_COLUMNS, invoiceGroupId: claimsTable.invoiceGroupId })
    .from(claimsTable)
    .where(eq(claimsTable.id, claimId));
  if (!claim) {
    throw new Error(`loadGroupLegsForClaim: claim ${claimId} not found`);
  }
  if (claim.invoiceGroupId == null) {
    const treesByLegId = await loadDecisionTreesForLegs([claim]);
    return { claim, groupLegs: [claim], treesByLegId };
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
  const treesByLegId = await loadDecisionTreesForLegs(groupLegs);
  return { claim, groupLegs, treesByLegId };
}
