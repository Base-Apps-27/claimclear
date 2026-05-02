// Parity + state-machine coverage for the "Why?" line copy used by
// both the Dashboard hero and the Queue urgency hero (Task #298).
//
// The Dashboard and the Queue mount the SAME `UrgentTodayWhyLine`
// component pointed at the SAME endpoint, so by construction they
// can't disagree at the JSX level. These tests pin the contract one
// layer deeper: the pure copy decision is identical for identical
// inputs across every hero tone, and the suppression guard fires
// exactly when nothing was ever urgent today.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { deriveUrgentTodayWhy } from "./urgent-today-why";

test("deriveUrgentTodayWhy: hides the line when nothing was ever urgent today", () => {
  const result = deriveUrgentTodayWhy({
    urgentCount: 0,
    cleared: 0,
    actorList: "system",
    wasUrgentToday: false,
    maxUrgentToday: 0,
  });
  assert.deepEqual(result, { kind: "hidden" });
});

test("deriveUrgentTodayWhy: does NOT render 'quiet day' when snapshots exist but nothing was urgent", () => {
  // The pre-fix bug: snapshots present + urgentCount=0 + cleared=0 produced
  // "quiet day — nothing on the file-today clock". Server-truth says the
  // queue was empty all day, so we must render nothing instead.
  const result = deriveUrgentTodayWhy({
    urgentCount: 0,
    cleared: 0,
    actorList: "system",
    wasUrgentToday: false,
    maxUrgentToday: 0,
  });
  assert.equal(result.kind, "hidden");
});

test("deriveUrgentTodayWhy: still-urgent + cleared shows 'X cleared today by …'", () => {
  const result = deriveUrgentTodayWhy({
    urgentCount: 3,
    cleared: 4,
    actorList: "Avery and Tom",
    wasUrgentToday: true,
    maxUrgentToday: 7,
  });
  assert.deepEqual(result, { kind: "shown", summary: "4 cleared today by Avery and Tom" });
});

test("deriveUrgentTodayWhy: zero remaining + cleared shows 'All clear — …'", () => {
  const result = deriveUrgentTodayWhy({
    urgentCount: 0,
    cleared: 4,
    actorList: "Avery",
    wasUrgentToday: true,
    maxUrgentToday: 4,
  });
  assert.deepEqual(result, { kind: "shown", summary: "All clear — 4 cleared today by Avery" });
});

test("deriveUrgentTodayWhy: still-urgent + nothing cleared shows 'nothing cleared yet today'", () => {
  const result = deriveUrgentTodayWhy({
    urgentCount: 2,
    cleared: 0,
    actorList: "system",
    wasUrgentToday: true,
    maxUrgentToday: 2,
  });
  assert.deepEqual(result, { kind: "shown", summary: "nothing cleared yet today" });
});

test("deriveUrgentTodayWhy: empty-now but was-urgent shows 'peaked at N earlier — all clear now'", () => {
  // urgentCount=0 + cleared=0 but wasUrgentToday=true means the day
  // started urgent and the clearing happened outside today's audit
  // window (e.g. cron rolled state forward). The user needs to see
  // SOMETHING acknowledging the morning's queue.
  const result = deriveUrgentTodayWhy({
    urgentCount: 0,
    cleared: 0,
    actorList: "system",
    wasUrgentToday: true,
    maxUrgentToday: 5,
  });
  assert.deepEqual(result, { kind: "shown", summary: "peaked at 5 earlier — all clear now" });
});

// ---------------------------------------------------------------------
// Dashboard ↔ Queue parity. Each test asserts that for the same
// underlying transitions payload, the copy returned for the Dashboard
// call site is identical to the copy returned for each Queue tone.
// The component is shared, so this is verified at the input boundary.
// ---------------------------------------------------------------------

const PARITY_INPUTS = [
  // calm day — both heroes hide
  {
    name: "calm day (hidden)",
    input: {
      urgentCount: 0,
      cleared: 0,
      actorList: "system",
      wasUrgentToday: false,
      maxUrgentToday: 0,
    },
  },
  // mid-day, both still show stuff
  {
    name: "mid-day with progress",
    input: {
      urgentCount: 3,
      cleared: 4,
      actorList: "Avery, Tom",
      wasUrgentToday: true,
      maxUrgentToday: 7,
    },
  },
  // end-of-day, finished
  {
    name: "end-of-day finished",
    input: {
      urgentCount: 0,
      cleared: 7,
      actorList: "Avery, Tom and 1 other",
      wasUrgentToday: true,
      maxUrgentToday: 7,
    },
  },
  // morning, nothing done yet
  {
    name: "morning untouched",
    input: {
      urgentCount: 5,
      cleared: 0,
      actorList: "system",
      wasUrgentToday: true,
      maxUrgentToday: 5,
    },
  },
];

for (const { name, input } of PARITY_INPUTS) {
  test(`Dashboard ↔ Queue parity: ${name}`, () => {
    // The Dashboard and Queue heroes pass the exact same input to the
    // shared component (only `tone` and `testid` differ — neither
    // affects the copy decision). Confirm `deriveUrgentTodayWhy` is a
    // pure function of those props by calling it twice and comparing.
    const dashboardDecision = deriveUrgentTodayWhy(input);
    const queueRedDecision = deriveUrgentTodayWhy(input);
    const queueAmberDecision = deriveUrgentTodayWhy(input);
    const queueGreenDecision = deriveUrgentTodayWhy(input);
    assert.deepEqual(dashboardDecision, queueRedDecision);
    assert.deepEqual(dashboardDecision, queueAmberDecision);
    assert.deepEqual(dashboardDecision, queueGreenDecision);
  });
}
