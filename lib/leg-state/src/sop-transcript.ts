// Pure helper that turns a leg's `sopAnswers` jsonb + the matching
// decision tree into a plain "Question — Answer" transcript. Lives in
// `@workspace/leg-state` so both the React client (read-only "SOP walk
// transcript" card on the leg page) and the server (Task #377: surface
// the same transcript inside the dispute write-up prompt so the LLM
// sees the operator's walk-through trail) consume one source of truth.
//
// Design points worth pinning here:
//
//   - The transcript is derived purely from what the operator answered;
//     it never invents missing nodes. If a step's nodeId is no longer in
//     the tree (the SOP was edited after the walk), we fall back to the
//     stored answer with a placeholder question so the row stays visible
//     instead of silently dropping (Guard #5: never silently mask
//     operator-recorded steps).
//
//   - The shape mirrors the "• Question — Answer" lines the previous
//     SOP-advance player auto-wrote into `per_leg_context` (see
//     `isLegacyDerivedContext`). That parity is intentional: when a
//     legacy-derived perLegContext is detected, the leg page renders it
//     under the transcript as the migration trail so nothing is lost.
//
//   - The helper does NOT format to markdown / HTML. It returns
//     structured rows so each consumer (React renderer, prompt builder)
//     owns its own chrome.
//
//   - The decision-tree dependency is intentionally minimal — only the
//     `nodes: [{id, question}]` shape is required. The full
//     `DecisionTree` type from claimclear (with options, evidence
//     requirements, etc.) is structurally compatible so callers there
//     can pass it directly without a coercion step.

export interface SopAnswerRow {
  nodeId: string;
  answer: string;
  ts?: string;
}

export interface TranscriptLine {
  /** The question text from the tree at the time of render. Falls back
   *  to the stored nodeId when the node has been removed from the tree. */
  question: string;
  /** Operator's recorded answer, verbatim from the audit row. */
  answer: string;
  /** True when the question came from the live tree; false when we had
   *  to fall back to the nodeId placeholder. The renderer uses this to
   *  flag "tree was edited" rows distinctly. */
  resolved: boolean;
}

/**
 * Minimal decision-tree shape required for transcript derivation.
 * Structurally a supertype of claimclear's `DecisionTree` so callers
 * can pass the full type directly.
 */
export interface SopTranscriptTreeNode {
  id: string;
  question: string;
}

export interface SopTranscriptTree {
  nodes: ReadonlyArray<SopTranscriptTreeNode>;
}

/**
 * Narrow `sopAnswers` (jsonb on the wire → `unknown` in TS) to the
 * documented row shape. Identical to the server's `SopAnswerRow`
 * narrowing in `claims.ts` — kept tight so a malformed payload yields
 * an empty transcript rather than throwing into the React tree.
 */
export function normalizeAnswers(raw: unknown): SopAnswerRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is SopAnswerRow =>
      !!r &&
      typeof r === "object" &&
      "nodeId" in r &&
      "answer" in r &&
      typeof (r as SopAnswerRow).nodeId === "string" &&
      typeof (r as SopAnswerRow).answer === "string",
    )
    .map((r) => ({ nodeId: r.nodeId, answer: r.answer, ts: r.ts }));
}

/**
 * Build the transcript lines for a leg. Returns an empty array when
 * either the answers list or the tree is missing — a leg that hasn't
 * walked the SOP yet has no transcript to show. Empty-vs-missing is the
 * caller's concern (the leg-detail card renders an empty-state line;
 * the prompt builder skips the block entirely).
 */
export function buildSopTranscript(
  answers: unknown,
  tree: SopTranscriptTree | null | undefined,
): TranscriptLine[] {
  const rows = normalizeAnswers(answers);
  if (rows.length === 0) return [];
  if (!tree) {
    // Without a tree we can't resolve nodeIds; surface every row as
    // unresolved so the operator at least sees what was answered.
    return rows.map((r) => ({
      question: r.nodeId,
      answer: r.answer,
      resolved: false,
    }));
  }
  return rows.map((r) => {
    const node = tree.nodes.find((n) => n.id === r.nodeId);
    if (node && node.question.trim().length > 0) {
      return { question: node.question, answer: r.answer, resolved: true };
    }
    return { question: r.nodeId, answer: r.answer, resolved: false };
  });
}
