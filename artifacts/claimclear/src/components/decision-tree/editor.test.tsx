// InstructionImageUploader render contract: Upload + Paste buttons
// render when no image yet, are replaced by the image preview when one
// is present, the test-id prefix is stable, and PDFs are excluded.
//
// Plus: pure tree-mutation helpers powering the delete-with-re-parent
// flow (Task #459) and a render-side check that the re-parent dialog
// surface paints the right summary + Confirm button when wired with
// realistic state.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { InstructionImageUploader, ReparentDialogBody, TreeEditor, type ReparentRequest } from "./editor";
import {
  type DecisionTree,
  countDescendants,
  deleteNodeWithReparent,
  findParent,
  findReceivableSlots,
  getOrphanedChildren,
  removeSubtree,
} from "./types";

void React;

function withNavigator<T>(value: unknown, fn: () => T): T {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, "navigator", desc);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

test("InstructionImageUploader: with no current image renders the keyboard-paste zone, Upload, and Paste (when clipboard.read available)", () => {
  const html = withNavigator(
    { clipboard: { read: async () => [] } },
    () =>
      renderToStaticMarkup(
        <InstructionImageUploader
          onUploaded={() => {}}
          onRemove={() => {}}
        />,
      ),
  );
  assert.match(html, /data-testid="instruction-image-paste-zone"/);
  assert.match(html, /data-testid="instruction-image-upload-btn"/);
  assert.match(html, /data-testid="instruction-image-paste-btn"/);
  // Hidden file input also mounts under the prefixed test-id.
  assert.match(html, /data-testid="instruction-image-file-input"/);
  // Empty-state Upload label per the prop override.
  assert.match(html, /Upload/);
});

test("InstructionImageUploader: when navigator.clipboard.read is unavailable, Upload still renders but Paste is hidden", () => {
  const html = withNavigator({ userAgent: "test" }, () =>
    renderToStaticMarkup(
      <InstructionImageUploader
        onUploaded={() => {}}
        onRemove={() => {}}
      />,
    ),
  );
  assert.match(html, /data-testid="instruction-image-upload-btn"/);
  assert.equal(
    html.includes("instruction-image-paste-btn"),
    false,
    "Paste button must hide when navigator.clipboard.read isn't available",
  );
});

test("InstructionImageUploader: PDFs are not on the file input's accept list (this uploader is image-only)", () => {
  const html = withNavigator(
    { clipboard: { read: async () => [] } },
    () =>
      renderToStaticMarkup(
        <InstructionImageUploader
          onUploaded={() => {}}
          onRemove={() => {}}
        />,
      ),
  );
  // Pull the file input tag and verify accept list excludes PDFs.
  const m = html.match(
    /<input[^>]*data-testid="instruction-image-file-input"[^>]*>/,
  );
  assert.ok(m, "expected to find the hidden file input");
  assert.equal(
    m![0].includes("application/pdf"),
    false,
    "instruction-image uploader must not advertise PDF in its accept list",
  );
  assert.match(m![0], /accept="[^"]*image\//);
});

/* ------------------------------------------------------------------ */
/* Task #459 — pure tree-mutation helpers for delete + re-parent.      */
/*                                                                    */
/* These tests pin the contract the editor relies on: snapshots are    */
/* preserved (input not mutated), orphaned sub-trees survive the       */
/* delete, root deletion is blocked, and the no-available-slot edge    */
/* gives a structured error instead of silently dropping work.         */
/* ------------------------------------------------------------------ */

// Build a small, predictable tree:
//
//        root (Q1)
//        /        \
//   yes -> mid (Q2)         no -> leafA (Q3)
//          /   \
//   yes -> ca (Q4)   no -> cb (Q5)
//                            \
//                       yes -> ccB (Q6)
//
// Deleting `mid` should re-parent ca and cb to root: root has slot 0
// (currently pointing at mid, becomes available after detach) and slot
// 1 (currently pointing at leafA — NOT available). With only 1 slot
// available and 2 children to place, this should be blocked. We add a
// third option to root in the "happy" tree to give us the slots needed.

function buildBlockedTree(): DecisionTree {
  return {
    rootId: "root",
    nodes: [
      { id: "root", question: "Q1?", options: [{ label: "yes", childId: "mid" }, { label: "no", childId: "leafA" }] },
      { id: "mid", question: "Q2?", options: [{ label: "yes", childId: "ca" }, { label: "no", childId: "cb" }] },
      { id: "ca", question: "Q4?", options: [{ label: "yes" }, { label: "no" }] },
      { id: "cb", question: "Q5?", options: [{ label: "yes", childId: "ccB" }, { label: "no" }] },
      { id: "ccB", question: "Q6?", options: [{ label: "yes" }, { label: "no" }] },
      { id: "leafA", question: "Q3?", options: [{ label: "yes" }, { label: "no" }] },
    ],
  };
}

