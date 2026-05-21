// Task #817 — Coverage walker unit tests. Validates the pure
// `walkClaimThroughTree` function that classifies a claim's recorded
// SOP answers as terminated / abandoned / unmatched against an
// arbitrary decision tree. Pure function => no DB or anthropic
// dependency, so it runs with the rest of the api-server test suite.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { walkClaimThroughTree } from "../routes/ai-builder";

const sampleTree = {
  rootId: "a",
  nodes: [
    {
      id: "a",
      question: "Is GPS available?",
      options: [
        { label: "Yes", childId: "b" },
        { label: "No", outcomeType: "hold" as const, outcomeLabel: "Hold" },
      ],
    },
    {
      id: "b",
      question: "Do breadcrumbs match?",
      options: [
        { label: "Match", outcomeType: "portal_dispute" as const, outcomeLabel: "Submit" },
        { label: "No match", outcomeType: "internal" as const, outcomeLabel: "Drop" },
      ],
    },
  ],
};

test("walkClaimThroughTree: a finished claim with sopOutcome is terminated", () => {
  const r = walkClaimThroughTree(sampleTree, [], "b", "portal_dispute");
  assert.equal(r.classification, "terminated");
});

test("walkClaimThroughTree: zero answers and no outcome is abandoned at root", () => {
  const r = walkClaimThroughTree(sampleTree, [], null, null);
  assert.equal(r.classification, "abandoned");
  assert.equal(r.finalNodeId, "a");
});

test("walkClaimThroughTree: a clean walk to a terminal option is terminated", () => {
  const r = walkClaimThroughTree(
    sampleTree,
    [
      { nodeId: "a", answer: "Yes" },
      { nodeId: "b", answer: "Match" },
    ],
    null,
    null,
  );
  assert.equal(r.classification, "terminated");
  assert.equal(r.finalNodeId, "b");
});

test("walkClaimThroughTree: ran out of answers mid-tree is abandoned", () => {
  const r = walkClaimThroughTree(
    sampleTree,
    [{ nodeId: "a", answer: "Yes" }],
    null,
    null,
  );
  assert.equal(r.classification, "abandoned");
  assert.equal(r.finalNodeId, "b");
});

test("walkClaimThroughTree: answer with no matching option is unmatched", () => {
  const r = walkClaimThroughTree(
    sampleTree,
    [{ nodeId: "a", answer: "Maybe" }],
    null,
    null,
  );
  assert.equal(r.classification, "unmatched");
  assert.equal(r.finalNodeId, "a");
  assert.equal(r.unmatchedAtOption, "Maybe");
});

test("walkClaimThroughTree: case-insensitive fallback matches via nodeId", () => {
  const r = walkClaimThroughTree(
    sampleTree,
    [{ nodeId: "a", answer: "yes" }],
    null,
    null,
  );
  // Falls back to lowercase match because nodeId matches.
  assert.equal(r.classification, "abandoned");
  assert.equal(r.finalNodeId, "b");
});
