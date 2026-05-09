import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Download,
  FileText,
  Printer,
  Send,
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
  useGetDashboardTimeInPhase,
  getExportClaimsCsvUrl,
} from "@workspace/api-client-react";
import { useDashboardLiveUpdates } from "@/hooks/use-claim-events";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { PageHeader, FilterStrip, type FilterStripTab, MetricTile, Section } from "@/components/cohesion";
import { InfoTooltip } from "@/components/info-tooltip";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { formatChartTick, getDisplayTimezoneShort } from "@/lib/time";
import { useRole, HideForClerk } from "@/lib/role";

// Macro-phase display labels — keep in lockstep with the
// `MacroPhase` enum in api-server `lib/macro-phase.ts`.
const PHASE_LABELS: Record<string, string> = {
  "pre-submit": "Pre-submit",
  "in-flight": "In flight",
  "response-pending": "Response pending",
  "mas-action-required": "MAS action",
  "awaiting-payout": "Awaiting payout",
  "closed": "Closed",
  "on-hold": "On hold",
};

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const min = ms / 60000;
  if (min < 60) return `${Math.round(min)}m`;
  const hr = min / 60;
  if (hr < 36) return `${hr.toFixed(hr < 10 ? 1 : 0)}h`;
  const days = hr / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)}d`;
}

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
  // Render the bracket dates in the operator app's display TZ via the
  // shared chart-tick formatter, so the bracket and the chart axis can
  // never disagree on the day boundary (#562).
  const fmt = (d: Date) => formatChartTick(d.toISOString());
  if (key === "qtd") return `Quarter to date · ${fmt(start)} – ${fmt(end)}`;
  if (key === "ytd") return `Year to date · ${fmt(start)} – ${fmt(end)}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

// Calendar-day axis label. Server timeseries returns YYYY-MM-DD keys,
// which `formatChartTick` renders without TZ conversion so the axis
// label is always the authored day (#562).
function formatShortDate(ymd: string): string {
  return formatChartTick(ymd);
}

