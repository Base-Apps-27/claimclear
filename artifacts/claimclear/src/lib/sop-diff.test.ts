import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffChars,
  diffSopSettings,
  diffSopSnapshots,
  formatDiffSummary,
} from "./sop-diff.ts";

test("diffChars marks added and removed runs and keeps equal", () => {
  const segs = diffChars("the cat sat", "the bat sat");
  const text = segs.map((s) => `${s.op[0]}:${s.text}`).join("|");
  assert.match(text, /a:b/);
  assert.match(text, /r:c/);
  assert.ok(segs.some((s) => s.op === "equal" && s.text.includes("at sat")));
});

test("diffChars handles full add / full remove", () => {
  assert.deepEqual(diffChars("", "abc"), [{ op: "added", text: "abc" }]);
  assert.deepEqual(diffChars("xyz", ""), [{ op: "removed", text: "xyz" }]);
});

test("diffSopSnapshots classifies added / removed / edited / unchanged nodes", () => {
  const before = {
    rootId: "n1",
    nodes: [
      { id: "n1", question: "Is it raining?", options: [] },
      { id: "n2", question: "Stay inside", options: [] },
      { id: "n3", question: "Old node", options: [] },
    ],
  };
  const after = {
    rootId: "n1",
    nodes: [
      { id: "n1", question: "Is it raining?", options: [] },
      { id: "n2", question: "Stay indoors", options: [] },
      { id: "n4", question: "New node", options: [] },
    ],
  };
  const diff = diffSopSnapshots(before, after);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.summary.edited, 1);

  const n1 = diff.nodes.find((n) => n.id === "n1");
  const n2 = diff.nodes.find((n) => n.id === "n2");
  const n3 = diff.nodes.find((n) => n.id === "n3");
  const n4 = diff.nodes.find((n) => n.id === "n4");
  assert.equal(n1?.status, "unchanged");
  assert.equal(n2?.status, "edited");
  assert.equal(n3?.status, "removed");
  assert.equal(n4?.status, "added");

  const questionField = n2?.fields.find((f) => f.field === "Question");
  assert.ok(questionField, "edited node should expose Question field diff");
  assert.ok(questionField!.segments.some((s) => s.op === "added"));
  assert.ok(questionField!.segments.some((s) => s.op === "removed"));
});

test("diffSopSnapshots tolerates missing / null trees", () => {
  const diff = diffSopSnapshots(null, { rootId: "n1", nodes: [{ id: "n1", question: "Hi" }] });
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.removed, 0);
  assert.equal(diff.summary.edited, 0);

  const empty = diffSopSnapshots(null, null);
  assert.deepEqual(empty.summary, { added: 0, removed: 0, edited: 0 });
});

test("diffSopSettings reports boolean flips with off/on values", () => {
  const before = {
    name: "Late delivery",
    useDirectEmail: false,
    tripOverriding: true,
  };
  const after = {
    name: "Late delivery",
    useDirectEmail: true,
    tripOverriding: true,
  };
  const settings = diffSopSettings(before, after);
  assert.equal(settings.length, 1);
  const flag = settings[0];
  assert.equal(flag.key, "useDirectEmail");
  assert.equal(flag.kind, "boolean");
  assert.equal(flag.before, "off");
  assert.equal(flag.after, "on");
  assert.equal(flag.beforeBool, false);
  assert.equal(flag.afterBool, true);
});

test("diffSopSettings char-diffs scalar text fields and ignores unchanged", () => {
  const before = {
    name: "Late",
    category: "Ops",
    emailTemplate: "Hi {{name}},",
    disputeInstructions: "Cite POD.",
    useDirectEmail: false,
  };
  const after = {
    name: "Late",
    category: "Operations",
    emailTemplate: "Hello {{name}},",
    disputeInstructions: "Cite POD.",
    useDirectEmail: false,
  };
  const settings = diffSopSettings(before, after);
  const keys = settings.map((s) => s.key).sort();
  assert.deepEqual(keys, ["category", "emailTemplate"]);
  const cat = settings.find((s) => s.key === "category")!;
  assert.equal(cat.kind, "text");
  assert.ok(cat.segments.some((s) => s.op === "added"));
});

test("diffSopSnapshots populates settings alongside node diffs", () => {
  const before = {
    name: "Late",
    useDirectEmail: false,
    decisionTree: {
      rootId: "n1",
      nodes: [{ id: "n1", question: "Q1" }],
    },
  };
  const after = {
    name: "Late",
    useDirectEmail: true,
    decisionTree: {
      rootId: "n1",
      nodes: [{ id: "n1", question: "Q1 updated" }],
    },
  };
  const diff = diffSopSnapshots(before, after);
  assert.equal(diff.summary.edited, 1);
  assert.equal(diff.settings.length, 1);
  assert.equal(diff.settings[0].key, "useDirectEmail");
});

test("formatDiffSummary pluralizes the leading count", () => {
  assert.equal(
    formatDiffSummary({ added: 3, removed: 1, edited: 5 }),
    "3 nodes added, 1 removed, 5 edited",
  );
  assert.equal(
    formatDiffSummary({ added: 1, removed: 0, edited: 0 }),
    "1 node added, 0 removed, 0 edited",
  );
});
