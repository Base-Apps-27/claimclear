import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Link } from "wouter";
import { ArrowRight, AlertTriangle, Clock, CheckCircle2, Bot, Activity, Send, Inbox, XCircle, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/info-tooltip";
import { EmptyState } from "@/components/empty-state";
import { WorkerHealthBanner } from "@/components/worker-health-banner";

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

  const pipeline = summary.pipeline ?? {} as Record<string, number>;
  const amounts = summary.amounts ?? {} as Record<string, string>;
  const stats = summary.stats ?? {} as Record<string, number>;

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
        <p className="text-muted-foreground mt-2">Overview of dispute pipeline and recovery performance.</p>
      </div>

      <WorkerHealthBanner />

      {(stats.total ?? 0) === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Inbox}
              title="Welcome to ClaimClear"
              description="No claims yet. Import a MAS report to populate the pipeline, or create your first claim manually."
              primaryAction={{ label: "Import claims", href: "/import" }}
              secondaryAction={{ label: "Connect a portal", href: "/settings" }}
            />
          </CardContent>
        </Card>
      ) : (
      <>
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Needs Evidence
              <InfoTooltip content="Number of invoice groups that require evidence gathering before a dispute can be filed. These need GPS logs, driver statements, or other supporting documents." />
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{pipeline.needsEvidence ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Invoice groups requiring manual review
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Awaiting Response
              <InfoTooltip content="Invoice groups that have been submitted to the payor portal and are waiting for the payor to respond. Check back periodically for updates." />
            </CardTitle>
            <Clock className="h-4 w-4 text-violet-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-violet-600">{pipeline.awaitingResponse ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Submitted to payor portals
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Total Exposure
              <InfoTooltip content="Estimated total financial exposure including the claim amounts plus approximately 70% for vendor prepayment costs. This represents the maximum potential loss if disputes are not recovered." />
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(amounts.totalExposure)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Claims + ~70% vendor prepay (approx.)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Recovered
              <InfoTooltip content="Total dollar amount successfully recovered through approved disputes. This is money returned to the company after disputes were resolved in our favor." />
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(amounts.totalApproved)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(amounts.totalClaimed)} claimed across {stats.total ?? 0} invoice groups
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Portal Worker
              <InfoTooltip content="On-demand portal worker. Each run launches a fresh browser to process pending submissions and exits when finished." />
            </CardTitle>
            <Bot className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.portalWorker?.isRunning
                ? "Running"
                : summary.portalWorker?.lastRun?.status === "failed"
                  ? "Failed"
                  : summary.portalWorker?.lastRun
                    ? "Idle"
                    : "Never run"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.portalWorker?.isRunning ? (
                <Badge variant="default" className="text-[10px] bg-blue-600">In progress</Badge>
              ) : summary.portalWorker?.overdueCount && summary.portalWorker.overdueCount > 0 ? (
                <Badge variant="destructive" className="text-[10px]">{summary.portalWorker.overdueCount} overdue</Badge>
              ) : summary.portalWorker?.lastRun?.status === "failed" ? (
                <Badge variant="destructive" className="text-[10px]">Last run failed</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">Healthy</Badge>
              )}
              {" "}{summary.portalWorker?.pendingDueCount ?? 0} due
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Portal Queue
              <InfoTooltip content="Number of claims currently waiting in the queue for automated bot submission to the MAS portal. The bot processes these in order." />
            </CardTitle>
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
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Success Rate
              <InfoTooltip content="Percentage of portal submissions that were successfully completed by the bot. A low rate may indicate portal issues or session problems." />
            </CardTitle>
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

      {/* Closure breakdown: Denied vs Withdrawn (with reason split) */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="card-closure-denied">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Denied by payer
              <InfoTooltip content="Invoice groups the payer formally denied. These are real denials based on a recorded portal or email response — the dispute went all the way through and was rejected." />
            </CardTitle>
            <XCircle className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600" data-testid="stat-denied-total">{stats.denied ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <span data-testid="stat-denied-payer-denied">{stats.deniedByReason?.payer_denied ?? 0}</span> payer denied
              {(stats.deniedByReason?.other ?? 0) > 0 && (
                <> • <span data-testid="stat-denied-other">{stats.deniedByReason?.other ?? 0}</span> other</>
              )}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-closure-withdrawn">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              Withdrawn (closed by us)
              <InfoTooltip content="Invoice groups we chose to close internally — either Not Contestable (no clear path to recover the dollars) or Accepted Loss (we got a denial response and decided not to keep fighting it)." />
            </CardTitle>
            <MinusCircle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600" data-testid="stat-withdrawn-total">{stats.withdrawn ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              <span data-testid="stat-withdrawn-not-contestable">{stats.withdrawnByReason?.not_contestable ?? 0}</span> not contestable
              {" • "}
              <span data-testid="stat-withdrawn-accepted-loss">{stats.withdrawnByReason?.accepted_loss ?? 0}</span> accepted loss
              {(stats.withdrawnByReason?.other ?? 0) > 0 && (
                <> • <span data-testid="stat-withdrawn-other">{stats.withdrawnByReason?.other ?? 0}</span> other</>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Expiring Claims */}
        <Card className="col-span-1 border-red-200" data-testid="card-expiring-soon">
          <CardHeader>
            <CardTitle className="text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Expiring Soon
              <InfoTooltip
                content="Invoice groups awaiting action from our team whose dispute filing window closes within 10 days. Excludes groups already submitted to the payor or on hold. The office is closed on weekends, so deadlines that fall on Saturday or Sunday are treated as Friday."
                iconClassName="text-red-400"
              />
            </CardTitle>
            <CardDescription>Dispute window closing in {'<'} 10 days (weekends count as Friday)</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2"
              data-testid="urgent-count-tile"
            >
              <div className="text-3xl font-bold text-red-600 leading-none" data-testid="urgent-count-value">
                {summary.urgentCount ?? 0}
              </div>
              <p className="text-xs text-red-700 mt-1">
                Urgent — due today or next business day
              </p>
            </div>
            <div
              className="space-y-4 max-h-[22rem] overflow-y-auto pr-1"
              data-testid="expiring-list"
            >
              {summary.expiringGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoice groups expiring soon.</p>
              ) : (
                summary.expiringGroups.map(group => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0"
                    data-testid={`expiring-row-${group.id}`}
                    data-urgent={group.isUrgent ? "true" : "false"}
                  >
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <Link href={`/invoice-groups/${group.id}`} className="hover:underline hover:text-primary">
                          {group.invoiceNumber}
                        </Link>
                        <span
                          className={
                            group.isUrgent
                              ? "text-xs text-red-600 font-semibold"
                              : "text-xs text-muted-foreground font-medium"
                          }
                        >
                          {group.effectiveDaysLeft} days left
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDate(group.earliestDate)} • {group.rideCount} ride{group.rideCount === 1 ? '' : 's'} • {formatCurrency(group.totalAmount)}
                      </div>
                    </div>
                    <StatusBadge status={group.status} className="text-[10px] px-1.5 py-0" />
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Invoice Groups */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-1.5">
                Recent Activity
                <InfoTooltip content="The most recently updated invoice groups in the system. Use this to quickly see what's changed and jump to any group." />
              </CardTitle>
              <CardDescription>Recently updated invoice groups</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/invoice-groups">View All <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto overflow-y-auto max-h-[26rem] pr-1" data-testid="recent-activity-list">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b">
                  <tr>
                    <th className="px-4 py-3 font-medium rounded-tl-md">Invoice #</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3 font-medium">Error Type</th>
                    <th className="px-4 py-3 font-medium">Rides</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium rounded-tr-md">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentGroups.map(group => (
                    <tr key={group.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-primary">
                        <Link href={`/invoice-groups/${group.id}`}>{group.invoiceNumber}</Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(group.updatedAt)}</td>
                      <td className="px-4 py-3 max-w-[200px] truncate">{group.errorTypeName || 'Unknown'}</td>
                      <td className="px-4 py-3">{group.rideCount}</td>
                      <td className="px-4 py-3">{formatCurrency(group.totalAmount)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={group.status} />
                      </td>
                    </tr>
                  ))}
                  {summary.recentGroups.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        No recent invoice groups found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
      </>
      )}
    </div>
  );
}
