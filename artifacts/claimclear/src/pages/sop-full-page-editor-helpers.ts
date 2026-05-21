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
  validateAppliesPerInvoice,
  removeSubtree,
  deleteNodeWithReparent,
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
  selection: string | null | ReadonlySet<string>,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const flowNodes: Node<FlowNodeData>[] = [];
  const flowEdges: Edge[] = [];
  const isSelected = (id: string): boolean => {
    if (selection == null) return false;
    if (typeof selection === "string") return id === selection;
    return selection.has(id);
  };

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
        selected: isSelected(n.id),
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
          data: { parentId: n.id, optionIndex: idx, tone: "blue" },
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
          data: { parentId: n.id, optionIndex: idx, tone: "green" },
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

// Task #784 — parity helpers restored after Task #780 retired the modal
// editor. These power: add/delete branches, delete-node-with-reparent,
// orphan re-attach, and per-node instruction image. All pure +
// immutable so the React state setter picks up the new tree.

export function addOption(tree: DecisionTree, nodeId: string): DecisionTree {
  const node = tree.nodes.find((n) => n.id === nodeId);
  if (!node) return tree;
  return updateNode(tree, nodeId, {
    options: [...node.options, { label: `Option ${node.options.length + 1}` }],
  });
}

// Remove a single branch. If the branch pointed at a child sub-tree
// AND that sub-tree has no other parent in the graph, the sub-tree
// is also pruned to keep the tree tidy. Callers may opt to NOT prune
// (detach only) by using `setOption(tree, nodeId, idx, { childId: undefined })`.
export function removeOption(
  tree: DecisionTree,
  nodeId: string,
  idx: number,
): DecisionTree {
  const node = tree.nodes.find((n) => n.id === nodeId);
  if (!node) return tree;
  const opt = node.options[idx];
  if (!opt) return tree;
  const childId = opt.childId;
  const nextOptions = node.options.filter((_, i) => i !== idx);
  let nextNodes = tree.nodes.map((n) =>
    n.id === nodeId ? { ...n, options: nextOptions } : n,
  );
  // Only prune the sub-tree if no other option anywhere still points
  // at the removed child — otherwise we'd silently delete a shared
  // sub-tree that the rest of the graph depends on.
  if (childId) {
    const stillReferenced = nextNodes.some((n) =>
      n.options.some((o) => o.childId === childId),
    );
    if (!stillReferenced) {
      nextNodes = removeSubtree(nextNodes, childId);
    }
  }
  return { ...tree, nodes: nextNodes };
}

// Question nodes that exist in the tree but no parent references them
// AND are not the root. These are eligible re-attach targets for any
// empty branch slot. (Re-attach restores the parity gap from the old
// modal editor where Detach was reversible.)
export function getOrphanQuestionIds(tree: DecisionTree): string[] {
  const referenced = new Set<string>();
  for (const n of tree.nodes) {
    for (const o of n.options) {
      if (o.childId) referenced.add(o.childId);
    }
  }
  return tree.nodes
    .filter((n) => n.id !== tree.rootId && !referenced.has(n.id))
    .map((n) => n.id);
}

