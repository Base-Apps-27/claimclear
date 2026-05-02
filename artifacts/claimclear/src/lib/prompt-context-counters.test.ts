// Pins the counter accounting + summary copy used by the prompt-context
// badge (gauntlet) and activity-feed preflight row. The badge surfaces
// only what these helpers report, so a regression here is a regression
// the operator would notice as a missing/incorrect badge.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  computePromptContextCounters,
  summarizePreflightMetadata,
  summarizePromptContext,
  type PromptContextLegRow,
} from "./prompt-context-counters";

const ride = (
  id: number,
  conf: string,
  extras: Partial<PromptContextLegRow> = {},
): PromptContextLegRow => ({
  id,
  confNumber: conf,
  perLegContext: null,
  duplicateOfClaimId: null,
  sopOutcome: "portal_dispute",
  ...extras,
});

test("returns hasContext=false and zero counts when no leg has context", () => {
  const counters = computePromptContextCounters([
    ride(1, "C1"),
    ride(2, "C2"),
  ]);
  assert.equal(counters.hasContext, false);
  assert.equal(counters.perLegContextLegCount, 0);
  assert.equal(counters.siblingDuplicateCount, 0);
  assert.equal(counters.visibleLegCount, 2);
  assert.equal(summarizePromptContext(counters), null);
});

test("counts only non-duplicate legs as 'visible' and ignores duplicate per-leg context", () => {
  const counters = computePromptContextCounters([
    ride(1, "C1", { perLegContext: "primary finding" }),
    // duplicate-of-1 with its own per-leg-context — must be suppressed
    ride(2, "C2", {
      perLegContext: "ignored",
      duplicateOfClaimId: 1,
      sopOutcome: null,
    }),
    ride(3, "C3"),
    ride(4, "C4", { perLegContext: "another finding" }),
  ]);
  assert.equal(counters.visibleLegCount, 3);
  assert.equal(counters.perLegContextLegCount, 2);
  assert.equal(counters.siblingDuplicateCount, 1);
  assert.equal(counters.hasContext, true);
  assert.deepEqual(
    counters.perLegContextLegs.map((e) => e.confNumber),
    ["C1", "C4"],
  );
  assert.deepEqual(counters.siblingDuplicates, [
    {
      duplicateClaimId: 2,
      duplicateConfNumber: "C2",
      primaryClaimId: 1,
      primaryConfNumber: "C1",
    },
  ]);
  assert.equal(
    summarizePromptContext(counters),
    "2 of 3 legs had per-leg findings; 1 sibling duplicate rolled up",
  );
});

test("singularizes copy when counts are 1", () => {
  const counters = computePromptContextCounters([
    ride(1, "C1", { perLegContext: "one finding" }),
  ]);
  assert.equal(
    summarizePromptContext(counters),
    "1 of 1 leg had per-leg findings",
  );
});

test("trims per-leg context and ignores whitespace-only entries", () => {
  const counters = computePromptContextCounters([
    ride(1, "C1", { perLegContext: "  " }),
    ride(2, "C2", { perLegContext: "  real finding  " }),
  ]);
  assert.equal(counters.perLegContextLegCount, 1);
  assert.equal(counters.perLegContextLegs[0].perLegContext, "real finding");
});

test("falls back to #<id> for the primary ref when the primary is missing from the row set", () => {
  const counters = computePromptContextCounters([
    ride(2, "C2", { duplicateOfClaimId: 99, sopOutcome: null }),
  ]);
  assert.equal(counters.siblingDuplicates[0].primaryConfNumber, "#99");
});

test("summarizePreflightMetadata returns null when metadata is missing or zero", () => {
  assert.equal(summarizePreflightMetadata(null), null);
  assert.equal(summarizePreflightMetadata(undefined), null);
  assert.equal(summarizePreflightMetadata({}), null);
  assert.equal(
    summarizePreflightMetadata({ perLegContextLegCount: 0, siblingDuplicateCount: 0 }),
    null,
  );
});

test("summarizePreflightMetadata renders both counters when present", () => {
  const out = summarizePreflightMetadata({
    perLegContextLegCount: 2,
    siblingDuplicateCount: 1,
  });
  assert.ok(out);
  assert.equal(out.text, "2 legs contributed per-leg findings; 1 sibling duplicate rolled up");
});

test("summarizePreflightMetadata singularizes for 1 leg / 1 duplicate", () => {
  const out = summarizePreflightMetadata({
    perLegContextLegCount: 1,
    siblingDuplicateCount: 1,
  });
  assert.ok(out);
  assert.equal(out.text, "1 leg contributed per-leg findings; 1 sibling duplicate rolled up");
});
