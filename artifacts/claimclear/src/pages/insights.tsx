// Insights vocab (matches Dashboard/daily brief):
//   Disputed = Σ invoice totalAmount in window (invoice-grain)
//   Recovered = Σ invoice approvedAmount in window
//   At risk = open invoice exposure NOW (snapshot, not windowed)
//   Pipeline.closed = resolved within window (other buckets = snapshot)
//   Deep link = /invoice-groups?macroPhase=… (Queue contract)

import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Download,
  Printer,
  TrendingUp,
  Truck,
  UserCircle2,
  Users,
  XCircle,
} from "lucide-react";
import {
  useGetDashboardSummary,
  useGetDashboardInsights,
  useGetDashboardTimeseries,
  useGetDashboardUserProductivity,
  useGetDashboardRepeatOffenders,
  getExportClaimsCsvUrl,
  getExportInvoiceGroupsCsvUrl,
} from "@workspace/api-client-react";
import { useDashboardLiveUpdates } from "@/hooks/use-claim-events";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area,
} from "recharts";
import { PageHeader, FilterStrip, type FilterStripTab, MetricTile, Section } from "@/components/cohesion";
import { InfoTooltip } from "@/components/info-tooltip";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { formatChartTick, getDisplayTimezoneShort } from "@/lib/time";
import { useRole } from "@/lib/role";

// ─── Time range ────────────────────────────────────────────────────────
// Task #712 — default range is QTD. CFO/COO read by quarter, not by an
// arbitrary trailing window, so QTD anchors all of the money / pipeline
// math on the same boundary the books close on.
type RangeKey = "7" | "30" | "90" | "qtd" | "ytd";
const RANGE_TABS: FilterStripTab<RangeKey>[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "qtd", label: "QTD" },
  { key: "ytd", label: "YTD" },
];

function daysForRange(key: RangeKey): number {
  if (key === "7") return 7;
  if (key === "30") return 30;
  if (key === "90") return 90;
  const now = new Date();
  if (key === "qtd") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const start = new Date(now.getFullYear(), quarterStartMonth, 1);
    return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000));
  }
  // ytd
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000));
}