// Delete an entire question node. Root cannot be deleted. Children
// of the deleted node are re-parented onto the deleted node's parent
// when there's room; if not, the whole sub-tree is pruned (the leaf
// path). The caller is expected to confirm with the user before
// invoking when descendantCount > 1.
export function deleteNode(
  tree: DecisionTree,
  nodeId: string,
): { tree: DecisionTree; ok: boolean; reason?: string } {
  const result = deleteNodeWithReparent(tree, nodeId);
  if (result.ok) {
    // Drop the deleted node itself; deleteNodeWithReparent rewires the
    // parent's options but leaves the node row in `.nodes`. Final
    // cleanup also prunes any descendants that became unreachable.
    let nodes = result.tree.nodes.filter((n) => n.id !== nodeId);
    const reachable = new Set<string>();
    const stack = [result.tree.rootId];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const node = nodes.find((n) => n.id === id);
      if (!node) continue;
      for (const o of node.options) {
        if (o.childId) stack.push(o.childId);
      }
    }
    nodes = nodes.filter((n) => reachable.has(n.id));
    return { tree: { ...result.tree, nodes }, ok: true };
  }
  // Fall back: if the only obstacle was "no_available_slot" (orphans
  // had nowhere to land on the parent), just prune the sub-tree.
  if (result.reason === "no_available_slot") {
    const parent = tree.nodes.find((n) =>
      n.options.some((o) => o.childId === nodeId),
    );
    if (!parent) return { tree, ok: false, reason: "no_parent" };
    const detached: DecisionTree = {
      ...tree,
      nodes: tree.nodes.map((n) =>
        n.id === parent.id
          ? {
              ...n,
              options: n.options.map((o) =>
                o.childId === nodeId ? { ...o, childId: undefined } : o,
              ),
            }
          : n,
      ),
    };
    return {
      tree: { ...detached, nodes: removeSubtree(detached.nodes, nodeId) },
      ok: true,
    };
  }
  return { tree, ok: false, reason: result.reason };
}

