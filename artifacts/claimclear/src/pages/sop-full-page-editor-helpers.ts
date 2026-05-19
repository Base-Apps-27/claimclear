// Pure helpers for SopFullPageEditor. Lives in its own file so the
// unit test can import them WITHOUT pulling in `@xyflow/react` (which
// transitively imports a `.css` file that node's loader can't parse).
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type {
  UpdateErrorTypeBody,
  UpdateErrorTypeBodyDecisionTree,
} from "@workspace/api-client-react";
import {
  type DecisionTree,
  type TreeNode,
  type TreeOption,
  type OutcomeType,
  type EvidenceReq,
  type LegacyTreeNode,
  generateNodeId,
  legacyToTree,
  OUTCOME_LABELS,
} from "@/components/decision-tree/types";

// Structurally validate a tree object before letting React Flow / dagre /
// the inspector loose on it. The DB has been seen to hold legacy shapes,
// `null`, and the occasional malformed object; rendering any of those
// crashes the editor. Anything we don't recognize returns null so callers
// can fall back gracefully. Pure + exported so AI Builder and the page
// loader share one parser.
export function coerceTree(raw: unknown): DecisionTree | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.rootId === "string" && Array.isArray(r.nodes)) {
    const nodes = r.nodes as unknown[];
    const valid = nodes.every(
      (n) =>
        n != null &&
        typeof n === "object" &&
        typeof (n as Record<string, unknown>).id === "string" &&
        Array.isArray((n as Record<string, unknown>).options),
    );
    if (!valid) return null;
    const hasRoot = nodes.some(
      (n) => (n as Record<string, unknown>).id === r.rootId,
    );
    if (!hasRoot) return null;
    return r as unknown as DecisionTree;
  }
  if (typeof r.question === "string") {
    try {
      return legacyToTree(r as unknown as LegacyTreeNode);
    } catch {
      return null;
    }
  }
  return null;
}

// Ask the AI builder to generate a full decision tree from a plain-text
// SOP description. Mirrors the request shape used by the original
// AI Builder on error-types.tsx (POST /api/error-types/build-tree-from-text
// with { description, errorTypeName }) so we share one backend route.
// Returns a coerced DecisionTree; throws if the response is missing
// a tree or the tree fails structural validation.
export async function buildTreeFromText(
  description: string,
  errorTypeName?: string,
): Promise<DecisionTree> {
  const res = await fetch("/api/error-types/build-tree-from-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, errorTypeName }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const data: { decisionTree?: unknown } = await res.json();
  if (!data.decisionTree) {
    throw new Error("AI returned no tree");
  }
  const coerced = coerceTree(data.decisionTree);
  if (!coerced) {
    throw new Error("AI returned an unrecognized tree shape");
  }
  return coerced;
}

export type FlowNodeData = {
  kind: "question" | "outcome";
  label: string;
  question?: string;
  outcomeType?: OutcomeType;
  evidenceCount?: number;
  selected?: boolean;
};

export const NODE_W = 220;
export const NODE_H = 96;

export function layoutWithDagre(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
): Node<FlowNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 56, marginx: 24, marginy: 24 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } };
  });
}

