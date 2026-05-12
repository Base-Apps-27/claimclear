// Weekly executive digest body. Reads from the canonical 7-day money
// block (/dashboard/summary) for the headline scorecard and from
// /dashboard/insights?days=7 for the supporting cross-cuts (payor
// concentration, top denial reasons, group outcome funnel).
//
// Audience: admins. Tone: scoreboard. No operator action items — the
// daily ops brief covers the "what to do today" surface.
//
// Headline scorecard tiles (all read verbatim from the aggregator):
//   • Recovered (7d) vs prior 7d
//   • Net change vs prior 7d   (canonical summary.amounts.netChangeRecovered)
//   • Disputed (7d)            (canonical summary.amounts.disputedAmount)
//   • Recovery rate            (recovered ÷ disputed)
//   • At-risk $
//   • Open invoices
//
// CRITICAL: every dollar here is rendered verbatim from the aggregator.
// The vendor-prepay (× 1.7) multiplier is already baked into the
// aggregator outputs; multiplying again at the renderer would
// double-inflate. Do not reintroduce.

import {
  kpiStrip,
  sectionHeader,
  simpleTable,
  money,
  pct,
  deltaArrow,
  escapeHtml,
  paragraph,
  type KpiTile,
} from "./partials";
import type { CanonicalSummary, CanonicalInsights } from "./data";

function parseAmount(raw: string | number | null | undefined): number {
  if (raw == null) return 0;
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export function renderWeeklyExecBody(
  summary: CanonicalSummary | null,
  insights: CanonicalInsights | null,
): string {
  if (!summary && !insights) {
    return paragraph(
      "Both /dashboard/summary and /dashboard/insights returned errors — see degradation notes below.",
    );
  }

  const recovered = parseAmount(
    summary?.amounts.recoveredAmount ?? insights?.totalRecoveredAmount,
  );
  const prior = parseAmount(
    summary?.amounts.priorRecoveredAmount ?? insights?.priorPeriodRecoveredAmount,
  );
  const trend = deltaArrow(recovered, prior);
  const netChange = summary?.amounts.netChangeRecovered ?? (recovered - prior).toFixed(2);
  const disputed = summary?.amounts.disputedAmount ?? null;

  // Headline scorecard — disputed and net change are first-class tiles
  // alongside recovered/recovery-rate so the exec read is one glance.
  const tiles: KpiTile[] = [
    {
      label: "Recovered (7d)",
      value: money(recovered),
      hint: `${trend.arrow} ${trend.label} vs prior 7d`,
      emphasis: recovered > prior ? "good" : recovered < prior ? "warn" : "default",
    },
    {
      label: "Net change vs prior",
      value: money(netChange),
      hint: `Prior 7d: ${money(prior)}`,
      emphasis: parseAmount(netChange) > 0 ? "good" : parseAmount(netChange) < 0 ? "warn" : "default",
    },
    {
      label: "Disputed (7d)",
      value: money(disputed),
      hint: "Total in window",
    },
    {
      label: "Recovery rate",
      value: pct(summary?.amounts.recoveryRate ?? null),
      hint: "Recovered ÷ Disputed",
    },
    {
      label: "At-risk $",
      value: money(summary?.amounts.atRiskExposure ?? insights?.atRiskAmount ?? null),
      hint: `${summary?.amounts.atRiskGroups ?? insights?.atRiskGroupCount ?? 0} groups`,
      emphasis: "warn",
    },
    {
      label: "Open invoices",
      value: String(summary?.amounts.openInvoices ?? "—"),
    },
  ];

  const recoveryBlock = `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:12px 0;background:#fafafa;">
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.05em;">Recovery vs prior week</div>
      <div style="font-size:13px;color:#444;line-height:1.6;margin-top:6px;">
        Recovered ${escapeHtml(money(recovered))} this week vs ${escapeHtml(money(prior))} prior.
        Net change ${escapeHtml(money(netChange))}.
        Disputed in window: ${escapeHtml(money(disputed))}.
      </div>
    </div>
  `;

  // Pipeline funnel — 4 phases from insights aggregator. Defensive when
  // insights is null.
  const pipelineRows = (insights?.pipelineByPhase ?? []).map((p) => ({
    cells: [escapeHtml(p.phase), String(p.count), escapeHtml(money(p.openAmount))],
  }));
  const pipelineSection = `
    ${sectionHeader("Pipeline", "Counts and open $ by phase (last 7d)")}
    ${simpleTable(["Phase", "Count", "Open $"], pipelineRows)}
  `;

  // Group outcome breakdown — wins / losses / withdrawn / pending /
  // no-action / non-issue. Same source the Insights page uses.
  const outcomeRows = (insights?.groupOutcomeBreakdown ?? [])
    .filter((o) => o.count > 0)
    .map((o) => ({ cells: [escapeHtml(o.outcome), String(o.count)] }));
  const outcomeSection = `
    ${sectionHeader("Group outcomes (last 7d)")}
    ${simpleTable(["Outcome", "Groups"], outcomeRows)}
  `;

  // Top payor concentration — open at-risk $ and win rate.
  const payorRows = (insights?.payorConcentrationByGroup ?? []).slice(0, 5).map((p) => ({
    cells: [
      escapeHtml(p.payorEmail),
      String(p.openCount),
      escapeHtml(money(p.openAtRiskAmount)),
      escapeHtml(pct(p.winRate)),
    ],
  }));
  const payorSection = `
    ${sectionHeader("Top payors by open at-risk $")}
    ${simpleTable(["Payor", "Open", "At-risk $", "Win rate"], payorRows)}
  `;

  // Top denial reasons by $ denied — sort by deniedAmount desc, exclude
  // zero-denial rows so the table actually shows denial drivers and not
  // just the most-frequent error type.
  const denialRows = (insights?.errorTypeBreakdown ?? [])
    .map((e) => ({ ...e, denied: parseAmount(e.deniedAmount) }))
    .filter((e) => e.denied > 0)
    .sort((a, b) => b.denied - a.denied)
    .slice(0, 5)
    .map((e) => ({
      cells: [
        escapeHtml(e.name),
        String(e.count),
        escapeHtml(money(e.deniedAmount)),
        escapeHtml(money(e.recoveredAmount)),
      ],
    }));
  const denialSection = `
    ${sectionHeader("Top denial reasons (last 7d)", "Ranked by $ denied")}
    ${simpleTable(["Error type", "Count", "Denied", "Recovered"], denialRows)}
  `;

  return `
    ${kpiStrip(tiles)}
    ${recoveryBlock}
    ${pipelineSection}
    ${outcomeSection}
    ${payorSection}
    ${denialSection}
  `;
}
