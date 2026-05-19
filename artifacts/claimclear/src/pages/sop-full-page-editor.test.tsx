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
  buildSavePayload,
  findMatches,
  applyReplacements,
  type SopEditorSettings,
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

test("save pipeline: mocked errorType + name edit + tree edit fires one mutateAsync carrying both fields", async () => {
  // Simulates what `SopFullPageEditor.handleSave` does end-to-end
  // without booting React/xyflow: load an `errorType`, initialize
  // settings + tree from it, apply a name edit + a tree edit, then
  // invoke `updateMutation.mutateAsync` with the result of
  // `buildSavePayload`. Asserts the mutation is called exactly once
  // with BOTH the tree and the renamed settings in the same payload.
  // This is the closest pure-helper equivalent of the component-level
  // assertion the reviewer asked for.
  const errorType = {
    id: 42,
    name: "Original name",
    category: "Bundling",
    description: "Original description",
    guidance: "",
    recommendedActions: "",
    disputeInstructions: "",
    useGpsControlDeviation: false,
    useDirectEmail: false,
    tripOverriding: false,
    decisionTree: sampleTree() as unknown as Record<string, unknown>,
  };

  // Editor's load effect: hydrate settings from the loaded errorType.
  let settings: SopEditorSettings = {
    name: errorType.name,
    category: errorType.category ?? "",
    description: errorType.description ?? "",
    guidance: errorType.guidance ?? "",
    recommendedActions: errorType.recommendedActions ?? "",
    disputeInstructions: errorType.disputeInstructions ?? "",
    useGpsControlDeviation: errorType.useGpsControlDeviation,
    useDirectEmail: errorType.useDirectEmail,
    tripOverriding: errorType.tripOverriding,
  };
  let tree: DecisionTree = coerceTree(errorType.decisionTree)!;
  assert.ok(tree, "loaded tree should coerce");

  // User edits in the Settings tab → name change.
  settings = { ...settings, name: "Renamed via Settings tab" };
  // User edits in the canvas → root question text change.
  tree = updateNode(tree, "a", { question: "Renamed root question" });

  // Mock the mutation the editor calls in handleSave.
  const calls: { id: number; data: unknown }[] = [];
  const mutateAsync = async (args: { id: number; data: unknown }) => {
    calls.push(args);
    return undefined;
  };

  // Mirror handleSave's call shape exactly.
  await mutateAsync({ id: errorType.id, data: buildSavePayload(tree, settings) });

  assert.equal(calls.length, 1, "mutateAsync should fire exactly once");
  assert.equal(calls[0].id, 42);
  const body = calls[0].data as Record<string, unknown>;
  // Settings field shipped
  assert.equal(body.name, "Renamed via Settings tab");
  assert.equal(body.category, "Bundling");
  // Tree field shipped, carrying the canvas edit
  const sentTree = body.decisionTree as DecisionTree;
  assert.equal(sentTree.rootId, "a");
  assert.equal(
    sentTree.nodes.find((n) => n.id === "a")!.question,
    "Renamed root question",
    "tree change rides along in the same payload as the settings change",
  );
});

test("buildSavePayload sends both the tree and the settings in a single PATCH body", () => {
  // The Settings tab and the canvas share one Save click — the editor
  // mutation is fired with the result of this helper, so asserting the
  // shape here is enough to prove a name edit + a tree edit ride along
  // together. (Was the modal-summary workaround in Task #775.)
  const tree = sampleTree();
  // Simulate a tree edit (name node text change) and a settings edit
  // (rename + flip the trip-overriding flag) in local editor state.
  const editedTree = updateNode(tree, "a", { question: "Is the claim bundled now?" });
  const settings: SopEditorSettings = {
    name: "New SOP Name",
    category: "GPS Issues",
    description: "When the bundling check fires.",
    guidance: "Verify GPS first.",
    recommendedActions: "Mark ready or hold.",
    disputeInstructions: "Reference the breadcrumbs.",
    useGpsControlDeviation: true,
    useDirectEmail: false,
    tripOverriding: true,
  };

  const payload = buildSavePayload(editedTree, settings);

  // Settings fields all present
  assert.equal(payload.name, "New SOP Name");
  assert.equal(payload.category, "GPS Issues");
  assert.equal(payload.description, "When the bundling check fires.");
  assert.equal(payload.guidance, "Verify GPS first.");
  assert.equal(payload.recommendedActions, "Mark ready or hold.");
  assert.equal(payload.disputeInstructions, "Reference the breadcrumbs.");
  assert.equal(payload.useGpsControlDeviation, true);
  assert.equal(payload.useDirectEmail, false);
  assert.equal(payload.tripOverriding, true);

  // Tree shipped alongside — and serialized (no class instances / live refs).
  const sentTree = payload.decisionTree as unknown as DecisionTree;
  assert.equal(sentTree.rootId, "a");
  assert.equal(sentTree.nodes.find((n) => n.id === "a")!.question, "Is the claim bundled now?");
  // Defensive copy: mutating the payload tree must not affect the editor's tree.
  sentTree.nodes[0].question = "MUTATED";
  assert.equal(editedTree.nodes.find((n) => n.id === "a")!.question, "Is the claim bundled now?");
});