export function treeToFlow(
  tree: DecisionTree,
  selectedId: string | null,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const flowNodes: Node<FlowNodeData>[] = [];
  const flowEdges: Edge[] = [];

  for (const n of tree.nodes) {
    flowNodes.push({
      id: n.id,
      type: "question",
      position: { x: 0, y: 0 },
      data: {
        kind: "question",
        label: n.question || "(untitled question)",
        question: n.question,
        evidenceCount: n.evidenceRequirements?.length ?? 0,
        selected: n.id === selectedId,
      },
    });
    n.options.forEach((opt, idx) => {
      if (opt.childId) {
        flowEdges.push({
          id: `${n.id}->${opt.childId}#${idx}`,
          source: n.id,
          target: opt.childId,
          type: "insertable",
          label: opt.label || (idx === 0 ? "Yes" : "No"),
          data: { parentId: n.id, optionIndex: idx },
        });
      } else if (opt.outcomeType) {
        const termId = `${n.id}__term${idx}`;
        flowNodes.push({
          id: termId,
          type: "outcome",
          position: { x: 0, y: 0 },
          data: {
            kind: "outcome",
            label: opt.outcomeLabel || OUTCOME_LABELS[opt.outcomeType] || opt.outcomeType,
            outcomeType: opt.outcomeType,
            selected: false,
          },
        });
        flowEdges.push({
          id: `${n.id}->${termId}`,
          source: n.id,
          target: termId,
          type: "insertable",
          label: opt.label || (idx === 0 ? "Yes" : "No"),
          data: { parentId: n.id, optionIndex: idx },
        });
      }
    });
  }
  return { nodes: layoutWithDagre(flowNodes, flowEdges), edges: flowEdges };
}

export function updateNode(
  tree: DecisionTree,
  id: string,
  patch: Partial<TreeNode>,
): DecisionTree {
  return { ...tree, nodes: tree.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function setOption(
  tree: DecisionTree,
  nodeId: string,
  idx: number,
  patch: Partial<TreeOption>,
): DecisionTree {
  return {
    ...tree,
    nodes: tree.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const options = [...n.options];
      options[idx] = { ...options[idx], ...patch };
      return { ...n, options };
    }),
  };
}

export function insertBetween(
  tree: DecisionTree,
  parentId: string,
  optionIndex: number,
): { tree: DecisionTree; newId: string } {
  const parent = tree.nodes.find((n) => n.id === parentId);
  if (!parent) return { tree, newId: "" };
  const opt = parent.options[optionIndex];
  const newId = generateNodeId();
  const newNode: TreeNode = {
    id: newId,
    question: "New step",
    options: [
      opt.childId
        ? { label: "Continue", childId: opt.childId }
        : { label: "Continue", outcomeType: opt.outcomeType, outcomeLabel: opt.outcomeLabel },
      { label: "Other" },
    ],
  };
  const nextTree: DecisionTree = {
    ...tree,
    nodes: [
      ...tree.nodes.map((n) =>
        n.id === parentId
          ? {
              ...n,
              options: n.options.map((o, i) =>
                i === optionIndex ? { label: o.label, childId: newId } : o,
              ),
            }
          : n,
      ),
      newNode,
    ],
  };
  return { tree: nextTree, newId };
}

export function addEvidenceReq(tree: DecisionTree, nodeId: string): DecisionTree {
  return updateNode(tree, nodeId, {
    evidenceRequirements: [
      ...((tree.nodes.find((n) => n.id === nodeId)?.evidenceRequirements) || []),
      { key: `ev_${Date.now()}`, label: "New evidence", required: true },
    ],
  });
}

export function setEvidenceReq(
  tree: DecisionTree,
  nodeId: string,
  idx: number,
  patch: Partial<EvidenceReq>,
): DecisionTree {
  const node = tree.nodes.find((n) => n.id === nodeId);
  if (!node) return tree;
  const reqs = [...(node.evidenceRequirements || [])];
  reqs[idx] = { ...reqs[idx], ...patch };
  return updateNode(tree, nodeId, { evidenceRequirements: reqs });
}

