import { useMemo, useState } from "react";
import {
  useGetDashboardSummary,
  useListClaims,
  useGetDashboardTimeseries,
  useGetDashboardUserProductivity,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import {
  BarChart3,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Users,
  Activity,
  CheckCircle2,
  XCircle,
  FileText,
  Send,
} from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

type RangeOption = 7 | 30 | 90;

const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

const STATUS_COLORS: Record<string, string> = {
  "New": "#3b82f6",
  "Needs Evidence": "#f59e0b",
  "Portal Queued": "#8b5cf6",
  "Generating Email": "#a855f7",
  "Ready to Review": "#06b6d4",
  "Awaiting Response": "#0ea5e9",
  "On Hold": "#f97316",
  "Resolved": "#10b981",
  "Denied": "#ef4444",
};

const OUTCOME_COLORS: Record<string, string> = {
  "Pending": "#94a3b8",
  "Approved": "#10b981",
  "Partially Approved": "#22c55e",
  "Denied": "#ef4444",
  "Withdrawn": "#f97316",
  "Non-Issue": "#a855f7",
};

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function MiniBarRow({
  label,
  value,
  pct,
  color,
}: { label: string; value: number; pct: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="truncate mr-2">{label}</span>
        <Badge variant="secondary">{value}</Badge>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function Summary() {
  const [range, setRange] = useState<RangeOption>(30);

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: allClaimsData } = useListClaims({ limit: 1000 });
  const { data: timeseries, isLoading: tsLoading } = useGetDashboardTimeseries({ days: range });
  const { data: productivity, isLoading: prodLoading } = useGetDashboardUserProductivity({ days: range });

  const claims = allClaimsData?.claims || [];

  const { statusBreakdown, outcomeBreakdown, errorTypeBreakdown, totalClaims } = useMemo(() => {
    const status: Record<string, number> = {};
    const outcome: Record<string, number> = {};
    const errorType: Record<string, number> = {};
    claims.forEach(c => {
      status[c.status] = (status[c.status] || 0) + 1;
      outcome[c.outcome] = (outcome[c.outcome] || 0) + 1;
      const et = c.errorTypeName || "Unclassified";
      errorType[et] = (errorType[et] || 0) + 1;
    });
    return {
      statusBreakdown: status,
      outcomeBreakdown: outcome,
      errorTypeBreakdown: errorType,
      totalClaims: claims.length,
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

  const teamTotals = useMemo(() => {
    const users = productivity?.users || [];
    return {
      activeUsers: users.length,
      totalActions: users.reduce((s, u) => s + u.total, 0),
      maxTotal: users.reduce((m, u) => Math.max(m, u.total), 0) || 1,
    };
  }, [productivity]);

  if (summaryLoading) return <div className="text-center py-12 text-muted-foreground">Loading analytics...</div>;
  if (!summary) return <div className="text-center py-12 text-muted-foreground">No data available</div>;

  const totalClaimed = parseFloat(summary.amounts.totalClaimed);
  const totalApproved = parseFloat(summary.amounts.totalApproved);
  const totalExposure = parseFloat(summary.amounts.totalExposure);
  const recoveryRate = totalClaimed > 0 ? ((totalApproved / totalClaimed) * 100).toFixed(1) : "0";

  const trendData = (timeseries?.points || []).map(p => ({
    ...p,
    label: formatShortDate(p.date),
  }));

  const topUsers = (productivity?.users || []).slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Summary Analytics</h2>
          <p className="text-muted-foreground">Overview of claim dispute performance and team activity</p>
        </div>
        <div className="flex items-center gap-2" data-testid="range-selector">
          <span className="text-xs text-muted-foreground">Range:</span>
          {RANGE_OPTIONS.map(opt => (
            <Button
              key={opt.value}
              variant={range === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setRange(opt.value)}
              data-testid={`range-${opt.value}`}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-primary" />
              <div>
                <p className="text-3xl font-bold">{summary.stats.total}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Total Claims
                  <InfoTooltip content="The total number of claims in the system across all statuses and outcomes." />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-amber-500" />
              <div>
                <p className="text-3xl font-bold">{formatCurrency(summary.amounts.totalClaimed)}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Disputed Amount
                  <InfoTooltip content="The sum of all claim amounts across every claim in the system." />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-3xl font-bold">{formatCurrency(summary.amounts.totalApproved)}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Recovered Amount
                  <InfoTooltip content="Total dollar amount successfully recovered from approved disputes." />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-3xl font-bold">{formatCurrency(String(totalExposure))}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Total Exposure
                  <InfoTooltip content="Estimated financial exposure including claim amounts plus ~70% for vendor prepayment costs." />
                </p>
                <p className="text-[10px] text-muted-foreground">Claims + ~70% vendor prepay (approx.)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-3xl font-bold">{recoveryRate}%</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  Recovery Rate
                  <InfoTooltip content="Percentage of disputed dollars successfully recovered. (Recovered / Disputed) × 100." />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" data-testid="chart-activity-trend">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4" />
                  Activity Trend
                  <InfoTooltip content="Daily counts of claims created vs claims resolved or denied over the selected window." />
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Last {range} days · {trendTotals.created} created · {trendTotals.resolved} resolved
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {tsLoading ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
            ) : trendData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No activity in this window</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad-created" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="grad-resolved" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={32} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      labelFormatter={(l) => l as string}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="claimsCreated" name="Created" stroke="#3b82f6" strokeWidth={2} fill="url(#grad-created)" />
                    <Area type="monotone" dataKey="claimsResolved" name="Resolved/Denied" stroke="#10b981" strokeWidth={2} fill="url(#grad-resolved)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="chart-recovery-trend">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5">
              <DollarSign className="h-4 w-4" />
              Recovery Trend
              <InfoTooltip content="Daily dollars recovered (sum of approved amounts on groups updated that day)." />
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCompactCurrency(trendTotals.recovered)} recovered in {range}d
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            {tsLoading ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
            ) : trendData.length === 0 || trendTotals.recovered === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground text-center">
                No dollars recovered<br />in this window
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={48} tickFormatter={formatCompactCurrency} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(v: number) => [formatCurrency(String(v)), "Recovered"]}
                    />
                    <Bar dataKey="dollarsRecovered" name="Recovered" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="chart-team-activity">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Team Activity
                <InfoTooltip content="Per-user productivity over the selected window. Counts triage, resolutions, denials, draft edits, and portal submissions." />
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Last {range} days · {teamTotals.activeUsers} active {teamTotals.activeUsers === 1 ? "user" : "users"} · {teamTotals.totalActions} actions
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {prodLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : topUsers.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No tracked user activity in this window</div>
          ) : (
            <div className="space-y-4">
              {topUsers.map(u => {
                const widthPct = (u.total / teamTotals.maxTotal) * 100;
                return (
                  <div key={u.userEmail} data-testid={`user-row-${u.userEmail}`} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{u.userName || u.userEmail}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.userEmail}</p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">{u.total} total</Badge>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${Math.max(widthPct, 4)}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {u.triaged > 0 && (
                        <span className="flex items-center gap-1"><Activity className="h-3 w-3" />{u.triaged} triaged</span>
                      )}
                      {u.resolved > 0 && (
                        <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3" />{u.resolved} resolved</span>
                      )}
                      {u.denied > 0 && (
                        <span className="flex items-center gap-1 text-red-600"><XCircle className="h-3 w-3" />{u.denied} denied</span>
                      )}
                      {u.drafts > 0 && (
                        <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{u.drafts} draft edits</span>
                      )}
                      {u.submissions > 0 && (
                        <span className="flex items-center gap-1 text-blue-600"><Send className="h-3 w-3" />{u.submissions} submitted</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {summary.expiringGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              30-Day Expiration Risk ({summary.expiringGroups.length})
              <InfoTooltip content="Invoice groups approaching their dispute filing deadline. If not acted on within the window, the right to dispute may be lost permanently." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Total exposure at risk: {formatCurrency(String(summary.expiringGroups.reduce((s, g) => s + (parseFloat(g.totalAmount || "0") || 0), 0) * 1.7))}
              <span className="text-xs ml-1">(invoice totals + ~70% vendor prepay, approx.)</span>
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              By Status
              <InfoTooltip content="Breakdown of claims by their current workflow status. Shows how many claims are at each stage of the dispute process." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(statusBreakdown).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <MiniBarRow
                  key={status}
                  label={status}
                  value={count}
                  pct={totalClaims > 0 ? (count / totalClaims) * 100 : 0}
                  color={STATUS_COLORS[status] || "#64748b"}
                />
              ))}
              {Object.keys(statusBreakdown).length === 0 && (
                <p className="text-sm text-muted-foreground">No claims to display</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              By Outcome
              <InfoTooltip content="Breakdown of claims by their dispute outcome: Pending (undecided), Approved (payor agreed), Partially Approved, or Denied (payor rejected)." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(outcomeBreakdown).sort((a, b) => b[1] - a[1]).map(([outcome, count]) => (
                <MiniBarRow
                  key={outcome}
                  label={outcome}
                  value={count}
                  pct={totalClaims > 0 ? (count / totalClaims) * 100 : 0}
                  color={OUTCOME_COLORS[outcome] || "#64748b"}
                />
              ))}
              {Object.keys(outcomeBreakdown).length === 0 && (
                <p className="text-sm text-muted-foreground">No outcomes to display</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              Top Error Types
              <InfoTooltip content="Most common claim error classifications. Highlights which denial reasons appear most often and may need SOP attention." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(errorTypeBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([et, count], idx) => (
                <MiniBarRow
                  key={et}
                  label={et}
                  value={count}
                  pct={totalClaims > 0 ? (count / totalClaims) * 100 : 0}
                  color={["#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#ef4444", "#06b6d4", "#f97316", "#64748b"][idx % 8]}
                />
              ))}
              {Object.keys(errorTypeBreakdown).length === 0 && (
                <p className="text-sm text-muted-foreground">No classifications to display</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Portal Submission Stats
            <InfoTooltip content="Overview of automated bot submissions to the MAS portal. Shows how many are pending, successfully submitted, or failed." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Pending", value: summary.portalStats.pending, color: "#f59e0b" },
              { label: "Submitted", value: summary.portalStats.submitted, color: "#10b981" },
              { label: "Failed", value: summary.portalStats.failed, color: "#ef4444" },
              { label: "Success Rate", value: `${summary.portalStats.successRate}%`, color: "#3b82f6" },
            ].map(item => (
              <div key={item.label} className="text-center">
                <p className="text-2xl font-bold" style={{ color: item.color }}>{item.value}</p>
                <p className="text-xs text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
          {(summary.portalStats.pending + summary.portalStats.submitted + summary.portalStats.failed) > 0 && (
            <div className="mt-4 h-3 rounded-full overflow-hidden flex">
              {(() => {
                const totalSubs = summary.portalStats.pending + summary.portalStats.submitted + summary.portalStats.failed;
                return (
                  <>
                    <div style={{ width: `${(summary.portalStats.submitted / totalSubs) * 100}%`, backgroundColor: "#10b981" }} />
                    <div style={{ width: `${(summary.portalStats.pending / totalSubs) * 100}%`, backgroundColor: "#f59e0b" }} />
                    <div style={{ width: `${(summary.portalStats.failed / totalSubs) * 100}%`, backgroundColor: "#ef4444" }} />
                  </>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
