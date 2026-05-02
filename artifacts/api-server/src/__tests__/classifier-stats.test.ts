import { test } from "node:test";
import { strict as assert } from "node:assert";

import { computeCostUsd, getPricing } from "../lib/llm-pricing";
import {
  computeClassifierStats,
  detectSpikes,
  VERDICT_BINS,
  type ClassifierStatsRow,
  type DailyClassifierStats,
} from "../lib/classifier-stats";

// ---------------------------------------------------------------------------
// llm-pricing — Haiku math is the only pricing the live classifier hits, but
// the table also covers Sonnet/Opus so a future model bump still produces a
// number on the dashboard. Unknown models intentionally bill $0 so a daily
// total is summable; the row-level absence is logged elsewhere.
// ---------------------------------------------------------------------------

test("computeCostUsd: claude-haiku-4-5 charges $1/$5 per Mtok", () => {
  // 1M input + 1M output = $1 + $5 = $6
  const cost = computeCostUsd({
    model: "claude-haiku-4-5",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(cost, 6);
});

test("computeCostUsd: small Haiku call produces a tiny but non-zero number", () => {
  // 2k input + 200 output ≈ $0.000003 — well under a cent but must be > 0.
  const cost = computeCostUsd({
    model: "claude-haiku-4-5",
    inputTokens: 2000,
    outputTokens: 200,
  });
  assert.ok(cost > 0, "small Haiku call should still cost something");
  assert.ok(cost < 0.01, "small Haiku call should cost less than a cent");
});

test("computeCostUsd: unknown model bills $0 (not NaN)", () => {
  // Any future-model regression should keep the daily-total math summable.
  // A dedicated dashboard line surfaces the unknown-model case visually.
  const cost = computeCostUsd({
    model: "claude-future-9-9",
    inputTokens: 1000,
    outputTokens: 100,
  });
  assert.equal(cost, 0);
});

test("getPricing: returns null for unknown models", () => {
  assert.equal(getPricing("not-a-real-model"), null);
});

// ---------------------------------------------------------------------------
// computeClassifierStats — the dashboard rollup. Validates day bucketing,
// verdict-bin counting, spend summation, and that empty days in the window
// still appear so the dashboard renders a continuous timeline.
// ---------------------------------------------------------------------------

function row(partial: Partial<ClassifierStatsRow> & { receivedAt: Date }): ClassifierStatsRow {
  return {
    classifierSource: "ai",
    responseType: "approval",
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    ...partial,
  };
}

test("computeClassifierStats: empty input still emits zero-filled days for the window", () => {
  const now = new Date("2026-05-02T12:00:00.000Z");
  const stats = computeClassifierStats({ windowDays: 7, now, rows: [] });
  assert.equal(stats.daily.length, 7);
  // Last day must be "today", first must be (today - 6).
  assert.equal(stats.daily[stats.daily.length - 1].day, "2026-05-02");
  assert.equal(stats.daily[0].day, "2026-04-26");
  for (const d of stats.daily) {
    assert.equal(d.totalRows, 0);
    assert.equal(d.spendUsd, 0);
  }
  assert.equal(stats.totals.rows, 0);
  assert.equal(stats.alerts.length, 0);
});

test("computeClassifierStats: AI rows count toward verdict bin AND aiCallCount", () => {
  const now = new Date("2026-05-02T12:00:00.000Z");
  const day = new Date("2026-05-01T08:00:00.000Z");
  const stats = computeClassifierStats({
    windowDays: 7,
    now,
    rows: [
      row({ receivedAt: day, classifierSource: "ai", responseType: "approval", costUsd: 0.001, inputTokens: 1000, outputTokens: 100 }),
      row({ receivedAt: day, classifierSource: "ai", responseType: "denial", costUsd: 0.002, inputTokens: 1500, outputTokens: 120 }),
    ],
  });
  const dayBucket = stats.daily.find((d) => d.day === "2026-05-01")!;
  assert.equal(dayBucket.verdicts.approval, 1);
  assert.equal(dayBucket.verdicts.denial, 1);
  assert.equal(dayBucket.aiCallCount, 2);
  assert.equal(dayBucket.aiAttemptCount, 2);
  assert.equal(dayBucket.spendUsd, 0.003);
  assert.equal(dayBucket.inputTokens, 2500);
  assert.equal(stats.totals.aiCalls, 2);
  assert.equal(stats.totals.spendUsd, 0.003);
});

test("computeClassifierStats: abstain rows land in the abstain bin (not 'other')", () => {
  // Abstain rows live in the DB as classifierSource=abstain + responseType=other,
  // but on the dashboard they need their own bin so a Haiku outage is
  // visible separately from genuine 'other' verdicts.
  const now = new Date("2026-05-02T12:00:00.000Z");
  const day = new Date("2026-05-01T08:00:00.000Z");
  const stats = computeClassifierStats({
    windowDays: 7,
    now,
    rows: [
      row({ receivedAt: day, classifierSource: "abstain", responseType: "other", costUsd: 0, inputTokens: 0, outputTokens: 0 }),
      row({ receivedAt: day, classifierSource: "abstain", responseType: "other" }),
    ],
  });
  const dayBucket = stats.daily.find((d) => d.day === "2026-05-01")!;
  assert.equal(dayBucket.verdicts.abstain, 2);
  assert.equal(dayBucket.verdicts.other, 0, "abstain rows must NOT inflate the 'other' bin");
  assert.equal(dayBucket.abstainCount, 2);
  assert.equal(dayBucket.aiAttemptCount, 2);
  assert.equal(dayBucket.aiCallCount, 0);
});

test("computeClassifierStats: phrase_signature rows count toward verdicts but not AI totals", () => {
  const now = new Date("2026-05-02T12:00:00.000Z");
  const day = new Date("2026-05-01T08:00:00.000Z");
  const stats = computeClassifierStats({
    windowDays: 7,
    now,
    rows: [
      row({ receivedAt: day, classifierSource: "phrase_signature", responseType: "acknowledgment" }),
      row({ receivedAt: day, classifierSource: "retro_phrase_signature", responseType: "acknowledgment" }),
    ],
  });
  const dayBucket = stats.daily.find((d) => d.day === "2026-05-01")!;
  assert.equal(dayBucket.verdicts.acknowledgment, 2);
  assert.equal(dayBucket.phraseSignatureCount, 2);
  assert.equal(dayBucket.aiCallCount, 0);
  assert.equal(dayBucket.aiAttemptCount, 0);
  assert.equal(stats.totals.aiCalls, 0);
});

test("computeClassifierStats: rows outside the window are dropped", () => {
  const now = new Date("2026-05-02T12:00:00.000Z");
  const stats = computeClassifierStats({
    windowDays: 3,
    now,
    rows: [
      row({ receivedAt: new Date("2026-04-15T00:00:00.000Z"), classifierSource: "ai", responseType: "approval" }),
    ],
  });
  assert.equal(stats.totals.rows, 0);
});

test("VERDICT_BINS includes every ClassifiedDecision plus abstain", () => {
  // Smoke check that the bin list stays in sync with the type (all 6 enum
  // values from the classifier + abstain). If a new decision is added,
  // the dashboard needs a new column too.
  assert.deepEqual([...VERDICT_BINS].sort(), [
    "abstain",
    "acknowledgment",
    "approval",
    "denial",
    "info_request",
    "other",
    "partial_approval",
  ]);
});

// ---------------------------------------------------------------------------
// detectSpikes — the alert layer. Validates the multiplier + absolute floor,
// the low-volume guard, and that no alert fires when behavior is steady.
// ---------------------------------------------------------------------------

function steadyDay(day: string, attempts: number, otherFrac: number, abstainCount: number = 0): DailyClassifierStats {
  const otherCount = Math.round(attempts * otherFrac);
  const verdicts = {
    approval: 0, denial: 0, partial_approval: 0, info_request: 0,
    acknowledgment: 0, other: otherCount, abstain: abstainCount,
  };
  // Fill remaining attempts as 'approval' so the AI bin sums correctly.
  verdicts.approval = Math.max(0, attempts - otherCount - abstainCount);
  return {
    day,
    verdicts,
    phraseSignatureCount: 0,
    aiAttemptCount: attempts,
    aiCallCount: attempts - abstainCount,
    abstainCount,
    totalRows: attempts,
    spendUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

test("detectSpikes: stays silent when 'other' rate is steady", () => {
  // Baseline 8 days at 5% other, recent day at 5% other → no alert.
  const series: DailyClassifierStats[] = [];
  for (let i = 0; i < 8; i++) series.push(steadyDay(`2026-04-${20 + i}`, 20, 0.05));
  series.push(steadyDay("2026-04-30", 20, 0.05)); // recent (day -1)
  series.push(steadyDay("2026-05-01", 5, 0)); // today (partial)
  const alerts = detectSpikes(series, {});
  assert.deepEqual(alerts, []);
});

test("detectSpikes: fires spike_other when recent day's other rate >= 2x baseline AND >= 25%", () => {
  const series: DailyClassifierStats[] = [];
  for (let i = 0; i < 8; i++) series.push(steadyDay(`2026-04-${20 + i}`, 20, 0.05));
  series.push(steadyDay("2026-04-30", 20, 0.4)); // recent: 40% other
  series.push(steadyDay("2026-05-01", 5, 0));
  const alerts = detectSpikes(series, {});
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "spike_other");
  assert.equal(alerts[0].recentSample, 20);
  assert.ok(alerts[0].recentRate >= 0.25);
});

test("detectSpikes: ignores days with sample below the floor", () => {
  // Two abstain calls out of two doesn't justify an alert — too small to
  // distinguish a real outage from random noise.
  const series: DailyClassifierStats[] = [];
  for (let i = 0; i < 8; i++) series.push(steadyDay(`2026-04-${20 + i}`, 20, 0.05));
  series.push(steadyDay("2026-04-30", 2, 0, 2));
  series.push(steadyDay("2026-05-01", 0, 0));
  const alerts = detectSpikes(series, {});
  assert.deepEqual(alerts, [], "tiny samples must not trip the alert");
});

test("detectSpikes: fires spike_abstain on a clear outage day", () => {
  const series: DailyClassifierStats[] = [];
  for (let i = 0; i < 8; i++) series.push(steadyDay(`2026-04-${20 + i}`, 20, 0.05, 0));
  series.push(steadyDay("2026-04-30", 20, 0, 12)); // 60% abstain
  series.push(steadyDay("2026-05-01", 5, 0));
  const alerts = detectSpikes(series, {});
  const abstain = alerts.find((a) => a.kind === "spike_abstain");
  assert.ok(abstain, "expected an abstain spike alert");
  assert.ok(abstain!.recentRate >= 0.5);
});

test("detectSpikes: returns nothing when given fewer than two days of data", () => {
  assert.deepEqual(detectSpikes([], {}), []);
  assert.deepEqual(detectSpikes([steadyDay("2026-05-01", 10, 0.4)], {}), []);
});
