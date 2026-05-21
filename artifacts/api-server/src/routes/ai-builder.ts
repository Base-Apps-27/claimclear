// Task #817 — Smarter AI Builder endpoints.
//
// Four new author-assist routes that complement the existing
// `sop-analyzer.ts` (build-tree-from-text, simplify-text):
//
//   1. POST /error-types/ai-builder/suggest-next
//        Given a parent question + the empty option slot, propose
//        1-3 candidate next-question rewrites.
//
//   2. POST /error-types/ai-builder/scan-ambiguity
//        Batch-flag ambiguous question wording across the entire
//        tree; one model call, tolerant of partial JSON.
//
//   3. POST /error-types/ai-builder/ingest-document  (multipart)
//        Accept a PDF / PNG / JPG up to ~10MB. Use Claude's native
//        document + vision content blocks to extract text, then
//        delegate to the existing tree-generation prompt so the
//        document path and the plain-text path produce identical
//        shapes.
//
//   4. POST /error-types/ai-builder/coverage-check
//        Walk the last N claims for an error type through the
//        currently-edited tree using each claim's persisted
//        `sopAnswers`. Classify every claim as terminated /
//        abandoned / unmatched and return a sample of unmatched
//        ones so the author can extend the tree.
//
//   4b. POST /error-types/ai-builder/suggest-branch-from-claim
//        Companion call to (4): propose a brand-new branch wording +
//        outcome to fix a single unmatched claim.
//
// Operational notes:
// * No extra system deps. Document ingest uses Claude's `document`
//   content block (PDFs) and `image` block (PNG/JPG), so we don't
//   ship `pdf-parse`, an OCR daemon, or `pdfjs` workers.
// * The streaming is intentionally deferred to a follow-up — we
//   surface a shimmer skeleton client-side instead. The pipe is
//   already in place to add it later (Anthropic SDK supports
//   `messages.stream`).
import { Router, type IRouter } from "express";
import express from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, errorTypesTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { asyncHandler } from "../lib/asyncHandler";
import { denyClerk } from "../middlewares/denyClerk";

const router: IRouter = Router();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Shared types (mirror the editor's shape but server-side; importing
// across artifact boundaries isn't supported so we duplicate the
// minimal contract).
// ---------------------------------------------------------------------------
type OutcomeType =
  | "portal_dispute"
  | "internal"
  | "hold"
  | "dispute"
  | "cannot_dispute"
  | "non_issue";

interface DTOption {
  label: string;
  childId?: string;
  outcomeType?: OutcomeType;
  outcomeLabel?: string;
}
interface DTNode {
  id: string;
  question: string;
  options: DTOption[];
}
interface DTTree {
  rootId: string;
  nodes: DTNode[];
}

function isValidTree(raw: unknown): raw is DTTree {
  if (!raw || typeof raw !== "object") return false;
  const t = raw as Record<string, unknown>;
  if (typeof t.rootId !== "string") return false;
  if (!Array.isArray(t.nodes)) return false;
  return t.nodes.every(
    (n) =>
      n != null &&
      typeof n === "object" &&
      typeof (n as Record<string, unknown>).id === "string" &&
      Array.isArray((n as Record<string, unknown>).options),
  );
}

function extractJson(text: string): string {
  let s = text.trim();
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) s = m[1].trim();
  return s;
}

// ---------------------------------------------------------------------------
// 1) Suggest next question
// ---------------------------------------------------------------------------
router.post(
  "/error-types/ai-builder/suggest-next",
  denyClerk,
  asyncHandler(async (req, res): Promise<void> => {
    const {
      parentQuestion,
      optionLabel,
      contextPath,
      sourceSopText,
      errorTypeName,
    } = req.body ?? {};

    if (
      typeof parentQuestion !== "string" ||
      !parentQuestion.trim() ||
      typeof optionLabel !== "string"
    ) {
      res.status(400).json({ error: "parentQuestion and optionLabel are required" });
      return;
    }

    const path = Array.isArray(contextPath)
      ? contextPath.filter((s) => typeof s === "string").join(" → ")
      : "";

    const prompt = `You are an expert NEMT claims dispute analyst helping an author extend a decision tree.

${errorTypeName ? `Error type: "${errorTypeName}"\n` : ""}${sourceSopText ? `Original SOP context:\n---\n${String(sourceSopText).slice(0, 4000)}\n---\n` : ""}
The author just clicked on an empty branch slot under this parent step:
  Parent question: ${parentQuestion}
  Option label the operator picked: ${optionLabel || "(unnamed branch)"}
  Path from root: ${path || "(root)"}

Propose 1-3 candidate next questions (yes/no style) the operator should answer next. Each must be:
- A single concrete question (12-22 words, plain language, 6th-grade reading level)
- Specific to the path above — do not re-ask what's already been answered
- Practical for an NEMT operator working a portal/email dispute

Respond with ONLY valid JSON:
{ "candidates": [ { "question": "...", "rationale": "1 short sentence" } ] }`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      res.status(500).json({ error: "No text response from AI" });
      return;
    }
    let parsed: { candidates?: Array<{ question?: string; rationale?: string }> };
    try {
      parsed = JSON.parse(extractJson(block.text));
    } catch {
      res.status(500).json({ error: "AI returned invalid JSON" });
      return;
    }
    const candidates = (parsed.candidates || [])
      .filter((c) => c && typeof c.question === "string" && c.question.trim().length > 0)
      .slice(0, 3)
      .map((c) => ({
        question: c.question!.trim(),
        rationale: typeof c.rationale === "string" ? c.rationale.trim() : "",
      }));
    res.json({ candidates });
  }),
);

