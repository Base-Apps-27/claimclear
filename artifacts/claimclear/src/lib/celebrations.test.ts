// Unit coverage for the celebration registry (Task #509).
//
// Pure tests for `celebrationCopy`. The visual side of `fireCelebration`
// is exercised by the integration smoke check listed in the task's
// step 7 (manual confetti verification) — it's an imperative DOM
// effect on `canvas-confetti` that's not worth a snapshot-style test.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { celebrationCopy } from "./celebrations";

test("day-complete copy uses the standard variant outside Friday afternoon", () => {
  // Wednesday at noon — never the Friday-afternoon variant.
  // Use the local-components constructor (matches the Friday fixtures
  // below) so the dates-guardrail lint stays clean: literal
  // `new Date("YYYY-MM-DD…")` strings are flagged because they parse
  // as UTC and shift the calendar day in negative-UTC zones.
  const wed = new Date(2026, 4, 6, 12, 0, 0);
  const copy = celebrationCopy({ kind: "day-complete", dateLabel: "May 5", now: wed });
  assert.equal(copy.title, "Day complete");
  assert.match(copy.description, /Great work — all invoices for May 5/);
});

test("day-complete copy switches to the Friday-afternoon variant after 14:00 local", () => {
  // Friday May 8, 2026 at 15:00 local — well past 14:00.
  const friAfternoon = new Date(2026, 4, 8, 15, 0, 0);
  const copy = celebrationCopy({ kind: "day-complete", dateLabel: "May 8", now: friAfternoon });
  assert.equal(copy.title, "Day complete — have a good weekend");
  assert.match(copy.description, /Enjoy the weekend/);
});

test("day-complete Friday morning still reads as a normal day-complete", () => {
  // Friday May 8, 2026 at 11:00 local — earlier than the 14:00 cutoff.
  const friMorning = new Date(2026, 4, 8, 11, 0, 0);
  const copy = celebrationCopy({ kind: "day-complete", dateLabel: "May 8", now: friMorning });
  assert.equal(copy.title, "Day complete");
});

test("session-milestone copy is tier-specific across 10/25/50", () => {
  const c10 = celebrationCopy({ kind: "session-milestone", milestone: 10 });
  assert.equal(c10.title, "10 claims processed today");
  assert.match(c10.description, /Nice pace/);

  const c25 = celebrationCopy({ kind: "session-milestone", milestone: 25 });
  assert.equal(c25.title, "25 claims processed today");
  assert.match(c25.description, /queue is feeling lighter/);

  const c50 = celebrationCopy({ kind: "session-milestone", milestone: 50 });
  assert.equal(c50.title, "50 claims processed today");
  assert.match(c50.description, /Outstanding pace/);
});