function rangeWindowLabel(key: RangeKey, days: number): string {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  const fmt = (d: Date) => formatChartTick(d.toISOString());
  if (key === "qtd") return `Quarter to date · ${fmt(start)} – ${fmt(end)}`;
  if (key === "ytd") return `Year to date · ${fmt(start)} – ${fmt(end)}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatShortDate(ymd: string): string {
  return formatChartTick(ymd);
}

function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function MiniBar({ pct, tone = "blue" }: { pct: number; tone?: "blue" | "amber" | "red" | "green" }) {
  const map: Record<string, string> = {
    blue: "hsl(var(--primary))",
    amber: "hsl(var(--cc-warning))",
    red: "hsl(var(--destructive))",
    green: "hsl(var(--cc-success))",
  };
  return (
    <div className="h-1.5 rounded flex-1 bg-muted">
      <div className="h-full rounded" style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, background: map[tone] }} />
    </div>
  );
}

function TrendArrow({ d }: { d: "up" | "down" | "flat" }) {
  if (d === "up") return <span title="more rejections vs prior window" style={{ color: "hsl(var(--destructive))" }}>▲</span>;
  if (d === "down") return <span title="fewer rejections vs prior window" style={{ color: "hsl(var(--cc-success))" }}>▼</span>;
  return <span className="text-muted-foreground">—</span>;
}

// Per-phase visual/copy. The order here matches the API contract's
// pipeline order (pre-submit → in-flight → response-pending → closed)
// so the funnel and the JSON response can never drift apart.
const PIPELINE_PHASE_META: Array<{ key: string; label: string; tone: "amber" | "blue" | "green" | "muted"; barColor: string; deepLinkValue: string | null }> = [
  { key: "pre-submit", label: "Pre-submit", tone: "amber", barColor: "hsl(var(--cc-warning))", deepLinkValue: "pre-submit" },
  { key: "in-flight", label: "In flight", tone: "blue", barColor: "hsl(var(--primary))", deepLinkValue: "in-flight" },
  { key: "response-pending", label: "Response pending", tone: "amber", barColor: "hsl(var(--cc-warning))", deepLinkValue: "response-pending" },
  { key: "closed", label: "Closed", tone: "green", barColor: "hsl(var(--cc-success))", deepLinkValue: "closed" },
];

// Outcome row presentation. Approved-family is green, Denied/Withdrawn
// are negative tones, Pending is neutral, Non-Issue is closed-grey.
function outcomeStyle(o: string): { color: string; Icon: typeof CheckCircle2 } {
  if (o === "Approved" || o === "Partially Approved") return { color: "hsl(var(--cc-success))", Icon: CheckCircle2 };
  if (o === "Denied" || o === "Withdrawn") return { color: "hsl(var(--destructive))", Icon: XCircle };
  return { color: "hsl(var(--muted-foreground))", Icon: Activity };
}

// ─── Page ──────────────────────────────────────────────────────────────
export default function Insights() {
  // Clerks see Insights but with money figures masked to "—". The
  // server already nulls money fields for clerks, so most renders fall
  // through to formatCurrency's "—" path automatically.
  const { isClerk: clerk } = useRole();
  const [rangeKey, setRangeKey] = useState<RangeKey>("qtd");
  const days = daysForRange(rangeKey);

  // Daily Flow chart unit toggle. Default is INVOICES (the unit a CFO
  // reads books in); operators can flip to legs when they're debugging
  // claim-grain throughput. Per-leg sections elsewhere on the page are
  // explicitly tagged with a "Per leg" badge so the unit is never
  // ambiguous.
  const [flowUnit, setFlowUnit] = useState<"invoices" | "legs">("invoices");

  useDashboardLiveUpdates();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: insights, isLoading: insightsLoading } = useGetDashboardInsights({ days });
  const { data: timeseries, isLoading: tsLoading } = useGetDashboardTimeseries({ days });
  const { data: productivity, isLoading: prodLoading } = useGetDashboardUserProductivity({ days });
  const { data: repeat, isLoading: repeatLoading } = useGetDashboardRepeatOffenders({ days, limit: 5 });

  const tzShort = getDisplayTimezoneShort();

  // ─── Money scorecard ─────────────────────────────────────────────────
  // Recovered $ in window — settled-positive only, matches Dashboard
  // "Reclaimed" tile. At-risk $ is a SNAPSHOT (current open exposure),
  // matches Dashboard "At risk" tile, but invoice-grain (no ×1.7 vendor
  // prepay multiplier — that lived on the Dashboard exposure tile and
  // confused operators on Insights). Denied $ is windowed claim total
  // for outcome=Denied. Net change tile compares recovered $ against
  // the equal-length prior window.
  // All money/outcome figures are RESOLVED-IN-WINDOW (`phase=closed AND
  // phaseEnteredAt IN window`) per the new contract — the page now
  // answers "how did the disputes we closed this period turn out"
  // instead of "what arrived this period". `closedInWindowCount` is
  // the sample size driving every tile in the scorecard.
  const totalRecovered = parseFloat(insights?.totalRecoveredAmount ?? "0") || 0;
  const confirmedRecovered = parseFloat(insights?.confirmedRecoveredAmount ?? "0") || 0;
  const totalDisputed = parseFloat(insights?.totalClaimedAmount ?? "0") || 0;
  const priorRecovered = parseFloat(insights?.priorPeriodRecoveredAmount ?? "0") || 0;
  const atRiskAmount = parseFloat(insights?.atRiskAmount ?? "0") || 0;
  const atRiskGroupCount = insights?.atRiskGroupCount ?? 0;
  const closedInWindowCount = insights?.closedInWindowCount ?? 0;
  // Driver-prepay exposure tile (Task #729). Task #720 stripped the
  // ×1.7 multiplier off the Dashboard so its at-risk tile matches
  // Insights/daily-brief one-for-one. Operators still need to see the
  // full cash-on-the-line figure, so we surface it here as one
  // explicit tile with a tooltip naming the 70% vendor prepay rate.
  // Sourced from /dashboard/summary.amounts so the math is the single
  // source of truth in risk-config.ts.
  const atRiskExposureAmount = parseFloat(summary?.amounts?.atRiskExposure ?? "0") || 0;
  const vendorPrepayRate = summary?.amounts?.vendorPrepayRate ?? 0.7;
  const vendorPrepayPct = Math.round(vendorPrepayRate * 100);
  const recoveryRate = totalDisputed > 0 ? Math.round((totalRecovered / totalDisputed) * 100) : null;
  const netChange = totalRecovered - priorRecovered;
  // Cap displayed % delta at ±999% so prior=$1 → +$10k doesn't render
  // as "+1,000,000%" and dominate the row visually. The raw signed
  // dollar value still tells the real story; the % is just a sanity
  // cue. Null when prior is 0 (delta is undefined, not infinite).
  const netChangePctRaw = priorRecovered > 0 ? Math.round((netChange / priorRecovered) * 100) : null;
  const netChangePct =
    netChangePctRaw === null
      ? null
      : Math.max(-999, Math.min(999, netChangePctRaw));
  const netChangePctCapped = netChangePctRaw !== null && netChangePctRaw !== netChangePct;
  const netChangeTone: "green" | "red" | "muted" = netChange > 0 ? "green" : netChange < 0 ? "red" : "muted";
  const netChangeSign = netChange > 0 ? "+" : "";

  // ─── Pipeline snapshot ──────────────────────────────────────────────
  const pipelineRows = insights?.pipelineByPhase ?? [];
  const pipelineByKey = useMemo(() => {
    const m = new Map<string, { count: number; openAmount: number }>();
    for (const r of pipelineRows) {
      m.set(r.phase, { count: r.count, openAmount: parseFloat(r.openAmount ?? "0") || 0 });
    }
    return m;
  }, [pipelineRows]);
  const pipelineOpenInvoices = PIPELINE_PHASE_META
    .filter(p => p.key !== "closed")
    .reduce((s, p) => s + (pipelineByKey.get(p.key)?.count ?? 0), 0);
  const pipelineMaxCount = Math.max(1, ...PIPELINE_PHASE_META.map(p => pipelineByKey.get(p.key)?.count ?? 0));

  // ─── Daily flow ─────────────────────────────────────────────────────
  // Three-series chart on the invoices unit: what we filed, what we
  // re-attested (closing the loop on a win), and what the payor sent
  // back. Splits "our work" from "payor work" so the operator can
  // see whether a stalled day is on us or on them. The "legs" toggle
  // keeps the older claims-grain flow for diagnostics.
  const dailyFlow = useMemo(() => {
    const points = timeseries?.points ?? [];
    return points.map(p => {
      const created = flowUnit === "invoices" ? p.invoicesCreated : p.claimsCreated;
      const submitted = flowUnit === "invoices" ? p.invoicesSubmitted : 0;
      const reattested = flowUnit === "invoices" ? p.invoicesReattested : 0;
      const responses = flowUnit === "invoices" ? p.responsesReceived : 0;
      const resolved = flowUnit === "invoices" ? p.invoicesResolved : p.claimsResolved;
      return {
        label: formatShortDate(p.date),
        created,
        submitted,
        reattested,
        responses,
        resolved,
        // Net pipeline change per day = inflow − outflow. Positive = backlog
        // grew that day; negative = backlog drained. "Outflow" here is
        // payor responses (what actually closes the loop), not our own
        // resolved-state writes.
        netChange: created - responses,
      };
    });
  }, [timeseries, flowUnit]);
  const flowTotals = useMemo(() => {
    const denom = Math.max(1, dailyFlow.length);
    const created = dailyFlow.reduce((s, p) => s + p.created, 0);
    const submitted = dailyFlow.reduce((s, p) => s + p.submitted, 0);
    const reattested = dailyFlow.reduce((s, p) => s + p.reattested, 0);
    const responses = dailyFlow.reduce((s, p) => s + p.responses, 0);
    const resolved = dailyFlow.reduce((s, p) => s + p.resolved, 0);
    return {
      created,
      submitted,
      reattested,
      responses,
      resolved,
      avgSubmittedPerDay: submitted / denom,
      avgReattestedPerDay: reattested / denom,
      avgResponsesPerDay: responses / denom,
      avgResolvedPerDay: resolved / denom,
      // Backlog delta over window = invoices in − payor responses out.
      backlogDelta: created - responses,
    };
  }, [dailyFlow]);

  // ─── Outcomes recovered-$ trend (current window vs prior window
  // overlay). Only meaningful for users who can see money — clerks
  // get the buckets but no overlay chart.
  const recoveredTrend = useMemo(() => {
    const points = timeseries?.points ?? [];
    return points.map(p => ({
      label: formatShortDate(p.date),
      current: p.dollarsRecovered ?? 0,
      prior: p.priorDollarsRecovered ?? 0,
    }));
  }, [timeseries]);

  // ─── Outcomes ───────────────────────────────────────────────────────
  const groupOutcomeBreakdown = insights?.groupOutcomeBreakdown ?? [];
  const totalGroupOutcomes = groupOutcomeBreakdown.reduce((s, r) => s + r.count, 0);

  // ─── Risk & accountability ──────────────────────────────────────────
  const payorConcentration = insights?.payorConcentrationByGroup ?? [];
  const teamRows = useMemo(() => {
    const users = productivity?.users || [];
    return users.slice(0, 8).map(u => {
      const won = u.resolved;
      const filed = u.resolved + u.denied;
      const rate = filed > 0 ? Math.round((won / filed) * 100) : null;
      return { who: u.userName || u.userEmail, filed, won, rate, total: u.total };
    });
  }, [productivity]);

  // Deadline risk side card — sourced from /dashboard/summary so the
  // numbers stay in lockstep with the daily brief and the Queue
  // ?expiring=urgent CTA.
  const expiringGroups = summary?.expiringGroups ?? [];
  const urgentCount = summary?.urgentCount ?? 0;
  const expiringExposure = useMemo(
    () => expiringGroups.reduce((s, g) => s + (parseFloat(g.totalAmount || "0") || 0), 0),
    [expiringGroups],
  );

  // ─── Causes ─────────────────────────────────────────────────────────
  // Top denial reasons — ranked by $ DENIED (the dollar bleed each
  // cause is responsible for), per Task #712 spec. Recovered $ is
  // shown alongside as context but does NOT drive the ranking.
  const errorTypeBars = useMemo(() => {
    const rows = (insights?.errorTypeBreakdown ?? []).map(b => ({
      name: b.name,
      count: b.count,
      recovered: parseFloat(b.recoveredAmount ?? "0") || 0,
      denied: parseFloat(b.deniedAmount ?? "0") || 0,
    }));
    const entries = rows.sort((a, b) => b.denied - a.denied).slice(0, 6);
    const maxDenied = entries.reduce((m, e) => Math.max(m, e.denied), 0) || 1;
    // % is "share of $ DENIED" — the same axis the ranking is on. The
    // old denominator was `totalClaims` (all claims, including
    // approvals and pending) so a denial cause that owned 100% of the
    // dollar bleed could still read "3%" because most legs weren't
    // denials. Using denied $ as the denominator makes the row read
    // "this cause is responsible for X% of the bleed".
    const totalDeniedForPct = rows.reduce((s, e) => s + e.denied, 0) || 1;
    return entries.map(e => ({
      ...e,
      pct: Math.round((e.denied / totalDeniedForPct) * 100),
      barPct: Math.round((e.denied / maxDenied) * 100),
    }));
  }, [insights?.errorTypeBreakdown, insights?.totalClaims]);

  // ─── Export ─────────────────────────────────────────────────────────
  // Default export is INVOICE-grain (one row per invoice group), since
  // the page's primary unit is the invoice. The dropdown still lets
  // operators grab the per-leg view when they need it.
  const exportInvoicesHref = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const iso = since.toISOString().slice(0, 10);
    return getExportInvoiceGroupsCsvUrl({ createdFrom: iso });
  }, [days]);
  const exportLegsHref = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const iso = since.toISOString().slice(0, 10);
    return getExportClaimsCsvUrl({ createdFrom: iso });
  }, [days]);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handlePrintThisView = () => window.print();

  const headerActions = (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Button
          asChild
          variant="outline"
          size="sm"
          data-testid="btn-export-invoices"
        >
          <a href={exportInvoicesHref} download>
            <Download className="w-4 h-4 mr-1.5" />
            Export invoices
          </a>
        </Button>
        <button
          type="button"
          className="ml-1 inline-flex items-center justify-center px-2 h-8 rounded border border-border bg-background text-xs hover:bg-muted"
          onClick={() => setShowExportMenu(v => !v)}
          aria-expanded={showExportMenu}
          aria-haspopup="menu"
          data-testid="btn-export-toggle"
        >
          ▾
        </button>
        {showExportMenu && (
          <div
            className="absolute right-0 mt-1 z-30 w-56 rounded-md border border-border bg-popover shadow-md text-sm"
            role="menu"
          >
            <a
              href={exportLegsHref}
              download
              className="block px-3 py-2 hover:bg-muted"
              onClick={() => setShowExportMenu(false)}
              data-testid="btn-export-legs"
            >
              Export per-leg (claims) CSV
              <div className="text-[10px] text-muted-foreground">One row per claim</div>
            </a>
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handlePrintThisView}
        data-testid="btn-print-this-view"
      >
        <Printer className="w-4 h-4 mr-1.5" />
        Print this view
      </Button>
    </div>
  );

  if (summaryLoading || insightsLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Insights" sub={`Loading… · times in ${tzShort}`} accent="green" actions={headerActions} />
        <SkeletonSwap
          loading
          skeleton={
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          }
        >
          {null}
        </SkeletonSwap>
      </div>
    );
  }

  if (!summary) {
    return <div className="text-center py-12 text-muted-foreground">No data available</div>;
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Insights"
        sub={`Money at stake and pipeline status · times shown in ${tzShort}`}
        accent="green"
        actions={headerActions}
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <FilterStrip
          tabs={RANGE_TABS}
          active={rangeKey}
          onChange={setRangeKey as (k: string) => void}
          accent="green"
          ariaLabel="Filter insights by time range"
        />
        <span className="text-xs text-muted-foreground">{rangeWindowLabel(rangeKey, days)}</span>
      </div>

      {/* ─── Money scorecard (CFO) ─────────────────────────────────── */}
      <Section
        title={<span className="flex items-center gap-2">Money scorecard <span className="text-[10px] font-normal text-muted-foreground uppercase">Invoices</span></span>}
        icon={<TrendingUp className="w-4 h-4" />}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="money-scorecard">
          <MetricTile
            label="Disputed (resolved window)"
            value={clerk ? "—" : formatCurrency(String(totalDisputed))}
            sub={`Σ invoice $ on ${closedInWindowCount} resolved · last ${days}d`}
            tone="muted"
          />
          <MetricTile
            label="Recovered (resolved window)"
            value={clerk ? "—" : formatCurrency(String(totalRecovered))}
            sub={
              clerk
                ? undefined
                : `Confirmed: ${formatCompactCurrency(confirmedRecovered)} · last ${days}d`
            }
            tone="green"
          />
          <MetricTile
            label="Outstanding (now)"
            value={clerk ? "—" : formatCurrency(String(atRiskAmount))}
            sub={`${atRiskGroupCount} open invoice${atRiskGroupCount === 1 ? "" : "s"} · snapshot`}
            tone="amber"
          />
          {!clerk && (
            <div data-testid="tile-driver-prepay-exposure">
              <MetricTile
                label="Driver prepay exposure"
                value={formatCurrency(String(atRiskExposureAmount))}
                sub={
                  <span className="inline-flex items-center gap-1">
                    <span>Claim + driver prepay on the line</span>
                    <InfoTooltip
                      content={`Driver prepay exposure = at-risk claim $ × (1 + ${vendorPrepayPct}%). Assumes the practice has fronted ${vendorPrepayPct}% of each claim to the vendor up front, which is also at risk if the dispute fails. Kept off the Dashboard tile so its at-risk figure matches Insights and the daily brief one-for-one.`}
                    />
                  </span>
                }
                tone="red"
              />
            </div>
          )}
          <MetricTile
            label="Recovery rate"
            value={clerk ? "—" : recoveryRate === null ? "—" : `${recoveryRate}%`}
            sub={clerk ? undefined : `Recovered ÷ Disputed · ${closedInWindowCount} resolved`}
            tone={recoveryRate === null ? "muted" : recoveryRate >= 75 ? "green" : recoveryRate >= 50 ? "amber" : "red"}
          />
          <MetricTile
            label="Net change vs prior window"
            value={
              clerk
                ? "—"
                : (priorRecovered === 0 && totalRecovered === 0)
                  ? "—"
                  : `${netChangeSign}${formatCurrency(String(netChange))}`
            }
            sub={
              clerk
                ? undefined
                : netChangePct === null
                  ? "No prior-window recovery"
                  : `${netChangeSign}${netChangePct}%${netChangePctCapped ? "+" : ""} vs prior ${days}d`
            }
            tone={netChangeTone}
          />
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
          <InfoTooltip content="Every money/outcome figure on this page is anchored on resolution time — i.e. invoices that entered phase=closed inside the window. The Dashboard top strip uses the same definitions for the same window length, so the two surfaces always reconcile. Confirmed = the slice of Recovered where re-attestation has actually completed." />
          <span>Resolved-in-window. Definitions match the Dashboard and the daily brief.</span>
        </div>
      </Section>

      {/* ─── Pipeline snapshot (COO) ───────────────────────────────── */}
      {/* Single segmented funnel: each phase is one stripe of one
          horizontal bar, sized by invoice count, click-through to the
          Queue filtered by macroPhase. The bar lives full-width so the
          funnel reads left→right (pre-submit → closed). */}
      <Section
        title={<span className="flex items-center gap-2">Pipeline snapshot <span className="text-[10px] font-normal text-muted-foreground uppercase">Invoices</span></span>}
        icon={<BarChart3 className="w-4 h-4" />}
        action={
          <span className="text-[11px] text-muted-foreground">
            {pipelineOpenInvoices} open invoice{pipelineOpenInvoices === 1 ? "" : "s"} now
          </span>
        }
      >
        {(() => {
          // Snapshot bar shows ONLY currently-open phases. The `closed`
          // bucket is windowed (resolved-in-window), not a snapshot —
          // mixing it into the segmented bar made the funnel read as
          // "open + ancient closed forever" and visually drowned the
          // open phases. Closed-in-window is surfaced beside the bar
          // as its own stat instead.
          const openPhases = PIPELINE_PHASE_META.filter(p => p.key !== "closed");
          const totalForBar = openPhases.reduce((s, p) => s + (pipelineByKey.get(p.key)?.count ?? 0), 0) || 1;
          const closedRow = pipelineByKey.get("closed");
          return (
            <div data-testid="pipeline-snapshot">
              <div className="flex h-7 w-full rounded-md overflow-hidden border border-border" role="img" aria-label="Pipeline funnel by macro phase (currently open)">
                {openPhases.map(p => {
                  const row = pipelineByKey.get(p.key);
                  const count = row?.count ?? 0;
                  if (count === 0) return null;
                  const pct = (count / totalForBar) * 100;
                  const href = p.deepLinkValue ? `/invoice-groups?macroPhase=${encodeURIComponent(p.deepLinkValue)}` : "#";
                  return (
                    <Link
                      key={p.key}
                      href={href}
                      className="h-full transition-opacity hover:opacity-80 flex items-center justify-center text-[11px] font-semibold text-white"
                      style={{ width: `${pct}%`, background: p.barColor, minWidth: count > 0 ? 24 : 0 }}
                      title={`${p.label} · ${count}`}
                      data-testid={`pipeline-segment-${p.key}`}
                    >
                      {pct >= 8 ? count : ""}
                    </Link>
                  );
                })}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="pipeline-closed-in-window">
                <span>
                  Closed in last {days}d:{" "}
                  <strong className="text-foreground tabular-nums">{closedRow?.count ?? 0}</strong> invoice{closedRow?.count === 1 ? "" : "s"}
                  {!clerk && (closedRow?.openAmount ?? 0) > 0 && (
                    <> · <strong className="text-foreground tabular-nums">{formatCompactCurrency(closedRow?.openAmount ?? 0)}</strong></>
                  )}
                </span>
                <InfoTooltip content="Snapshot bar shows currently-open invoices by macro phase. The 'Closed in last Nd' line is window-scoped (resolved-in-window) — i.e. the throughput of the funnel over the selected period. Together they read as 'open now → closed in window'." />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3" data-testid="pipeline-legend">
                {PIPELINE_PHASE_META.map(p => {
                  const row = pipelineByKey.get(p.key);
                  const count = row?.count ?? 0;
                  const open = row?.openAmount ?? 0;
                  const href = p.deepLinkValue ? `/invoice-groups?macroPhase=${encodeURIComponent(p.deepLinkValue)}` : "#";
                  return (
                    <Link
                      key={p.key}
                      href={href}
                      className="flex items-start gap-2 rounded px-2 py-1.5 -mx-2 hover:bg-muted/40 transition-colors"
                      data-testid={`pipeline-phase-${p.key}`}
                    >
                      <span className="mt-1 inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ background: p.barColor }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          {p.label}
                          <ArrowUpRight className="w-3 h-3" />
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-base font-bold tabular-nums">{count}</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {clerk
                              ? "—"
                              : p.key === "closed"
                                ? `${formatCompactCurrency(open)} in window`
                                : `${formatCompactCurrency(open)} open`}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </Section>

      {/* ─── Daily flow ────────────────────────────────────────────── */}
      <Section
        title={
          <span className="flex items-center gap-2">
            Daily flow
            <span className="text-[10px] font-normal text-muted-foreground uppercase">
              {flowUnit === "invoices" ? "Invoices" : "Per leg"}
            </span>
          </span>
        }
        icon={<Activity className="w-4 h-4" />}
        action={
          <div className="inline-flex rounded border border-border overflow-hidden text-xs" role="tablist">
            <button
              type="button"
              className={`px-2.5 py-1 ${flowUnit === "invoices" ? "bg-muted font-semibold" : "bg-transparent"}`}
              onClick={() => setFlowUnit("invoices")}
              data-testid="flow-unit-invoices"
              aria-pressed={flowUnit === "invoices"}
            >
              Invoices
            </button>
            <button
              type="button"
              className={`px-2.5 py-1 border-l border-border ${flowUnit === "legs" ? "bg-muted font-semibold" : "bg-transparent"}`}
              onClick={() => setFlowUnit("legs")}
              data-testid="flow-unit-legs"
              aria-pressed={flowUnit === "legs"}
            >
              Per leg
            </button>
          </div>
        }
      >
        <div className="flex items-stretch gap-6 flex-wrap">
          <div className="min-w-[180px] text-xs space-y-2.5">
            <div>
              <div className="text-muted-foreground">Avg submitted / day</div>
              <div className="text-xl font-bold tabular-nums">{flowTotals.avgSubmittedPerDay.toFixed(1)}</div>
            </div>
            {flowUnit === "invoices" && (
              <>
                <div>
                  <div className="text-muted-foreground">Avg re-attested / day</div>
                  <div className="text-xl font-bold tabular-nums">{flowTotals.avgReattestedPerDay.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Avg responses / day</div>
                  <div className="text-xl font-bold tabular-nums">{flowTotals.avgResponsesPerDay.toFixed(1)}</div>
                </div>
              </>
            )}
            <div>
              <div className="text-muted-foreground">Backlog delta</div>
              <div
                className="text-xl font-bold tabular-nums"
                style={{
                  color:
                    flowTotals.backlogDelta > 0
                      ? "hsl(var(--destructive))"
                      : flowTotals.backlogDelta < 0
                        ? "hsl(var(--cc-success))"
                        : "hsl(var(--foreground))",
                }}
                title="Created − Responses received across the window. Positive = backlog grew."
              >
                {flowTotals.backlogDelta > 0 ? "+" : ""}{flowTotals.backlogDelta}
              </div>
              <div className="text-[10px] text-muted-foreground">created − responses</div>
            </div>
          </div>
          <div className="flex-1 min-w-[280px] h-52" data-testid="daily-flow-chart">
            <SkeletonSwap loading={tsLoading} className="h-full" skeleton={<Skeleton className="h-full w-full" />}>
              {dailyFlow.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                  No activity in this window
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyFlow} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={32} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="created" name="Created" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    {flowUnit === "invoices" ? (
                      <>
                        <Line type="monotone" dataKey="submitted" name="Submitted (us)" stroke="hsl(var(--cc-warning))" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="reattested" name="Re-attested (us)" stroke="hsl(var(--cc-success))" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="responses" name="Responses received (payor)" stroke="hsl(var(--cc-info, var(--primary)))" strokeWidth={2} strokeDasharray="2 2" dot={false} />
                      </>
                    ) : (
                      <Line type="monotone" dataKey="resolved" name="Resolved" stroke="hsl(var(--cc-success))" strokeWidth={2} dot={false} />
                    )}
                    <Line type="monotone" dataKey="netChange" name="Net change (created − responses)" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </SkeletonSwap>
          </div>
        </div>
      </Section>

      {/* ─── Outcomes ──────────────────────────────────────────────── */}
      <Section
        title={<span className="flex items-center gap-2">Outcomes <span className="text-[10px] font-normal text-muted-foreground uppercase">Invoices</span></span>}
        icon={<CheckCircle2 className="w-4 h-4" />}
      >
        {!clerk && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">Recovered $ trend · current vs prior {days}d</span>
              <span className="text-[10px] text-muted-foreground">
                Now: <strong className="text-foreground">{formatCompactCurrency(totalRecovered)}</strong> · Prior: <strong className="text-foreground">{formatCompactCurrency(priorRecovered)}</strong>
              </span>
            </div>
            <div className="h-32" data-testid="outcomes-recovered-trend">
              <SkeletonSwap loading={tsLoading} className="h-full" skeleton={<Skeleton className="h-full w-full" />}>
                {recoveredTrend.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    No recovered $ in this window
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={recoveredTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="recoveredCurrent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--cc-success))" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="hsl(var(--cc-success))" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={42} tickFormatter={(v: number) => formatCompactCurrency(v)} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => formatCurrency(String(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="current" name="This window" stroke="hsl(var(--cc-success))" strokeWidth={2} fill="url(#recoveredCurrent)" />
                      <Line type="monotone" dataKey="prior" name="Prior window" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </SkeletonSwap>
            </div>
          </div>
        )}
        {totalGroupOutcomes > 0 && (
          <div className="mb-4" data-testid="outcomes-mix-bar">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">Outcome mix · {totalGroupOutcomes} invoice{totalGroupOutcomes === 1 ? "" : "s"} resolved in window</span>
            </div>
            <div className="flex h-6 w-full rounded-md overflow-hidden border border-border" role="img" aria-label="Outcome mix stacked bar">
              {groupOutcomeBreakdown.map(({ outcome: o, count: n }) => {
                if (n === 0) return null;
                const { color } = outcomeStyle(o);
                const pct = (n / totalGroupOutcomes) * 100;
                return (
                  <div
                    key={o}
                    className="h-full flex items-center justify-center text-[10px] font-semibold text-white"
                    style={{ width: `${pct}%`, background: color, minWidth: 18 }}
                    title={`${o} · ${n} (${Math.round(pct)}%)`}
                    data-testid={`outcome-mix-${o.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {pct >= 8 ? `${Math.round(pct)}%` : ""}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="outcomes-breakdown">
          {totalGroupOutcomes === 0 ? (
            <p className="text-sm text-muted-foreground col-span-full">No invoice outcomes in this window.</p>
          ) : (
            groupOutcomeBreakdown.map(({ outcome: o, count: n }) => {
              const { color, Icon } = outcomeStyle(o);
              const pct = totalGroupOutcomes > 0 ? Math.round((n / totalGroupOutcomes) * 100) : 0;
              return (
                <div
                  key={o}
                  className="rounded-md border border-border bg-card p-3"
                  data-testid={`outcome-${o.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }}>
                    <Icon className="w-3.5 h-3.5" />
                    {o}
                  </div>
                  <div className="text-2xl font-bold tabular-nums mt-1">{n}</div>
                  <div className="text-[11px] text-muted-foreground">{pct}% of {totalGroupOutcomes}</div>
                </div>
              );
            })
          )}
        </div>
      </Section>

      {/* ─── Risk & accountability — row 5 (Deadline risk + Top payors) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Section
          title={<span className="flex items-center gap-2">Deadline risk <span className="text-[10px] font-normal text-muted-foreground uppercase">Invoices</span></span>}
          icon={<AlertTriangle className="w-4 h-4" />}
        >
          <div className="space-y-3 text-sm" data-testid="deadline-risk">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Urgent</span>
              <Link
                href="/invoice-groups?expiring=urgent"
                className="text-2xl font-bold tabular-nums hover:underline"
                style={{ color: urgentCount > 0 ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}
                data-testid="deadline-urgent-link"
              >
                {urgentCount}
              </Link>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Expiring soon</span>
              <Link
                href="/invoice-groups?expiring=soon"
                className="text-2xl font-bold tabular-nums hover:underline"
                style={{ color: expiringGroups.length > 0 ? "hsl(var(--cc-warning))" : "hsl(var(--muted-foreground))" }}
                data-testid="deadline-soon-link"
              >
                {expiringGroups.length}
              </Link>
            </div>
            {!clerk && expiringExposure > 0 && (
              <div className="text-xs text-muted-foreground pt-1 border-t border-border">
                Invoice $ on those rows: <strong className="text-foreground">{formatCurrency(String(expiringExposure))}</strong>
              </div>
            )}
          </div>
        </Section>

        <Section
          className="lg:col-span-2"
          title={<span className="flex items-center gap-2">Top payors by open exposure <span className="text-[10px] font-normal text-muted-foreground uppercase">Invoices</span></span>}
          icon={<AlertTriangle className="w-4 h-4" />}
          padded={false}
        >
          <div className="text-[10px] uppercase font-semibold px-4 py-1.5 flex items-center gap-3 bg-muted text-muted-foreground">
            <span className="flex-1">Payor</span>
            <span style={{ minWidth: 56, textAlign: "right" }}>Open</span>
            <span style={{ minWidth: 84, textAlign: "right" }}>$ at risk</span>
            <span style={{ minWidth: 64, textAlign: "right" }}>Win rate</span>
          </div>
          {payorConcentration.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">No open exposure tracked by payor.</div>
          ) : (
            payorConcentration.map((p, i) => {
              const open = parseFloat(p.openAtRiskAmount ?? "0") || 0;
              const winRate = p.winRate;
              return (
                <div
                  key={p.payorEmail}
                  className="px-4 py-2.5 flex items-center gap-3 text-sm"
                  style={{ borderBottom: i === payorConcentration.length - 1 ? "none" : "1px solid hsl(var(--border))" }}
                  data-testid={`payor-row-${i}`}
                >
                  <span className="flex-1 truncate" title={p.payorEmail}>{p.payorEmail}</span>
                  <span className="font-mono tabular-nums" style={{ minWidth: 56, textAlign: "right" }}>{p.openCount}</span>
                  <span
                    className="font-mono text-xs tabular-nums"
                    style={{ minWidth: 84, textAlign: "right", color: !clerk && open > 0 ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}
                  >
                    {clerk ? "—" : open > 0 ? formatCompactCurrency(open) : "—"}
                  </span>
                  <span
                    className="font-mono text-xs tabular-nums"
                    style={{
                      minWidth: 64,
                      textAlign: "right",
                      color: winRate === null ? "hsl(var(--muted-foreground))" : winRate >= 0.6 ? "hsl(var(--cc-success))" : "hsl(var(--destructive))",
                    }}
                    title="Approved + Partially Approved / all decided invoices RESOLVED in window"
                  >
                    {winRate === null ? "—" : `${Math.round(winRate * 100)}%`}
                  </span>
                </div>
              );
            })
          )}
        </Section>

      </div>

      {/* ─── Causes & people — row 6 (Top denial reasons + Team productivity) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section
          title={<span className="flex items-center gap-2">Top denial reasons <span className="text-[10px] font-normal text-muted-foreground uppercase">Per leg</span></span>}
          icon={<BarChart3 className="w-4 h-4" />}
          action={<Link href="/error-types" className="text-xs text-primary hover:underline">Open Error Types →</Link>}
        >
          <div className="text-[11px] text-muted-foreground mb-2">Ranked by $ denied — what each cause is costing.</div>
          <div className="space-y-2.5" data-testid="error-type-bars">
            {errorTypeBars.length === 0 ? (
              <p className="text-sm text-muted-foreground">No classifications to display</p>
            ) : (
              errorTypeBars.map(b => (
                <div key={b.name} className="text-sm">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="flex-1 truncate">{b.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{b.pct}%</span>
                    <span className="text-xs font-semibold font-mono" style={{ color: "hsl(var(--destructive))" }} title="$ denied — drives ranking">
                      {clerk ? "—" : `-${formatCompactCurrency(b.denied)}`}
                    </span>
                    <span className="text-xs font-mono opacity-70" style={{ color: "hsl(var(--cc-success))" }} title="$ recovered (context only)">
                      {clerk ? "—" : `+${formatCompactCurrency(b.recovered)}`}
                    </span>
                  </div>
                  <MiniBar pct={b.barPct} tone="red" />
                </div>
              ))
            )}
          </div>
        </Section>

        <Section title={<span className="flex items-center gap-2">Team productivity <span className="text-[10px] font-normal text-muted-foreground uppercase">Per leg</span></span>} icon={<Users className="w-4 h-4" />} padded={false}>
          <div className="text-[10px] uppercase font-semibold px-4 py-1.5 flex items-center gap-3 bg-muted text-muted-foreground">
            <span style={{ minWidth: 140 }}>Owner</span>
            <span style={{ minWidth: 50, textAlign: "right" }}>Filed</span>
            <span style={{ minWidth: 50, textAlign: "right" }}>Won</span>
            <span className="flex-1">Win rate</span>
          </div>
          <SkeletonSwap loading={prodLoading} skeleton={<Skeleton className="h-24 w-full" />}>
            {teamRows.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">No tracked user activity in this window</div>
            ) : (
              teamRows.map(t => (
                <div key={t.who} className="px-4 py-2.5 flex items-center gap-3 text-sm border-b border-border last:border-b-0" data-testid={`team-row-${t.who}`}>
                  <span className="font-medium truncate" style={{ minWidth: 140 }}>{t.who}</span>
                  <span className="font-mono tabular-nums" style={{ minWidth: 50, textAlign: "right" }}>{t.filed}</span>
                  <span className="font-mono tabular-nums" style={{ minWidth: 50, textAlign: "right" }}>{t.won}</span>
                  <div className="flex-1 flex items-center gap-2">
                    {t.rate === null ? (
                      <span className="text-xs text-muted-foreground">no resolutions</span>
                    ) : (
                      <>
                        <MiniBar pct={t.rate} tone={t.rate >= 85 ? "green" : t.rate >= 75 ? "blue" : "amber"} />
                        <span
                          className="text-xs font-mono tabular-nums"
                          style={{ minWidth: 32, textAlign: "right", color: t.rate >= 85 ? "hsl(var(--cc-success))" : "hsl(var(--foreground))" }}
                        >
                          {t.rate}%
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </SkeletonSwap>
        </Section>
      </div>

      {/* ─── Repeat offenders ──────────────────────────────────────── */}
      <div
        className="rounded-md overflow-hidden bg-card"
        style={{ borderColor: "hsl(var(--cc-amber-border))", borderWidth: 2, borderStyle: "solid" }}
        data-testid="repeat-offenders"
      >
        <div
          className="px-5 py-3 flex items-center justify-between flex-wrap gap-2"
          style={{ background: "hsl(var(--cc-amber-bg))", borderBottom: "1px solid hsl(var(--cc-amber-border))" }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--cc-warning))" }} />
            <span className="text-sm font-bold uppercase tracking-wide" style={{ color: "hsl(var(--cc-amber-fg))" }}>
              Repeat offenders
            </span>
            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded" style={{ color: "hsl(var(--cc-amber-fg))", background: "hsl(var(--cc-amber-border))" }}>
              Per leg
            </span>
            <span className="text-xs" style={{ color: "hsl(var(--cc-amber-fg))", opacity: 0.85 }}>
              · vehicles &amp; members generating most rejected claims
            </span>
          </div>
          <span className="text-[11px]" style={{ color: "hsl(var(--cc-amber-fg))" }}>
            {repeat ? `${repeat.driverGroupsTotal} vehicles · ${repeat.memberGroupsTotal} members in window` : ""}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="border-b md:border-b-0 md:border-r border-border" data-testid="repeat-drivers">
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "hsl(var(--background))", borderBottom: "1px solid hsl(var(--border))" }}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <Truck className="w-3.5 h-3.5" />Drivers / vehicles
                <span className="text-[10px] font-normal normal-case opacity-80">(by car #)</span>
              </div>
            </div>
            <div className="text-[10px] uppercase font-semibold px-4 py-1.5 flex items-center gap-3 bg-muted text-muted-foreground">
              <span style={{ minWidth: 84 }}>Vehicle</span>
              <span style={{ minWidth: 100 }} className="hidden md:inline">Last invoice</span>
              <span className="flex-1">Top error type</span>
              <span style={{ minWidth: 56, textAlign: "right" }}>Rejections</span>
              <span style={{ minWidth: 84, textAlign: "right" }}>$ at risk</span>
              <span style={{ minWidth: 56, textAlign: "right" }}>Win rate</span>
              <span style={{ minWidth: 28, textAlign: "right" }}>vs</span>
              <span style={{ width: 56 }} />
            </div>
            <SkeletonSwap loading={repeatLoading} skeleton={<Skeleton className="h-24 w-full" />}>
              {(repeat?.drivers ?? []).length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">No repeat offenders in this window.</div>
              ) : (
                (repeat?.drivers ?? []).map((d, i, arr) => (
                  <div
                    key={`${d.carNumber}-${i}`}
                    className="px-4 py-2.5 flex items-center gap-3 text-sm"
                    style={{ borderBottom: i === arr.length - 1 ? "none" : "1px solid hsl(var(--border))" }}
                    data-testid={`repeat-driver-row-${d.carNumber}`}
                  >
                    <span className="font-mono text-xs font-semibold" style={{ minWidth: 84 }}>{d.carNumber}</span>
                    <span className="font-mono text-[11px] text-muted-foreground truncate hidden md:inline" style={{ minWidth: 100 }} title={d.lastInvoiceNumber ?? undefined}>
                      {d.lastInvoiceNumber ?? "—"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] truncate text-muted-foreground">{d.topErrorTypeName ?? "—"}</div>
                    </div>
                    <span className="font-mono font-semibold tabular-nums" style={{ minWidth: 56, textAlign: "right" }}>{d.rejectionCount}</span>
                    <span className="font-mono text-xs tabular-nums" style={{ minWidth: 84, textAlign: "right", color: "hsl(var(--destructive))" }}>
                      {formatCurrency(d.atRiskAmount)}
                    </span>
                    <span
                      className="font-mono text-xs tabular-nums"
                      style={{
                        minWidth: 56,
                        textAlign: "right",
                        color: d.winRate === null ? "hsl(var(--muted-foreground))" : d.winRate >= 0.6 ? "hsl(var(--cc-success))" : "hsl(var(--destructive))",
                      }}
                    >
                      {d.winRate === null ? "—" : `${Math.round(d.winRate * 100)}%`}
                    </span>
                    <span style={{ minWidth: 28, textAlign: "right", fontSize: 12 }}>
                      <TrendArrow d={d.trend} />
                    </span>
                    <Link
                      href={`/claims?carNumber=${encodeURIComponent(d.carNumber)}`}
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      style={{ width: 56, justifyContent: "flex-end" }}
                    >
                      Open <ArrowUpRight className="w-3 h-3" />
                    </Link>
                  </div>
                ))
              )}
            </SkeletonSwap>
          </div>

          <div data-testid="repeat-members">
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "hsl(var(--background))", borderBottom: "1px solid hsl(var(--border))" }}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <UserCircle2 className="w-3.5 h-3.5" />Members
                <span className="text-[10px] font-normal normal-case opacity-80">(by client #)</span>
              </div>
            </div>
            <div className="text-[10px] uppercase font-semibold px-4 py-1.5 flex items-center gap-3 bg-muted text-muted-foreground">
              <span style={{ minWidth: 100 }}>Member</span>
              <span className="flex-1">Top error type</span>
              <span style={{ minWidth: 56, textAlign: "right" }}>Rejections</span>
              <span style={{ minWidth: 84, textAlign: "right" }}>$ at risk</span>
              <span style={{ minWidth: 56, textAlign: "right" }}>Win rate</span>
              <span style={{ minWidth: 28, textAlign: "right" }}>vs</span>
              <span style={{ width: 56 }} />
            </div>
            <SkeletonSwap loading={repeatLoading} skeleton={<Skeleton className="h-24 w-full" />}>
              {(repeat?.members ?? []).length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">No repeat-offender members in this window.</div>
              ) : (
                (repeat?.members ?? []).map((m, i, arr) => (
                  <div
                    key={`${m.clientNumber}-${i}`}
                    className="px-4 py-2.5 flex items-center gap-3 text-sm"
                    style={{ borderBottom: i === arr.length - 1 ? "none" : "1px solid hsl(var(--border))" }}
                    data-testid={`repeat-member-row-${m.clientNumber}`}
                  >
                    <span className="font-mono text-xs font-semibold" style={{ minWidth: 100 }}>{m.clientNumber}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] truncate text-muted-foreground">{m.topErrorTypeName ?? "—"}</div>
                    </div>
                    <span className="font-mono font-semibold tabular-nums" style={{ minWidth: 56, textAlign: "right" }}>{m.rejectionCount}</span>
                    <span className="font-mono text-xs tabular-nums" style={{ minWidth: 84, textAlign: "right", color: "hsl(var(--destructive))" }}>
                      {formatCurrency(m.atRiskAmount)}
                    </span>
                    <span
                      className="font-mono text-xs tabular-nums"
                      style={{
                        minWidth: 56,
                        textAlign: "right",
                        color: m.winRate === null ? "hsl(var(--muted-foreground))" : m.winRate >= 0.6 ? "hsl(var(--cc-success))" : "hsl(var(--destructive))",
                      }}
                    >
                      {m.winRate === null ? "—" : `${Math.round(m.winRate * 100)}%`}
                    </span>
                    <span style={{ minWidth: 28, textAlign: "right", fontSize: 12 }}>
                      <TrendArrow d={m.trend} />
                    </span>
                    <Link
                      href={`/claims?clientNumber=${encodeURIComponent(m.clientNumber)}`}
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      style={{ width: 56, justifyContent: "flex-end" }}
                    >
                      Open <ArrowUpRight className="w-3 h-3" />
                    </Link>
                  </div>
                ))
              )}
            </SkeletonSwap>
          </div>
        </div>

        <div
          className="px-5 py-2 text-xs text-muted-foreground flex items-center gap-2"
          style={{ background: "hsl(var(--background))", borderTop: "1px solid hsl(var(--border))" }}
        >
          <InfoTooltip content="Click Open on any row to filter the claims list to that vehicle or member." />
          <span>Click <strong>Open</strong> on any row to see all rejected claims for that vehicle or member.</span>
        </div>
      </div>
    </div>
  );
}
