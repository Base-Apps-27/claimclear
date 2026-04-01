import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Link } from "wouter";
import { ArrowRight, AlertTriangle, Clock, CheckCircle2, XCircle, Bot, Activity, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary({
    query: {
      queryKey: getGetDashboardSummaryQueryKey()
    }
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
        <p className="text-muted-foreground mt-2">Overview of dispute pipeline and recovery performance.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Evidence</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{summary.pipeline.needsEvidence}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Claims requiring manual review
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Awaiting Response</CardTitle>
            <Clock className="h-4 w-4 text-violet-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-violet-600">{summary.pipeline.awaitingResponse}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Submitted to payor portals
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recovered (Approved)</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(summary.amounts.totalApproved)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Total amount successfully disputed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Claimed</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.amounts.totalClaimed)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Across all {summary.stats.total} tracked claims
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bot Instances</CardTitle>
            <Bot className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.botInstances?.length || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {(summary.botInstances?.length || 0) > 0 ? (
                <Badge variant="default" className="text-[10px] bg-green-600">Online</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">Offline</Badge>
              )}
              {" "}Active in last 5 min
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Portal Queue</CardTitle>
            <Send className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.portalStats?.pending || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Pending submissions waiting for bot
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.portalStats?.successRate || 0}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.portalStats?.submitted || 0} submitted, {summary.portalStats?.failed || 0} failed
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Expiring Claims */}
        <Card className="col-span-1 border-red-200">
          <CardHeader>
            <CardTitle className="text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Expiring Soon
            </CardTitle>
            <CardDescription>Dispute window closing in {'<'} 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {summary.expiringClaims.length === 0 ? (
                <p className="text-sm text-muted-foreground">No claims expiring soon.</p>
              ) : (
                summary.expiringClaims.map(claim => (
                  <div key={claim.id} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <Link href={`/claims/${claim.id}`} className="hover:underline hover:text-primary">
                          {claim.confNumber}
                        </Link>
                        <span className="text-xs text-red-600 font-semibold">{claim.daysLeft} days left</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDate(claim.date)} • {formatCurrency(claim.claimAmount)}
                      </div>
                    </div>
                    <StatusBadge status={claim.status} className="text-[10px] px-1.5 py-0" />
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Claims */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest claims added to the system</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/claims">View All <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b">
                  <tr>
                    <th className="px-4 py-3 font-medium rounded-tl-md">Conf #</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Error Type</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium rounded-tr-md">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentClaims.map(claim => (
                    <tr key={claim.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-primary">
                        <Link href={`/claims/${claim.id}`}>{claim.confNumber}</Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(claim.date)}</td>
                      <td className="px-4 py-3 max-w-[200px] truncate">{claim.errorTypeName || 'Unknown'}</td>
                      <td className="px-4 py-3">{formatCurrency(claim.claimAmount)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={claim.status} />
                      </td>
                    </tr>
                  ))}
                  {summary.recentClaims.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No recent claims found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