function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function TrendArrow({ d }: { d: "up" | "down" | "flat" }) {
  if (d === "up") return <span title="more rejections vs prior window" style={{ color: "hsl(var(--destructive))" }}>▲</span>;
  if (d === "down") return <span title="fewer rejections vs prior window" style={{ color: "hsl(var(--cc-success))" }}>▼</span>;
  return <span className="text-muted-foreground">—</span>;
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

export default function Insights() {
  // Clerks see Insights but with money figures masked to "—". The server
  // already nulls money on /claims, /dashboard/*, /dashboard/timeseries,
  // and /dashboard/repeat-offenders for clerks, so most downstream
  // formatCurrency calls render "—" automatically. We only need to
  // short-circuit client-computed sums (which would otherwise add nulls
  // as 0 and display "$0.00") via the HideForClerk wrappers below.
  const { isClerk: clerk } = useRole();
  const [rangeKey, setRangeKey] = useState<RangeKey>("30");
  const days = daysForRange(rangeKey);

  useDashboardLiveUpdates();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  // Server-side aggregation for the topline tiles and breakdowns.
  // Replaces the prior in-memory reductions over the first 500 claims
  // returned by /claims — those silently understated everything once
  // the window held more than 500 rows. Now `totalClaims`, the dollar
  // sums, and every breakdown reflect the entire window exactly.
  const { data: insights, isLoading: insightsLoading } = useGetDashboardInsights({ days });
  const { data: timeseries, isLoading: tsLoading } = useGetDashboardTimeseries({ days });
  const { data: productivity, isLoading: prodLoading } = useGetDashboardUserProductivity({ days });
  const { data: repeat, isLoading: repeatLoading } = useGetDashboardRepeatOffenders({ days, limit: 5 });
  // Task #563 — time-in-phase rollups powering the Bottleneck row,
  // Time-in-Phase chart, and Time-in-MAS-Action sub-stats.
  const { data: tip, isLoading: tipLoading } = useGetDashboardTimeInPhase({ days });

  const phaseChartData = useMemo(() => {
    return (tip?.phases ?? [])
      .filter(p => p.phase !== "closed" && p.count > 0)
      .map(p => ({
        phase: PHASE_LABELS[p.phase] ?? p.phase,
        rawPhase: p.phase,
        median: Math.round(p.medianMs / 3600000 * 10) / 10,
        p90: Math.round(p.p90Ms / 3600000 * 10) / 10,
        count: p.count,
      }));
  }, [tip?.phases]);

  const masPhase = useMemo(() => {
    return (tip?.phases ?? []).find(p => p.phase === "mas-action-required") ?? null;
  }, [tip?.phases]);
  const bottleneck = tip?.bottleneck ?? null;
  const tzShort = getDisplayTimezoneShort();

  const totalClaims = insights?.totalClaims ?? 0;
  const totalClaimed = parseFloat(insights?.totalClaimedAmount ?? "0") || 0;
  const totalApproved = parseFloat(insights?.totalRecoveredAmount ?? "0") || 0;

  const trendTotals = useMemo(() => {
    const points = timeseries?.points || [];
    return {
      created: points.reduce((s, p) => s + p.claimsCreated, 0),
      resolved: points.reduce((s, p) => s + p.claimsResolved, 0),
      recovered: points.reduce((s, p) => s + p.dollarsRecovered, 0),
    };
  }, [timeseries]);

  const trendData = (timeseries?.points || []).map(p => ({
    ...p,
    label: formatShortDate(p.date),
  }));

  const bestDay = useMemo(() => {
    return (timeseries?.points || []).reduce<{ date: string; dollars: number } | null>((best, p) => {
      if (!best || p.dollarsRecovered > best.dollars) return { date: p.date, dollars: p.dollarsRecovered };
      return best;
    }, null);
  }, [timeseries]);

  // Per-error-type bars. Counts and dollar sums come straight from the
  // server's `errorTypeBreakdown`, so a window with thousands of claims
  // is summarized exactly rather than from a leading 500-row sample.
  const errorTypeBars = useMemo(() => {
    const rows = (insights?.errorTypeBreakdown ?? []).map(b => ({
      name: b.name,
      count: b.count,
      recovered: parseFloat(b.recoveredAmount ?? "0") || 0,
      denied: parseFloat(b.deniedAmount ?? "0") || 0,
    }));
    const entries = rows.sort((a, b) => b.recovered - a.recovered).slice(0, 6);
    const maxRecovered = entries.reduce((m, e) => Math.max(m, e.recovered), 0) || 1;
    // Percentage of windowed claims that fell into this error type. Use
    // the global windowed total (not just the top-6 sum) so the
    // numbers add up to a meaningful share of all claims, not a share
    // of "claims that made the bar list".
    const totalForPct = totalClaims || rows.reduce((s, e) => s + e.count, 0) || 1;
    return entries.map(e => ({
      ...e,
      pct: Math.round((e.count / totalForPct) * 100),
      barPct: Math.round((e.recovered / maxRecovered) * 100),
    }));
  }, [insights?.errorTypeBreakdown, totalClaims]);

  // Status / outcome / payor breakdowns also come from the server.
  // We materialize them as Maps keyed by the dimension so the JSX
  // doesn't need to know whether the source was a client reduction
  // or a typed array — same shape it consumed before.
  const statusBreakdown = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of insights?.statusBreakdown ?? []) m[r.status] = r.count;
    return m;
  }, [insights?.statusBreakdown]);
  const outcomeBreakdown = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of insights?.outcomeBreakdown ?? []) m[r.outcome] = r.count;
    return m;
  }, [insights?.outcomeBreakdown]);
  const payorBreakdown = useMemo(() => {
    const m: Record<string, { count: number; atRisk: number }> = {};
    for (const r of insights?.payorBreakdown ?? []) {
      m[r.payorEmail] = {
        count: r.count,
        atRisk: parseFloat(r.atRiskAmount ?? "0") || 0,
      };
    }
    return m;
  }, [insights?.payorBreakdown]);

  const teamRows = useMemo(() => {
    const users = productivity?.users || [];
    return users.slice(0, 8).map(u => {
      const won = u.resolved;
      const filed = u.resolved + u.denied;
      const rate = filed > 0 ? Math.round((won / filed) * 100) : null;
      return { who: u.userName || u.userEmail, filed, won, rate, total: u.total };
    });
  }, [productivity]);

  const exportClaimsHref = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const iso = since.toISOString().slice(0, 10);
    return getExportClaimsCsvUrl({ createdFrom: iso });
  }, [days]);

  // Opens the browser's native print dialog scoped to this page. The
  // CTA used to read "Monthly PDF report", which implied a server-rendered
  // PDF artifact — there is none. The button now matches the action it
  // actually performs (window.print). See Task #411 audit, Tier 1.
  const handlePrintThisView = () => {
    window.print();
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm" data-testid="btn-export-view">
        <a href={exportClaimsHref} download>
          <Download className="w-4 h-4 mr-1.5" />
          Export view
        </a>
      </Button>
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

  if (summaryLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Insights" sub={`Loading… · times in ${tzShort}`} accent="green" actions={headerActions} />
        <SkeletonSwap
          loading
          skeleton={
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24 w-full" />)}
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

  // Use the vendor-prepay rate the API computed against, so insights and the
  // dashboard / brief never disagree if the rate changes.
  const vendorPrepayRate = summary.amounts.vendorPrepayRate ?? 0.70;
  const exposureMultiplier = 1 + vendorPrepayRate;
  const totalExposure = totalClaimed * exposureMultiplier;
  const recoveryRate = totalClaimed > 0 ? Math.round((totalApproved / totalClaimed) * 100) : 0;

  const drivers = repeat?.drivers ?? [];
  const members = repeat?.members ?? [];

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Insights"
        sub={`Recovery analytics and pattern detection · times shown in ${tzShort}`}
        accent="green"
        actions={headerActions}
      />

      {/* Task #563 — Bottleneck row card. Top non-terminal macro phase
          by p90 over the selected window, with a click-through to the
          queue filtered to that phase. Hidden when there isn't enough
          signal (need >= 3 samples on a non-terminal phase). */}
      {bottleneck && (
        <Link
          href={`/invoice-groups?phase=${encodeURIComponent(bottleneck.phase)}`}
          className="block"
          data-testid="insights-bottleneck-row"
        >
          <div
            className="rounded-md border bg-card p-3.5 flex items-center gap-3 text-sm hover:bg-muted/40 transition-colors"
            style={{ borderColor: "hsl(var(--cc-amber-border))" }}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--cc-warning))" }} />
            <span>
              <strong>Biggest hold-up:</strong>{" "}
              <span className="font-medium">{PHASE_LABELS[bottleneck.phase] ?? bottleneck.phase}</span>{" "}
              <span className="text-muted-foreground">
                · p90 <strong className="text-foreground">{formatDuration(bottleneck.p90Ms)}</strong>{" "}
                · median {formatDuration(bottleneck.medianMs)}{" "}
                · {bottleneck.count} transition{bottleneck.count === 1 ? "" : "s"} in last {days}d
              </span>
            </span>
            <ArrowUpRight className="w-4 h-4 ml-auto text-muted-foreground" />
          </div>
        </Link>
      )}

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

      {/* Topline metric tiles — windowed to the selected time range.
          Money tiles render "—" for clerks; non-money tiles (claim count
          and recovery rate) stay visible to everyone. */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="insights-topline">
        <MetricTile label="Total claims" value={totalClaims} sub={`in last ${days}d`} />
        <MetricTile label="Disputed" value={clerk ? "—" : formatCurrency(String(totalClaimed))} sub={`filed in last ${days}d`} tone="blue" />
        <MetricTile
          label="Recovered"
          value={clerk ? "—" : formatCurrency(String(totalApproved))}
          sub={!clerk && trendTotals.recovered > 0 ? `${formatCompactCurrency(trendTotals.recovered)} in last ${days}d` : `last ${days}d`}
          tone="green"
        />
        <MetricTile label="Total exposure" value={clerk ? "—" : formatCurrency(String(totalExposure))} sub="claim + ~70% vendor prepay" tone="red" />
        <MetricTile label="Recovery rate" value={clerk ? "—" : `${recoveryRate}%`} sub="recovered / disputed" tone="muted" />
      </div>

      {/* Recovery over time block */}
      <Section title="Recovery over time" icon={<TrendingUp className="w-4 h-4" />}>
        <div className="flex items-stretch gap-6 flex-wrap">
          <div className="min-w-[200px]">
            <div className="text-3xl font-bold tabular-nums" style={{ color: "hsl(var(--cc-success))" }}>
              {clerk ? "—" : formatCompactCurrency(trendTotals.recovered)}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">recovered in last {days} days</div>
            {!clerk && bestDay && bestDay.dollars > 0 && (
              <div className="text-xs mt-2 text-muted-foreground">
                Best day: <strong>{formatShortDate(bestDay.date)}</strong> · {formatCompactCurrency(bestDay.dollars)} recovered
              </div>
            )}
            <div className="text-xs mt-2 text-muted-foreground">
              {trendTotals.created} claims created · {trendTotals.resolved} resolved
            </div>
          </div>
          <div className="flex-1 min-w-[280px] h-32" data-testid="recovery-trend-chart">
            <SkeletonSwap
              loading={tsLoading}
              className="h-full"
              skeleton={<Skeleton className="h-full w-full" />}
            >
            {trendData.length === 0 || trendTotals.recovered === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No dollars recovered in this window
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="insightsGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--cc-success))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--cc-success))" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={40} tickFormatter={formatCompactCurrency} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v: number) => [formatCurrency(String(v)), "Recovered"]}
                  />
                  <Area type="monotone" dataKey="dollarsRecovered" stroke="hsl(var(--cc-success))" strokeWidth={2} fill="url(#insightsGreen)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
            </SkeletonSwap>
          </div>
        </div>
      </Section>

      {/* Task #563 — Time in Phase chart + MAS-Action sub-stats. Sourced
          from the audit_logs `group_status_changed` stream rolled up
          server-side; one sample per (group, transition). */}
      <Section
        title={`Time in phase · last ${days}d`}
        icon={<Activity className="w-4 h-4" />}
      >
        <SkeletonSwap loading={tipLoading} skeleton={<Skeleton className="h-40 w-full" />}>
          {phaseChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No phase transitions in this window.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
              <div className="lg:col-span-2 h-44" data-testid="time-in-phase-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={phaseChartData}
                    margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="phase" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      width={36}
                      tickFormatter={(v: number) => `${v}h`}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(v: number, name: string) => [`${v}h`, name === "median" ? "Median" : "p90"]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="median" name="Median" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="p90" name="p90" fill="hsl(var(--cc-warning))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div
                className="rounded-md border border-border bg-card p-3.5"
                data-testid="time-in-mas-action"
              >
                <div className="text-[11px] uppercase font-semibold mb-2 text-muted-foreground flex items-center gap-1">
                  Time in MAS action
                  <InfoTooltip content="How long invoices wait in the MAS-action-required phase before the operator clears the cancel queue. Overdue threshold is 7 days." />
                </div>
                {masPhase ? (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Median</span>
                      <span className="font-mono tabular-nums">{formatDuration(masPhase.medianMs)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">p90</span>
                      <span className="font-mono tabular-nums">{formatDuration(masPhase.p90Ms)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Transitions</span>
                      <span className="font-mono tabular-nums">{masPhase.count}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-border mt-1">
                      <span className="text-muted-foreground">Overdue (&gt;7d)</span>
                      <span
                        className="font-mono tabular-nums"
                        style={{
                          color: (masPhase.overdueCount ?? 0) > 0
                            ? "hsl(var(--destructive))"
                            : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {masPhase.overdueCount ?? 0}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No MAS-action transitions in this window.</p>
                )}
              </div>
            </div>
          )}
        </SkeletonSwap>
      </Section>

      {/* Repeat offenders amber-bordered block */}
      <div
        className="rounded-md overflow-hidden bg-card"
        style={{ borderColor: "hsl(var(--cc-amber-border))", borderWidth: 2, borderStyle: "solid" }}
        data-testid="repeat-offenders"
      >
        <div
          className="px-5 py-3 flex items-center justify-between flex-wrap gap-2"
          style={{
            background: "hsl(var(--cc-amber-bg))",
            borderBottom: "1px solid hsl(var(--cc-amber-border))",
          }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--cc-warning))" }} />
            <span className="text-sm font-bold uppercase tracking-wide" style={{ color: "hsl(var(--cc-amber-fg))" }}>
              Repeat offenders
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
          {/* Drivers / vehicles by carNumber */}
          <div className="border-b md:border-b-0 md:border-r border-border" data-testid="repeat-drivers">
            <div
              className="px-4 py-2.5 flex items-center justify-between"
              style={{ background: "hsl(var(--background))", borderBottom: "1px solid hsl(var(--border))" }}
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <Truck className="w-3.5 h-3.5" />Drivers / vehicles
                <span className="text-[10px] font-normal normal-case opacity-80">(by car #)</span>
              </div>

            </div>
            <div
              className="text-[10px] uppercase font-semibold px-4 py-1.5 flex items-center gap-3 bg-muted text-muted-foreground"
            >
              <span style={{ minWidth: 84 }}>Vehicle</span>
              <span style={{ minWidth: 100 }} className="hidden md:inline">Last invoice</span>
              <span className="flex-1">Top error type</span>
              <span style={{ minWidth: 56, textAlign: "right" }}>Rejections</span>
              <span style={{ minWidth: 84, textAlign: "right" }}>$ at risk</span>
              <span style={{ minWidth: 56, textAlign: "right" }}>Win rate</span>
              <span style={{ minWidth: 28, textAlign: "right" }}>vs</span>
              <span style={{ width: 56 }} />
            </div>
            <SkeletonSwap
              loading={repeatLoading}
              skeleton={<Skeleton className="h-24 w-full" />}
            >
            {drivers.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No repeat offenders in this window.
              </div>
            ) : (
              drivers.map((d, i) => (
                <div
                  key={`${d.carNumber}-${i}`}
                  className="px-4 py-2.5 flex items-center gap-3 text-sm"
                  style={{ borderBottom: i === drivers.length - 1 ? "none" : "1px solid hsl(var(--border))" }}
                  data-testid={`repeat-driver-row-${d.carNumber}`}
                >
                  <span className="font-mono text-xs font-semibold" style={{ minWidth: 84 }}>{d.carNumber}</span>
                  <span
                    className="font-mono text-[11px] text-muted-foreground truncate hidden md:inline"
                    style={{ minWidth: 100 }}
                    title={d.lastInvoiceNumber ?? undefined}
                  >
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
                    title="Approved / (Approved + Denied) for resolved claims in this window"
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

          {/* Members by clientNumber */}
          <div data-testid="repeat-members">
            <div
              className="px-4 py-2.5 flex items-center justify-between"
              style={{ background: "hsl(var(--background))", borderBottom: "1px solid hsl(var(--border))" }}
            >
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
            <SkeletonSwap
              loading={repeatLoading}
              skeleton={<Skeleton className="h-24 w-full" />}
            >
            {members.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No repeat-offender members in this window.
              </div>
            ) : (
              members.map((m, i) => (
                <div
                  key={`${m.clientNumber}-${i}`}
                  className="px-4 py-2.5 flex items-center gap-3 text-sm"
                  style={{ borderBottom: i === members.length - 1 ? "none" : "1px solid hsl(var(--border))" }}
                  data-testid={`repeat-member-row-${m.clientNumber}`}
                >
                  <span className="font-mono text-xs font-semibold" style={{ minWidth: 100 }}>{m.clientNumber}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] truncate text-muted-foreground">{m.topErrorTypeName ?? "—"}</div>
                  </div>
                  <span
                    className="font-mono font-semibold tabular-nums"
                    style={{ minWidth: 56, textAlign: "right" }}
                    title="Total rejected trips for this member in the window"
                  >
                    {m.rejectionCount}
                  </span>
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
                    title="Approved / (Approved + Denied) for resolved claims in this window"
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

      {/* Recovered by error type + Team productivity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section
          title="Recovered by error type"
          icon={<BarChart3 className="w-4 h-4" />}
          action={<Link href="/error-types" className="text-xs text-primary hover:underline">Open Error Types →</Link>}
        >
          <div className="space-y-2.5" data-testid="error-type-bars">
            {errorTypeBars.length === 0 ? (
              <p className="text-sm text-muted-foreground">No classifications to display</p>
            ) : (
              errorTypeBars.map(b => (
                <div key={b.name} className="text-sm">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="flex-1 truncate">{b.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{b.pct}%</span>
                    <span className="text-xs font-medium font-mono" style={{ color: "hsl(var(--cc-success))" }}>
                      {clerk ? "—" : `+${formatCompactCurrency(b.recovered)}`}
                    </span>
                    <span className="text-xs font-mono opacity-70" style={{ color: "hsl(var(--destructive))" }}>
                      {clerk ? "—" : `-${formatCompactCurrency(b.denied)}`}
                    </span>
                  </div>
                  <MiniBar pct={b.barPct} tone="green" />
                </div>
              ))
            )}
          </div>
        </Section>

        <Section title="Team productivity" icon={<Users className="w-4 h-4" />} padded={false}>
          <div className="text-[10px] uppercase font-semibold px-4 py-1.5 flex items-center gap-3 bg-muted border-b border-border text-muted-foreground">
            <span style={{ minWidth: 140 }}>Owner</span>
            <span style={{ minWidth: 50, textAlign: "right" }}>Filed</span>
            <span style={{ minWidth: 50, textAlign: "right" }}>Won</span>
            <span className="flex-1">Win rate</span>
          </div>
          <SkeletonSwap
            loading={prodLoading}
            skeleton={<Skeleton className="h-24 w-full" />}
          >
          {teamRows.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">No tracked user activity in this window</div>
          ) : (
            teamRows.map(t => (
              <div
                key={t.who}
                className="px-4 py-2.5 flex items-center gap-3 text-sm border-b border-border last:border-b-0"
                data-testid={`team-row-${t.who}`}
              >
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

      {/* Footer breakdowns: status / outcome / portal */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="insights-footer-breakdowns">
        <div className="rounded-md border border-border bg-card p-3.5">
          <div className="text-[11px] uppercase font-semibold mb-2 text-muted-foreground flex items-center gap-1">
            By status (in flight)
            <InfoTooltip content="Distribution of all claims by their current workflow status." />
          </div>
          <div className="text-xs space-y-1">
            {Object.keys(statusBreakdown).length === 0 ? (
              <p className="text-muted-foreground">No claims to display</p>
            ) : (
              Object.entries(statusBreakdown)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([s, n]) => (
                  <div key={s} className="flex justify-between">
                    <span className="truncate mr-2">{s}</span>
                    <span className="font-mono tabular-nums">{n}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-3.5">
          <div className="text-[11px] uppercase font-semibold mb-2 text-muted-foreground flex items-center gap-1">
            By outcome
            <InfoTooltip content="Distribution of all claims by dispute outcome." />
          </div>
          <div className="text-xs space-y-1">
            {Object.keys(outcomeBreakdown).length === 0 ? (
              <p className="text-muted-foreground">No outcomes to display</p>
            ) : (
              Object.entries(outcomeBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([o, n]) => {
                  const color =
                    o === "Approved" || o === "Partially Approved"
                      ? "hsl(var(--cc-success))"
                      : o === "Denied"
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--muted-foreground))";
                  const Icon = o === "Approved" || o === "Partially Approved" ? CheckCircle2 : o === "Denied" ? XCircle : Activity;
                  return (
                    <div key={o} className="flex justify-between items-center">
                      <span className="flex items-center gap-1.5 truncate" style={{ color }}>
                        <Icon className="w-3 h-3" />
                        {o}
                      </span>
                      <span className="font-mono tabular-nums">{n}</span>
                    </div>
                  );
                })
            )}
            <div className="text-[10px] text-muted-foreground pt-1">{totalClaims} total claims</div>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-3.5" data-testid="payor-breakdown">
          <div className="text-[11px] uppercase font-semibold mb-2 text-muted-foreground flex items-center gap-1">
            By payor
            <InfoTooltip content="Top payors by claim volume in the sample. Denied $ shows current at-risk exposure with that payor." />
          </div>
          <div className="text-xs space-y-1">
            {Object.keys(payorBreakdown).length === 0 ? (
              <p className="text-muted-foreground">No payor data to display</p>
            ) : (
              Object.entries(payorBreakdown)
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 6)
                .map(([email, agg]) => (
                  <div key={email} className="flex justify-between items-baseline gap-2">
                    <span className="truncate flex-1" title={email}>{email}</span>
                    <span className="font-mono tabular-nums">{agg.count}</span>
                    <span
                      className="font-mono tabular-nums text-[10px]"
                      style={{ color: !clerk && agg.atRisk > 0 ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}
                      title="Sum of denied claim amounts attributed to this payor"
                    >
                      {clerk ? "—" : agg.atRisk > 0 ? `-${formatCompactCurrency(agg.atRisk)}` : "—"}
                    </span>
                  </div>
                ))
            )}
            <div className="text-[10px] text-muted-foreground pt-1">
              {Object.keys(payorBreakdown).length} distinct payor{Object.keys(payorBreakdown).length === 1 ? "" : "s"} sampled
            </div>
          </div>
        </div>
      </div>

      {totalExposure > 0 && summary.expiringGroups.length > 0 && (
        <div
          className="rounded-md border border-border bg-card p-3.5 flex items-center gap-3 text-sm flex-wrap"
          data-testid="exposure-callout"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: summary.urgentCount > 0 ? "hsl(var(--destructive))" : "hsl(var(--cc-warning))" }} />
          <span>
            {summary.urgentCount > 0 ? (
              <>
                <strong style={{ color: "hsl(var(--destructive))" }}>{summary.urgentCount} urgent</strong> ·{" "}
              </>
            ) : null}
            <strong>{summary.expiringGroups.length}</strong> invoice group{summary.expiringGroups.length === 1 ? "" : "s"} approaching the dispute deadline{!clerk && (
              <>
                {" "}· est. exposure{" "}
                <strong style={{ color: "hsl(var(--destructive))" }}>
                  {formatCurrency(String(summary.expiringGroups.reduce((s, g) => s + (parseFloat(g.totalAmount || "0") || 0), 0) * exposureMultiplier))}
                </strong>{" "}
                <span className="text-xs text-muted-foreground">(claim + ~{Math.round(vendorPrepayRate * 100)}% vendor prepay, approx.)</span>
              </>
            )}
          </span>
          <Link
            href={summary.urgentCount > 0 ? "/invoice-groups?expiring=urgent" : "/invoice-groups?expiring=soon"}
            className="ml-auto text-xs text-primary hover:underline"
          >
            {summary.urgentCount > 0 ? "Open urgent worklist →" : "Open worklist →"}
          </Link>
        </div>
      )}
    </div>
  );
}
