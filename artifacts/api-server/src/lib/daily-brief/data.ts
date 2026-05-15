// Canonical data sources for the brief templates.
//
// Both the daily ops brief and the weekly exec digest read every dollar
// and count from the same dashboard endpoints the UI uses, so the email
// figures can never silently diverge from what an admin sees in the app:
//
//   • /api/dashboard/summary   — the canonical 7-day money block
//                                 + pipeline + at-risk snapshot.
//                                 Same payload that drives
//                                 web/src/pages/dashboard.tsx.
//                                 Backs the daily ops brief KPI strip.
//   • /api/dashboard/insights  — the Insights aggregator (windowable).
//                                 Same payload that drives
//                                 web/src/pages/insights.tsx.
//                                 Backs the weekly exec scorecard.
//
// Vocabulary: every $ field used by either renderer is named below in
// CanonicalSummary / CanonicalInsights. Renderers must read those
// fields verbatim — the aggregator already bakes in the vendor-prepay
// (× 1.7) multiplier, so multiplying again at the template layer
// would double-inflate every dollar shown.
//
// We hit them over loopback HTTP rather than calling the route handlers
// directly so the brief renderer is gated on exactly the same scrub /
// auth / amount-visibility code path as a real browser request — and so
// adding a new field to the dashboard immediately becomes available to
// the email renderer without a parallel SQL extraction.
//
// The bot service token is required: routes/index.ts mounts the
// dashboard router under requireAuthOrBot for exactly this caller.
// `req.user` is undefined for bot calls, which `canSeeAmounts(undefined)`
// treats as "show amounts" — there is no operator-style scrubbing in
// the email payload because the brief is admin-content (or, for
// operators, contains no money fields at all).
//
// NOTE on the legacy `× 1.7` multiplier: prior versions of the brief
// inflated raw claim amounts by the vendor-prepay rate inside the
// template layer. The canonical money fields below
// (`recoveredAmount`, `disputedAmount`, `atRiskExposure`, …) already
// have the multiplier baked in at the aggregator boundary — applying
// it a second time at the renderer would double-inflate. The new
// modules read these fields verbatim and do NOT multiply.

import { logger } from "../logger";

interface FetchOpts {
  port: number;
  botToken: string;
}

function envFetchOpts(): FetchOpts {
  const rawPort = process.env.PORT;
  const port = rawPort ? Number(rawPort) : NaN;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT env var is required to fetch canonical brief data");
  }
  const botToken = process.env.BOT_SERVICE_TOKEN ?? "";
  if (!botToken) {
    throw new Error("BOT_SERVICE_TOKEN env var is required to fetch canonical brief data");
  }
  return { port, botToken };
}

// Lightweight subset of the /dashboard/summary response. Add fields
// here only when the brief actually renders them, so tests catch when
// the dashboard contract changes underneath us.
export interface CanonicalSummary {
  pipeline: { needsEvidence: number; portalQueued: number; awaitingResponse: number };
  amounts: {
    windowDays: number;
    openInvoices: number;
    disputedAmount: string | null;
    recoveredAmount: string | null;
    confirmedRecoveredAmount: string | null;
    priorRecoveredAmount: string | null;
    recoveryRate: number | null;
    netChangeRecovered: string | null;
    atRiskExposure: string | null;
    atRiskClaim: string | null;
    atRiskGroups: number;
  };
  expiringGroups: Array<{
    id: number;
    invoiceNumber: string | null;
    earliestDate: string | null;
    daysLeft: number;
    // `effectiveDaysLeft` is the dashboard's canonical edge-aware
    // remaining-days field (see routes/dashboard.ts ~L541). Brief
    // KPIs that count "due tomorrow" must use THIS, not `daysLeft`,
    // so the email matches the dashboard's "today-tomorrow" filter.
    effectiveDaysLeft: number;
    isUrgent: boolean;
    totalAmount: string | null;
  }>;
  urgentCount: number;
  submittedStuckCount: number;
  today: string;
}

// Canonical /api/responses/awaiting-review/count contract. Same value
// the dashboard's "Responses Awaiting Review" hero tile reads via
// useGetResponsesAwaitingReviewCount() — see web/src/pages/dashboard.tsx.
export interface CanonicalReviewCount {
  count: number;
  masActionCount: number;
}

export interface CanonicalInsights {
  days: number;
  totalClaims: number;
  totalRecoveredAmount: string | null;
  totalDeniedAmount: string | null;
  priorPeriodRecoveredAmount: string | null;
  atRiskAmount: string | null;
  atRiskGroupCount: number;
  pipelineByPhase: Array<{ phase: string; count: number; openAmount: string | null }>;
  payorConcentrationByGroup: Array<{
    payorEmail: string;
    openCount: number;
    invoiceCountInWindow: number;
    openAtRiskAmount: string | null;
    winRate: number | null;
  }>;
  groupOutcomeBreakdown: Array<{ outcome: string; count: number }>;
  errorTypeBreakdown: Array<{
    name: string;
    count: number;
    recoveredAmount: string | null;
    deniedAmount: string | null;
  }>;
}

async function jsonFetch<T>(path: string): Promise<T> {
  const { port, botToken } = envFetchOpts();
  const res = await fetch(`http://localhost:${port}${path}`, {
    headers: { "x-bot-token": botToken, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function fetchCanonicalSummary(): Promise<CanonicalSummary> {
  return jsonFetch<CanonicalSummary>("/api/dashboard/summary");
}

export async function fetchCanonicalInsights(days: number): Promise<CanonicalInsights> {
  return jsonFetch<CanonicalInsights>(`/api/dashboard/insights?days=${days}`);
}

export async function fetchCanonicalReviewCount(): Promise<CanonicalReviewCount> {
  return jsonFetch<CanonicalReviewCount>("/api/responses/awaiting-review/count");
}

export async function safeFetchCanonicalReviewCount(
  notes: { source: string; message: string }[],
): Promise<CanonicalReviewCount | null> {
  try {
    return await fetchCanonicalReviewCount();
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ err }, "[BRIEF] /responses/awaiting-review/count fetch failed");
    notes.push({ source: "responses_awaiting_review_count", message: msg.slice(0, 240) });
    return null;
  }
}

// Resilient wrappers — callers add a degradation note instead of
// 500-ing the whole brief when an aggregator call fails.

export async function safeFetchCanonicalSummary(
  notes: { source: string; message: string }[],
): Promise<CanonicalSummary | null> {
  try {
    return await fetchCanonicalSummary();
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ err }, "[BRIEF] /dashboard/summary fetch failed");
    notes.push({ source: "dashboard_summary", message: msg.slice(0, 240) });
    return null;
  }
}

export async function safeFetchCanonicalInsights(
  days: number,
  notes: { source: string; message: string }[],
): Promise<CanonicalInsights | null> {
  try {
    return await fetchCanonicalInsights(days);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ err, days }, "[BRIEF] /dashboard/insights fetch failed");
    notes.push({ source: "dashboard_insights", message: msg.slice(0, 240) });
    return null;
  }
}
