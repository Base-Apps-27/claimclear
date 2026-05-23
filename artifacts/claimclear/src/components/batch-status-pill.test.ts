// Pin the activity → label/count mapping for the header batch-status pill.
//
// These tests guard the two bugs the activity field + batchTotal/processed
// fields were introduced to fix:
//   1. Scraping the customer portal must NOT render as "Sending batch"
//      (the shared Chromium gate is held during both, so the old code mis-
//      labelled every gate hold as a send).
//   2. A submit batch's progress must count UP through the ORIGINAL total
//      ("1 of 23" → "2 of 23" → "3 of 23"), not appear to count down as
//      `runningCount + queuedCount` shrinks ("1 of 23" → "1 of 22" → …).
//
// We exercise the pure `deriveState` helper directly (exported solely for
// this test) instead of rendering the full pill, which would require a
// QueryClient + SSE EventSource scaffold for no extra coverage.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { deriveState } from "./batch-status-pill";

const NOW = Date.UTC(2026, 4, 22, 18, 0, 0); // 2026-05-22T18:00:00Z

function baseStatus(overrides: Record<string, unknown> = {}): Parameters<typeof deriveState>[0] {
  return {
    isRunning: false,
    activity: "idle",
    nextBatchAt: null,
    prevBatchAt: null,
    queuedCount: 0,
    runningCount: 0,
    batchTotal: null,
    batchProcessed: null,
    schedule: [],
    ...overrides,
  } as Parameters<typeof deriveState>[0];
}

// ---------------------------------------------------------------------------
// Scrape labelling — Bug 1
// ---------------------------------------------------------------------------

test("activity='scraping' renders 'Checking portal', not 'Sending batch'", () => {
  const state = deriveState(baseStatus({ activity: "scraping" }), NOW);
  assert.equal(state.subtext, "Checking portal");
  assert.notEqual(state.subtext, "Sending batch");
  assert.equal(state.running, true, "pill should still pulse so users know something is happening");
});

test("activity='scraping' carries a longer hover tooltip via `title`", () => {
  const state = deriveState(baseStatus({ activity: "scraping" }), NOW);
  assert.match(state.title ?? "", /customer portal/i);
  assert.match(state.title ?? "", /responses/i);
});

test("activity='scraping' uses the blue colour, not the green 'sending' colour", () => {
  // Green is reserved for real sends so a scrape never reads as money-moving.
  const state = deriveState(baseStatus({ activity: "scraping" }), NOW);
  assert.equal(state.color, "blue");
});

// ---------------------------------------------------------------------------
// Send progress — Bug 2 (count UP through a fixed denominator)
// ---------------------------------------------------------------------------

test("activity='sending' with batch progress counts UP: processed+1 of total", () => {
  // Batch of 23, 2 finished, 1 currently in flight — UI should read "3 of 23".
  const state = deriveState(
    baseStatus({
      activity: "sending",
      isRunning: true,
      batchTotal: 23,
      batchProcessed: 2,
      runningCount: 1,
      queuedCount: 20,
    }),
    NOW,
  );
  assert.equal(state.count, "3");
  assert.equal(state.label, "of 23");
  assert.equal(state.subtext, "Sending batch");
});

test("denominator stays fixed as the queue drains — the regression that caused '1 of 23 → 1 of 22'", () => {
  // Same total (23), more rows finished, fewer queued. Denominator must NOT
  // shrink with `runningCount + queuedCount` the way the old code did.
  const early = deriveState(
    baseStatus({
      activity: "sending",
      isRunning: true,
      batchTotal: 23,
      batchProcessed: 0,
      runningCount: 1,
      queuedCount: 22,
    }),
    NOW,
  );
  const mid = deriveState(
    baseStatus({
      activity: "sending",
      isRunning: true,
      batchTotal: 23,
      batchProcessed: 9,
      runningCount: 1,
      queuedCount: 13,
    }),
    NOW,
  );
  assert.equal(early.count, "1");
  assert.equal(early.label, "of 23");
  assert.equal(mid.count, "10");
  assert.equal(mid.label, "of 23", "denominator must stay at the original batch size");
});

test("numerator caps at total on the very last row (avoids '24 of 23')", () => {
  const state = deriveState(
    baseStatus({
      activity: "sending",
      isRunning: true,
      batchTotal: 5,
      batchProcessed: 5,
      runningCount: 0,
      queuedCount: 0,
    }),
    NOW,
  );
  assert.equal(state.count, "5");
  assert.equal(state.label, "of 5");
});

// ---------------------------------------------------------------------------
// Mixed-deploy resilience — server may not yet ship activity/batchTotal
// ---------------------------------------------------------------------------

test("legacy payload (no activity, only isRunning + counts) falls back to the old live-count display", () => {
  // Stale client / old server. We should still render a sending state
  // instead of crashing, even though the denominator behaviour reverts to
  // the legacy shrink-as-queue-drains math.
  const state = deriveState(
    baseStatus({
      isRunning: true,
      activity: undefined as unknown as "idle", // simulate missing field
      batchTotal: null,
      batchProcessed: null,
      runningCount: 1,
      queuedCount: 4,
    }),
    NOW,
  );
  assert.equal(state.subtext, "Sending batch");
  assert.equal(state.count, "1");
  assert.equal(state.label, "of 5");
});

test("activity='idle' falls through to the queued/scheduled branches, never 'Sending batch'", () => {
  const state = deriveState(
    baseStatus({
      activity: "idle",
      isRunning: false,
      queuedCount: 3,
      nextBatchAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
      prevBatchAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    }),
    NOW,
  );
  assert.notEqual(state.subtext, "Sending batch");
  assert.equal(state.running, false);
  assert.equal(state.count, "3");
  assert.equal(state.label, "queued");
});