// Ask the AI rewrite endpoint to simplify a single field's text.
// Uses the legacy `items` shape (one row per call) so we can request a
// rewrite of just the question or just the instructions field without
// having to assemble the full step context. The server normalizes
// `items` into the same grouped prompt shape internally.
export async function simplifyTextField(
  text: string,
  field: "question" | "instructions",
): Promise<string> {
  const res = await fetch("/api/error-types/simplify-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: "field", field, text }],
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const data: { suggestions?: { id: string; text: string }[] } = await res.json();
  const suggestion = (data.suggestions || []).find((s) => s.id === "field");
  if (!suggestion || typeof suggestion.text !== "string") {
    throw new Error("AI returned no suggestion");
  }
  return suggestion.text;
}

export function removeEvidenceReq(
  tree: DecisionTree,
  nodeId: string,
  idx: number,
): DecisionTree {
  const node = tree.nodes.find((n) => n.id === nodeId);
  if (!node) return tree;
  const reqs = (node.evidenceRequirements || []).filter((_, i) => i !== idx);
  return updateNode(tree, nodeId, { evidenceRequirements: reqs });
}

// ---------------------------------------------------------------------------
// Find & Replace — Task #776
//
// Pure helpers for the cross-SOP Find & Replace dialog. Kept here so the
// unit tests can exercise them without booting React Flow or jsdom.
//
// Scope of matchable fields (locked by the task spec): each tree node's
//   - question
//   - instructionText           (the "instructions" field in the spec)
//   - options[].label
//   - options[].outcomeLabel
//   - evidenceRequirements[].label
// Anything else is intentionally NOT touched.
// ---------------------------------------------------------------------------

export type FindMatchField =
  | "question"
  | "instructions"
  | "optionLabel"
  | "outcomeLabel"
  | "evidenceLabel";

export interface FindMatch {
  errorTypeId: number;
  nodeId: string;
  field: FindMatchField;
  // Index into options[] or evidenceRequirements[] when relevant. `-1`
  // for node-level fields (question/instructions).
  index: number;
  beforeText: string;
  afterText: string;
  matchSpans: Array<{ start: number; end: number }>;
}

export interface FindOptions {
  matchCase?: boolean;
}

function computeSpans(
  haystack: string,
  needle: string,
  matchCase: boolean,
): Array<{ start: number; end: number }> {
  if (!needle) return [];
  const hay = matchCase ? haystack : haystack.toLowerCase();
  const nee = matchCase ? needle : needle.toLowerCase();
  const out: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i <= hay.length - nee.length) {
    const idx = hay.indexOf(nee, i);
    if (idx === -1) break;
    out.push({ start: idx, end: idx + nee.length });
    i = idx + nee.length;
  }
  return out;
}

function applyToString(
  text: string,
  spans: Array<{ start: number; end: number }>,
  replacement: string,
): string {
  if (spans.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const s of spans) {
    out += text.slice(cursor, s.start) + replacement;
    cursor = s.end;
  }
  out += text.slice(cursor);
  return out;
}

// Walk a tree and collect every match of `needle` in the five
// supported fields. Returns one entry per (node × field × index)
// combination that has at least one hit. `afterText` is precomputed
// so callers can render the diff without re-running the replace.
export function findMatches(
  tree: DecisionTree,
  errorTypeId: number,
  needle: string,
  replacement: string,
  opts: FindOptions = {},
): FindMatch[] {
  const matchCase = opts.matchCase === true;
  if (!needle) return [];
  const out: FindMatch[] = [];

  const push = (
    nodeId: string,
    field: FindMatchField,
    index: number,
    text: string | undefined,
  ) => {
    if (typeof text !== "string" || text.length === 0) return;
    const spans = computeSpans(text, needle, matchCase);
    if (spans.length === 0) return;
    out.push({
      errorTypeId,
      nodeId,
      field,
      index,
      beforeText: text,
      afterText: applyToString(text, spans, replacement),
      matchSpans: spans,
    });
  };

  for (const node of tree.nodes) {
    push(node.id, "question", -1, node.question);
    push(node.id, "instructions", -1, node.instructionText);
    node.options.forEach((opt, idx) => {
      push(node.id, "optionLabel", idx, opt.label);
      push(node.id, "outcomeLabel", idx, opt.outcomeLabel);
    });
    (node.evidenceRequirements || []).forEach((req, idx) => {
      push(node.id, "evidenceLabel", idx, req.label);
    });
  }

  return out;
}

