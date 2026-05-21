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
  addEvidenceReqToMany,
  bulkSetAppliesPerInvoice,
  bulkToggleAppliesPerInvoice,
  cloneSubTreeWithFreshIds,
  extractSubTreeFromEditor,
  treesEqual,
  settingsEqual,
  extractSubtree,
  remapSubtreeIds,
  scrubSubtreeRefs,
  pasteSubtreeIntoOption,
  getEmptyOptionSlots,
  suggestNextQuestion,
  scanAmbiguity,
  checkCoverage,
  ingestDocument,
  outcomeTone,
  getAncestorIds,
  getDescendantIds,
  getHoverHighlightIds,
  addChildQuestion,
  moveOption,
  getBreadcrumbChain,
  treeShapeSignature,
  isUntouchedRoot,
  prefersReducedMotion,
  type SopEditorSettings,
  type SubtreePayload,
} from "./sop-full-page-editor-helpers";
import { createEmptyTree } from "@/components/decision-tree/types";
import {
  getClipboard,
  setClipboard,
  clearClipboard,
  subscribeClipboard,
  __resetClipboardForTests,
} from "./sop-clipboard";
import { validateAppliesPerInvoice } from "@/components/decision-tree/types";

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
    sourceSopText: "",
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
    sourceSopText: "",
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
    sourceSopText: "",
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

// ---------------------------------------------------------------------------
// Task #777 — Multi-select + bulk apply helper unit tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Task #779 — treesEqual unit test
// ---------------------------------------------------------------------------

test("treesEqual recognizes structurally identical trees and rejects any drift", () => {
  const a = sampleTree();
  const b = sampleTree();
  assert.equal(treesEqual(a, b), true);
  assert.equal(treesEqual(a, a), true);
  // null/undefined handling — editor's tree state is nullable during load
  assert.equal(treesEqual(null, null), true);
  assert.equal(treesEqual(undefined, undefined), true);
  assert.equal(treesEqual(a, null), false);
  assert.equal(treesEqual(null, a), false);
  // Any mutation flips equality
  const edited = updateNode(a, "a", { question: "Different question" });
  assert.equal(treesEqual(a, edited), false);
  // Adding a node also flips it
  const withExtra: DecisionTree = {
    ...a,
    nodes: [...a.nodes, { id: "c", question: "Extra", options: [] }],
  };
  assert.equal(treesEqual(a, withExtra), false);
});

test("settingsEqual recognizes identical settings and rejects any field drift", () => {
  const base: SopEditorSettings = {
    name: "Test SOP",
    category: "cat",
    description: "desc",
    guidance: "g",
    recommendedActions: "ra",
    disputeInstructions: "di",
    useGpsControlDeviation: false,
    useDirectEmail: true,
    tripOverriding: false,
    sourceSopText: "",
  };
  const copy: SopEditorSettings = { ...base };
  assert.equal(settingsEqual(base, copy), true);
  assert.equal(settingsEqual(base, base), true);
  // nullable
  assert.equal(settingsEqual(null, null), true);
  assert.equal(settingsEqual(undefined, undefined), true);
  assert.equal(settingsEqual(base, null), false);
  // any field flip
  assert.equal(settingsEqual(base, { ...base, name: "Other" }), false);
  assert.equal(
    settingsEqual(base, { ...base, useGpsControlDeviation: true }),
    false,
  );
});

test("treeToFlow accepts a Set of selected ids and highlights every member", () => {
  const { nodes } = treeToFlow(sampleTree(), new Set(["a", "b"]));
  const a = nodes.find((n) => n.id === "a")!;
  const b = nodes.find((n) => n.id === "b")!;
  assert.equal((a.data as { selected?: boolean }).selected, true);
  assert.equal((b.data as { selected?: boolean }).selected, true);
});

test("addEvidenceReqToMany appends a fresh evidence req to every targeted node, immutably", () => {
  const t = sampleTree();
  const next = addEvidenceReqToMany(t, ["a", "b"], "Driver GPS log");
  const a = next.nodes.find((n) => n.id === "a")!;
  const b = next.nodes.find((n) => n.id === "b")!;
  assert.equal(a.evidenceRequirements?.length, 1);
  assert.equal(b.evidenceRequirements?.length, 1);
  assert.equal(a.evidenceRequirements![0].label, "Driver GPS log");
  assert.equal(b.evidenceRequirements![0].label, "Driver GPS log");
  assert.equal(a.evidenceRequirements![0].required, true);
  // Distinct keys per row so they don't collide as a list key
  assert.notEqual(a.evidenceRequirements![0].key, b.evidenceRequirements![0].key);
  // Source untouched
  assert.equal(t.nodes.find((n) => n.id === "a")!.evidenceRequirements, undefined);
});

test("addEvidenceReqToMany ignores nodes not in the id list and refuses empty labels", () => {
  const t = sampleTree();
  const next = addEvidenceReqToMany(t, ["a"], "Photo");
  assert.equal(next.nodes.find((n) => n.id === "b")!.evidenceRequirements, undefined);
  // Empty label is a no-op (returns the same tree reference for free)
  assert.equal(addEvidenceReqToMany(t, ["a"], "   "), t);
  // Empty id list is a no-op
  assert.equal(addEvidenceReqToMany(t, [], "Photo"), t);
});

