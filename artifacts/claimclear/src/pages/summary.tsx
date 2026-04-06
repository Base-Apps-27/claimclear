import { useGetDashboardSummary, useListClaims } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { BarChart3, DollarSign, TrendingUp, AlertTriangle } from "lucide-react";

export default function Summary() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: allClaimsData } = useListClaims({ limit: 1000 });

  if (summaryLoading) return <div className="text-center py-12 text-muted-foreground">Loading analytics...</div>;
  if (!summary) return <div className="text-center py-12 text-muted-foreground">No data available</div>;

  const claims = allClaimsData?.claims || [];
  const totalClaimed = parseFloat(summary.amounts.totalClaimed);
  const totalApproved = parseFloat(summary.amounts.totalApproved);
  const totalExposure = parseFloat(summary.amounts.totalExposure);
  const recoveryRate = totalClaimed > 0 ? ((totalApproved / totalClaimed) * 100).toFixed(1) : "0";

  const statusBreakdown: Record<string, number> = {};
  const outcomeBreakdown: Record<string, number> = {};
  const errorTypeBreakdown: Record<string, number> = {};

  claims.forEach(c => {
    statusBreakdown[c.status] = (statusBreakdown[c.status] || 0) + 1;
    outcomeBreakdown[c.outcome] = (outcomeBreakdown[c.outcome] || 0) + 1;
    const et = c.errorTypeName || "Unclassified";
    errorTypeBreakdown[et] = (errorTypeBreakdown[et] || 0) + 1;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Summary Analytics</h2>
        <p className="text-muted-foreground">Overview of claim dispute performance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-primary" />
              <div>
                <p className="text-3xl font-bold">{summary.stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Claims</p>
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
                <p className="text-xs text-muted-foreground">Disputed Amount</p>
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
                <p className="text-xs text-muted-foreground">Recovered Amount</p>
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
                <p className="text-xs text-muted-foreground">Total Exposure</p>
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
                <p className="text-xs text-muted-foreground">Recovery Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {summary.expiringClaims.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              30-Day Expiration Risk ({summary.expiringClaims.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              Total exposure at risk: {formatCurrency(String(summary.expiringClaims.reduce((s, c) => s + (parseFloat(c.claimAmount || "0") || 0), 0) * 1.7))}
              <span className="text-xs ml-1">(claims + ~70% vendor prepay, approx.)</span>
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>By Status</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(statusBreakdown).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm">{status}</span>
                  <Badge variant="secondary">{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>By Outcome</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(outcomeBreakdown).sort((a, b) => b[1] - a[1]).map(([outcome, count]) => (
                <div key={outcome} className="flex items-center justify-between">
                  <span className="text-sm">{outcome}</span>
                  <Badge variant="secondary">{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>By Error Type</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(errorTypeBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([et, count]) => (
                <div key={et} className="flex items-center justify-between">
                  <span className="text-sm truncate mr-2">{et}</span>
                  <Badge variant="secondary">{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Portal Submission Stats</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-amber-500">{summary.portalStats.pending}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-500">{summary.portalStats.submitted}</p>
              <p className="text-xs text-muted-foreground">Submitted</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-500">{summary.portalStats.failed}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-500">{summary.portalStats.successRate}%</p>
              <p className="text-xs text-muted-foreground">Success Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
