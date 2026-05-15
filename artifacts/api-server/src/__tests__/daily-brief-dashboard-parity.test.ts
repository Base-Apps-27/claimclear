// Dashboard ↔ daily-brief metric parity.
//
// Every KPI tile rendered in the daily brief must trace back to the
// same canonical source the dashboard UI uses. Specifically:
//
//   • "Due today"               → summary.urgentCount   (server clock)
//   • "Due tomorrow"            → expiringGroups.filter(effectiveDaysLeft===1)
//                                  (matches the dashboard's
//                                   matchesExpiringFilter("today-tomorrow")
//                                   edge-aware predicate)
//   • "Responses awaiting review" → /api/responses/awaiting-review/count
//                                   (NOT summary.pipeline.awaitingResponse,
//                                    which is the unrelated payer-side
//                                    "awaiting payer reply" status count)
//
// Regressing any of these silently mis-states KPIs in the email vs the
// dashboard, so the parity is locked here.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { renderAdminDailyBody } from "../lib/daily-brief/daily-body";
import type { CanonicalSummary, CanonicalReviewCount } from "../lib/daily-brief/data";
import type { PortalAttentionBundle } from "../lib/daily-brief/portal-attention";
import type { YesterdayActivity } from "../lib/brief-personalization";

const baseSummary: CanonicalSummary = {
  amounts: {
    openInvoices: 12,
    atRiskExposure: "0.00",
    atRiskGroups: 0,
    recoveredAmount: "0.00",
    confirmedRecoveredAmount: "0.00",
    priorRecoveredAmount: "0.00",
    recoveryRate: 0,
    netChangeRecovered: "0.00",
    disputedAmount: "0.00",
  },
  // pipeline.awaitingResponse is intentionally a DIFFERENT, large number
  // than the review-count fixture below — so the test fails loudly if
  // the renderer ever falls back to it.
  pipeline: { awaitingResponse: 999 },
  urgentCount: 5,
  expiringGroups: [
    { id: 1, invoiceNumber: "A", earliestDate: "2026-05-12", totalAmount: "0", daysLeft: 0, effectiveDaysLeft: 0, isUrgent: true },
    { id: 2, invoiceNumber: "B", earliestDate: "2026-05-13", totalAmount: "0", daysLeft: 1, effectiveDaysLeft: 1, isUrgent: false },
    { id: 3, invoiceNumber: "C", earliestDate: "2026-05-13", totalAmount: "0", daysLeft: 1, effectiveDaysLeft: 1, isUrgent: false },
    { id: 4, invoiceNumber: "D", earliestDate: "2026-05-14", totalAmount: "0", daysLeft: 2, effectiveDaysLeft: 2, isUrgent: false },
  ],
} as unknown as CanonicalSummary;

const yesterday: YesterdayActivity = {
  claimsCreated: 0,
  draftsSubmitted: 0,
  responsesReceived: 0,
  decisionsLogged: 0,
};
const attention: PortalAttentionBundle = { needsAttention: [], manualRequeues: [] };

function tileValue(html: string, label: string): string | null {
  // The KPI strip renders each tile with the label and value in close
  // proximity. Find the label, then the next number-or-em-dash token.
  const labelIdx = html.indexOf(label);
  if (labelIdx < 0) return null;
  const window = html.slice(Math.max(0, labelIdx - 600), labelIdx + 200);
  const m = window.match(/>(\d[\d,]*|—)</g);
  if (!m || m.length === 0) return null;
  const last = m[m.length - 1];
  return last.slice(1, -1);
}

test("'Due today' tile reads summary.urgentCount, not a local recount of expiringGroups", () => {
  const review: CanonicalReviewCount = { count: 7, masActionCount: 0 };
  const html = renderAdminDailyBody(baseSummary, yesterday, attention, review);
  assert.equal(tileValue(html, "Due today"), "5",
    `expected 'Due today' tile to be 5 (summary.urgentCount), got ${tileValue(html, "Due today")}`);
});

test("'Due tomorrow' tile counts expiringGroups by effectiveDaysLeft===1", () => {
  const review: CanonicalReviewCount = { count: 7, masActionCount: 0 };
  const html = renderAdminDailyBody(baseSummary, yesterday, attention, review);
  assert.equal(tileValue(html, "Due tomorrow"), "2",
    `expected 'Due tomorrow' tile to be 2 (effectiveDaysLeft===1 groups), got ${tileValue(html, "Due tomorrow")}`);
});

test("'Responses awaiting review' tile reads the canonical review-count endpoint, NOT pipeline.awaitingResponse", () => {
  const review: CanonicalReviewCount = { count: 7, masActionCount: 0 };
  const html = renderAdminDailyBody(baseSummary, yesterday, attention, review);
  assert.match(html, /Responses awaiting review/);
  assert.equal(tileValue(html, "Responses awaiting review"), "7",
    "review tile must mirror /api/responses/awaiting-review/count");
  assert.equal(html.includes("999"), false,
    "review tile must NOT fall back to pipeline.awaitingResponse (999)");
});

test("'Responses awaiting review' tile degrades to '—' when review-count fetch failed", () => {
  const html = renderAdminDailyBody(baseSummary, yesterday, attention, null);
  assert.equal(tileValue(html, "Responses awaiting review"), "—");
  assert.equal(html.includes("999"), false,
    "even on degradation, must NOT fall back to pipeline.awaitingResponse");
});