function buildHappyTree(): DecisionTree {
  // Same as blocked tree but root has 3 options (the third one is empty
  // and can receive an orphan).
  const t = buildBlockedTree();
  const root = t.nodes.find(n => n.id === "root")!;
  root.options = [...root.options, { label: "maybe" }];
  return t;
}

test("countDescendants counts the node itself plus the entire reachable sub-tree", () => {
  const t = buildBlockedTree();
  assert.equal(countDescendants(t, "ca"), 1);
  assert.equal(countDescendants(t, "cb"), 2);
  assert.equal(countDescendants(t, "mid"), 4);
  assert.equal(countDescendants(t, "root"), 6);
});

test("countDescendants is defensive against cycles (visits each node at most once)", () => {
  const t: DecisionTree = {
    rootId: "a",
    nodes: [
      { id: "a", question: "", options: [{ label: "x", childId: "b" }] },
      { id: "b", question: "", options: [{ label: "x", childId: "a" }] },
    ],
  };
  assert.equal(countDescendants(t, "a"), 2);
});

test("findParent returns the parent node and option index, or null for the root", () => {
  const t = buildBlockedTree();
  assert.equal(findParent(t, "root"), null);
  const p = findParent(t, "mid");
  assert.ok(p);
  assert.equal(p!.parentNode.id, "root");
  assert.equal(p!.optionIndex, 0);
});

test("getOrphanedChildren lists each child branch with its question + descendant count, in option order", () => {
  const t = buildBlockedTree();
  const orphans = getOrphanedChildren(t, "mid");
  assert.equal(orphans.length, 2);
  assert.deepEqual(orphans.map(o => o.childId), ["ca", "cb"]);
  assert.equal(orphans[0].descendantCount, 1);
  assert.equal(orphans[1].descendantCount, 2);
  assert.equal(orphans[0].optionLabel, "yes");
  // A leaf node has no orphans.
  assert.deepEqual(getOrphanedChildren(t, "leafA"), []);
});

test("findReceivableSlots returns the slot pointing at the deleted node first, then any empty slots", () => {
  const t = buildHappyTree();
  const root = t.nodes.find(n => n.id === "root")!;
  // root.options: [yes->mid, no->leafA, maybe(empty)]
  // Receivable for deleting `mid`: slot 0 (currently points at mid) +
  // slot 2 (empty). slot 1 still points at leafA so is NOT receivable.
  assert.deepEqual(findReceivableSlots(root, "mid"), [0, 2]);
  // Deleting leafA: slot 1 (points at leafA) + slot 2 (empty).
  assert.deepEqual(findReceivableSlots(root, "leafA"), [1, 2]);
});

test("deleteNodeWithReparent re-parents children atomically and removes only the deleted node", () => {
  const t = buildHappyTree();
  const before = JSON.parse(JSON.stringify(t));
  const result = deleteNodeWithReparent(t, "mid");
  assert.equal(result.ok, true);
  // Input not mutated (snapshot for undo must be intact).
  assert.deepEqual(t, before);
  if (!result.ok) throw new Error("unreachable");
  const newTree = result.tree;
  // `mid` is gone, the rest survive.
  assert.equal(newTree.nodes.find(n => n.id === "mid"), undefined);
  for (const id of ["root", "ca", "cb", "ccB", "leafA"]) {
    assert.ok(newTree.nodes.find(n => n.id === id), `expected ${id} to survive`);
  }
  // Root's options now point at orphans in slot 0 and slot 2; slot 1
  // is unchanged (still leafA).
  const newRoot = newTree.nodes.find(n => n.id === "root")!;
  assert.equal(newRoot.options[0].childId, "ca");
  assert.equal(newRoot.options[1].childId, "leafA");
  assert.equal(newRoot.options[2].childId, "cb");
  // The grandchild wiring under cb survived.
  const newCb = newTree.nodes.find(n => n.id === "cb")!;
  assert.equal(newCb.options[0].childId, "ccB");
});

