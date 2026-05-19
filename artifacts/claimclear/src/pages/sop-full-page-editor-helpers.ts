// Pure helpers for SopFullPageEditor. Lives in its own file so the
// unit test can import them WITHOUT pulling in `@xyflow/react` (which
// transitively imports a `.css` file that node's loader can't parse).
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
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
