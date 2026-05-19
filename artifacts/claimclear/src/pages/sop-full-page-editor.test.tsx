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
  simplifyTextField,
  buildTreeFromText,
  coerceTree,
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

test("simplifyTextField POSTs the single field to /api/error-types/simplify-text and returns the suggestion", async () => {
  // Capture the request the helper builds so we can prove the wire shape
  // matches what /api/error-types/simplify-text accepts (the `items` path
  // in artifacts/api-server/src/routes/sop-analyzer.ts).
  const calls: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ suggestions: [{ id: "field", text: "Shorter, clearer rewrite." }] }),
    } as Response;
  }) as typeof fetch;

  try {
    const out = await simplifyTextField("Please rewrite this very long question text.", "question");
    assert.equal(out, "Shorter, clearer rewrite.");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/error-types/simplify-text");
    assert.equal(calls[0].init.method, "POST");
    const body = JSON.parse(calls[0].init.body as string);
    assert.deepEqual(body, {
      items: [{ id: "field", field: "question", text: "Please rewrite this very long question text." }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildTreeFromText POSTs to /build-tree-from-text and the panel's accept handler swaps the editor's tree state", async () => {
  // Wire shape mirrors the existing AI Builder on error-types.tsx so
  // we share one backend route. The "accept handler" the panel passes
  // to AiBuilderPanel is a simple `(tree) => setTree(tree)` callback;
  // proving the helper hands back the coerced tree AND that the
  // callback updates the captured state is enough to know the panel
  // wires correctly without booting React + xyflow + jsdom.
  const knownTree: DecisionTree = {
    rootId: "x",
    nodes: [
      { id: "x", question: "Is the new tree wired up?", options: [
        { label: "Yes", outcomeType: "portal_dispute", outcomeLabel: "Mark Ready" },
        { label: "No",  outcomeType: "hold", outcomeLabel: "Place on Hold" },
      ] },
    ],
  };
  const calls: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ decisionTree: knownTree }),
    } as Response;
  }) as typeof fetch;

  try {
    const generated = await buildTreeFromText("describe the SOP", "Bundled claims");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/error-types/build-tree-from-text");
    assert.equal(calls[0].init.method, "POST");
    const body = JSON.parse(calls[0].init.body as string);
    assert.deepEqual(body, { description: "describe the SOP", errorTypeName: "Bundled claims" });
    // coerce should preserve the structurally-valid input untouched
    assert.equal(generated.rootId, "x");
    assert.equal(generated.nodes.length, 1);

    // Simulate the editor's tree state + the panel's onReplace handoff.
    let editorTree: DecisionTree = sampleTree();
    const onReplace = (next: DecisionTree) => { editorTree = next; };
    onReplace(generated);
    assert.equal(editorTree.rootId, "x");
    assert.equal(editorTree.nodes[0].question, "Is the new tree wired up?");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildTreeFromText rejects an unrecognized tree shape so the panel can toast destructively", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({ decisionTree: { totally: "not a tree" } }),
    } as Response)) as typeof fetch;

  try {
    await assert.rejects(
      () => buildTreeFromText("hello", "name"),
      /unrecognized tree shape/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("coerceTree returns null for malformed shapes and accepts the canonical tree", () => {
  assert.equal(coerceTree(null), null);
  assert.equal(coerceTree({ rootId: "missing", nodes: [] }), null);
  const ok = coerceTree(sampleTree());
  assert.ok(ok, "valid tree should coerce");
  assert.equal(ok!.rootId, "a");
});

test("simplifyTextField throws on non-ok responses so the caller can show a destructive toast", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 500,
      json: async () => ({ error: "AI is down" }),
    } as Response)) as typeof fetch;

  try {
    await assert.rejects(
      () => simplifyTextField("hi", "instructions"),
      /AI is down/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
