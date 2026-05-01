import { test } from "node:test";
import { strict as assert } from "node:assert";

import { parseClassifierResponse } from "../lib/inbound-email-classifier";
import { shouldTransitionToNeedsReview, shouldAutoMarkProcessed } from "../lib/response-matcher";

// ---------------------------------------------------------------------------
// shouldTransitionToNeedsReview — the rule that splits "real responses" from
// "we got your request" acknowledgments. Acknowledgments are intentionally
// silent: stored + timeline note for proof-of-receipt, but no Needs Review
// transition (otherwise every confirmation receipt spams the queue).
// ---------------------------------------------------------------------------

test("shouldTransitionToNeedsReview: acknowledgment never transitions", () => {
  assert.equal(shouldTransitionToNeedsReview("acknowledgment"), false);
});

test("shouldTransitionToNeedsReview: every actionable type DOES transition", () => {
  for (const t of ["approval", "denial", "partial_approval", "info_request", "other"] as const) {
    assert.equal(
      shouldTransitionToNeedsReview(t),
      true,
      `expected '${t}' to drive a Needs Review transition`,
    );
  }
});

// ---------------------------------------------------------------------------
// shouldAutoMarkProcessed — the rule that auto-clears the "Unprocessed"
// badge for noise-only acknowledgments. Only the deterministic
// phrase-signature path qualifies: an operator has nothing to do on those
// rows. Abstain rows still need manual review, and even AI-classified
// acknowledgments stay unprocessed so a human can confirm the model's call.
// ---------------------------------------------------------------------------

test("shouldAutoMarkProcessed: phrase-signature acknowledgment is auto-cleared", () => {
  assert.equal(shouldAutoMarkProcessed("acknowledgment", "phrase_signature"), true);
});

test("shouldAutoMarkProcessed: AI-classified acknowledgment stays unprocessed", () => {
  // Even when the AI says "acknowledgment", we want a human to confirm —
  // the AI path is reserved for novel content where we don't fully trust
  // the call.
  assert.equal(shouldAutoMarkProcessed("acknowledgment", "ai"), false);
});

test("shouldAutoMarkProcessed: abstain acknowledgment stays unprocessed", () => {
  // 'abstain' implies neither phrase nor AI confidently classified the
  // email. Abstain rows are the queue's manual-review path by design.
  assert.equal(shouldAutoMarkProcessed("acknowledgment", "abstain"), false);
});

test("shouldAutoMarkProcessed: actionable phrase-signature responses stay unprocessed", () => {
  // Only acknowledgments are auto-cleared. Approvals, denials, info
  // requests, etc. always need an operator decision regardless of how we
  // classified them.
  for (const t of ["approval", "denial", "partial_approval", "info_request", "other"] as const) {
    assert.equal(
      shouldAutoMarkProcessed(t, "phrase_signature"),
      false,
      `expected '${t}' from phrase signature to remain processed=false`,
    );
  }
});

test("shouldAutoMarkProcessed: actionable AI/abstain responses stay unprocessed", () => {
  for (const source of ["ai", "abstain"] as const) {
    for (const t of ["approval", "denial", "partial_approval", "info_request", "other"] as const) {
      assert.equal(
        shouldAutoMarkProcessed(t, source),
        false,
        `expected '${t}' from '${source}' to remain processed=false`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// parseClassifierResponse — defensive parsing of whatever Claude returns. The
// classifier is best-effort, so this is the layer that protects us when the
// model wraps in code fences, drops fields, or returns 'N/A'-style nulls.
// ---------------------------------------------------------------------------

test("parseClassifierResponse: clean JSON parses straight through", () => {
  const raw = JSON.stringify({
    decision: "denial",
    summary: "MAS denied the dispute citing lack of GPS evidence.",
    amount: "$45.20",
    deadline: null,
    requestedAction: null,
    confidence: "high",
  });
  const r = parseClassifierResponse(raw);
  assert.equal(r.decision, "denial");
  assert.equal(r.summary, "MAS denied the dispute citing lack of GPS evidence.");
  assert.equal(r.amount, "$45.20");
  assert.equal(r.deadline, null);
  assert.equal(r.confidence, "high");
});

test("parseClassifierResponse: strips ```json fences before parsing", () => {
  const raw = "```json\n" + JSON.stringify({
    decision: "acknowledgment",
    summary: "Receipt confirmation only.",
    confidence: "high",
  }) + "\n```";
  const r = parseClassifierResponse(raw);
  assert.equal(r.decision, "acknowledgment");
  assert.equal(r.summary, "Receipt confirmation only.");
});

test("parseClassifierResponse: strips bare ``` fences (no language tag)", () => {
  const raw = "```\n" + JSON.stringify({
    decision: "approval",
    summary: "Approved in full.",
    confidence: "medium",
  }) + "\n```";
  const r = parseClassifierResponse(raw);
  assert.equal(r.decision, "approval");
});

test("parseClassifierResponse: 'N/A' / 'null' string fields normalize to null", () => {
  const raw = JSON.stringify({
    decision: "info_request",
    summary: "They need additional GPS logs.",
    amount: "N/A",
    deadline: "null",
    requestedAction: "Provide the GPS breadcrumbs for the trip.",
    confidence: "medium",
  });
  const r = parseClassifierResponse(raw);
  assert.equal(r.amount, null);
  assert.equal(r.deadline, null);
  assert.equal(r.requestedAction, "Provide the GPS breadcrumbs for the trip.");
});

test("parseClassifierResponse: invalid decision rejected (so caller falls back to keywords)", () => {
  const raw = JSON.stringify({
    decision: "maybe_approved", // not in the enum
    summary: "Unclear",
    confidence: "low",
  });
  assert.throws(() => parseClassifierResponse(raw), /Invalid decision/);
});

test("parseClassifierResponse: missing summary is replaced with placeholder, not crashed", () => {
  const raw = JSON.stringify({
    decision: "other",
    confidence: "low",
  });
  const r = parseClassifierResponse(raw);
  assert.equal(r.summary, "(no summary)");
});

test("parseClassifierResponse: unknown confidence value defaults to medium (no crash)", () => {
  const raw = JSON.stringify({
    decision: "approval",
    summary: "Approved.",
    confidence: "very-confident", // not in enum
  });
  const r = parseClassifierResponse(raw);
  assert.equal(r.confidence, "medium");
});

test("parseClassifierResponse: malformed JSON throws (so wrapper falls back to keywords)", () => {
  assert.throws(() => parseClassifierResponse("not json at all"));
});

test("parseClassifierResponse: empty/whitespace-only string fields normalize to null", () => {
  const raw = JSON.stringify({
    decision: "acknowledgment",
    summary: "Received.",
    amount: "   ",
    deadline: "",
    requestedAction: "  ",
    confidence: "high",
  });
  const r = parseClassifierResponse(raw);
  assert.equal(r.amount, null);
  assert.equal(r.deadline, null);
  assert.equal(r.requestedAction, null);
});