test("deleteNodeWithReparent on a leaf removes the node and detaches the parent's pointer", () => {
  const t = buildHappyTree();
  const result = deleteNodeWithReparent(t, "leafA");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.tree.nodes.find(n => n.id === "leafA"), undefined);
  const newRoot = result.tree.nodes.find(n => n.id === "root")!;
  assert.equal(newRoot.options[1].childId, undefined);
});

test("deleteNodeWithReparent BLOCKS deleting the root (no silent data loss)", () => {
  const t = buildHappyTree();
  const result = deleteNodeWithReparent(t, "root");
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.reason, "root");
});

test("deleteNodeWithReparent BLOCKS when the parent has no slot to receive every orphan", () => {
  const t = buildBlockedTree(); // root only has 2 options, both occupied
  const result = deleteNodeWithReparent(t, "mid");
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.reason, "no_available_slot");
});

test("deleteNodeWithReparent reports not_found for an unknown node id", () => {
  const t = buildHappyTree();
  const result = deleteNodeWithReparent(t, "ghost");
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.reason, "not_found");
});

test("undo restore: holding the previous tree reference brings back the deleted node and its original wiring exactly", () => {
  const original = buildHappyTree();
  const snapshot = JSON.parse(JSON.stringify(original)) as DecisionTree;
  const result = deleteNodeWithReparent(original, "mid");
  assert.equal(result.ok, true);
  // Snapshot still describes the pre-delete tree byte-for-byte. The
  // editor's undo handler does exactly this: onChange(snapshot).
  assert.deepEqual(original, snapshot);
  // And the snapshot still contains `mid` with both original children
  // wired underneath it.
  const mid = snapshot.nodes.find(n => n.id === "mid")!;
  assert.equal(mid.options[0].childId, "ca");
  assert.equal(mid.options[1].childId, "cb");
});

test("removeSubtree drops the whole branch (used by remove-option / convert-to-leaf paths)", () => {
  const t = buildHappyTree();
  const pruned = removeSubtree(t.nodes, "mid");
  // mid + ca + cb + ccB are gone; root + leafA survive.
  assert.equal(pruned.find(n => n.id === "mid"), undefined);
  assert.equal(pruned.find(n => n.id === "ca"), undefined);
  assert.equal(pruned.find(n => n.id === "cb"), undefined);
  assert.equal(pruned.find(n => n.id === "ccB"), undefined);
  assert.ok(pruned.find(n => n.id === "root"));
  assert.ok(pruned.find(n => n.id === "leafA"));
});

test("self-reference defense: an option whose childId loops back to the deleted node is NOT treated as an orphan and leaves no dangling reference", () => {
  // A malformed tree where node `mid` has an option pointing at
  // itself. The self-loop is going away with the node — it isn't a
  // real child to re-parent. After delete, no surviving option should
  // reference `mid`.
  const t: DecisionTree = {
    rootId: "root",
    nodes: [
      { id: "root", question: "Q1?", options: [
        { label: "yes", childId: "mid" },
        { label: "no" },
        { label: "maybe" },
      ] },
      { id: "mid", question: "Q2?", options: [
        { label: "loop", childId: "mid" },     // self-reference
        { label: "real", childId: "ca" },
      ] },
      { id: "ca", question: "Q4?", options: [{ label: "yes" }, { label: "no" }] },
    ],
  };
  const orphans = getOrphanedChildren(t, "mid");
  // Only `ca` is a real orphan — the self-loop is filtered out.
  assert.deepEqual(orphans.map(o => o.childId), ["ca"]);
  const result = deleteNodeWithReparent(t, "mid");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  // No surviving option points at the deleted node.
  for (const n of result.tree.nodes) {
    for (const opt of n.options) {
      assert.notEqual(opt.childId, "mid", `node ${n.id} still references deleted node`);
    }
  }
  // ca got re-parented to root.
  const newRoot = result.tree.nodes.find(n => n.id === "root")!;
  assert.equal(newRoot.options[0].childId, "ca");
});

test("multi-reference defense: parent with two options pointing at the deleted node has BOTH detached, then orphans assigned", () => {
  // Parent has two options pointing at `mid` (shouldn't happen via
  // the editor, but tree imports could carry it). Both pointers must
  // be detached so we don't leave a dangling ref.
  const t: DecisionTree = {
    rootId: "root",
    nodes: [
      { id: "root", question: "Q1?", options: [
        { label: "a", childId: "mid" },
        { label: "b", childId: "mid" },
        { label: "c" },
      ] },
      { id: "mid", question: "Q2?", options: [{ label: "yes", childId: "ca" }] },
      { id: "ca", question: "Q4?", options: [{ label: "yes" }, { label: "no" }] },
    ],
  };
  const result = deleteNodeWithReparent(t, "mid");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  for (const n of result.tree.nodes) {
    for (const opt of n.options) {
      assert.notEqual(opt.childId, "mid");
    }
  }
  const newRoot = result.tree.nodes.find(n => n.id === "root")!;
  // ca lands in slot 0 (the first detached slot).
  assert.equal(newRoot.options[0].childId, "ca");
  assert.equal(newRoot.options[1].childId, undefined);
});