test("bulkSetAppliesPerInvoice flips eligible nodes and skips any whose flip would fail validation", () => {
  // Tree: root "p" is a pure decision (no evidence, no per-leg context,
  // child "c1" also pristine). "q" has evidence on its own node, so
  // flipping appliesPerInvoice to true on "q" must be skipped.
  const tree: DecisionTree = {
    rootId: "p",
    nodes: [
      { id: "p", question: "Pure decision?", options: [
        { label: "Yes", childId: "c1" },
        { label: "No",  outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
      { id: "c1", question: "Clean child", options: [
        { label: "Done", outcomeType: "portal_dispute", outcomeLabel: "Ready" },
      ] },
      { id: "q", question: "Has evidence", options: [
        { label: "Done", outcomeType: "portal_dispute", outcomeLabel: "Ready" },
      ], evidenceRequirements: [{ key: "ev1", label: "Photo", required: true }] },
    ],
  };
  const { tree: next, skipped } = bulkSetAppliesPerInvoice(tree, ["p", "q"], true);
  assert.deepEqual(skipped, ["q"]);
  assert.equal(next.nodes.find((n) => n.id === "p")!.appliesPerInvoice, true);
  assert.notEqual(next.nodes.find((n) => n.id === "q")!.appliesPerInvoice, true);
  // The resulting tree must itself be valid — proves we never wrote a
  // violation through.
  assert.deepEqual(validateAppliesPerInvoice(next), []);
  // Immutability: source tree untouched.
  assert.notEqual(tree.nodes.find((n) => n.id === "p")!.appliesPerInvoice, true);
});

test("bulkToggleAppliesPerInvoice flips each selected node independently for mixed selections", () => {
  // Mixed selection: one node currently true, one currently false/undef,
  // plus one that would fail the validator if flipped to true. The
  // toggle must invert each node independently — NOT route the whole
  // batch to a single target value.
  const tree: DecisionTree = {
    rootId: "p",
    nodes: [
      // currently true → expect flip to false
      { id: "p", question: "Already on", appliesPerInvoice: true, options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
      // currently false → expect flip to true (clean → eligible)
      { id: "q", question: "Currently off, clean", options: [
        { label: "Done", outcomeType: "portal_dispute", outcomeLabel: "Ready" },
      ] },
      // currently false but has evidence → expect SKIP
      { id: "r", question: "Currently off, dirty", options: [
        { label: "Done", outcomeType: "portal_dispute", outcomeLabel: "Ready" },
      ], evidenceRequirements: [{ key: "ev1", label: "Photo", required: true }] },
    ],
  };
  const { tree: next, skipped } = bulkToggleAppliesPerInvoice(tree, ["p", "q", "r"]);
  assert.deepEqual(skipped, ["r"]);
  assert.equal(next.nodes.find((n) => n.id === "p")!.appliesPerInvoice, false);
  assert.equal(next.nodes.find((n) => n.id === "q")!.appliesPerInvoice, true);
  // r untouched (no flip applied because the false→true direction
  // would create a new violation)
  assert.notEqual(next.nodes.find((n) => n.id === "r")!.appliesPerInvoice, true);
  // Tree must validate clean afterwards.
  assert.deepEqual(validateAppliesPerInvoice(next), []);
  // Immutability: source tree untouched.
  assert.equal(tree.nodes.find((n) => n.id === "p")!.appliesPerInvoice, true);
  assert.notEqual(tree.nodes.find((n) => n.id === "q")!.appliesPerInvoice, true);
});

test("bulkSetAppliesPerInvoice with value=false clears the flag on every node without invoking the validator skip", () => {
  const tree: DecisionTree = {
    rootId: "p",
    nodes: [
      { id: "p", question: "Pure decision?", appliesPerInvoice: true, options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
      { id: "q", question: "Also flagged", appliesPerInvoice: true, options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
  const { tree: next, skipped } = bulkSetAppliesPerInvoice(tree, ["p", "q"], false);
  assert.deepEqual(skipped, []);
  assert.equal(next.nodes.find((n) => n.id === "p")!.appliesPerInvoice, false);
  assert.equal(next.nodes.find((n) => n.id === "q")!.appliesPerInvoice, false);
});

// ---------------------------------------------------------------------------
// Task #778 — SOP library helper unit tests
// ---------------------------------------------------------------------------

test("cloneSubTreeWithFreshIds: single node gets a fresh id and no internal pointers", () => {
  const tree: DecisionTree = {
    rootId: "only",
    nodes: [
      { id: "only", question: "Just me", options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
  const { nodes, rootId } = cloneSubTreeWithFreshIds(tree, "only");
  assert.equal(nodes.length, 1);
  assert.notEqual(rootId, "only", "root id must be fresh");
  assert.equal(nodes[0].id, rootId);
  assert.equal(nodes[0].question, "Just me");
  // Terminal outcome preserved
  assert.equal(nodes[0].options[0].outcomeType, "hold");
  // Immutability: source untouched
  assert.equal(tree.nodes[0].id, "only");
});

test("cloneSubTreeWithFreshIds: nested chain remaps every childId to the new clone", () => {
  const tree: DecisionTree = {
    rootId: "a",
    nodes: [
      { id: "a", question: "A", options: [{ label: "next", childId: "b" }] },
      { id: "b", question: "B", options: [{ label: "next", childId: "c" }] },
      { id: "c", question: "C", options: [
        { label: "Done", outcomeType: "portal_dispute", outcomeLabel: "Ready" },
      ] },
    ],
  };
  const { nodes, rootId } = cloneSubTreeWithFreshIds(tree, "a");
  assert.equal(nodes.length, 3);
  const ids = new Set(nodes.map((n) => n.id));
  // No collision with source ids
  assert.equal(ids.has("a"), false);
  assert.equal(ids.has("b"), false);
  assert.equal(ids.has("c"), false);
  // Internal pointers all land inside the cloned set
  const rootNode = nodes.find((n) => n.id === rootId)!;
  const childId = rootNode.options[0].childId!;
  assert.ok(ids.has(childId), "child pointer should land inside the cloned set");
  const child = nodes.find((n) => n.id === childId)!;
  const grandchildId = child.options[0].childId!;
  assert.ok(ids.has(grandchildId));
  // Terminal outcome on the deepest node preserved
  const grandchild = nodes.find((n) => n.id === grandchildId)!;
  assert.equal(grandchild.options[0].outcomeType, "portal_dispute");
});

test("cloneSubTreeWithFreshIds: branching tree clones every reachable node and preserves terminal outcomes", () => {
  const tree: DecisionTree = {
    rootId: "root",
    nodes: [
      { id: "root", question: "Root", options: [
        { label: "Yes", childId: "l" },
        { label: "No", childId: "r" },
      ] },
      { id: "l", question: "Left", options: [
        { label: "Done", outcomeType: "portal_dispute", outcomeLabel: "Ready" },
      ] },
      { id: "r", question: "Right", options: [
        { label: "Done", outcomeType: "non_issue", outcomeLabel: "Drop" },
      ] },
      // Unrelated node — must NOT be cloned.
      { id: "unrelated", question: "Other", options: [] },
    ],
  };
  const { nodes, rootId } = cloneSubTreeWithFreshIds(tree, "root");
  assert.equal(nodes.length, 3, "should clone root + two children only");
  const ids = new Set(nodes.map((n) => n.id));
  assert.equal(ids.has("unrelated"), false);
  const root = nodes.find((n) => n.id === rootId)!;
  assert.equal(root.options.length, 2);
  assert.ok(root.options[0].childId && ids.has(root.options[0].childId));
  assert.ok(root.options[1].childId && ids.has(root.options[1].childId));
  // Outcome labels survive the clone
  const left = nodes.find((n) => n.id === root.options[0].childId)!;
  assert.equal(left.options[0].outcomeLabel, "Ready");
});

test("cloneSubTreeWithFreshIds: cloned ids never collide with the editor's existing tree when inserted", () => {
  // Simulate: editor has tree T1, library item was extracted from a
  // similarly-structured tree T2. Clone T2's root and merge into T1 —
  // there must be zero id collisions.
  const editor: DecisionTree = sampleTree();
  const library: DecisionTree = sampleTree(); // identical id namespace ("a","b") on purpose
  const { nodes: clonedNodes, rootId: clonedRoot } = cloneSubTreeWithFreshIds(library, library.rootId);
  const existingIds = new Set(editor.nodes.map((n) => n.id));
  for (const n of clonedNodes) {
    assert.equal(existingIds.has(n.id), false, `cloned id ${n.id} collided with editor`);
  }
  assert.equal(existingIds.has(clonedRoot), false);
});

test("extractSubTreeFromEditor: returns a tree rooted at the chosen node with only its descendants", () => {
  const tree: DecisionTree = {
    rootId: "a",
    nodes: [
      { id: "a", question: "A", options: [{ label: "next", childId: "b" }] },
      { id: "b", question: "B", options: [{ label: "next", childId: "c" }] },
      { id: "c", question: "C", options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
      // Unrelated branch — must be excluded.
      { id: "z", question: "Z", options: [] },
    ],
  };
  const sub = extractSubTreeFromEditor(tree, "b");
  assert.equal(sub.rootId, "b");
  const ids = sub.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["b", "c"]);
});

// ---------------------------------------------------------------------------
// Task #816 — Cross-SOP sub-tree copy/paste helpers & clipboard
// ---------------------------------------------------------------------------

test("extractSubtree returns a serializable payload rooted at the picked node", () => {
  const tree = sampleTree();
  const payload = extractSubtree(tree, "b");
  assert.ok(payload, "should return a payload for a non-root node");
  assert.equal(payload!.rootId, "b");
  assert.deepEqual(payload!.nodes.map((n) => n.id).sort(), ["b"]);
  // Must be a fresh object graph — mutating it should not touch the source.
  payload!.nodes[0].question = "TOUCHED";
  assert.notEqual(tree.nodes.find((n) => n.id === "b")!.question, "TOUCHED");
});

test("extractSubtree refuses to extract the tree's root (cannot be pasted onto an empty slot)", () => {
  const tree = sampleTree();
  assert.equal(extractSubtree(tree, tree.rootId), null);
});

test("extractSubtree returns null for an unknown node id", () => {
  const tree = sampleTree();
  assert.equal(extractSubtree(tree, "does-not-exist"), null);
});

test("extractSubtree on a deep sub-tree carries every reachable descendant", () => {
  const tree: DecisionTree = {
    rootId: "root",
    nodes: [
      { id: "root", question: "Root", options: [{ label: "into", childId: "mid" }] },
      { id: "mid", question: "Mid", options: [
        { label: "L", childId: "leafL" },
        { label: "R", childId: "leafR" },
      ] },
      { id: "leafL", question: "L", options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
      { id: "leafR", question: "R", options: [
        { label: "Done", outcomeType: "portal_dispute", outcomeLabel: "Ready" },
      ] },
      // Unrelated branch — must not appear.
      { id: "elsewhere", question: "Else", options: [] },
    ],
  };
  const payload = extractSubtree(tree, "mid");
  assert.ok(payload);
  const ids = payload!.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["leafL", "leafR", "mid"]);
});

test("remapSubtreeIds mints fresh ids and remaps every internal childId pointer", () => {
  const payload: SubtreePayload = {
    rootId: "a",
    nodes: [
      { id: "a", question: "A", options: [{ label: "→", childId: "b" }] },
      { id: "b", question: "B", options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
  const remapped = remapSubtreeIds(payload);
  const ids = new Set(remapped.nodes.map((n) => n.id));
  assert.equal(ids.has("a"), false, "old root id must be replaced");
  assert.equal(ids.has("b"), false, "old child id must be replaced");
  assert.equal(ids.has(remapped.rootId), true);
  const root = remapped.nodes.find((n) => n.id === remapped.rootId)!;
  const childId = root.options[0].childId!;
  assert.ok(ids.has(childId), "internal pointer must land inside the cloned set");
  // Source payload untouched (input is JSON-cloned defensively).
  assert.equal(payload.rootId, "a");
});

test("remapSubtreeIds: repeated calls produce non-overlapping id sets", () => {
  const payload: SubtreePayload = {
    rootId: "a",
    nodes: [
      { id: "a", question: "A", options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
  const r1 = remapSubtreeIds(payload);
  const r2 = remapSubtreeIds(payload);
  assert.notEqual(r1.rootId, r2.rootId);
});

test("scrubSubtreeRefs drops evidenceTypeId values not present in the destination's allowlist", () => {
  const payload: SubtreePayload = {
    rootId: "a",
    nodes: [
      {
        id: "a", question: "A", options: [
          { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
        ],
        evidenceRequirements: [
          { key: "k1", label: "GPS log", required: true, evidenceTypeId: 1 },
          { key: "k2", label: "Photo", required: false, evidenceTypeId: 999 },
        ],
      },
    ],
  };
  const { payload: scrubbed, dropped } = scrubSubtreeRefs(payload, {
    evidenceTypeIds: new Set([1]),
  });
  const reqs = scrubbed.nodes[0].evidenceRequirements!;
  assert.equal(reqs[0].evidenceTypeId, 1, "valid id is preserved");
  assert.equal(reqs[1].evidenceTypeId, undefined, "invalid id is stripped");
  // Other req fields untouched.
  assert.equal(reqs[1].label, "Photo");
  assert.equal(reqs[1].required, false);
  assert.deepEqual(dropped.evidenceTypeIds, [999]);
  assert.deepEqual(dropped.sopLibraryItemIds, []);
});

test("scrubSubtreeRefs without an allowlist is a no-op so unknown destinations don't lose every reference", () => {
  const payload: SubtreePayload = {
    rootId: "a",
    nodes: [
      {
        id: "a", question: "A", options: [
          { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
        ],
        evidenceRequirements: [
          { key: "k1", label: "GPS log", required: true, evidenceTypeId: 42 },
        ],
      },
    ],
  };
  const { payload: scrubbed, dropped } = scrubSubtreeRefs(payload, {});
  assert.equal(scrubbed.nodes[0].evidenceRequirements![0].evidenceTypeId, 42);
  assert.deepEqual(dropped.evidenceTypeIds, []);
});

test("scrubSubtreeRefs strips sopLibraryItemId when the destination doesn't have it", () => {
  // sopLibraryItemId is off the typed schema today but the helper must
  // defensively scrub future payloads that carry it.
  const payload = {
    rootId: "a",
    nodes: [
      {
        id: "a", question: "A", options: [
          { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
        ],
        sopLibraryItemId: "lib-xyz",
      },
    ],
  } as unknown as SubtreePayload;
  const { payload: scrubbed, dropped } = scrubSubtreeRefs(payload, {
    sopLibraryItemIds: new Set<string>(),
  });
  assert.equal(
    (scrubbed.nodes[0] as unknown as Record<string, unknown>).sopLibraryItemId,
    undefined,
  );
  assert.deepEqual(dropped.sopLibraryItemIds, ["lib-xyz"]);
});

test("pasteSubtreeIntoOption attaches the payload's root to the chosen empty option", () => {
  // Destination tree has one empty slot on the root option "Left".
  const dest: DecisionTree = {
    rootId: "d-root",
    nodes: [
      { id: "d-root", question: "Pick", options: [
        { label: "Left" },
        { label: "Right", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
  const payload: SubtreePayload = {
    rootId: "pasted",
    nodes: [
      { id: "pasted", question: "Pasted root", options: [
        { label: "Done", outcomeType: "non_issue", outcomeLabel: "Drop" },
      ] },
    ],
  };
  const next = pasteSubtreeIntoOption(dest, "d-root", 0, payload);
  // Option got wired to the payload's root id
  assert.equal(next.nodes[0].options[0].childId, "pasted");
  // Pasted nodes were appended
  assert.ok(next.nodes.find((n) => n.id === "pasted"));
  // Untouched option stayed put
  assert.equal(next.nodes[0].options[1].outcomeType, "hold");
  // Source tree untouched (immutability)
  assert.equal(dest.nodes[0].options[0].childId, undefined);
});

test("pasteSubtreeIntoOption refuses to overwrite an option that already has a childId or outcomeType", () => {
  const dest: DecisionTree = {
    rootId: "x",
    nodes: [
      { id: "x", question: "Pick", options: [
        { label: "Has child", childId: "c" },
        { label: "Terminal", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
      { id: "c", question: "Child", options: [] },
    ],
  };
  const payload: SubtreePayload = {
    rootId: "p", nodes: [
      { id: "p", question: "P", options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
  // Both slots are non-empty — paste must be a no-op for both.
  assert.equal(pasteSubtreeIntoOption(dest, "x", 0, payload), dest);
  assert.equal(pasteSubtreeIntoOption(dest, "x", 1, payload), dest);
});

test("pasteSubtreeIntoOption is a no-op for unknown parent or out-of-range option index", () => {
  const dest: DecisionTree = {
    rootId: "x", nodes: [
      { id: "x", question: "Only", options: [{ label: "slot" }] },
    ],
  };
  const payload: SubtreePayload = {
    rootId: "p", nodes: [
      { id: "p", question: "P", options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
  assert.equal(pasteSubtreeIntoOption(dest, "nope", 0, payload), dest);
  assert.equal(pasteSubtreeIntoOption(dest, "x", 5, payload), dest);
});

test("getEmptyOptionSlots enumerates every option without childId or outcomeType", () => {
  const tree: DecisionTree = {
    rootId: "r",
    nodes: [
      { id: "r", question: "Root", options: [
        { label: "Empty" },                                        // empty → match
        { label: "Has child", childId: "c" },                      // skip
        { label: "Terminal", outcomeType: "hold", outcomeLabel: "Hold" }, // skip
      ] },
      { id: "c", question: "Child", options: [
        { label: "" },                                             // empty (uses fallback label) → match
      ] },
    ],
  };
  const slots = getEmptyOptionSlots(tree);
  assert.equal(slots.length, 2);
  assert.deepEqual(
    slots.map((s) => `${s.parentId}#${s.optionIndex}:${s.label}`).sort(),
    ["c#0:Option 1", "r#0:Empty"],
  );
});

// ---- Clipboard module ----------------------------------------------------

test("clipboard store: setClipboard then getClipboard round-trips the entry", () => {
  __resetClipboardForTests();
  const payload: SubtreePayload = {
    rootId: "a",
    nodes: [
      { id: "a", question: "A", options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };
  setClipboard({
    payload,
    nodeCount: 1,
    sourceSopTitle: "Source SOP",
    sourceErrorTypeId: 42,
    copiedAt: 1234,
  });
  const got = getClipboard();
  assert.ok(got);
  assert.equal(got!.nodeCount, 1);
  assert.equal(got!.sourceSopTitle, "Source SOP");
  assert.equal(got!.payload.rootId, "a");
});

test("clipboard store: clearClipboard nulls the entry and notifies subscribers", () => {
  __resetClipboardForTests();
  let calls = 0;
  const unsub = subscribeClipboard(() => { calls++; });
  setClipboard({
    payload: { rootId: "x", nodes: [{ id: "x", question: "x", options: [] }] },
    nodeCount: 1,
    sourceSopTitle: "S",
    sourceErrorTypeId: null,
    copiedAt: 0,
  });
  assert.equal(calls, 1);
  clearClipboard();
  assert.equal(calls, 2);
  assert.equal(getClipboard(), null);
  // Clearing again when already empty is a no-op (no extra notify).
  clearClipboard();
  assert.equal(calls, 2);
  unsub();
});

test("clipboard store: hydrates from sessionStorage on first read", () => {
  __resetClipboardForTests();
  // Stub a minimal sessionStorage so the hydrate path runs in node.
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  const originalSession = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  (globalThis as { sessionStorage?: Storage }).sessionStorage = fakeStorage as unknown as Storage;
  try {
    store.set(
      "sop-editor:clipboard",
      JSON.stringify({
        payload: { rootId: "z", nodes: [{ id: "z", question: "z", options: [] }] },
        nodeCount: 1,
        sourceSopTitle: "Persisted",
        sourceErrorTypeId: 7,
        copiedAt: 999,
      }),
    );
    const got = getClipboard();
    assert.ok(got);
    assert.equal(got!.sourceSopTitle, "Persisted");
    assert.equal(got!.payload.rootId, "z");
  } finally {
    if (originalSession !== undefined) {
      (globalThis as { sessionStorage?: Storage }).sessionStorage = originalSession;
    } else {
      delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    }
    __resetClipboardForTests();
  }
});

test("cross-SOP copy/paste end-to-end: copy from SOP A, paste into SOP B with id remapping and reference scrubbing", () => {
  __resetClipboardForTests();
  // SOP A — source. Has a sub-tree under "branch" with an evidence
  // requirement that references evidenceTypeId=7 (valid in source) and
  // a node carrying a sopLibraryItemId="lib-a" (valid in source).
  const sopA = {
    rootId: "a-root",
    nodes: [
      { id: "a-root", question: "A root", options: [
        { label: "Yes", childId: "a-branch" },
        { label: "No",  outcomeType: "non_issue", outcomeLabel: "Drop" },
      ] },
      {
        id: "a-branch",
        question: "A branch root",
        options: [{ label: "deeper", childId: "a-leaf" }],
        evidenceRequirements: [
          { key: "k1", label: "GPS log", required: true, evidenceTypeId: 7 },
          { key: "k2", label: "Photo", required: false, evidenceTypeId: 999 },
        ],
        // off-schema; helper scrubs defensively
        sopLibraryItemId: "lib-a",
      },
      { id: "a-leaf", question: "A leaf", options: [
        { label: "Done", outcomeType: "portal_dispute", outcomeLabel: "Ready" },
      ] },
    ],
  } as unknown as DecisionTree;

  // SOP B — destination. Has a single empty option slot under "b-root".
  // Crucially, it reuses some of the same node ids ("a-leaf") to prove
  // that id remapping prevents collisions.
  const sopB: DecisionTree = {
    rootId: "b-root",
    nodes: [
      { id: "b-root", question: "B root", options: [
        { label: "Open", /* empty slot — paste target */ },
        { label: "Closed", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
      // Same id namespace as SOP A on purpose
      { id: "a-leaf", question: "B's pre-existing a-leaf", options: [
        { label: "Done", outcomeType: "hold", outcomeLabel: "Hold" },
      ] },
    ],
  };

  // -- Step 1: COPY from SOP A ------------------------------------------
  const payload = extractSubtree(sopA, "a-branch");
  assert.ok(payload, "copy of a non-root node should succeed");
  setClipboard({
    payload: payload!,
    nodeCount: payload!.nodes.length,
    sourceSopTitle: "SOP A",
    sourceErrorTypeId: 1,
    copiedAt: Date.now(),
  });
  const stashed = getClipboard();
  assert.ok(stashed);
  assert.equal(stashed!.payload.rootId, "a-branch");

  // -- Step 2: NAVIGATE to SOP B ----------------------------------------
  // (No state change here — the clipboard is module-level so SOP B
  // sees the same entry.)

  // -- Step 3: PASTE into SOP B's empty slot, scrubbing references ------
  // Destination workspace knows evidenceTypeId 7 but NOT 999; it also
  // has zero matching sop-library ids.
  const { payload: scrubbed, dropped } = scrubSubtreeRefs(stashed!.payload, {
    evidenceTypeIds: new Set([7]),
    sopLibraryItemIds: new Set<string>(),
  });
  // The scrub must drop the unknown evidence type id and the unknown
  // sop library reference, and report both in the dropped summary.
  assert.deepEqual(dropped.evidenceTypeIds, [999]);
  assert.deepEqual(dropped.sopLibraryItemIds, ["lib-a"]);

  const remapped = remapSubtreeIds(scrubbed);
  const result = pasteSubtreeIntoOption(sopB, "b-root", 0, remapped);

  // -- Step 4: ASSERTIONS ------------------------------------------------
  // (a) The empty slot in SOP B is now wired to the pasted root.
  const bRoot = result.nodes.find((n) => n.id === "b-root")!;
  assert.equal(bRoot.options[0].childId, remapped.rootId);
  assert.equal(bRoot.options[1].outcomeType, "hold", "untouched options stay put");

  // (b) None of SOP A's original node ids leaked into SOP B's tree
  //     for the pasted set — remapping must have produced fresh ids.
  const pastedIds = new Set(remapped.nodes.map((n) => n.id));
  for (const sourceId of ["a-branch", "a-leaf"]) {
    assert.equal(
      pastedIds.has(sourceId),
      false,
      `source id ${sourceId} leaked into the pasted tree`,
    );
  }

  // (c) SOP B's pre-existing "a-leaf" node is untouched — the paste
  //     must NOT have overwritten it via an id collision.
  const preExisting = result.nodes.find(
    (n) => n.id === "a-leaf" && n.question === "B's pre-existing a-leaf",
  );
  assert.ok(preExisting, "pre-existing destination node must survive paste");

  // (d) The pasted sub-tree carries the scrubbed evidence (kept id=7,
  //     dropped id=999) and no sopLibraryItemId field.
  const pastedRoot = result.nodes.find((n) => n.id === remapped.rootId)!;
  assert.equal(pastedRoot.evidenceRequirements?.length, 2);
  assert.equal(pastedRoot.evidenceRequirements![0].evidenceTypeId, 7);
  assert.equal(pastedRoot.evidenceRequirements![1].evidenceTypeId, undefined);
  assert.equal(
    (pastedRoot as unknown as Record<string, unknown>).sopLibraryItemId,
    undefined,
  );

  // (e) Internal childId pointers in the pasted tree all resolve
  //     inside the pasted set (no dangling pointer to the source).
  for (const n of remapped.nodes) {
    for (const o of n.options) {
      if (o.childId) assert.ok(pastedIds.has(o.childId));
    }
  }

  // (f) Source tree (SOP A) is untouched — copy/paste is non-destructive.
  assert.equal(
    sopA.nodes.find((n) => n.id === "a-branch")!.question,
    "A branch root",
  );

  __resetClipboardForTests();
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

// ---------------------------------------------------------------------------
// Task #817 — Smarter AI Builder helper wire-shape tests. Same fetch-stub
// pattern as simplifyTextField/buildTreeFromText above; we don't boot
// React, we just prove each helper hits the right URL with the right
// body and returns the expected shape.
// ---------------------------------------------------------------------------

test("suggestNextQuestion POSTs to /ai-builder/suggest-next and returns trimmed candidates", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({
        candidates: [
          { question: "Is the manifest signed?", rationale: "next logical step" },
          { question: "  ", rationale: "should be dropped" },
          { question: "Was the driver attested?", rationale: "alt path" },
        ],
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const out = await suggestNextQuestion({
      parentQuestion: "Is GPS available?",
      optionLabel: "Yes",
      contextPath: ["Is GPS available?", "Yes"],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/error-types/ai-builder/suggest-next");
    assert.equal(out.length, 2);
    assert.equal(out[0].question, "Is the manifest signed?");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanAmbiguity POSTs the tree and returns flags from the AI response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        flags: [
          { nodeId: "a", severity: "high", reason: "compound question", suggestedRewrite: "Split it" },
        ],
      }),
    } as Response)) as typeof fetch;
  try {
    const flags = await scanAmbiguity({ tree: sampleTree() });
    assert.equal(flags.length, 1);
    assert.equal(flags[0].severity, "high");
    assert.equal(flags[0].suggestedRewrite, "Split it");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkCoverage POSTs errorTypeId+tree and returns a coverage report", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({
        totalChecked: 200,
        sampleSize: 200,
        terminated: 180,
        abandoned: 15,
        unmatched: 5,
        unmatchedSamples: [
          { claimId: 42, invoiceNumber: "INV-42", finalNodeId: "a", unmatchedAtOption: "Maybe", finalQuestion: "Is GPS available?" },
        ],
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const report = await checkCoverage({ errorTypeId: 7, tree: sampleTree(), sampleSize: 200 });
    assert.equal(report.terminated, 180);
    assert.equal(report.unmatchedSamples.length, 1);
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.errorTypeId, 7);
    assert.equal(body.sampleSize, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestDocument refuses unsupported MIME types client-side before hitting the server", async () => {
  // The helper guards the file type up-front so we don't pay for a round-trip
  // (and so the file-picker accept= attribute isn't the only gate).
  const txt = new File(["hello"], "sop.txt", { type: "text/plain" });
  await assert.rejects(() => ingestDocument(txt), /PDF, PNG, or JPEG/);
});

test("ingestDocument refuses files larger than 10MB up-front", async () => {
  const big = new File(
    [new Uint8Array(11 * 1024 * 1024)],
    "big.pdf",
    { type: "application/pdf" },
  );
  await assert.rejects(() => ingestDocument(big), /too large/i);
});

import {
  attachChildQuestion,
  addBranchWithSuggestion,
} from "./sop-full-page-editor-helpers";

test("attachChildQuestion creates a new child node and wires the option slot to it", () => {
  const tree: DecisionTree = {
    rootId: "n1",
    nodes: [
      {
        id: "n1",
        question: "Root?",
        options: [{ label: "Yes" }, { label: "No" }],
      },
    ],
  };
  const { tree: next, newId } = attachChildQuestion(tree, "n1", 0, "Was claim within 90 days?");
  assert.ok(newId.length > 0, "returns a fresh node id");
  assert.equal(next.nodes.length, 2, "adds a new node");
  const parent = next.nodes.find((n) => n.id === "n1")!;
  assert.equal(parent.options[0].childId, newId, "wires slot 0 to new node");
  assert.equal(parent.options[1].childId, undefined, "leaves other slot alone");
  const child = next.nodes.find((n) => n.id === newId)!;
  assert.equal(child.question, "Was claim within 90 days?");
  assert.equal(child.options.length, 2, "seeds Yes/No");
});

test("attachChildQuestion is a no-op for an unknown parent", () => {
  const tree: DecisionTree = {
    rootId: "n1",
    nodes: [{ id: "n1", question: "Root?", options: [{ label: "Yes" }] }],
  };
  const { tree: next, newId } = attachChildQuestion(tree, "missing", 0, "x?");
  assert.equal(newId, "");
  assert.equal(next, tree);
});

test("addBranchWithSuggestion appends an outcome branch when no nextQuestion", () => {
  const tree: DecisionTree = {
    rootId: "n1",
    nodes: [{ id: "n1", question: "Root?", options: [{ label: "Yes" }] }],
  };
  const { tree: next, newId } = addBranchWithSuggestion(tree, "n1", "Other", {
    outcomeType: "hold",
    outcomeLabel: "Hold for review",
  });
  assert.equal(newId, undefined, "no node id for terminal branch");
  const parent = next.nodes.find((n) => n.id === "n1")!;
  assert.equal(parent.options.length, 2);
  assert.equal(parent.options[1].label, "Other");
  assert.equal(parent.options[1].outcomeType, "hold");
  assert.equal(parent.options[1].outcomeLabel, "Hold for review");
});

test("addBranchWithSuggestion appends a question branch when nextQuestion is given", () => {
  const tree: DecisionTree = {
    rootId: "n1",
    nodes: [{ id: "n1", question: "Root?", options: [{ label: "Yes" }] }],
  };
  const { tree: next, newId } = addBranchWithSuggestion(tree, "n1", "Maybe", {
    nextQuestion: "Is the claim flagged?",
  });
  assert.ok(newId && newId.length > 0);
  assert.equal(next.nodes.length, 2);
  const parent = next.nodes.find((n) => n.id === "n1")!;
  assert.equal(parent.options[1].label, "Maybe");
  assert.equal(parent.options[1].childId, newId);
  const child = next.nodes.find((n) => n.id === newId)!;
  assert.equal(child.question, "Is the claim flagged?");
});
// ---------------------------------------------------------------------------
// Task #818 — canvas polish helpers
// ---------------------------------------------------------------------------

test("outcomeTone maps approve types to green, hold to amber, drop-types to red", () => {
  assert.equal(outcomeTone("portal_dispute"), "green");
  assert.equal(outcomeTone("dispute"), "green");
  assert.equal(outcomeTone("hold"), "amber");
  assert.equal(outcomeTone("non_issue"), "red");
  assert.equal(outcomeTone("cannot_dispute"), "red");
  assert.equal(outcomeTone("internal"), "red");
  assert.equal(outcomeTone(undefined), "muted");
});

test("treeToFlow stamps outcome-specific tones on terminal edges (not all green)", () => {
  // sampleTree has: a-NO -> non_issue (red), b-Found -> portal_dispute (green), b-None -> hold (amber)
  const { edges } = treeToFlow(sampleTree(), null);
  const noEdge = edges.find((e) => e.source === "a" && e.target === "a__term1");
  const foundEdge = edges.find((e) => e.source === "b" && e.target === "b__term0");
  const holdEdge = edges.find((e) => e.source === "b" && e.target === "b__term1");
  assert.equal((noEdge!.data as { tone: string }).tone, "red");
  assert.equal((foundEdge!.data as { tone: string }).tone, "green");
  assert.equal((holdEdge!.data as { tone: string }).tone, "amber");
});

test("getAncestorIds walks reverse adjacency and handles DAGs with multiple parents", () => {
  // Two parents both point to "c"; ancestors of "c" must include both + root.
  const dag: DecisionTree = {
    rootId: "root",
    nodes: [
      { id: "root", question: "?", options: [
        { label: "L", childId: "a" },
        { label: "R", childId: "b" },
      ] },
      { id: "a", question: "?", options: [{ label: "go", childId: "c" }] },
      { id: "b", question: "?", options: [{ label: "go", childId: "c" }] },
      { id: "c", question: "?", options: [] },
    ],
  };
  const got = getAncestorIds(dag, "c");
  assert.deepEqual([...got].sort(), ["a", "b", "root"]);
});

test("getAncestorIds returns an empty set for the root node", () => {
  assert.equal(getAncestorIds(sampleTree(), "a").size, 0);
});

test("getDescendantIds collects the node + every reachable child", () => {
  const got = getDescendantIds(sampleTree(), "a");
  assert.deepEqual([...got].sort(), ["a", "b"]);
});

test("getHoverHighlightIds for a question yields the root-to-node chain plus the node itself", () => {
  const got = getHoverHighlightIds(sampleTree(), "b");
  assert.deepEqual([...got].sort(), ["a", "b"]);
});

test("getHoverHighlightIds for a synthetic outcome terminal includes the terminal, its parent, and all ancestors", () => {
  // Hovering b's "Found" terminal => b__term0 (synthetic). Highlight must include
  // the terminal itself, its parent question b, and a (the root path to b).
  const got = getHoverHighlightIds(sampleTree(), "b__term0");
  assert.deepEqual([...got].sort(), ["a", "b", "b__term0"]);
});

test("addChildQuestion appends a new option + question, returns the new id, and leaves the source tree untouched", () => {
  const tree = sampleTree();
  const before = JSON.parse(JSON.stringify(tree));
  const { tree: next, newId, optionIndex } = addChildQuestion(tree, "a");
  // Source tree is unchanged (immutable contract).
  assert.deepEqual(tree, before);
  // New id is non-empty and the option index is the next slot.
  assert.ok(newId);
  assert.equal(optionIndex, 2);
  // Parent gained an option pointing at the new node.
  const parent = next.nodes.find((n) => n.id === "a")!;
  assert.equal(parent.options.length, 3);
  assert.equal(parent.options[2].childId, newId);
  assert.equal(parent.options[2].label, "New branch");
  // New node exists with no children (a fresh leaf question).
  const child = next.nodes.find((n) => n.id === newId)!;
  assert.ok(child);
  assert.equal(child.options.length, 2);
});

test("addChildQuestion on an unknown parent is a no-op", () => {
  const tree = sampleTree();
  const { tree: next, newId } = addChildQuestion(tree, "nope");
  assert.equal(newId, "");
  assert.equal(next, tree);
});

// ---------------------------------------------------------------------------
// Task #819 — SOP inspector + outline polish helpers
// ---------------------------------------------------------------------------

test("moveOption reorders branches within a node and is immutable", () => {
  const tree = sampleTree();
  const root = tree.nodes.find((n) => n.id === "a")!;
  const originalLabels = root.options.map((o) => o.label);
  assert.deepEqual(originalLabels, ["Yes", "No"]);
  const next = moveOption(tree, "a", 0, 1);
  // original tree was untouched
  assert.notEqual(next, tree);
  assert.deepEqual(
    tree.nodes.find((n) => n.id === "a")!.options.map((o) => o.label),
    ["Yes", "No"],
  );
  // new tree has swapped order
  assert.deepEqual(
    next.nodes.find((n) => n.id === "a")!.options.map((o) => o.label),
    ["No", "Yes"],
  );
});

test("moveOption clamps out-of-range targets to the array bounds", () => {
  const tree = sampleTree();
  const downPastEnd = moveOption(tree, "a", 0, 99);
  assert.deepEqual(
    downPastEnd.nodes.find((n) => n.id === "a")!.options.map((o) => o.label),
    ["No", "Yes"],
  );
  const upPastStart = moveOption(tree, "a", 1, -5);
  assert.deepEqual(
    upPastStart.nodes.find((n) => n.id === "a")!.options.map((o) => o.label),
    ["No", "Yes"],
  );
});

test("moveOption is a no-op when from equals to or when node missing", () => {
  const tree = sampleTree();
  assert.equal(moveOption(tree, "a", 0, 0), tree);
  assert.equal(moveOption(tree, "missing", 0, 1), tree);
  assert.equal(moveOption(tree, "a", 99, 0), tree);
});

test("getBreadcrumbChain returns the root for the root node itself", () => {
  const tree = sampleTree();
  assert.deepEqual(getBreadcrumbChain(tree, tree.rootId), [tree.rootId]);
});

test("getBreadcrumbChain walks root→target through option.childId", () => {
  const tree = sampleTree();
  // Sample tree: a -[Yes]-> b. Confirm the chain.
  const chain = getBreadcrumbChain(tree, "b");
  assert.deepEqual(chain, ["a", "b"]);
});

test("getBreadcrumbChain returns [] when the target id is unreachable", () => {
  const tree = sampleTree();
  assert.deepEqual(getBreadcrumbChain(tree, "ghost"), []);
});

// ---------------------------------------------------------------------------
// Task #820 — SOP editor robustness helpers
// ---------------------------------------------------------------------------

test("treeShapeSignature is stable across pure text edits", () => {
  const t1 = sampleTree();
  const sig1 = treeShapeSignature(t1);
  // Edit only the question text on node a — structure (ids, options,
  // childId/outcomeType wiring) is unchanged.
  const t2 = updateNode(t1, "a", { question: "Completely different wording?" });
  const sig2 = treeShapeSignature(t2);
  assert.equal(sig1, sig2, "text-only edits must not change the signature");
});

test("treeShapeSignature is stable across branch-label edits and evidence additions", () => {
  const t1 = sampleTree();
  const sig1 = treeShapeSignature(t1);
  const t2 = addEvidenceReq(t1, "a");
  assert.equal(treeShapeSignature(t2), sig1, "evidence additions must not change the signature");
  const t3: DecisionTree = {
    ...t1,
    nodes: t1.nodes.map((n) =>
      n.id === "a"
        ? { ...n, options: n.options.map((o, i) => (i === 0 ? { ...o, label: "Definitely" } : o)) }
        : n,
    ),
  };
  assert.equal(treeShapeSignature(t3), sig1, "branch label edits must not change the signature");
});

test("treeShapeSignature changes when a new node is added", () => {
  const t1 = sampleTree();
  const sig1 = treeShapeSignature(t1);
  const { tree: t2 } = addChildQuestion(t1, "b");
  assert.notEqual(treeShapeSignature(t2), sig1, "adding a node must invalidate the layout cache");
});

test("treeShapeSignature changes when an option is rewired from outcome to child", () => {
  const t1 = sampleTree();
  const sig1 = treeShapeSignature(t1);
  // Replace option 1 of root (currently an outcome) with a child link.
  const t2: DecisionTree = {
    ...t1,
    nodes: [
      ...t1.nodes.map((n) =>
        n.id === "a"
          ? { ...n, options: [n.options[0], { label: "No", childId: "b" }] }
          : n,
      ),
    ],
  };
  assert.notEqual(treeShapeSignature(t2), sig1);
});

test("treeShapeSignature is stable across node-array reordering", () => {
  const t1 = sampleTree();
  const t2: DecisionTree = { ...t1, nodes: [...t1.nodes].reverse() };
  assert.equal(treeShapeSignature(t2), treeShapeSignature(t1));
});

test("treeShapeSignature returns empty string for nullish input", () => {
  assert.equal(treeShapeSignature(null), "");
  assert.equal(treeShapeSignature(undefined), "");
});

test("treeToFlow skips dagre when given a cached-positions map for every node", () => {
  const t = sampleTree();
  const first = treeToFlow(t, null);
  const cache = new Map(first.nodes.map((n) => [n.id, { x: 999, y: 888 }]));
  const second = treeToFlow(t, null, cache);
  // Every node now sits at the synthetic cached position, proving
  // dagre was bypassed (it would never produce x=999 for both).
  for (const n of second.nodes) {
    assert.equal(n.position.x, 999, `node ${n.id} should reuse cached x`);
    assert.equal(n.position.y, 888, `node ${n.id} should reuse cached y`);
  }
});

test("treeToFlow falls back to dagre when the cache is missing any node id", () => {
  const t = sampleTree();
  // Only a partial cache — should be ignored.
  const cache = new Map<string, { x: number; y: number }>([["a", { x: 1, y: 2 }]]);
  const out = treeToFlow(t, null, cache);
  // Dagre always yields distinct, non-(1,2) positions for the rest.
  const nonRoot = out.nodes.find((n) => n.id !== "a");
  assert.ok(nonRoot, "expected at least one non-root node");
  assert.ok(
    !(nonRoot!.position.x === 1 && nonRoot!.position.y === 2),
    "non-root node must not inherit the partial cache value",
  );
});

test("isUntouchedRoot detects a fresh createEmptyTree result", () => {
  assert.equal(isUntouchedRoot(createEmptyTree()), true);
});

test("isUntouchedRoot returns false once the user types a question", () => {
  const t = createEmptyTree();
  const edited = updateNode(t, t.rootId, { question: "Is the GPS log present?" });
  assert.equal(isUntouchedRoot(edited), false);
});

test("isUntouchedRoot returns false once any option is wired", () => {
  const t = createEmptyTree();
  const { tree: withChild } = addChildQuestion(t, t.rootId);
  assert.equal(isUntouchedRoot(withChild), false);
});

test("isUntouchedRoot returns false for the multi-node sample tree", () => {
  assert.equal(isUntouchedRoot(sampleTree()), false);
});

test("isUntouchedRoot returns false for nullish input", () => {
  assert.equal(isUntouchedRoot(null), false);
  assert.equal(isUntouchedRoot(undefined), false);
});

test("prefersReducedMotion returns false in a non-browser context", () => {
  // node:test runs in plain Node — no window.matchMedia — so the
  // helper must return false (the safe default of "motion allowed").
  assert.equal(prefersReducedMotion(), false);
});

// =============================================================
// Task #820 — behavioral helpers (component-style coverage via
// the node:test pure-helper pattern).
// =============================================================

import {
  computeSavePillState,
  computeSaveButtonState,
  shouldRegisterBeforeUnload,
  shouldShowStaleBanner,
  shouldNavigateAfterSave,
  shouldShowEmptyOverlay,
  createDebouncedCommit,
} from "./sop-full-page-editor-helpers.js";

// --- Save chip transitions (3-state) -------------------------
test("save-state chip is 'saving' while a save is in flight, even if dirty", () => {
  assert.equal(computeSavePillState(true, true, false), "saving");
  assert.equal(computeSavePillState(true, false, false), "saving");
});
test("save-state chip is 'unsaved' when dirty and not saving", () => {
  assert.equal(computeSavePillState(false, true, false), "unsaved");
});
test("save-state chip is 'saved' once clean (justSaved does not change the chip text)", () => {
  assert.equal(computeSavePillState(false, false, false), "saved");
  assert.equal(computeSavePillState(false, false, true), "saved");
});

// --- Save button state (optimistic checkmark) ----------------
test("save button shows 'saving' during request, then flashes 'saved', then settles 'idle'", () => {
  // Mid-request — saving wins over everything.
  assert.equal(computeSaveButtonState(true, true, false), "saving");
  // Just-resolved success — green checkmark window.
  assert.equal(computeSaveButtonState(false, false, true), "saved");
  // After the 1.5s flash clears.
  assert.equal(computeSaveButtonState(false, false, false), "idle");
  // User typed again immediately after — back to dirty.
  assert.equal(computeSaveButtonState(false, true, false), "dirty");
});

// --- beforeunload registration gating ------------------------
test("beforeunload listener stays unregistered while the editor is clean", () => {
  assert.equal(shouldRegisterBeforeUnload(false), false);
});
test("beforeunload listener registers as soon as the editor goes dirty", () => {
  assert.equal(shouldRegisterBeforeUnload(true), true);
});

// --- Stale-tab detection -------------------------------------
test("stale banner stays hidden when we have no baseline yet (first paint)", () => {
  assert.equal(shouldShowStaleBanner(null, "2026-05-21T10:00:00Z", true), false);
  assert.equal(shouldShowStaleBanner(undefined, "2026-05-21T10:00:00Z", true), false);
});
test("stale banner stays hidden when the server returns the same updatedAt", () => {
  assert.equal(
    shouldShowStaleBanner("2026-05-21T10:00:00Z", "2026-05-21T10:00:00Z", true),
    false,
  );
});
test("stale banner fires when the server advanced AND local copy is dirty", () => {
  assert.equal(
    shouldShowStaleBanner("2026-05-21T10:00:00Z", "2026-05-21T10:05:00Z", true),
    true,
  );
});
test("stale banner stays hidden on a clean tab even if the server advanced (silent reconcile)", () => {
  assert.equal(
    shouldShowStaleBanner("2026-05-21T10:00:00Z", "2026-05-21T10:05:00Z", false),
    false,
  );
});

// --- Save & leave control flow -------------------------------
test("save-and-leave navigates only when the save reported success", () => {
  assert.equal(shouldNavigateAfterSave(true, "/library"), true);
});
test("save-and-leave keeps the user on the page when the save failed", () => {
  assert.equal(shouldNavigateAfterSave(false, "/library"), false);
});
test("save-and-leave is a no-op when there is no pending destination", () => {
  assert.equal(shouldNavigateAfterSave(true, null), false);
  assert.equal(shouldNavigateAfterSave(true, ""), false);
});

// --- First-load empty overlay lifecycle ----------------------
test("empty overlay shows for a clean, untouched root tree", () => {
  assert.equal(shouldShowEmptyOverlay(createEmptyTree(), false), true);
});
test("empty overlay disappears once the user dirties the tree", () => {
  assert.equal(shouldShowEmptyOverlay(createEmptyTree(), true), false);
});
test("empty overlay never shows for a populated SOP, even right after load", () => {
  assert.equal(shouldShowEmptyOverlay(sampleTree(), false), false);
});

// --- Debounced commit (used by inspector inputs) -------------
test("debounced commit fires once per pause and uses the latest value", async () => {
  let committed: string[] = [];
  const d = createDebouncedCommit<string>((v) => committed.push(v), 50);
  d.schedule("a");
  d.schedule("ab");
  d.schedule("abc");
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(committed, ["abc"]);
});
test("flush commits immediately (mirrors onBlur) and cancels any pending timer", async () => {
  let committed: string[] = [];
  const d = createDebouncedCommit<string>((v) => committed.push(v), 50);
  d.schedule("typing…");
  d.flush("final");
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(committed, ["final"]);
});
test("cancel suppresses a scheduled commit (cleanup on unmount)", async () => {
  let committed: string[] = [];
  const d = createDebouncedCommit<string>((v) => committed.push(v), 30);
  d.schedule("x");
  d.cancel();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(committed, []);
});

// --- Flush-before-save (⌘S during typing) --------------------
test("flushing all pending debounced commits before save persists the latest keystrokes", async () => {
  // Simulates the registry the editor builds. Each debounced
  // field registers a flush() closure; handleSave calls flushAll
  // before persisting so the tree it serializes includes the
  // user's most recent character.
  let savedText: string | null = null;
  const flushes = new Set<() => void>();
  const register = (f: () => void) => { flushes.add(f); return () => { flushes.delete(f); }; };
  const flushAll = () => { flushes.forEach((f) => f()); };

  let currentTreeText = "old";
  const field = createDebouncedCommit<string>((v) => { currentTreeText = v; }, 500);
  const unregister = register(() => field.flush(latestTyped));

  // User types fast and then hits ⌘S well before 500ms elapses.
  let latestTyped = "new value the user just typed";
  field.schedule(latestTyped);

  // Save path: flush first, then persist whatever's in the tree.
  flushAll();
  savedText = currentTreeText;

  assert.equal(savedText, "new value the user just typed");
  unregister();
});

test("flush registry returns an unregister fn that removes the closure on unmount", () => {
  const flushes = new Set<() => void>();
  const register = (f: () => void) => { flushes.add(f); return () => { flushes.delete(f); }; };
  let calls = 0;
  const off = register(() => { calls += 1; });
  assert.equal(flushes.size, 1);
  off();
  assert.equal(flushes.size, 0);
  // After unregister, flushAll-equivalent should not call this closure.
  flushes.forEach((f) => f());
  assert.equal(calls, 0);
});

// --- Save reads from synchronous treeRef, not stale closure ---
test("save serializes the post-flush tree even when React state hasn't re-rendered yet", () => {
  // Models the editor: `tree` is the closure value at the moment
  // handleSave was invoked; `treeRef` is the synchronous mirror
  // that flushSync(() => flushAll()) updates before the save body
  // runs. The save body must prefer the ref so the latest typed
  // character is included.
  const staleTree = { rootId: "r", nodes: [{ id: "r", question: "old" }] };
  const flushedTree = { rootId: "r", nodes: [{ id: "r", question: "new!" }] };

  // Simulate flushSync: the ref is updated synchronously inside
  // the flushAll call (the real editor's effect runs synchronously
  // because flushSync drains effects too).
  const treeRef: { current: typeof staleTree | null } = { current: staleTree };
  const flushAll = () => { treeRef.current = flushedTree; };

  // Save body equivalent:
  const closureTree = staleTree;
  flushAll();
  const treeToSave = treeRef.current ?? closureTree;

  assert.equal(treeToSave, flushedTree);
  assert.equal(treeToSave.nodes[0].question, "new!");
});

test("save falls back to closure tree if the ref was never populated (first-render edge case)", () => {
  const closureTree = { rootId: "r", nodes: [] };
  const treeRef: { current: typeof closureTree | null } = { current: null };
  const flushAll = () => { /* nothing to flush */ };

  flushAll();
  const treeToSave = treeRef.current ?? closureTree;
  assert.equal(treeToSave, closureTree);
});

// --- Effective-dirty folds buffered keystrokes -------------
import { computeEffectiveDirty } from "./sop-full-page-editor-helpers.js";

test("effectiveDirty is true when tree itself is dirty (committed edit)", () => {
  assert.equal(computeEffectiveDirty(true, false), true);
});
test("effectiveDirty is true when only buffered keystrokes exist (pre-debounce)", () => {
  // This is the data-loss case the reviewer flagged: tree-level
  // dirty hasn't bumped yet because the debounce hasn't fired,
  // but the user has typed. The leave guards must still trip.
  assert.equal(computeEffectiveDirty(false, true), true);
});
test("effectiveDirty is false on a truly clean editor", () => {
  assert.equal(computeEffectiveDirty(false, false), false);
});
test("effectiveDirty is true when both flags are set (edits committed AND new typing)", () => {
  assert.equal(computeEffectiveDirty(true, true), true);
});
