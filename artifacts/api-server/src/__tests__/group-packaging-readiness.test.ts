// Unit tests for `computeGroupReadiness` introduced in Task #231.
//
// The pure helper drives the "Ready to package" CTA on the invoice
// group detail page and the 409 path on POST /invoice-groups/:id/package.
// These tests cover every gate (status, empty, unprocessed,
// no-contestable, ready) plus the count fields that the UI badges
// render unconditionally.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { computeGroupReadiness } from "../lib/group-packaging";

type LegInput = Parameters<typeof computeGroupReadiness>[1][number];

function leg(overrides: Partial<LegInput> = {}): LegInput {
  return {
    sopOutcome: null,
    holdReason: null,
    status: "Needs Evidence",
    ...overrides,
  };
}

// --- Gate 1: group status -----------------------------------------------

test("non pre-submit group → ready=false with informative reason", () => {
  for (const groupStatus of [
    "Generating Email",
    "Portal Queued",
    "Awaiting Response",
    "Ready to Review",
    "Resolved",
    "Denied",
    "On Hold",
  ]) {
    const r = computeGroupReadiness(
      { status: groupStatus },
      [leg({ sopOutcome: "portal_dispute" })],
    );
    assert.equal(r.ready, false, `status=${groupStatus} should not be packageable`);
    assert.match(r.reason, /pre-submit/i, `reason should explain why for ${groupStatus}`);
  }
});

// --- Gate 2: empty group ------------------------------------------------

test("group with zero legs → ready=false (empty invoice)", () => {
  const r = computeGroupReadiness({ status: "Needs Evidence" }, []);
  assert.equal(r.ready, false);
  assert.match(r.reason, /no legs/i);
  assert.equal(r.totalLegCount, 0);
});

// --- Gate 3: unprocessed legs -------------------------------------------

test("any unprocessed leg → ready=false with count in reason (singular)", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [leg({ sopOutcome: "portal_dispute" }), leg({ sopOutcome: null })],
  );
  assert.equal(r.ready, false);
  assert.match(r.reason, /1 leg/);
  assert.match(r.reason, /needs/);
  assert.equal(r.unprocessedLegCount, 1);
});

test("multiple unprocessed legs → reason uses plural form", () => {
  const r = computeGroupReadiness(
    { status: "New" },
    [leg(), leg(), leg({ sopOutcome: "portal_dispute" })],
  );
  assert.equal(r.ready, false);
  assert.match(r.reason, /2 legs/);
  assert.match(r.reason, /need/);
  assert.equal(r.unprocessedLegCount, 2);
});

// --- Gate 4: no contestable legs ----------------------------------------

test("all excluded → ready=false (nothing to dispute)", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ sopOutcome: "cannot_dispute" }),
      leg({ sopOutcome: "non_issue" }),
    ],
  );
  assert.equal(r.ready, false);
  assert.match(r.reason, /contestable/i);
  assert.equal(r.processedLegCount, 0);
  assert.equal(r.excludedLegCount, 2);
});

test("all held → ready=false (held legs are not contestable on their own)", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ holdReason: "missing_invoice" }),
      leg({ sopOutcome: "hold" }),
    ],
  );
  assert.equal(r.ready, false);
  // Held legs short-circuit before sopOutcome inspection so they are
  // not unprocessed; the failure mode is "no contestable" not "needs review".
  assert.match(r.reason, /contestable/i);
  assert.equal(r.unprocessedLegCount, 0);
  assert.equal(r.heldLegCount, 2);
});

// --- Happy path ---------------------------------------------------------

test("at least one disputed leg + everything else processed/excluded → ready", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ sopOutcome: "portal_dispute" }),
      leg({ sopOutcome: "dispute" }),
      leg({ sopOutcome: "cannot_dispute" }),
    ],
  );
  assert.equal(r.ready, true);
  assert.equal(r.reason, "Ready to package");
  assert.equal(r.processedLegCount, 2);
  assert.equal(r.excludedLegCount, 1);
  assert.equal(r.unprocessedLegCount, 0);
  assert.equal(r.heldLegCount, 0);
  assert.equal(r.totalLegCount, 3);
});

test("held legs do not block packaging when other legs are contestable", () => {
  // Critical product rule: held legs ride along, they don't block
  // the dispute. They show up in the held count but the CTA stays
  // enabled as long as there's at least one disputed leg.
  const r = computeGroupReadiness(
    { status: "New" },
    [
      leg({ sopOutcome: "portal_dispute" }),
      leg({ holdReason: "ask_payor" }),
      leg({ sopOutcome: "hold" }),
    ],
  );
  assert.equal(r.ready, true);
  assert.equal(r.heldLegCount, 2);
  assert.equal(r.processedLegCount, 1);
  assert.equal(r.unprocessedLegCount, 0);
});

test("count fields are populated even on the unhappy paths", () => {
  // Sanity: every return path should fill the count fields so the
  // UI badges always have something to render.
  const r = computeGroupReadiness(
    { status: "Awaiting Response" },
    [
      leg({ sopOutcome: "portal_dispute" }),
      leg({ sopOutcome: "cannot_dispute" }),
      leg({ holdReason: "x" }),
    ],
  );
  assert.equal(r.ready, false);
  assert.equal(r.processedLegCount, 1);
  assert.equal(r.excludedLegCount, 1);
  assert.equal(r.heldLegCount, 1);
  assert.equal(r.totalLegCount, 3);
});
