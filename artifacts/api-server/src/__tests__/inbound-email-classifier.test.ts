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

test("parseClassifierResponse: invalid decision degrades to 'other' at low confidence (does NOT throw)", () => {
  // Resilience contract (Task #321): an unknown decision must NOT crash
  // — we coerce to `other` and downgrade confidence so downstream code
  // can distinguish a degraded fall-back from a genuine AI "other".
  const raw = JSON.stringify({
    decision: "maybe_approved", // not in the enum
    summary: "Unclear",
    confidence: "high", // intentionally HIGH on input so we can prove the coercion forces low
  });
  const r = parseClassifierResponse(raw);
  assert.equal(r.decision, "other");
  assert.equal(r.confidence, "low");
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

test("parseClassifierResponse: malformed JSON degrades to 'other' instead of throwing (Task #321)", () => {
  // Whole-result resilience: when Haiku returns garbage, the matcher
  // still has to record the row (so the inbound email is not lost) and
  // ABSTAIN (so no Needs Review transition). The degraded result is
  // exactly what the abstain path expects.
  const r = parseClassifierResponse("not json at all");
  assert.equal(r.decision, "other");
  assert.equal(r.confidence, "low");
  assert.equal(r.summary, "(no summary)");
  assert.equal(r.amount, null);
  assert.equal(r.deadline, null);
  assert.equal(r.requestedAction, null);
  assert.equal(r.newInvoiceNumber, null);
  assert.equal(r.suggestedPayorDenialReason, null);
});

test("parseClassifierResponse: non-object JSON (array, string, number, null) degrades cleanly", () => {
  for (const raw of ["[]", '"approval"', "42", "null"]) {
    const r = parseClassifierResponse(raw);
    assert.equal(r.decision, "other", `expected degraded for ${raw}`);
    assert.equal(r.confidence, "low");
    assert.equal(r.suggestedPayorDenialReason, null);
    assert.equal(r.newInvoiceNumber, null);
  }
});

// ---------------------------------------------------------------------------
// Task #321 corpus — newInvoiceNumber and suggestedPayorDenialReason
// hints. The classifier surfaces these so the operator picker on
// Responses Awaiting Review can be pre-filled, but the parser never
// trusts the LLM blindly: garbage / hallucinated values collapse to
// null, and suggestedPayorDenialReason is forced to null whenever the
// decision is anything other than "denial".
// ---------------------------------------------------------------------------

test("parseClassifierResponse: well-formed denial with denial-reason code is accepted", () => {
  const raw = JSON.stringify({
    decision: "denial",
    summary: "Denied — GPS proof rejected.",
    confidence: "high",
    suggestedPayorDenialReason: "payor_rejected_gps",
    newInvoiceNumber: "1234567890",
  });
  const r = parseClassifierResponse(raw);
  assert.equal(r.suggestedPayorDenialReason, "payor_rejected_gps");
  assert.equal(r.newInvoiceNumber, "1234567890");
});

test("parseClassifierResponse: hallucinated denial-reason code collapses to null", () => {
  // Plausible drift cases: enum-adjacent typos and bare-stem variants
  // the operator UI must never see pre-selected.
  for (const bogus of ["PAYOR_REJECTED_GPS", "rejected_gps", "payor_unknown", "approval", "", "   ", "null", "n/a"]) {
    const raw = JSON.stringify({
      decision: "denial",
      summary: "Denied.",
      confidence: "medium",
      suggestedPayorDenialReason: bogus,
    });
    assert.equal(
      parseClassifierResponse(raw).suggestedPayorDenialReason,
      null,
      `expected null for hallucinated reason ${JSON.stringify(bogus)}`,
    );
  }
});

test("parseClassifierResponse: non-string denial-reason (number, array, object) collapses to null", () => {
  for (const bogus of [123, [], {}, true]) {
    const raw = JSON.stringify({
      decision: "denial",
      summary: "Denied.",
      confidence: "medium",
      suggestedPayorDenialReason: bogus,
    });
    assert.equal(parseClassifierResponse(raw).suggestedPayorDenialReason, null);
  }
});

test("parseClassifierResponse: suggestedPayorDenialReason is FORCED to null when decision !== 'denial'", () => {
  // Even if the LLM returns a syntactically valid code on a non-denial
  // verdict (approval, info_request, etc.), we must drop it — the
  // operator picker is only meaningful on actual denials, and
  // pre-filling it on an approval would be misleading.
  for (const decision of ["approval", "partial_approval", "info_request", "acknowledgment", "other"] as const) {
    const raw = JSON.stringify({
      decision,
      summary: "(generated)",
      confidence: "high",
      suggestedPayorDenialReason: "payor_rejected_gps", // valid code, wrong decision
    });
    assert.equal(
      parseClassifierResponse(raw).suggestedPayorDenialReason,
      null,
      `expected null when decision='${decision}'`,
    );
  }
});

test("parseClassifierResponse: newInvoiceNumber strips non-digits and rejects too-short results", () => {
  const cases: Array<[unknown, string | null]> = [
    ["1234567890", "1234567890"],
    ["INV-12345678", "12345678"],
    ["12345", null], // 5 digits — below the 6-digit floor
    ["TBD", null],
    ["null", null],
    ["", null],
    ["   ", null],
    [null, null],
    [undefined, null],
    [12345678, null], // not a string at all
  ];
  for (const [input, expected] of cases) {
    const raw = JSON.stringify({
      decision: "info_request",
      summary: "(generated)",
      confidence: "medium",
      newInvoiceNumber: input,
    });
    assert.equal(
      parseClassifierResponse(raw).newInvoiceNumber,
      expected,
      `newInvoiceNumber=${JSON.stringify(input)} → expected ${JSON.stringify(expected)}`,
    );
  }
});

test("parseClassifierResponse: missing new fields default to null without crashing", () => {
  const raw = JSON.stringify({
    decision: "approval",
    summary: "Approved.",
    confidence: "high",
    // newInvoiceNumber + suggestedPayorDenialReason omitted entirely.
  });
  const r = parseClassifierResponse(raw);
  assert.equal(r.newInvoiceNumber, null);
  assert.equal(r.suggestedPayorDenialReason, null);
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
