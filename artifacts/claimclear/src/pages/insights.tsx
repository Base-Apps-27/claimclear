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
  useListClaims,
  useGetDashboardTimeseries,
  useGetDashboardUserProductivity,
  useGetDashboardRepeatOffenders,
  getExportClaimsCsvUrl,
} from "@workspace/api-client-react";
import { useDashboardLiveUpdates } from "@/hooks/use-claim-events";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader, FilterStrip, type FilterStripTab, MetricTile, Section } from "@/components/cohesion";
import { InfoTooltip } from "@/components/info-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";

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
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (key === "qtd") return `Quarter to date · ${fmt(start)} – ${fmt(end)}`;
  if (key === "ytd") return `Year to date · ${fmt(start)} – ${fmt(end)}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
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
  const [rangeKey, setRangeKey] = useState<RangeKey>("30");
  const days = daysForRange(rangeKey);
  const createdFromISO = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }, [days]);

  useDashboardLiveUpdates();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  // `includeExpired: true`: analytics over a date range
  // must include past-deadline and Expired claims; otherwise the
  // counts misrepresent the historical workload.
  const { data: allClaimsData } = useListClaims({ limit: 1000, createdFrom: createdFromISO, includeExpired: true });
  const { data: timeseries, isLoading: tsLoading } = useGetDashboardTimeseries({ days });
  const { data: productivity, isLoading: prodLoading } = useGetDashboardUserProductivity({ days });
  const { data: repeat, isLoading: repeatLoading } = useGetDashboardRepeatOffenders({ days, limit: 5 });

  const claims = allClaimsData?.claims || [];

  const { statusBreakdown, outcomeBreakdown, errorTypeAggregate, payorBreakdown, totalClaims, rangeAmounts } = useMemo(() => {
    const status: Record<string, number> = {};
    const outcome: Record<string, number> = {};
    type ErrAgg = { count: number; recovered: number; denied: number };
    const errorType: Record<string, ErrAgg> = {};
    type PayorAgg = { count: number; denied: number; recovered: number; atRisk: number };
    const payor: Record<string, PayorAgg> = {};
    let claimedSum = 0;
    let approvedSum = 0;
    let deniedSum = 0;
    for (const c of claims) {
      status[c.status] = (status[c.status] || 0) + 1;
      outcome[c.outcome] = (outcome[c.outcome] || 0) + 1;
      const et = c.errorTypeName || "Unclassified";
      const agg = errorType[et] || (errorType[et] = { count: 0, recovered: 0, denied: 0 });
      agg.count += 1;
      const amt = parseFloat(c.claimAmount || "0");
      const isApproved = c.outcome === "Approved" || c.outcome === "Partially Approved";
      const isDenied = c.outcome === "Denied";
      if (Number.isFinite(amt)) {
        claimedSum += amt;
        if (isApproved) {
          agg.recovered += amt;
          approvedSum += amt;
        }
        if (isDenied) {
          agg.denied += amt;
          deniedSum += amt;
        }
      }
      const payorKey = c.payorEmail || "Unassigned";
      const p = payor[payorKey] || (payor[payorKey] = { count: 0, denied: 0, recovered: 0, atRisk: 0 });
      p.count += 1;
      if (isDenied) {
        p.denied += 1;
        if (Number.isFinite(amt)) p.atRisk += amt;
      }
      if (isApproved && Number.isFinite(amt)) p.recovered += amt;
    }
    return {
      statusBreakdown: status,
      outcomeBreakdown: outcome,
      errorTypeAggregate: errorType,
      payorBreakdown: payor,
      totalClaims: claims.length,
      rangeAmounts: { claimed: claimedSum, approved: approvedSum, denied: deniedSum },
    };
  }, [claims]);

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

  const errorTypeBars = useMemo(() => {
    const entries = Object.entries(errorTypeAggregate)
      .map(([name, agg]) => ({ name, ...agg }))
      .sort((a, b) => b.recovered - a.recovered)
      .slice(0, 6);
    const maxRecovered = entries.reduce((m, e) => Math.max(m, e.recovered), 0) || 1;
    const totalCount = entries.reduce((s, e) => s + e.count, 0) || 1;
    return entries.map(e => ({
      ...e,
      pct: Math.round((e.count / totalCount) * 100),
      barPct: Math.round((e.recovered / maxRecovered) * 100),
    }));
  }, [errorTypeAggregate]);

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

  const handlePrintMonthlyReport = () => {
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
        onClick={handlePrintMonthlyReport}
        data-testid="btn-monthly-pdf-report"
      >
        <Printer className="w-4 h-4 mr-1.5" />
        Monthly PDF report
      </Button>
    </div>
  );

  if (summaryLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Insights" sub="Loading…" accent="green" actions={headerActions} />
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  if (!summary) {
    return <div className="text-center py-12 text-muted-foreground">No data available</div>;
  }

  // Range-windowed amounts (computed from claims sample filtered by createdFrom).
  const totalClaimed = rangeAmounts.claimed;
  const totalApproved = rangeAmounts.approved;
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
        sub="Recovery analytics and pattern detection"
        accent="green"
        actions={headerActions}
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <FilterStrip<RangeKey>
          tabs={RANGE_TABS}
          active={rangeKey}
          onChange={setRangeKey}
          accent="green"
          ariaLabel="Filter insights by time range"
        />
        <span className="text-xs text-muted-foreground">{rangeWindowLabel(rangeKey, days)}</span>
      </div>

      {/* Topline metric tiles — windowed to the selected time range */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="insights-topline">
        <MetricTile label="Total claims" value={totalClaims} sub={`in last ${days}d`} />
        <MetricTile label="Disputed" value={formatCurrency(String(totalClaimed))} sub={`filed in last ${days}d`} tone="blue" />
        <MetricTile
          label="Recovered"
          value={formatCurrency(String(totalApproved))}
          sub={trendTotals.recovered > 0 ? `${formatCompactCurrency(trendTotals.recovered)} in last ${days}d` : `last ${days}d`}
          tone="green"
        />
        <MetricTile label="Total exposure" value={formatCurrency(String(totalExposure))} sub="claim + ~70% vendor prepay" tone="red" />
        <MetricTile label="Recovery rate" value={`${recoveryRate}%`} sub="recovered / disputed" tone="muted" />
      </div>

      {/* Recovery over time block */}
      <Section title="Recovery over time" icon={<TrendingUp className="w-4 h-4" />}>
        <div className="flex items-stretch gap-6 flex-wrap">
          <div className="min-w-[200px]">
            <div className="text-3xl font-bold tabular-nums" style={{ color: "hsl(var(--cc-success))" }}>
              {formatCompactCurrency(trendTotals.recovered)}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">recovered in last {days} days</div>
            {bestDay && bestDay.dollars > 0 && (
              <div className="text-xs mt-2 text-muted-foreground">
                Best day: <strong>{formatShortDate(bestDay.date)}</strong> · {formatCompactCurrency(bestDay.dollars)} recovered
              </div>
            )}
            <div className="text-xs mt-2 text-muted-foreground">
              {trendTotals.created} claims created · {trendTotals.resolved} resolved
            </div>
          </div>
          <div className="flex-1 min-w-[280px] h-32" data-testid="recovery-trend-chart">
            {tsLoading ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading…</div>
            ) : trendData.length === 0 || trendTotals.recovered === 0 ? (
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
          </div>
        </div>
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
            {repeatLoading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Loading…</div>
            ) : drivers.length === 0 ? (
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
            {repeatLoading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Loading…</div>
            ) : members.length === 0 ? (
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
                      +{formatCompactCurrency(b.recovered)}
                    </span>
                    <span className="text-xs font-mono opacity-70" style={{ color: "hsl(var(--destructive))" }}>
                      -{formatCompactCurrency(b.denied)}
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
          {prodLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : teamRows.length === 0 ? (
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
            <div className="text-[10px] text-muted-foreground pt-1">{totalClaims} total claims sampled</div>
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
                      style={{ color: agg.atRisk > 0 ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}
                      title="Sum of denied claim amounts attributed to this payor"
                    >
                      {agg.atRisk > 0 ? `-${formatCompactCurrency(agg.atRisk)}` : "—"}
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
            <strong>{summary.expiringGroups.length}</strong> invoice group{summary.expiringGroups.length === 1 ? "" : "s"} approaching the dispute deadline · est. exposure {" "}
            <strong style={{ color: "hsl(var(--destructive))" }}>
              {formatCurrency(String(summary.expiringGroups.reduce((s, g) => s + (parseFloat(g.totalAmount || "0") || 0), 0) * exposureMultiplier))}
            </strong>{" "}
            <span className="text-xs text-muted-foreground">(claim + ~{Math.round(vendorPrepayRate * 100)}% vendor prepay, approx.)</span>
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
