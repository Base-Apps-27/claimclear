// Unit tests for the pure terminal-routing helpers behind the SOP
// terminal redesign. These cover:
//   - both legacy `sopOutcome` values collapse to the same terminal kind
//     (the regression hot-spot — Guard #8 in the task spec)
//   - the closed family (cannot_dispute / non_issue / internal) renders
//     under one shared `closed` kind
//   - duplicate pointer wins over any sopOutcome (Guard #1)
//   - channel hint never silently defaults to "portal" when the
//     error_type is missing (Guard #9).

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  terminalKindForLeg,
  channelHintForErrorType,
  channelHintLabel,
} from "./sop-terminal-routing";

// ─── terminalKindForLeg ──────────────────────────────────────────────

test("terminalKindForLeg: legacy portal_dispute and dispute both map to 'include'", () => {
  // Regression: Guard #8 — a leg whose sopOutcome was persisted as
  // legacy "portal_dispute" MUST render the new "Ready" include
  // terminal. If this fails the migration thinking is wrong.
  assert.equal(terminalKindForLeg({ sopOutcome: "portal_dispute" }), "include");
  assert.equal(terminalKindForLeg({ sopOutcome: "dispute" }), "include");
});

test("terminalKindForLeg: cannot_dispute / non_issue / internal collapse to 'closed'", () => {
  assert.equal(terminalKindForLeg({ sopOutcome: "cannot_dispute" }), "closed");
  assert.equal(terminalKindForLeg({ sopOutcome: "non_issue" }), "closed");
  assert.equal(terminalKindForLeg({ sopOutcome: "internal" }), "closed");
});

test("terminalKindForLeg: hold renders the hold terminal", () => {
  assert.equal(terminalKindForLeg({ sopOutcome: "hold" }), "hold");
});

test("terminalKindForLeg: duplicate pointer wins over any sopOutcome", () => {
  assert.equal(
    terminalKindForLeg({ duplicateOfClaimId: 7, sopOutcome: "portal_dispute" }),
    "duplicate",
  );
  assert.equal(
    terminalKindForLeg({ duplicateOfClaimId: 7, sopOutcome: "hold" }),
    "duplicate",
  );
  assert.equal(
    terminalKindForLeg({ duplicateOfClaimId: 7, sopOutcome: null }),
    "duplicate",
  );
});

test("terminalKindForLeg: empty / null / unknown sopOutcome resolves to 'none'", () => {
  assert.equal(terminalKindForLeg({}), "none");
  assert.equal(terminalKindForLeg({ sopOutcome: null }), "none");
  assert.equal(terminalKindForLeg({ sopOutcome: "" }), "none");
  assert.equal(terminalKindForLeg({ sopOutcome: "garbage_value" }), "none");
});

// ─── channelHintForErrorType / channelHintLabel ──────────────────────

test("channelHintForErrorType: useDirectEmail=false → portal", () => {
  const hint = channelHintForErrorType({ useDirectEmail: false });
  assert.deepEqual(hint, { kind: "configured", channel: "portal" });
  assert.equal(channelHintLabel(hint), "Channel: via portal");
});

test("channelHintForErrorType: useDirectEmail=true → email", () => {
  const hint = channelHintForErrorType({ useDirectEmail: true });
  assert.deepEqual(hint, { kind: "configured", channel: "email" });
  assert.equal(channelHintLabel(hint), "Channel: via email");
});

test("channelHintForErrorType: missing/null error type → 'not configured', NEVER silent portal default", () => {
  // Guard #9 — no silent fallback. The label MUST surface "not configured"
  // so the operator knows the error type is misconfigured rather than
  // assume a portal channel.
  assert.equal(
    channelHintLabel(channelHintForErrorType(null)),
    "Channel: not configured",
  );
  assert.equal(
    channelHintLabel(channelHintForErrorType(undefined)),
    "Channel: not configured",
  );
  assert.equal(
    channelHintLabel(channelHintForErrorType({})),
    "Channel: not configured",
  );
  assert.equal(
    channelHintLabel(channelHintForErrorType({ useDirectEmail: null })),
    "Channel: not configured",
  );
});
