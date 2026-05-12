// Section-level coverage for the weekly executive digest body. The
// route-level tests already prove the cron + outcome plumbing; this
// test pins the renderer contract: the headline scorecard tiles
// + every supporting section must appear in the rendered HTML so a
// regression that drops a section is caught at unit-test speed.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { renderWeeklyExecBody } from "../lib/daily-brief/weekly-body";
import type { CanonicalSummary, CanonicalInsights } from "../lib/daily-brief/data";

const summary: CanonicalSummary = {
  amounts: {
    openInvoices: 96,
    atRiskExposure: "12345.67",
    atRiskGroups: 3,
    recoveredAmount: "5000.00",
    priorRecoveredAmount: "4000.00",
    recoveryRate: 42,
    netChangeRecovered: "1000.00",
    disputedAmount: "11904.76",
  },
  pipeline: { awaitingResponse: 14 },
  urgentCount: 2,
  expiringGroups: [],
} as unknown as CanonicalSummary;

const insights: CanonicalInsights = {
  totalRecoveredAmount: "5000.00",
  priorPeriodRecoveredAmount: "4000.00",
  atRiskAmount: "12345.67",
  atRiskGroupCount: 3,
  pipelineByPhase: [
    { phase: "Filed", count: 7, openAmount: "2500.00" },
    { phase: "Disputed", count: 4, openAmount: "1800.00" },
  ],
  groupOutcomeBreakdown: [
    { outcome: "won", count: 3 },
    { outcome: "lost", count: 1 },
    { outcome: "withdrawn", count: 0 },
  ],
  payorConcentrationByGroup: [
    {
      payorEmail: "claims@bigpayor.example",
      openCount: 9,
      openAtRiskAmount: "8000.00",
      winRate: 62,
    },
  ],
  errorTypeBreakdown: [
    { name: "Missing auth", count: 5, deniedAmount: "3000.00", recoveredAmount: "1500.00" },
    { name: "Coding error", count: 2, deniedAmount: "1200.00", recoveredAmount: "0.00" },
    { name: "Late filing", count: 1, deniedAmount: "0.00", recoveredAmount: "0.00" },
  ],
} as unknown as CanonicalInsights;

test("weekly exec body renders every required section", () => {
  const html = renderWeeklyExecBody(summary, insights);

  // Headline scorecard tiles (all six).
  assert.match(html, /Recovered \(7d\)/);
  assert.match(html, /Net change vs prior/);
  assert.match(html, /Disputed \(7d\)/);
  assert.match(html, /Recovery rate/);
  assert.match(html, /At-risk \$/);
  assert.match(html, /Open invoices/);

  // Recovery vs prior week recap block.
  assert.match(html, /Recovery vs prior week/);

  // Supporting sections.
  assert.match(html, /Pipeline/);
  assert.match(html, /Group outcomes \(last 7d\)/);
  assert.match(html, /Top payors by open at-risk \$/);
  assert.match(html, /Top denial reasons \(last 7d\)/);

  // Top denial reasons must be sorted by $ denied desc — "Missing auth"
  // ($3000) must appear before "Coding error" ($1200), and the
  // zero-denial "Late filing" row must be excluded.
  const missingAuthIdx = html.indexOf("Missing auth");
  const codingErrorIdx = html.indexOf("Coding error");
  assert.ok(missingAuthIdx > 0, "expected Missing auth row");
  assert.ok(codingErrorIdx > 0, "expected Coding error row");
  assert.ok(
    missingAuthIdx < codingErrorIdx,
    "denial reasons must be sorted by $ denied desc",
  );
  assert.equal(html.includes("Late filing"), false, "zero-$ denial rows are excluded");
});

test("weekly exec body degrades gracefully when both feeds fail", () => {
  const html = renderWeeklyExecBody(null, null);
  assert.match(html, /returned errors/i);
});
