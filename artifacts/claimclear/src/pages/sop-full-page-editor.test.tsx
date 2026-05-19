import { test } from "node:test";
import assert from "node:assert/strict";
import type { DecisionTree } from "@/components/decision-tree/types";

// Import the pure helpers directly. They live in a sibling file so this
// test doesn't pull in `@xyflow/react` (which transitively imports a
// `.css` file node's loader can't parse) — matches the project's
// existing pattern of unit-testing pure tree helpers without jsdom.
import {
  treeToFlow,
  insertBetween,
  updateNode,
  addEvidenceReq,
} from "./sop-full-page-editor-helpers";

function sampleTree(): DecisionTree {
  return {
    rootId: "a",
    nodes: [
      { id: "a", question: "Is the claim bundled?", options: [
        { label: "Yes", childId: "b" },
        { label: "No",  outcomeType: "non_issue", outcomeLabel: "Drop" },
      ] },
      { id: "b", question: "Is there a companion claim?", options: [
        { label: "Found", outcomeType: "portal_dispute", outcomeLabel: "Ready" },
        { label: "None",  outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
}

test("treeToFlow produces one node per question + one synthetic terminal per outcome", () => {
  const { nodes, edges } = treeToFlow(sampleTree(), null);
  // 2 question nodes + 3 outcome terminals (one per outcome option)
  assert.equal(nodes.filter(n => n.type === "question").length, 2);
  assert.equal(nodes.filter(n => n.type === "outcome").length, 3);
  // 4 edges total: a→b, a→term, b→term, b→term
  assert.equal(edges.length, 4);
  // Edge from a to b should carry the "Yes" branch label
  const yesEdge = edges.find(e => e.source === "a" && e.target === "b");
  assert.ok(yesEdge, "expected an edge a→b");
  assert.equal(yesEdge!.label, "Yes");
});

test("treeToFlow runs dagre layout so every node gets a non-zero position", () => {
  const { nodes } = treeToFlow(sampleTree(), null);
  // Root sits at the top; at least one descendant must be below it.
  const root = nodes.find(n => n.id === "a")!;
  const child = nodes.find(n => n.id === "b")!;
  assert.ok(child.position.y > root.position.y, "child should be laid out below parent");
});

test("treeToFlow flags the selected question for visual highlight", () => {
  const { nodes } = treeToFlow(sampleTree(), "b");
  const a = nodes.find(n => n.id === "a")!;
  const b = nodes.find(n => n.id === "b")!;
  assert.equal((a.data as { selected?: boolean }).selected, false);
  assert.equal((b.data as { selected?: boolean }).selected, true);
});

test("insertBetween splices a new node onto the existing edge and rewires the parent", () => {
  const t = sampleTree();
  const { tree: next, newId } = insertBetween(t, "a", 0); // insert on a→b "Yes" edge
  // New node exists, root now points at it, new node points at the original target.
  assert.ok(next.nodes.find(n => n.id === newId), "new node should be added");
  const a = next.nodes.find(n => n.id === "a")!;
  assert.equal(a.options[0].childId, newId, "parent should now point at the inserted node");
  const inserted = next.nodes.find(n => n.id === newId)!;
  assert.equal(inserted.options[0].childId, "b", "inserted node should forward to original child");
  // Original child is untouched
  const b = next.nodes.find(n => n.id === "b")!;
  assert.equal(b.options.length, 2);
});

test("insertBetween on a terminal-branch edge forwards the outcome onto the new node", () => {
  const t = sampleTree();
  const { tree: next, newId } = insertBetween(t, "a", 1); // a's "No" → Drop outcome
  const a = next.nodes.find(n => n.id === "a")!;
  assert.equal(a.options[1].childId, newId, "parent slot should now point at new node");
  const inserted = next.nodes.find(n => n.id === newId)!;
  assert.equal(inserted.options[0].outcomeType, "non_issue", "outcome should be forwarded to new node");
});

test("updateNode patches without mutating the source tree", () => {
  const t = sampleTree();
  const next = updateNode(t, "a", { question: "New question text" });
  assert.equal(next.nodes.find(n => n.id === "a")!.question, "New question text");
  // Source untouched (immutability — needed so React re-renders only what changed)
  assert.equal(t.nodes.find(n => n.id === "a")!.question, "Is the claim bundled?");
});

test("addEvidenceReq appends a default evidence req carrying a label so it passes the save guard", () => {
  const t = sampleTree();
  const next = addEvidenceReq(t, "b");
  const reqs = next.nodes.find(n => n.id === "b")!.evidenceRequirements!;
  assert.equal(reqs.length, 1);
  assert.ok(reqs[0].label.trim().length > 0, "new evidence must have a non-empty label");
  assert.ok(reqs[0].key.startsWith("ev_"), "key uses the editor's synthetic prefix");
});