// Per-node instruction image. Stored on the node so the runner can
// surface it next to the question; persisted as a `/objects/…` path
// that the storage route serves back at upload time.
export function setInstructionImage(
  tree: DecisionTree,
  nodeId: string,
  imagePath: string | undefined,
): DecisionTree {
  return updateNode(tree, nodeId, {
    instructionImagePath: imagePath,
    // Clear any legacy URL field so the two never disagree.
    instructionImageUrl: imagePath ? undefined : undefined,
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

// Task #777 — bulk evidence-requirement append. Returns a fresh tree
// with the same evidence row (new opaque `key`, caller-supplied label,
// default `required: true`) appended to every node in `nodeIds`. Pure
// + immutable so the editor's setState() picks it up and the unit
// test can exercise it without React/xyflow.
export function addEvidenceReqToMany(
  tree: DecisionTree,
  nodeIds: ReadonlyArray<string> | ReadonlySet<string>,
  label: string,
): DecisionTree {
  const ids = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
  if (ids.size === 0) return tree;
  const trimmed = label.trim();
  if (!trimmed) return tree;
  // One synthetic key for the whole batch so the rows are
  // identifiable as a group later if we ever need that, but each row
  // is still a fresh object (immutability).
  const baseKey = `ev_${Date.now()}`;
  let counter = 0;
  return {
    ...tree,
    nodes: tree.nodes.map((n) => {
      if (!ids.has(n.id)) return n;
      const next: EvidenceReq = {
        key: `${baseKey}_${++counter}`,
        label: trimmed,
        required: true,
      };
      return {
        ...n,
        evidenceRequirements: [...(n.evidenceRequirements || []), next],
      };
    }),
  };
}

// Task #777 — bulk-flip the `appliesPerInvoice` flag. We can't just
// set it on every node: `validateAppliesPerInvoice` refuses any node
// that (when the flag is true) carries evidence/per-leg context on
// itself or on any immediate child. So we tentatively flip each id,
// re-run the validator on the candidate tree, and back out any node
// whose flip introduces a NEW violation (versus the pre-flip
// baseline — we don't want to "fix" existing bad states here, just
// avoid causing new ones). Returns `{ tree, skipped }` so the caller
// can toast the user about skipped nodes.
export function bulkSetAppliesPerInvoice(
  tree: DecisionTree,
  nodeIds: ReadonlyArray<string> | ReadonlySet<string>,
  value: boolean,
): { tree: DecisionTree; skipped: string[] } {
  const ids = nodeIds instanceof Set
    ? new Set(nodeIds)
    : new Set<string>(nodeIds);
  if (ids.size === 0) return { tree, skipped: [] };

  // Pre-existing violations on the un-touched tree — anything in here
  // is NOT our fault, so we don't count it as "skipped".
  const baselineKeys = new Set(
    validateAppliesPerInvoice(tree).map(
      (v) => `${v.nodeId}|${v.reason}|${v.offendingNodeId}`,
    ),
  );

  const skipped: string[] = [];
  const accepted = new Set<string>();
  for (const id of ids) {
    const candidate: DecisionTree = {
      ...tree,
      nodes: tree.nodes.map((n) =>
        n.id === id ? { ...n, appliesPerInvoice: value } : n,
      ),
    };
    if (value === false) {
      // Turning the flag OFF can never introduce a violation — the
      // validator only flags nodes with `appliesPerInvoice === true`.
      accepted.add(id);
      continue;
    }
    const candidateViolations = validateAppliesPerInvoice(candidate);
    const newViolation = candidateViolations.some(
      (v) =>
        v.nodeId === id &&
        !baselineKeys.has(`${v.nodeId}|${v.reason}|${v.offendingNodeId}`),
    );
    if (newViolation) skipped.push(id);
    else accepted.add(id);
  }

  if (accepted.size === 0) return { tree, skipped };

  return {
    tree: {
      ...tree,
      nodes: tree.nodes.map((n) =>
        accepted.has(n.id) ? { ...n, appliesPerInvoice: value } : n,
      ),
    },
    skipped,
  };
}

// Task #777 — per-node flip of `appliesPerInvoice` for a bulk
// selection. Each selected node is independently inverted (true ↔
// false / undefined). Any node whose flip would introduce a NEW
// `validateAppliesPerInvoice` violation (versus the un-touched tree)
// is skipped and surfaced via the returned `skipped` list. Built on
// `bulkSetAppliesPerInvoice` so the skip rules stay in one place.
export function bulkToggleAppliesPerInvoice(
  tree: DecisionTree,
  nodeIds: ReadonlyArray<string> | ReadonlySet<string>,
): { tree: DecisionTree; skipped: string[] } {
  const ids = nodeIds instanceof Set ? Array.from(nodeIds) : Array.from(nodeIds);
  if (ids.length === 0) return { tree, skipped: [] };
  // Partition by their current value so we can route through the
  // existing setter (which already validates the true direction and
  // short-circuits the false direction).
  const toTrue: string[] = [];
  const toFalse: string[] = [];
  for (const id of ids) {
    const cur = tree.nodes.find((n) => n.id === id);
    if (!cur) continue;
    if (cur.appliesPerInvoice === true) toFalse.push(id);
    else toTrue.push(id);
  }
  // Turning OFF can never introduce a violation; run it first so
  // turning ON afterwards sees the cleanest baseline (though the
  // validator only inspects nodes flagged true, so order is
  // semantically irrelevant — this is just defensive).
  let next = tree;
  if (toFalse.length > 0) {
    next = bulkSetAppliesPerInvoice(next, toFalse, false).tree;
  }
  let skipped: string[] = [];
  if (toTrue.length > 0) {
    const r = bulkSetAppliesPerInvoice(next, toTrue, true);
    next = r.tree;
    skipped = r.skipped;
  }
  return { tree: next, skipped };
}

// Task #778 — extract a sub-tree rooted at `nodeId` as a standalone
// `DecisionTree` (preserving node ids). Used by "Save sub-tree to
// library" so the saved payload only carries the descendants of the
// chosen node — not the entire SOP. Pure; ignores unreachable nodes.
export function extractSubTreeFromEditor(
  tree: DecisionTree,
  nodeId: string,
): DecisionTree {
  const reachable = new Set<string>();
  const stack: string[] = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    const node = tree.nodes.find((n) => n.id === id);
    if (!node) continue;
    reachable.add(id);
    for (const opt of node.options) {
      if (opt.childId) stack.push(opt.childId);
    }
  }
  return {
    rootId: nodeId,
    nodes: tree.nodes.filter((n) => reachable.has(n.id)),
  };
}

// Task #778 — deep-clone a sub-tree rooted at `nodeId` and remap every
// reachable node id to a freshly minted one. Returns `{ nodes, rootId }`
// where `nodes` are brand new objects (so editing them never mutates
// the source) and every internal `childId` pointer has been remapped
// to the corresponding clone. Used when inserting a library sub-tree
// into the editor so the inserted ids cannot collide with anything
// already in the tree.
export function cloneSubTreeWithFreshIds(
  tree: DecisionTree,
  nodeId: string,
): { nodes: TreeNode[]; rootId: string } {
  // Walk reachable ids first, mint a new id per old id, then rebuild
  // each node using the id map to remap childIds.
  const idMap = new Map<string, string>();
  const order: string[] = [];
  const stack: string[] = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (idMap.has(id)) continue;
    const src = tree.nodes.find((n) => n.id === id);
    if (!src) continue;
    idMap.set(id, generateNodeId());
    order.push(id);
    for (const opt of src.options) {
      if (opt.childId) stack.push(opt.childId);
    }
  }
  const nodes: TreeNode[] = order.map((oldId) => {
    const src = tree.nodes.find((n) => n.id === oldId)!;
    const cloned: TreeNode = {
      ...src,
      id: idMap.get(oldId)!,
      options: src.options.map((opt) => {
        const next: TreeOption = { ...opt };
        if (opt.childId) {
          // Defensive: if the childId is unreachable for some reason
          // (e.g. dangling pointer in the source), drop it so the
          // inserted clone doesn't point off into the live tree.
          const mapped = idMap.get(opt.childId);
          if (mapped) next.childId = mapped;
          else delete next.childId;
        }
        return next;
      }),
      // Evidence requirements get fresh keys so the new copies don't
      // collide with the source's keys if they ever end up in the same
      // tree (defensive — pure clone semantics).
      evidenceRequirements: src.evidenceRequirements
        ? src.evidenceRequirements.map((req, i) => ({
            ...req,
            key: `ev_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
          }))
        : undefined,
    };
    return cloned;
  });
  return { nodes, rootId: idMap.get(nodeId)! };
}

// Task #816 — Cross-SOP sub-tree copy/paste.
//
// `extractSubtree` returns a serializable payload `{ rootId, nodes }`
// containing only the selected node and its descendants. Used by the
// editor's "Copy sub-tree" gesture so an author can paste the branch
// into another SOP. Refuses to extract the tree's root — copying the
// root would be "copy the whole SOP", which the paste affordance
// (which only fills empty option slots) cannot accept. Returns null
// for missing nodes or for the root.
export function extractSubtree(
  tree: DecisionTree,
  nodeId: string,
): SubtreePayload | null {
  if (!tree || nodeId === tree.rootId) return null;
  const exists = tree.nodes.some((n) => n.id === nodeId);
  if (!exists) return null;
  const sub = extractSubTreeFromEditor(tree, nodeId);
  // JSON round-trip so the caller gets a freshly serializable payload
  // (no live refs into the editor's tree state).
  return JSON.parse(JSON.stringify(sub)) as SubtreePayload;
}

// `remapSubtreeIds` clones the payload, minting a fresh node id for
// every node and remapping every internal `childId` pointer to its
// clone. Evidence requirements also get fresh keys so they don't
// collide with the destination tree's list keys. Returns the cloned
// payload — the caller is responsible for splicing it into a
// destination tree.
export function remapSubtreeIds(payload: SubtreePayload): SubtreePayload {
  // Round-trip the payload through JSON first to defensively detach
  // from anything the caller still holds a reference to.
  const cloned = JSON.parse(JSON.stringify(payload)) as SubtreePayload;
  const fake: DecisionTree = { rootId: cloned.rootId, nodes: cloned.nodes };
  const { nodes, rootId } = cloneSubTreeWithFreshIds(fake, cloned.rootId);
  return { rootId, nodes };
}

// Walk the payload and drop any cross-reference that the destination
// workspace doesn't have. Currently scrubs:
//   - `evidenceTypeId` on each evidence requirement (if not present in
//     `availableEvidenceTypeIds`).
//   - `sopLibraryItemId` on each node (if the field exists and the id
//     is not present in `availableSopLibraryItemIds`).
// Returns the scrubbed payload plus a summary describing what was
// dropped so the caller can surface it in a toast.
export interface DroppedRefsSummary {
  evidenceTypeIds: number[];
  sopLibraryItemIds: Array<string | number>;
}
export function scrubSubtreeRefs(
  payload: SubtreePayload,
  available: {
    evidenceTypeIds?: ReadonlySet<number> | ReadonlyArray<number>;
    sopLibraryItemIds?: ReadonlySet<string | number> | ReadonlyArray<string | number>;
  },
): { payload: SubtreePayload; dropped: DroppedRefsSummary } {
  // When a key is absent we treat the destination as "accepts any
  // value" (no scrub). Only when the caller explicitly passes an
  // allowlist do we drop references not present in it. This avoids
  // wiping every cross-ref when the caller doesn't yet know the
  // destination's available ids.
  const evSet: ReadonlySet<number> | null =
    available.evidenceTypeIds === undefined
      ? null
      : available.evidenceTypeIds instanceof Set
        ? available.evidenceTypeIds
        : new Set<number>(available.evidenceTypeIds);
  const libSet: ReadonlySet<string | number> | null =
    available.sopLibraryItemIds === undefined
      ? null
      : available.sopLibraryItemIds instanceof Set
        ? available.sopLibraryItemIds
        : new Set<string | number>(available.sopLibraryItemIds);
  const dropped: DroppedRefsSummary = {
    evidenceTypeIds: [],
    sopLibraryItemIds: [],
  };
  const nodes = payload.nodes.map((n) => {
    let next: TreeNode = n;
    // sopLibraryItemId lives off-schema today but the task spec calls
    // it out, so we scrub the field defensively if a future
    // payload carries it.
    const libRef = (n as unknown as Record<string, unknown>).sopLibraryItemId;
    if (libSet && libRef != null && (typeof libRef === "string" || typeof libRef === "number")) {
      if (!libSet.has(libRef)) {
        dropped.sopLibraryItemIds.push(libRef);
        const stripped = { ...(n as unknown as Record<string, unknown>) };
        delete stripped.sopLibraryItemId;
        next = stripped as unknown as TreeNode;
      }
    }
    if (next.evidenceRequirements && next.evidenceRequirements.length > 0) {
      const reqs = next.evidenceRequirements.map((r) => {
        if (evSet && typeof r.evidenceTypeId === "number" && !evSet.has(r.evidenceTypeId)) {
          dropped.evidenceTypeIds.push(r.evidenceTypeId);
          const { evidenceTypeId: _drop, ...rest } = r;
          void _drop;
          return rest as EvidenceReq;
        }
        return r;
      });
      next = { ...next, evidenceRequirements: reqs };
    }
    return next;
  });
  return { payload: { rootId: payload.rootId, nodes }, dropped };
}

export interface SubtreePayload {
  rootId: string;
  nodes: TreeNode[];
}

// Splice a remapped sub-tree payload into `tree` and attach the
// payload's root to `parentId`.options[optionIndex] as the new
// `childId`. The caller is responsible for having already remapped
// the payload (via `remapSubtreeIds`) so there are no id collisions.
export function pasteSubtreeIntoOption(
  tree: DecisionTree,
  parentId: string,
  optionIndex: number,
  remapped: SubtreePayload,
): DecisionTree {
  const parent = tree.nodes.find((n) => n.id === parentId);
  if (!parent) return tree;
  if (optionIndex < 0 || optionIndex >= parent.options.length) return tree;
  // Defensive: refuse to overwrite a non-empty option slot. The UI
  // only surfaces Paste on empty slots, but the helper is a public
  // surface and must not silently clobber an attached child or
  // terminal outcome if called from a future entry point.
  const target = parent.options[optionIndex];
  if (target.childId || target.outcomeType) return tree;
  return {
    ...tree,
    nodes: [
      ...tree.nodes.map((n) =>
        n.id === parentId
          ? {
              ...n,
              options: n.options.map((o, i) =>
                i === optionIndex
                  ? {
                      label: o.label,
                      childId: remapped.rootId,
                    }
                  : o,
              ),
            }
          : n,
      ),
      ...remapped.nodes,
    ],
  };
}

// Enumerate every empty option slot (no childId AND no outcomeType) in
// the tree. Used by the top-level Paste picker when the user hits ⌘V
// with nothing selected.
export interface EmptyOptionSlot {
  parentId: string;
  optionIndex: number;
  label: string;
  parentQuestion: string;
}
export function getEmptyOptionSlots(tree: DecisionTree): EmptyOptionSlot[] {
  const out: EmptyOptionSlot[] = [];
  for (const node of tree.nodes) {
    node.options.forEach((opt, idx) => {
      if (!opt.childId && !opt.outcomeType) {
        out.push({
          parentId: node.id,
          optionIndex: idx,
          label: opt.label || `Option ${idx + 1}`,
          parentQuestion: node.question || "(untitled)",
        });
      }
    });
  }
  return out;
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

// Task #779 — deep structural equality on two DecisionTree values.
// Used by the History drawer to compute `hasUnsavedChanges` against
// the loaded errorType snapshot so the Restore confirmation can warn
// when an unsaved edit is about to be discarded. Pure + small so the
// unit test can exercise it directly. Accepts `null`/`undefined`
// because the editor's tree state is nullable while loading.
export function treesEqual(
  a: DecisionTree | null | undefined,
  b: DecisionTree | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Task #779 — deep equality for the SopEditorSettings struct. Mirrors
// `treesEqual` so the History drawer's "unsaved changes" warning can
// detect drift in either half (tree or settings) without falling back
// to the noisier `dirty` bit. Pure JSON compare — every field on
// SopEditorSettings is a primitive (string/boolean), so JSON.stringify
// is total and order-stable.
export function settingsEqual(
  a: SopEditorSettings | null | undefined,
  b: SopEditorSettings | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
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
  // Task #784 — last plain-text SOP description the author pasted into
  // the AI Builder. Round-trips through the editor's settings state so
  // the AI Builder panel can rehydrate on next open.
  sourceSopText: string;
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
    sourceSopText: settings.sourceSopText,
    decisionTree: JSON.parse(
      JSON.stringify(tree),
    ) as UpdateErrorTypeBodyDecisionTree,
  };
}

// ---------------------------------------------------------------------------
// Task #817 — Smarter AI Builder helpers. Direct-fetch wrappers around
// the four new /api/error-types/ai-builder/* endpoints. Match the
// existing pattern (simplifyTextField, buildTreeFromText) — no codegen,
// so the helpers stay co-located with their UI consumers and are easy
// to unit-test by injecting a fake fetch.
// ---------------------------------------------------------------------------

export interface SuggestedNextQuestion {
  question: string;
  rationale: string;
}

export async function suggestNextQuestion(args: {
  parentQuestion: string;
  optionLabel: string;
  contextPath: string[];
  sourceSopText?: string;
  errorTypeName?: string;
}): Promise<SuggestedNextQuestion[]> {
  const res = await fetch("/api/error-types/ai-builder/suggest-next", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const data: { candidates?: SuggestedNextQuestion[] } = await res.json();
  return (data.candidates || []).filter(
    (c) => c && typeof c.question === "string" && c.question.trim().length > 0,
  );
}

export interface AmbiguityFlag {
  nodeId: string;
  severity: "low" | "medium" | "high";
  reason: string;
  suggestedRewrite: string;
}

export async function scanAmbiguity(args: {
  tree: DecisionTree;
  errorTypeName?: string;
}): Promise<AmbiguityFlag[]> {
  const res = await fetch("/api/error-types/ai-builder/scan-ambiguity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const data: { flags?: AmbiguityFlag[] } = await res.json();
  return data.flags || [];
}

export async function ingestDocument(file: File): Promise<string> {
  const allowed = new Set(["application/pdf", "image/png", "image/jpeg"]);
  if (!allowed.has(file.type)) {
    throw new Error("Only PDF, PNG, or JPEG files are supported");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("File too large (max 10MB)");
  }
  const buf = await file.arrayBuffer();
  const res = await fetch("/api/error-types/ai-builder/ingest-document", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: buf,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const data: { extractedText?: string } = await res.json();
  if (!data.extractedText) {
    throw new Error("No text extracted from document");
  }
  return data.extractedText;
}

export interface CoverageUnmatchedSample {
  claimId: number;
  invoiceNumber: string | null;
  finalNodeId: string | null;
  unmatchedAtOption?: string;
  finalQuestion: string;
}

export interface CoverageReport {
  totalChecked: number;
  sampleSize: number;
  terminated: number;
  abandoned: number;
  unmatched: number;
  unmatchedSamples: CoverageUnmatchedSample[];
}

export async function checkCoverage(args: {
  errorTypeId: number;
  tree: DecisionTree;
  sampleSize?: number;
}): Promise<CoverageReport> {
  const res = await fetch("/api/error-types/ai-builder/coverage-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as CoverageReport;
}

export interface BranchSuggestion {
  branchLabel: string;
  nextQuestion?: string;
  outcomeType?: "portal_dispute" | "hold" | "cannot_dispute" | "non_issue" | "internal";
  outcomeLabel?: string;
}

export async function suggestBranchFromClaim(args: {
  finalQuestion: string;
  unmatchedAnswer: string;
  errorTypeName?: string;
  sourceSopText?: string;
}): Promise<BranchSuggestion> {
  const res = await fetch("/api/error-types/ai-builder/suggest-branch-from-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as BranchSuggestion;
}

// Task #817 — create a brand-new child question node and wire the
// given (parentId, optionIdx) slot to it. Used by the Inspector's
// "Suggest next question" popover after the author picks one of the
// AI candidates, and by the coverage check's "Attach suggested fix"
// flow. Pure + immutable — caller threads the returned tree through
// setTree().
export function attachChildQuestion(
  tree: DecisionTree,
  parentId: string,
  optionIdx: number,
  question: string,
): { tree: DecisionTree; newId: string } {
  const parent = tree.nodes.find((n) => n.id === parentId);
  if (!parent || optionIdx < 0 || optionIdx >= parent.options.length) {
    return { tree, newId: "" };
  }
  const newId = `n_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const newNode = {
    id: newId,
    question,
    options: [{ label: "Yes" }, { label: "No" }],
  };
  const nextTree: DecisionTree = {
    ...tree,
    nodes: [
      ...tree.nodes.map((n) =>
        n.id === parentId
          ? {
              ...n,
              options: n.options.map((o, i) =>
                i === optionIdx
                  ? { label: o.label, childId: newId }
                  : o,
              ),
            }
          : n,
      ),
      newNode,
    ],
  };
  return { tree: nextTree, newId };
}

// Task #817 — add a brand-new branch (option slot) to a node and
// wire it to either a new child question or a terminal outcome.
// Used by the coverage check's "Attach suggested fix" flow when the
// AI suggests a missing branch on an existing node.
export function addBranchWithSuggestion(
  tree: DecisionTree,
  parentId: string,
  branchLabel: string,
  next:
    | { nextQuestion: string }
    | {
        outcomeType:
          | "portal_dispute"
          | "hold"
          | "cannot_dispute"
          | "non_issue"
          | "internal";
        outcomeLabel: string;
      },
): { tree: DecisionTree; newId?: string } {
  const parent = tree.nodes.find((n) => n.id === parentId);
  if (!parent) return { tree };
  if ("outcomeType" in next) {
    const nextTree: DecisionTree = {
      ...tree,
      nodes: tree.nodes.map((n) =>
        n.id === parentId
          ? {
              ...n,
              options: [
                ...n.options,
                {
                  label: branchLabel,
                  outcomeType: next.outcomeType,
                  outcomeLabel: next.outcomeLabel,
                },
              ],
            }
          : n,
      ),
    };
    return { tree: nextTree };
  }
  const newId = `n_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const newNode = {
    id: newId,
    question: next.nextQuestion,
    options: [{ label: "Yes" }, { label: "No" }],
  };
  const nextTree: DecisionTree = {
    ...tree,
    nodes: [
      ...tree.nodes.map((n) =>
        n.id === parentId
          ? {
              ...n,
              options: [...n.options, { label: branchLabel, childId: newId }],
            }
          : n,
      ),
      newNode,
    ],
  };
  return { tree: nextTree, newId };
}
