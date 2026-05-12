// Operator daily brief MUST include the same morning context the
// admin variant does — KPI strip, "Yesterday", and attention block —
// before the per-user worklist. The role-specific section is the
// "Needs you today" worklist itself; everything above it is shared.
//
// This test renders the operator body with a representative fixture
// and asserts each shared section appears.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { renderOperatorDailyBody } from "../lib/daily-brief/daily-body";
import type { CanonicalSummary } from "../lib/daily-brief/data";
import type { PortalAttentionBundle } from "../lib/daily-brief/portal-attention";
import type { YesterdayActivity, NeedsYouToday } from "../lib/brief-personalization";

const summary: CanonicalSummary = {
  amounts: {
    openInvoices: 96,
    atRiskExposure: "12345.67",
    atRiskGroups: 3,
    recoveredAmount: "5000.00",
    priorRecoveredAmount: "4000.00",
    recoveryRate: 42,
    netChangeRecovered: "1000.00",
  },
  pipeline: { awaitingResponse: 14 },
  urgentCount: 2,
  expiringGroups: [
    { id: 1, invoiceNumber: "INV-1001", earliestDate: "2026-05-01", totalAmount: "300.00", daysLeft: 0, effectiveDaysLeft: 0, isUrgent: true },
    { id: 2, invoiceNumber: "INV-1002", earliestDate: "2026-05-03", totalAmount: "400.00", daysLeft: 1, effectiveDaysLeft: 1, isUrgent: false },
  ],
} as unknown as CanonicalSummary;

const yesterday: YesterdayActivity = {
  claimsCreated: 4,
  draftsSubmitted: 7,
  responsesReceived: 2,
  decisionsLogged: 1,
};

const attention: PortalAttentionBundle = {
  needsAttention: [
    {
      id: 42,
      confNumber: "CONF-42",
      reason: "failed",
      attempts: 3,
      maxAttempts: 3,
      nextRetryAt: null,
      errorMessage: "portal returned 500",
      status: "failed",
    },
  ],
  manualRequeues: [],
};

const needs: NeedsYouToday = {
  needsReview: [
    { id: 7, confNumber: "CLM-7", status: "Response received", reason: "Awaiting your review", href: "/queue/7" },
  ],
  unsubmittedDrafts: [],
  recentlyTouched: [],
};

test("operator daily body renders shared head sections (KPI / yesterday / attention) before worklist", () => {
  const html = renderOperatorDailyBody(needs, "alice@example.com", summary, yesterday, attention);

  // KPI strip — at minimum the "Open invoices" and "At-risk $" tiles.
  assert.match(html, /Open invoices/);
  assert.match(html, /At-risk \$/);
  assert.match(html, /Due today/);

  // Yesterday row.
  assert.match(html, /Yesterday/);
  assert.match(html, /claims created/);
  assert.match(html, /drafts submitted/);

  // Attention block.
  assert.match(html, /Needs your attention/);
  assert.match(html, /CONF-42/);

  // Operator-specific worklist still present.
  assert.match(html, /Responses awaiting your review/);
  assert.match(html, /CLM-7/);
});

test("operator daily body still renders gracefully when summary is unavailable", () => {
  const html = renderOperatorDailyBody(needs, "alice@example.com", null, yesterday, attention);
  assert.match(html, /summary unavailable/i);
  assert.match(html, /Yesterday/);
  assert.match(html, /Responses awaiting your review/);
});