test("multi-reference dedupe: an option list with two options pointing at the same child surfaces only one orphan", () => {
  const t: DecisionTree = {
    rootId: "root",
    nodes: [
      { id: "root", question: "Q1?", options: [
        { label: "x", childId: "mid" },
        { label: "y" },
        { label: "z" },
      ] },
      { id: "mid", question: "Q2?", options: [
        { label: "a", childId: "ca" },
        { label: "b", childId: "ca" },          // duplicate ref
      ] },
      { id: "ca", question: "Q4?", options: [{ label: "yes" }, { label: "no" }] },
    ],
  };
  const orphans = getOrphanedChildren(t, "mid");
  assert.deepEqual(orphans.map(o => o.childId), ["ca"]);
});

test("end-to-end editor walk: delete middle → confirm dialog → children re-attached → undo restores byte-for-byte", () => {
  // Mirrors the editor's flow: requestDelete sees orphans → opens
  // dialog → confirm runs deleteNodeWithReparent → undo replays the
  // snapshot via onChange(snapshot). We unit-step the same sequence
  // the component runs to keep this test independent of jsdom.
  const original = buildHappyTree();
  const snapshot = JSON.parse(JSON.stringify(original)) as DecisionTree;

  // 1. Editor's requestDelete: orphans exist → dialog state computed.
  const orphans = getOrphanedChildren(original, "mid");
  const parent = findParent(original, "mid")!.parentNode;
  const slots = findReceivableSlots(parent, "mid");
  assert.equal(orphans.length, 2);
  assert.ok(slots.length >= orphans.length, "happy tree must have enough slots");

  // 2. Confirm: delete + re-parent.
  const confirmed = deleteNodeWithReparent(original, "mid");
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) throw new Error("unreachable");
  const afterDelete = confirmed.tree;
  // mid is gone; orphans reattached to root in slot 0 and slot 2.
  assert.equal(afterDelete.nodes.find(n => n.id === "mid"), undefined);
  const newRoot = afterDelete.nodes.find(n => n.id === "root")!;
  assert.equal(newRoot.options[0].childId, "ca");
  assert.equal(newRoot.options[2].childId, "cb");

  // 3. Undo: snapshot is the source of truth and matches the original
  //    structure exactly, including the deleted node's options +
  //    evidence requirements + grandchild wiring.
  assert.deepEqual(snapshot, original);
  const restoredMid = snapshot.nodes.find(n => n.id === "mid")!;
  assert.equal(restoredMid.options[0].childId, "ca");
  assert.equal(restoredMid.options[1].childId, "cb");
});

/* ------------------------------------------------------------------ */
/* Task #459 — render-side checks on the editor + ReparentDialog.      */
/*                                                                    */
/* The project pattern is renderToStaticMarkup (no jsdom), so we pin  */
/* what each surface emits in a given state instead of driving        */
/* clicks. The full delete→confirm→undo sequence is exercised through */
/* the helper-level walk above, which mirrors what the component runs.*/
/* ------------------------------------------------------------------ */

test("TreeEditor: renders a delete affordance for every non-root node, with a stable per-node test id", () => {
  const tree = buildHappyTree();
  const html = renderToStaticMarkup(
    <TreeEditor tree={tree} onChange={() => {}} />,
  );
  // Delete buttons render for every node card (root included; the
  // editor handles the root-block reactively via toast, not by hiding
  // the button — the title attribute documents the behaviour).
  assert.match(html, /data-testid="sop-delete-node-btn-root"/);
  assert.match(html, /data-testid="sop-delete-node-btn-mid"/);
  assert.match(html, /data-testid="sop-delete-node-btn-ca"/);
  assert.match(html, /data-testid="sop-delete-node-btn-leafA"/);
  // Root delete button advertises the block in its title for hover
  // affordance + screen-reader users.
  assert.match(html, /data-testid="sop-delete-node-btn-root"[^>]*title="Cannot delete root question"/);
  // Each card carries its node id so the undo handler can scroll
  // back to the previously-deleted node.
  assert.match(html, /data-node-id="mid"/);
});