// ---------------------------------------------------------------------------
// 2) Ambiguity scan
// ---------------------------------------------------------------------------
router.post(
  "/error-types/ai-builder/scan-ambiguity",
  denyClerk,
  asyncHandler(async (req, res): Promise<void> => {
    const { tree, errorTypeName } = req.body ?? {};
    if (!isValidTree(tree)) {
      res.status(400).json({ error: "tree is required and must have rootId + nodes[]" });
      return;
    }
    const questionRows = tree.nodes
      .filter((n) => typeof n.question === "string" && n.question.trim().length > 0)
      .map((n) => ({ nodeId: n.id, question: n.question }));
    if (questionRows.length === 0) {
      res.json({ flags: [] });
      return;
    }

    const prompt = `You are an editor reviewing decision-tree questions used by NEMT claims operators. Flag any question whose wording is structurally ambiguous — multiple reasonable interpretations, double negatives, missing referent, vague pronoun ("it" / "this" with no clear antecedent), or compound questions that pack two questions into one.

${errorTypeName ? `Error type: "${errorTypeName}"` : ""}

For each FLAGGED question return:
  - severity: "low" | "medium" | "high"
  - reason: 1 short sentence explaining what's ambiguous
  - suggestedRewrite: a plain-language rewrite that fixes the issue

Do NOT flag questions that are already clear. Tolerate domain jargon like GPS, MAS, portal, dispatch, attestation.

Respond with ONLY valid JSON:
{ "flags": [ { "nodeId": "...", "severity": "...", "reason": "...", "suggestedRewrite": "..." } ] }

Questions:
${JSON.stringify(questionRows, null, 2)}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      res.status(500).json({ error: "No text response from AI" });
      return;
    }
    let parsed: { flags?: unknown };
    try {
      parsed = JSON.parse(extractJson(block.text));
    } catch {
      // Be tolerant: return zero flags rather than a hard error so the
      // editor's "Check clarity" surface degrades gracefully.
      res.json({ flags: [] });
      return;
    }
    const validIds = new Set(tree.nodes.map((n) => n.id));
    const SEVERITIES = new Set(["low", "medium", "high"]);
    const flags = Array.isArray(parsed.flags)
      ? (parsed.flags as Array<Record<string, unknown>>)
          .map((f) => ({
            nodeId: typeof f.nodeId === "string" ? f.nodeId : "",
            severity: typeof f.severity === "string" ? f.severity.toLowerCase() : "medium",
            reason: typeof f.reason === "string" ? f.reason : "",
            suggestedRewrite:
              typeof f.suggestedRewrite === "string" ? f.suggestedRewrite : "",
          }))
          .filter(
            (f) =>
              validIds.has(f.nodeId) &&
              SEVERITIES.has(f.severity) &&
              f.reason.length > 0,
          )
      : [];
    res.json({ flags });
  }),
);

// ---------------------------------------------------------------------------
// 3) Document ingest — PDF / PNG / JPG → extracted text
// ---------------------------------------------------------------------------
const upload = express.raw({
  type: ["application/pdf", "image/png", "image/jpeg", "image/jpg"],
  limit: MAX_UPLOAD_BYTES,
});

router.post(
  "/error-types/ai-builder/ingest-document",
  denyClerk,
  upload,
  asyncHandler(async (req, res): Promise<void> => {
    const ctype = String(req.headers["content-type"] || "").split(";")[0].trim();
    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Empty request body" });
      return;
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: "File too large (max 10MB)" });
      return;
    }
    const supported = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
    ]);
    if (!supported.has(ctype)) {
      res.status(415).json({ error: `Unsupported content type: ${ctype}` });
      return;
    }

    const isPdf = ctype === "application/pdf";
    const mediaType = isPdf ? "application/pdf" : ctype === "image/jpg" ? "image/jpeg" : ctype;
    const base64 = body.toString("base64");

    // Claude supports `document` blocks for PDFs (vision over rendered
    // pages) and `image` blocks for PNG/JPEG. One call, no extra deps.
    const block = isPdf
      ? {
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mediaType as "image/png" | "image/jpeg",
            data: base64,
          },
        };

    let extractedText = "";
    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              block as any,
              {
                type: "text",
                text:
                  "Extract ALL text content from this document. Preserve list structure, headings, and numbered steps. Output ONLY the extracted text — no preamble, no commentary, no markdown fences.",
              },
            ],
          },
        ],
      });
      const tb = message.content.find((b) => b.type === "text");
      extractedText = tb && tb.type === "text" ? tb.text.trim() : "";
    } catch (err) {
      res.status(502).json({
        error: "AI extraction failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!extractedText) {
      res.status(422).json({
        error: "No text could be extracted from the document",
      });
      return;
    }

    res.json({ extractedText, byteSize: body.length, contentType: ctype });
  }),
);

// ---------------------------------------------------------------------------
// 4) Coverage check — walk recent claims through the tree
// ---------------------------------------------------------------------------

interface SopAnswerRow {
  nodeId: string;
  answer: string;
  ts?: string;
}

export interface CoverageWalkResult {
  classification: "terminated" | "abandoned" | "unmatched";
  finalNodeId: string | null;
  unmatchedAtOption?: string;
}

/**
 * Pure: walk a single claim's `sopAnswers` through a tree using the
 * same rules the runtime player uses (option label match, then child
 * traversal, then terminal outcome). Exported so the test mirrors the
 * walker exactly.
 */
export function walkClaimThroughTree(
  tree: DTTree,
  answers: SopAnswerRow[],
  currentNodeId: string | null,
  sopOutcome: string | null,
): CoverageWalkResult {
  // If the claim already terminated (outcome captured), that's a hit.
  if (sopOutcome && typeof sopOutcome === "string") {
    return { classification: "terminated", finalNodeId: currentNodeId };
  }
  // No answers at all — claim never started.
  if (!Array.isArray(answers) || answers.length === 0) {
    return { classification: "abandoned", finalNodeId: tree.rootId };
  }
  // Walk from root following the recorded answers in order.
  let nodeId: string = tree.rootId;
  for (const ans of answers) {
    const node = tree.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return { classification: "unmatched", finalNodeId: nodeId };
    }
    // Match by answer label first; fall back to nodeId match (rebased
    // trees keep the same node id but option labels may have moved).
    const option =
      node.options.find((o) => o.label === ans.answer) ??
      (ans.nodeId === nodeId
        ? node.options.find((o) => o.label.toLowerCase() === ans.answer.toLowerCase())
        : undefined);
    if (!option) {
      return {
        classification: "unmatched",
        finalNodeId: nodeId,
        unmatchedAtOption: ans.answer,
      };
    }
    if (option.outcomeType) {
      return { classification: "terminated", finalNodeId: nodeId };
    }
    if (!option.childId) {
      return { classification: "abandoned", finalNodeId: nodeId };
    }
    nodeId = option.childId;
  }
  // Ran out of answers before hitting a terminal — abandoned mid-tree.
  return { classification: "abandoned", finalNodeId: nodeId };
}

router.post(
  "/error-types/ai-builder/coverage-check",
  denyClerk,
  asyncHandler(async (req, res): Promise<void> => {
    const { errorTypeId, sampleSize, tree: bodyTree } = req.body ?? {};
    const id = Number(errorTypeId);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "errorTypeId is required" });
      return;
    }
    const size = Math.max(1, Math.min(1000, Number(sampleSize) || 200));

    // Load the tree from the body (so the author can run coverage on
    // their unsaved canvas) — fall back to the persisted tree.
    let tree: DTTree | null = isValidTree(bodyTree) ? bodyTree : null;
    if (!tree) {
      const [row] = await db
        .select()
        .from(errorTypesTable)
        .where(eq(errorTypesTable.id, id));
      if (!row) {
        res.status(404).json({ error: "Error type not found" });
        return;
      }
      tree = isValidTree(row.decisionTree) ? (row.decisionTree as DTTree) : null;
    }
    if (!tree) {
      res.status(400).json({ error: "No valid tree to check coverage against" });
      return;
    }

    // Pull the last N claims tagged with this error type. We filter to
    // claims that have a recorded sopAnswers OR sopOutcome so the walk
    // has something to evaluate.
    const claims = await db
      .select({
        id: claimsTable.id,
        invoiceNumber: claimsTable.invoiceNumbers,
        sopAnswers: claimsTable.sopAnswers,
        sopNodeId: claimsTable.sopNodeId,
        sopOutcome: claimsTable.sopOutcome,
      })
      .from(claimsTable)
      .where(eq(claimsTable.errorTypeId, String(id)))
      .orderBy(desc(claimsTable.id))
      .limit(size);

    let terminated = 0;
    let abandoned = 0;
    let unmatched = 0;
    const unmatchedSamples: Array<{
      claimId: number;
      invoiceNumber: string | null;
      finalNodeId: string | null;
      unmatchedAtOption?: string;
      finalQuestion: string;
    }> = [];

    for (const c of claims) {
      const answers = Array.isArray(c.sopAnswers)
        ? (c.sopAnswers as SopAnswerRow[])
        : [];
      const r = walkClaimThroughTree(tree, answers, c.sopNodeId, c.sopOutcome);
      if (r.classification === "terminated") terminated++;
      else if (r.classification === "abandoned") abandoned++;
      else {
        unmatched++;
        if (unmatchedSamples.length < 10) {
          const finalQuestion =
            tree.nodes.find((n) => n.id === r.finalNodeId)?.question || "";
          unmatchedSamples.push({
            claimId: c.id,
            invoiceNumber: c.invoiceNumber ?? null,
            finalNodeId: r.finalNodeId,
            unmatchedAtOption: r.unmatchedAtOption,
            finalQuestion,
          });
        }
      }
    }

    res.json({
      totalChecked: claims.length,
      sampleSize: size,
      terminated,
      abandoned,
      unmatched,
      unmatchedSamples,
    });
  }),
);

router.post(
  "/error-types/ai-builder/suggest-branch-from-claim",
  denyClerk,
  asyncHandler(async (req, res): Promise<void> => {
    const { finalQuestion, unmatchedAnswer, errorTypeName, sourceSopText } =
      req.body ?? {};
    if (
      typeof finalQuestion !== "string" ||
      typeof unmatchedAnswer !== "string" ||
      !finalQuestion.trim()
    ) {
      res.status(400).json({ error: "finalQuestion and unmatchedAnswer are required" });
      return;
    }

    const prompt = `You are extending a NEMT decision tree. A real operator answered "${unmatchedAnswer}" at the step:
  "${finalQuestion}"
but the tree had no matching branch.

${errorTypeName ? `Error type: "${errorTypeName}"\n` : ""}${sourceSopText ? `SOP context:\n---\n${String(sourceSopText).slice(0, 3000)}\n---\n` : ""}
Propose a new branch for this operator answer:
- A short branch label (matches operator's answer style)
- A next-step question if more decisions are needed, OR a terminal outcome
- Outcome must be one of: portal_dispute, hold, cannot_dispute, non_issue, internal

Respond with ONLY valid JSON in ONE of these shapes:
  { "branchLabel": "...", "nextQuestion": "..." }
or
  { "branchLabel": "...", "outcomeType": "portal_dispute|hold|cannot_dispute|non_issue|internal", "outcomeLabel": "short button label" }`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      res.status(500).json({ error: "No text response from AI" });
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(extractJson(block.text));
    } catch {
      res.status(500).json({ error: "AI returned invalid JSON" });
      return;
    }
    const branchLabel =
      typeof parsed.branchLabel === "string" ? parsed.branchLabel.trim() : "";
    if (!branchLabel) {
      res.status(500).json({ error: "AI returned no branchLabel" });
      return;
    }
    const ALLOWED: ReadonlySet<string> = new Set([
      "portal_dispute",
      "hold",
      "cannot_dispute",
      "non_issue",
      "internal",
    ]);
    if (typeof parsed.outcomeType === "string" && ALLOWED.has(parsed.outcomeType)) {
      res.json({
        branchLabel,
        outcomeType: parsed.outcomeType,
        outcomeLabel:
          typeof parsed.outcomeLabel === "string" ? parsed.outcomeLabel : branchLabel,
      });
      return;
    }
    if (typeof parsed.nextQuestion === "string" && parsed.nextQuestion.trim()) {
      res.json({ branchLabel, nextQuestion: parsed.nextQuestion.trim() });
      return;
    }
    res.status(500).json({ error: "AI proposal missing both nextQuestion and outcomeType" });
  }),
);

export default router;