// Apply the given matches to `tree` immutably, returning a new tree.
// Only matches with the same errorTypeId are considered; callers
// typically pre-filter per error-type but we guard here too.
export function applyReplacements(
  tree: DecisionTree,
  errorTypeId: number,
  matches: FindMatch[],
  replacement: string,
): DecisionTree {
  const relevant = matches.filter((m) => m.errorTypeId === errorTypeId);
  if (relevant.length === 0) return tree;

  // Group by node for a single pass.
  const byNode = new Map<string, FindMatch[]>();
  for (const m of relevant) {
    const list = byNode.get(m.nodeId);
    if (list) list.push(m);
    else byNode.set(m.nodeId, [m]);
  }

  return {
    ...tree,
    nodes: tree.nodes.map((n) => {
      const ms = byNode.get(n.id);
      if (!ms) return n;
      let nextQuestion = n.question;
      let nextInstructions = n.instructionText;
      let nextOptions = n.options;
      let nextEvidence = n.evidenceRequirements;
      for (const m of ms) {
        if (m.field === "question") {
          nextQuestion = applyToString(nextQuestion, m.matchSpans, replacement);
        } else if (m.field === "instructions") {
          if (typeof nextInstructions === "string") {
            nextInstructions = applyToString(nextInstructions, m.matchSpans, replacement);
          }
        } else if (m.field === "optionLabel") {
          nextOptions = nextOptions.map((o, i) =>
            i === m.index ? { ...o, label: applyToString(o.label, m.matchSpans, replacement) } : o,
          );
        } else if (m.field === "outcomeLabel") {
          nextOptions = nextOptions.map((o, i) =>
            i === m.index && typeof o.outcomeLabel === "string"
              ? { ...o, outcomeLabel: applyToString(o.outcomeLabel, m.matchSpans, replacement) }
              : o,
          );
        } else if (m.field === "evidenceLabel") {
          if (nextEvidence) {
            nextEvidence = nextEvidence.map((r, i) =>
              i === m.index ? { ...r, label: applyToString(r.label, m.matchSpans, replacement) } : r,
            );
          }
        }
      }
      return {
        ...n,
        question: nextQuestion,
        instructionText: nextInstructions,
        options: nextOptions,
        evidenceRequirements: nextEvidence,
      };
    }),
  };
}

// Editable settings fields the full-page editor's Settings tab manages
// alongside the canvas tree. Mirrors the same columns the old modal in
// error-types.tsx writes (minus decisionTree, evidenceRequirements,
// disputeReasonsLibrary, and emailTemplate — those have their own
// surfaces). Kept in its own type so the Save payload helper and the
// React state share one shape.
export interface SopEditorSettings {
  name: string;
  category: string;
  description: string;
  guidance: string;
  recommendedActions: string;
  disputeInstructions: string;
  useGpsControlDeviation: boolean;
  useDirectEmail: boolean;
  tripOverriding: boolean;
}

// Build the PATCH body for /api/error-types/:id. Sends the tree and the
// settings together in one call so the user's Save click is a single
// round-trip. Pulled out as a pure helper so the unit test can prove
// both halves land in the same payload without booting React or the
// network mutation.
export function buildSavePayload(
  tree: DecisionTree,
  settings: SopEditorSettings,
): UpdateErrorTypeBody {
  return {
    name: settings.name,
    category: settings.category,
    description: settings.description,
    guidance: settings.guidance,
    recommendedActions: settings.recommendedActions,
    disputeInstructions: settings.disputeInstructions,
    useGpsControlDeviation: settings.useGpsControlDeviation,
    useDirectEmail: settings.useDirectEmail,
    tripOverriding: settings.tripOverriding,
    decisionTree: JSON.parse(
      JSON.stringify(tree),
    ) as UpdateErrorTypeBodyDecisionTree,
  };
}
