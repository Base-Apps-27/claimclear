// Regression: dashboard's /api/dashboard/summary returns recoveryRate
// as an integer percent (e.g. 42 means 42%). The brief renderer's
// pct() helper must NOT multiply that value by 100 again — doing so
// would render "4200%" in the email and silently break exec
// reconciliation against the dashboard.
//
// We feed both the daily admin body and the weekly exec body a
// realistic summary with recoveryRate=42 and assert the rendered
// HTML contains "42%" exactly once and never "4200%".

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { renderAdminDailyBody } from "../lib/daily-brief/daily-body";
import { renderWeeklyExecBody } from "../lib/daily-brief/weekly-body";
import { pct } from "../lib/daily-brief/partials";
import type { CanonicalSummary, CanonicalInsights } from "../lib/daily-brief/data";
import type { PortalAttentionBundle } from "../lib/daily-brief/portal-attention";
import type { YesterdayActivity } from "../lib/brief-personalization";

const summary: CanonicalSummary = {
  amounts: {
    openInvoices: 96,
    atRiskExposure: "12345.67",
    atRiskGroups: 3,
    recoveredAmount: "5000.00",
    confirmedRecoveredAmount: "3500.00",
    priorRecoveredAmount: "4000.00",
    recoveryRate: 42,
    netChangeRecovered: "1000.00",
    disputedAmount: "11904.76",
  },
  pipeline: { awaitingResponse: 14 },
  urgentCount: 0,
  expiringGroups: [],
} as unknown as CanonicalSummary;

const yesterday: YesterdayActivity = {
  claimsCreated: 0,
  draftsSubmitted: 0,
  responsesReceived: 0,
  decisionsLogged: 0,
};
const attention: PortalAttentionBundle = { needsAttention: [], manualRequeues: [] };
const insights: CanonicalInsights = {
  totalRecoveredAmount: "5000.00",
  priorPeriodRecoveredAmount: "4000.00",
  atRiskAmount: "12345.67",
  atRiskGroupCount: 3,
  pipelineByPhase: [],
  groupOutcomeBreakdown: [],
  payorConcentrationByGroup: [],
  errorTypeBreakdown: [],
} as unknown as CanonicalInsights;

test("pct() treats input as already-percent (42 → '42%', not '4200%')", () => {
  assert.equal(pct(42), "42%");
  assert.equal(pct(0), "0%");
  assert.equal(pct(100), "100%");
  assert.equal(pct("42"), "42%");
  assert.equal(pct(null), "—");
  assert.equal(pct(undefined), "—");
});

test("daily admin body renders recoveryRate=42 as '42%' (not '4200%')", () => {
  const html = renderAdminDailyBody(summary, yesterday, attention);
  assert.ok(html.includes("42%"), `expected '42%' in daily body, got: ${html.slice(0, 400)}`);
  assert.equal(html.includes("4200%"), false, "daily body must not double-multiply recovery rate");
});

test("weekly exec body renders recoveryRate=42 as '42%' (not '4200%')", () => {
  const html = renderWeeklyExecBody(summary, insights);
  assert.ok(html.includes("42%"), `expected '42%' in weekly body, got: ${html.slice(0, 400)}`);
  assert.equal(html.includes("4200%"), false, "weekly body must not double-multiply recovery rate");
});
