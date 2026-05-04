// Task #372: pure tests for the SOP-walk transcript helper. The leg
// page renders this read-only above the live SOP card; the helper is
// the single source of truth for that derivation so tests pin the
// edges (empty answers, missing tree, removed-from-tree nodes,
// malformed jsonb).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildSopTranscript, normalizeAnswers } from "./sop-transcript";
import type { DecisionTree } from "@/components/decision-tree/types";

const tree: DecisionTree = {
  rootId: "n1",
  nodes: [
    { id: "n1", question: "Was GPS available?", options: [] },
    { id: "n2", question: "Did breadcrumbs match?", options: [] },
  ],
};

test("normalizeAnswers: non-array → []", () => {
  assert.deepEqual(normalizeAnswers(null), []);
  assert.deepEqual(normalizeAnswers(undefined), []);
  assert.deepEqual(normalizeAnswers({ nodeId: "n1", answer: "Yes" }), []);
});

test("normalizeAnswers: filters malformed entries (no nodeId / wrong types)", () => {
  const raw = [
    { nodeId: "n1", answer: "Yes", ts: "2026-01-01T00:00:00Z" },
    { answer: "missing nodeId" },
    { nodeId: 7, answer: "wrong type" },
    { nodeId: "n2", answer: "No" },
  ];
  assert.deepEqual(normalizeAnswers(raw), [
    { nodeId: "n1", answer: "Yes", ts: "2026-01-01T00:00:00Z" },
    { nodeId: "n2", answer: "No", ts: undefined },
  ]);
});

test("buildSopTranscript: empty answers → empty array (no transcript card content)", () => {
  assert.deepEqual(buildSopTranscript(null, tree), []);
  assert.deepEqual(buildSopTranscript([], tree), []);
});

test("buildSopTranscript: resolves tree nodeIds to question text and marks lines resolved", () => {
  const lines = buildSopTranscript(
    [
      { nodeId: "n1", answer: "Yes" },
      { nodeId: "n2", answer: "No" },
    ],
    tree,
  );
  assert.deepEqual(lines, [
    { question: "Was GPS available?", answer: "Yes", resolved: true },
    { question: "Did breadcrumbs match?", answer: "No", resolved: true },
  ]);
});

test("buildSopTranscript: nodeId no longer in the tree (SOP was edited) falls back to nodeId, marked unresolved", () => {
  const lines = buildSopTranscript(
    [
      { nodeId: "n1", answer: "Yes" },
      { nodeId: "removed-node-7", answer: "Continue" },
    ],
    tree,
  );
  assert.equal(lines[0].resolved, true);
  assert.equal(lines[1].resolved, false);
  assert.equal(lines[1].question, "removed-node-7");
  assert.equal(lines[1].answer, "Continue");
});

test("buildSopTranscript: tree=null surfaces every row as unresolved (read-only safety net)", () => {
  const lines = buildSopTranscript(
    [{ nodeId: "n1", answer: "Yes" }, { nodeId: "n2", answer: "No" }],
    null,
  );
  assert.equal(lines.length, 2);
  assert.equal(lines.every((l) => l.resolved === false), true);
});
