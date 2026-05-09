// Task #555 — Generate Submission Preview gate state.
//
// The detail page tooltip and the gauntlet button both name the
// blocker through `derivePreviewGateState.reason`, so the gate's
// priority order (phase → legs → resolved → readback) is part of the
// surface contract. These tests pin each branch explicitly.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ClaimResponse } from "@workspace/api-client-react";
import { derivePreviewGateState } from "./whats-next-derivation";

function leg(over: Partial<ClaimResponse> & { id: number }): ClaimResponse {
  return {
    confNumber: `CLM-${over.id}`,
    status: "New",
    outcome: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    sopOutcome: "dispute", // → ready/dropped: counts as resolved
    errorTypeId: "ET-1",
    holdReason: null,
    ...over,
  } as unknown as ClaimResponse;
}

const READY = { sopOutcome: "dispute" } as const;
const HOLD = { sopOutcome: "hold" } as const;
const PRE_SUBMIT_GROUP = {
  status: "New",
  phase: "triage",
  understandingReadbackAt: "2026-01-01T00:00:00Z",
};

test("preview-gate: every gate satisfied → ok=true, reason=null", () => {
  const gate = derivePreviewGateState(PRE_SUBMIT_GROUP, [leg({ id: 1, ...READY })]);
  assert.equal(gate.ok, true);
  assert.equal(gate.reason, null);
  assert.deepEqual(gate.missingGates, []);
});

test("preview-gate: phase past pre-submit → reason names phase", () => {
  const gate = derivePreviewGateState(
    { status: "Portal Queued", phase: "in-flight", understandingReadbackAt: "x" },
    [leg({ id: 1, ...READY })],
  );
  assert.equal(gate.ok, false);
  assert.equal(gate.missingGates[0], "phase");
  assert.match(gate.reason ?? "", /past pre-submit/);
});

test("preview-gate: empty disputed legs → reason names legs", () => {
  const gate = derivePreviewGateState(PRE_SUBMIT_GROUP, [
    leg({ id: 1, includedInDispute: false }),
  ]);
  assert.equal(gate.ok, false);
  assert.equal(gate.missingGates[0], "legs");
  assert.match(gate.reason ?? "", /no legs included/);
});

test("preview-gate: unresolved legs → reason names count + sub-status summary", () => {
  const gate = derivePreviewGateState(PRE_SUBMIT_GROUP, [
    leg({ id: 1, ...READY }),
    leg({ id: 2, ...HOLD }), // hold → on_hold sub-status (not resolved)
  ]);
  assert.equal(gate.ok, false);
  assert.equal(gate.missingGates[0], "resolved");
  assert.match(gate.reason ?? "", /1 leg still owe action/);
  assert.equal(gate.unresolvedCount, 1);
});

test("preview-gate: readback is OPTIONAL — missing readback with everything else green is OK", () => {
  // Readback was historically a fourth gate (#168) but is now an
  // optional prompt-enrichment hint everywhere — server's
  // /preview-generated and /portal-submissions both accept the
  // missing case. The gate must NOT block on readback or the UI's
  // Submit button drifts from what the server will actually accept.
  const gate = derivePreviewGateState(
    { status: "New", phase: "triage", understandingReadbackAt: null },
    [leg({ id: 1, ...READY })],
  );
  assert.equal(gate.ok, true);
  assert.equal(gate.reason, null);
  assert.deepEqual(gate.missingGates, []);
});