test("TreeEditor: the re-parent dialog is closed by default (no orphan list rendered)", () => {
  const tree = buildHappyTree();
  const html = renderToStaticMarkup(
    <TreeEditor tree={tree} onChange={() => {}} />,
  );
  assert.equal(
    html.includes("sop-reparent-dialog"),
    false,
    "dialog should not render until the user requests a delete on a node with orphans",
  );
  assert.equal(html.includes("sop-reparent-orphan-list"), false);
});

test("ReparentDialog: when wired with a re-parent request, lists every orphan + descendant count and shows an enabled Confirm", () => {
  const tree = buildHappyTree();
  const orphans = getOrphanedChildren(tree, "mid");
  const parent = findParent(tree, "mid")!.parentNode;
  const slots = findReceivableSlots(parent, "mid");
  const request: ReparentRequest = {
    nodeId: "mid",
    question: "Q2?",
    orphans,
    parent,
    receivableSlots: slots,
    blockReason: null,
  };
  const html = renderToStaticMarkup(
    <ReparentDialogBody request={request} onCancel={() => {}} onConfirm={() => {}} />,
  );
  // Dialog content rendered.
  assert.match(html, /data-testid="sop-reparent-dialog"/);
  assert.match(html, /Re-parent children before deleting\?/);
  // Each orphan shows its question text and its descendant count
  // ("1 node" for ca, "2 nodes" for cb).
  assert.match(html, /data-testid="sop-reparent-orphan-list"/);
  assert.match(html, /Q4\?/);
  assert.match(html, /Q5\?/);
  assert.match(html, /1 node/);
  assert.match(html, /2 nodes/);
  // Confirm button is rendered AND enabled (no `disabled` attribute on
  // the confirm button when there's no block reason).
  const confirmMatch = html.match(/<button[^>]*data-testid="sop-reparent-confirm-btn"[^>]*>/);
  assert.ok(confirmMatch, "expected to find the confirm button");
  // The Button class string contains tailwind variants like
  // `disabled:opacity-50`, so we look for the actual HTML attribute
  // (` disabled` followed by `=`, whitespace, or `>`).
  assert.equal(
    /\sdisabled(=|\s|>)/.test(confirmMatch![0]),
    false,
    "confirm must be enabled when blockReason is null",
  );
  // Block warnings are NOT rendered in the happy state.
  assert.equal(html.includes("sop-reparent-blocked-no-parent"), false);
  assert.equal(html.includes("sop-reparent-blocked-no-slot"), false);
});

test("ReparentDialog: no_available_slot block renders an inline warning and DISABLES Confirm", () => {
  const tree = buildBlockedTree(); // root has no spare slots
  const orphans = getOrphanedChildren(tree, "mid");
  const parent = findParent(tree, "mid")!.parentNode;
  const slots = findReceivableSlots(parent, "mid");
  const request: ReparentRequest = {
    nodeId: "mid",
    question: "Q2?",
    orphans,
    parent,
    receivableSlots: slots,
    blockReason: "no_available_slot",
  };
  const html = renderToStaticMarkup(
    <ReparentDialogBody request={request} onCancel={() => {}} onConfirm={() => {}} />,
  );
  assert.match(html, /data-testid="sop-reparent-blocked-no-slot"/);
  // Confirm button must be disabled when blocked — the user has to
  // restructure first.
  const confirmMatch = html.match(/<button[^>]*data-testid="sop-reparent-confirm-btn"[^>]*>/);
  assert.ok(confirmMatch);
  assert.match(confirmMatch![0], /\sdisabled(=|\s|>)/);
});

test("InstructionImageUploader: with a current image, the upload UI is REPLACED by the image preview (no buttons render)", () => {
  const html = withNavigator(
    { clipboard: { read: async () => [] } },
    () =>
      renderToStaticMarkup(
        <InstructionImageUploader
          imagePath="/objects/uploads/foo.png"
          onUploaded={() => {}}
          onRemove={() => {}}
        />,
      ),
  );
  // Image preview wins; route /objects/* through the API proxy.
  assert.match(html, /<img[^>]*src="\/api\/storage\/objects\/uploads\/foo\.png"/);
  // None of the upload/paste affordances should render alongside it.
  assert.equal(html.includes("instruction-image-upload-btn"), false);
  assert.equal(html.includes("instruction-image-paste-btn"), false);
  assert.equal(html.includes("instruction-image-paste-zone"), false);
});