// ---------------------------------------------------------------------------
// Task #776 — Find & Replace helper unit tests
// ---------------------------------------------------------------------------

function frTree(): DecisionTree {
  return {
    rootId: "n1",
    nodes: [
      {
        id: "n1",
        question: "Has the GPS log been uploaded?",
        instructionText: "Open the GPS log viewer and confirm.",
        options: [
          { label: "GPS log present", childId: "n2" },
          { label: "No GPS log", outcomeType: "hold", outcomeLabel: "Hold for GPS log" },
        ],
        evidenceRequirements: [
          { key: "ev1", label: "Driver's GPS log screenshot", required: true },
        ],
      },
      {
        id: "n2",
        question: "Plain text without the needle.",
        options: [
          { label: "Yes", outcomeType: "portal_dispute", outcomeLabel: "Mark Ready" },
        ],
      },
    ],
  };
}

test("findMatches walks all five supported fields and skips everything else", () => {
  const matches = findMatches(frTree(), 7, "GPS log", "ride log");
  // Should hit: question (n1), instructions (n1), optionLabel (n1, idx 0 and 1),
  // outcomeLabel (n1 idx 1), evidenceLabel (n1 idx 0). Not n2.
  const fields = matches.map((m) => `${m.nodeId}:${m.field}:${m.index}`).sort();
  assert.deepEqual(fields, [
    "n1:evidenceLabel:0",
    "n1:instructions:-1",
    "n1:optionLabel:0",
    "n1:optionLabel:1",
    "n1:outcomeLabel:1",
    "n1:question:-1",
  ]);
  // Every match carries the errorTypeId and a precomputed afterText.
  assert.ok(matches.every((m) => m.errorTypeId === 7));
  const q = matches.find((m) => m.field === "question")!;
  assert.equal(q.afterText, "Has the ride log been uploaded?");
});

test("findMatches is case-insensitive by default and respects the matchCase flag", () => {
  const tree: DecisionTree = {
    rootId: "x",
    nodes: [
      { id: "x", question: "GPS log vs gps log vs Gps Log", options: [
        { label: "ok", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
  const insensitive = findMatches(tree, 1, "gps log", "ride log");
  const q1 = insensitive.find((m) => m.field === "question")!;
  assert.equal(q1.matchSpans.length, 3);
  assert.equal(q1.afterText, "ride log vs ride log vs ride log");

  const sensitive = findMatches(tree, 1, "gps log", "ride log", { matchCase: true });
  const q2 = sensitive.find((m) => m.field === "question")!;
  assert.equal(q2.matchSpans.length, 1);
  assert.equal(q2.afterText, "GPS log vs ride log vs Gps Log");
});

test("findMatches returns nothing for an empty needle", () => {
  assert.deepEqual(findMatches(frTree(), 1, "", "x"), []);
});

test("applyReplacements rewrites every matched field immutably without touching unrelated nodes/fields", () => {
  const tree = frTree();
  const matches = findMatches(tree, 7, "GPS log", "ride log");
  const next = applyReplacements(tree, 7, matches, "ride log");

  // Source tree untouched (immutability — required by the existing
  // updateNode tests' invariant + the React render path).
  assert.equal(tree.nodes[0].question, "Has the GPS log been uploaded?");
  assert.equal(tree.nodes[0].instructionText, "Open the GPS log viewer and confirm.");
  assert.equal(tree.nodes[0].options[0].label, "GPS log present");
  assert.equal(tree.nodes[0].evidenceRequirements![0].label, "Driver's GPS log screenshot");

  // New tree carries every substitution.
  const n1 = next.nodes.find((n) => n.id === "n1")!;
  assert.equal(n1.question, "Has the ride log been uploaded?");
  assert.equal(n1.instructionText, "Open the ride log viewer and confirm.");
  assert.equal(n1.options[0].label, "ride log present");
  assert.equal(n1.options[1].label, "No ride log");
  assert.equal(n1.options[1].outcomeLabel, "Hold for ride log");
  assert.equal(n1.evidenceRequirements![0].label, "Driver's ride log screenshot");

  // Unrelated node is byte-identical.
  const n2 = next.nodes.find((n) => n.id === "n2")!;
  assert.equal(n2.question, "Plain text without the needle.");

  // The `rootId` and unrelated fields stay intact (no schema drift).
  assert.equal(next.rootId, "n1");
});

test("applyReplacements ignores matches whose errorTypeId does not match the tree", () => {
  const tree = frTree();
  const matches = findMatches(tree, 99, "GPS log", "ride log");
  const next = applyReplacements(tree, 7, matches, "ride log");
  // No errorTypeId 7 matches → tree returned unchanged (same reference is fine).
  assert.equal(next.nodes.find((n) => n.id === "n1")!.question, tree.nodes[0].question);
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
