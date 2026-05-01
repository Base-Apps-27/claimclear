// Unit tests for the per-leg status projector introduced in Task #231.
//
// The projector replaces the old `macroPhaseToStatus` collapse, which
// flattened every pre-submit leg to "Needs Evidence" regardless of its
// own per-leg state. The new function keeps macro-phase mirroring for
// in-flight / response-pending / closed groups but introduces a true
// per-leg projection in the pre-submit phase, plus a hold override
// that wins over everything.
//
// These tests are pure (no DB, no Express). They exercise the full
// decision table from `.local/tasks/task-231.md` §A.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { projectLegStatus } from "../lib/denormalized-cache";

type Leg = Parameters<typeof projectLegStatus>[0];
type Group = Parameters<typeof projectLegStatus>[1];

function leg(overrides: Partial<Leg> = {}): Leg {
  return {
    status: "Needs Evidence",
    sopOutcome: null,
    holdReason: null,
    ...overrides,
  };
}

function group(overrides: Partial<Group> = {}): Group {
  return {
    status: "Needs Evidence",
    reattestRequired: false,
    reattestCompletedAt: null,
    ...overrides,
  };
}

// --- Rule 1: per-leg hold wins over everything --------------------------

test("hold_reason set → On Hold regardless of group phase", () => {
  for (const groupStatus of [
    "New",
    "Needs Evidence",
    "Generating Email",
    "Ready to Review",
    "Awaiting Response",
    "Resolved",
  ]) {
    const out = projectLegStatus(
      leg({ holdReason: "missing_invoice", sopOutcome: "portal_dispute" }),
      group({ status: groupStatus }),
    );
    assert.equal(out, "On Hold", `group=${groupStatus} should yield On Hold when held`);
  }
});

test("sopOutcome=hold → On Hold (treated as a hold marker)", () => {
  const out = projectLegStatus(leg({ sopOutcome: "hold" }), group({ status: "Needs Evidence" }));
  assert.equal(out, "On Hold");
});

// --- Rule 2a: pre-submit per-leg projection -----------------------------

test("pre-submit + sopOutcome=portal_dispute → Processed", () => {
  const out = projectLegStatus(leg({ sopOutcome: "portal_dispute" }), group({ status: "New" }));
  assert.equal(out, "Processed");
});

test("pre-submit + sopOutcome=dispute → Processed", () => {
  const out = projectLegStatus(leg({ sopOutcome: "dispute" }), group({ status: "Needs Evidence" }));
  assert.equal(out, "Processed");
});

test("pre-submit + sopOutcome=cannot_dispute → null (preserve closed status)", () => {
  // Excluded legs already carry their authoritative closed/withdrawn
  // status from the SOP exclusion path; the projector must not stomp it.
  const out = projectLegStatus(
    leg({ sopOutcome: "cannot_dispute", status: "Resolved" }),
    group({ status: "Needs Evidence" }),
  );
  assert.equal(out, null);
});

test("pre-submit + sopOutcome=non_issue → null (preserve closed status)", () => {
  const out = projectLegStatus(
    leg({ sopOutcome: "non_issue", status: "Resolved" }),
    group({ status: "New" }),
  );
  assert.equal(out, null);
});

test("pre-submit + sopOutcome=null → mirror group (this is the regression fix)", () => {
  // The bug Task #231 fixes: previously every pre-submit leg collapsed
  // to "Needs Evidence". Now legs without an SOP outcome correctly
  // mirror whatever the group is showing (New or Needs Evidence).
  assert.equal(projectLegStatus(leg(), group({ status: "New" })), "New");
  assert.equal(projectLegStatus(leg(), group({ status: "Needs Evidence" })), "Needs Evidence");
});

// --- Rule 2b: in-flight collapses to Awaiting Response ------------------

test("in-flight group → Awaiting Response (regardless of sopOutcome)", () => {
  const sopVariants: Array<string | null> = [null, "portal_dispute", "dispute"];
  for (const sop of sopVariants) {
    const out = projectLegStatus(
      leg({ sopOutcome: sop }),
      group({ status: "Awaiting Response" }),
    );
    assert.equal(out, "Awaiting Response", `sopOutcome=${sop}`);
  }
});

test("Generating Email + Portal Queued (in-flight) → Awaiting Response", () => {
  assert.equal(
    projectLegStatus(leg({ sopOutcome: "portal_dispute" }), group({ status: "Generating Email" })),
    "Awaiting Response",
  );
  assert.equal(
    projectLegStatus(leg({ sopOutcome: "portal_dispute" }), group({ status: "Portal Queued" })),
    "Awaiting Response",
  );
});

// --- Rule 2c: response-pending mirrors group ----------------------------

test("response-pending mirrors group (Ready to Review / Needs Review)", () => {
  // Needs Review with reattest required puts the group in
  // response-pending phase per macro-phase rules.
  assert.equal(
    projectLegStatus(
      leg({ sopOutcome: "portal_dispute" }),
      group({ status: "Ready to Review" }),
    ),
    "Ready to Review",
  );
});

// --- Rule 2d: closed family mirrors group -------------------------------

test("closed group → leg mirrors group status", () => {
  for (const closedStatus of ["Resolved", "Denied"]) {
    const out = projectLegStatus(
      leg({ sopOutcome: "portal_dispute" }),
      group({ status: closedStatus }),
    );
    assert.equal(out, closedStatus, `closed status ${closedStatus} should mirror`);
  }
});

// --- Rule 2e: explicit on-hold group ------------------------------------

test("group On Hold → leg On Hold (even without per-leg hold)", () => {
  const out = projectLegStatus(leg({ sopOutcome: null }), group({ status: "On Hold" }));
  assert.equal(out, "On Hold");
});

// --- Mixed-pre-submit invariant (the headline regression) ---------------

test("mixed pre-submit invoice: Processed leg, unprocessed leg, excluded leg, held leg", () => {
  // Single group, four legs that mirror the spec's worked example.
  // Each call is independent (the projector is per-leg) — this test
  // demonstrates that the four legs surface four distinct statuses
  // instead of all collapsing to the same value.
  const g = group({ status: "Needs Evidence" });

  const processedLeg = projectLegStatus(leg({ sopOutcome: "portal_dispute" }), g);
  const unprocessedLeg = projectLegStatus(leg({ sopOutcome: null }), g);
  const excludedLeg = projectLegStatus(
    leg({ sopOutcome: "cannot_dispute", status: "Resolved" }),
    g,
  );
  const heldLeg = projectLegStatus(leg({ holdReason: "ask_payor" }), g);

  assert.equal(processedLeg, "Processed");
  assert.equal(unprocessedLeg, "Needs Evidence");
  assert.equal(excludedLeg, null);
  assert.equal(heldLeg, "On Hold");
});
