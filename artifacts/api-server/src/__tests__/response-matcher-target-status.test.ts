import { test } from "node:test";
import { strict as assert } from "node:assert";

import { derivePhaseFromLegacy } from "@workspace/invoice-state";
import { MATCHER_CLASSIFIED_TARGET_STATUS } from "../lib/response-matcher";
import { getMacroPhase, getGroupMacroPhase } from "../lib/macro-phase";

// Task #547 regression net.
//
// Contract: when the response matcher classifies an inbound payor reply
// as actionable (approval, denial, partial, info-request, other), the
// legacy `status` it writes MUST derive to phase=`response_received`
// (macro `response-pending`) so the verdict endpoint
// (`POST /claims/:id/verdict` and `promote-draft-verdicts`) accepts the
// operator's Approved/Denied click. Writing "Needs Review" instead
// lands phase=`triage` and 409s every verdict click — that was the
// production bug this test guards against.

test("matcher's classified target status derives to phase=response_received (approval reply)", () => {
  // Approval reply path: matcher writes MATCHER_CLASSIFIED_TARGET_STATUS;
  // deriver must land it in response_received.
  const derived = derivePhaseFromLegacy({
    status: MATCHER_CLASSIFIED_TARGET_STATUS,
    outcome: "Pending",
    reattestRequired: false,
    reattestCompletedAt: null,
    closureReason: null,
    holdReason: null,
  });
  assert.equal(derived.phase, "response_received");
});

test("matcher's classified target status derives to phase=response_received (denial reply)", () => {
  // Denial reply path: matcher writes the same status (the verdict
  // itself isn't recorded yet — the operator confirms it on the
  // Responses Awaiting Review screen). The deriver must still land
  // response_received so the verdict click succeeds.
  const derived = derivePhaseFromLegacy({
    status: MATCHER_CLASSIFIED_TARGET_STATUS,
    outcome: "Pending",
    reattestRequired: false,
    reattestCompletedAt: null,
    closureReason: null,
    holdReason: null,
  });
  assert.equal(derived.phase, "response_received");
});

test("matcher's classified target status maps to macro `response-pending`", () => {
  // Belt-and-braces: the macro phase that gates the verdict endpoint
  // must be `response-pending` for the matcher's chosen status, via
  // both the legacy status fallback and the canonical phase column.
  assert.equal(getMacroPhase(MATCHER_CLASSIFIED_TARGET_STATUS), "response-pending");
  assert.equal(
    getGroupMacroPhase({ status: MATCHER_CLASSIFIED_TARGET_STATUS, phase: "response_received" }),
    "response-pending",
  );
});

test("matcher's target status is NOT 'Needs Review' (the Task #547 regression)", () => {
  // Direct lock against the original bug. "Needs Review" derives to
  // phase=triage (see the `case "Needs Review"` arm in
  // `derivePhaseFromLegacy`), which the verdict endpoint rejects with
  // 409. Keep this assertion — it is the single line that would have
  // caught the prod incident before it shipped.
  assert.notEqual(MATCHER_CLASSIFIED_TARGET_STATUS, "Needs Review");
  const needsReviewPhase = derivePhaseFromLegacy({
    status: "Needs Review",
    outcome: "Pending",
    reattestRequired: false,
    reattestCompletedAt: null,
    closureReason: null,
    holdReason: null,
  }).phase;
  assert.equal(needsReviewPhase, "triage");
});
