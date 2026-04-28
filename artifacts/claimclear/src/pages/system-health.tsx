import {
  useGetSystemHealthCronRuns,
  useGetSystemHealthConnectors,
  useGetSystemHealthBounces,
  useGetSystemHealthWorkerActivity,
  getGetSystemHealthCronRunsQueryKey,
  getGetSystemHealthConnectorsQueryKey,
  getGetSystemHealthBouncesQueryKey,
  getGetSystemHealthWorkerActivityQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, AlertTriangle, Clock, MailX, Activity, Bot } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { WorkerHealthBanner } from "@/components/worker-health-banner";

const REFRESH_MS = 30_000;

function statusBadge(status: string) {
  switch (status) {
    case "ok":
    case "healthy":
      return <Badge className="bg-green-600 text-white">{status}</Badge>;
    case "running":
      return <Badge className="bg-blue-500 text-white">{status}</Badge>;
    case "degraded":
      return <Badge className="bg-amber-500 text-white">{status}</Badge>;
    case "failed":
    case "unhealthy":
      return <Badge className="bg-rose-600 text-white">{status}</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function relTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export default function SystemHealth() {
  const { data: cronData, isLoading: cronLoading } = useGetSystemHealthCronRuns({
    query: {
      queryKey: getGetSystemHealthCronRunsQueryKey(),
      refetchInterval: REFRESH_MS,
    },
  });
  const { data: connectorsData, isLoading: connectorsLoading } = useGetSystemHealthConnectors({
    query: {
      queryKey: getGetSystemHealthConnectorsQueryKey(),
      refetchInterval: REFRESH_MS,
    },
  });
  const { data: workerData, isLoading: workerLoading } = useGetSystemHealthWorkerActivity({
    query: {
      queryKey: getGetSystemHealthWorkerActivityQueryKey(),
      refetchInterval: REFRESH_MS,
    },
  });
  const { data: bouncesData, isLoading: bouncesLoading } = useGetSystemHealthBounces(
    { onlyUnmatched: "true", limit: 25 },
    {
      query: {
        queryKey: getGetSystemHealthBouncesQueryKey({ onlyUnmatched: "true", limit: 25 }),
        refetchInterval: REFRESH_MS,
      },
    },
  );

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Health</h1>
        <p className="text-muted-foreground mt-2">
          Background jobs, connector status, and unmatched email bounces. Auto-refreshes every 30 seconds.
        </p>
      </div>

      <WorkerHealthBanner variant="full" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-600" /> Scheduled Jobs
          </CardTitle>
          <CardDescription>Last 7 days of cron run history</CardDescription>
        </CardHeader>
        <CardContent>
          {cronLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : cronData?.jobs?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase border-b">
                  <tr>
                    <th className="text-left px-3 py-2">Job</th>
                    <th className="text-left px-3 py-2">Schedule</th>
                    <th className="text-left px-3 py-2">Last Run</th>
                    <th className="text-left px-3 py-2">Next Run</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Message</th>
                    <th className="text-right px-3 py-2">7d Success</th>
                  </tr>
                </thead>
                <tbody>
                  {cronData.jobs.map((j) => (
                    <tr key={j.jobName} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{j.jobName}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{j.cron ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{relTime(j.lastRun?.startedAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{relTime(j.nextRunAt)}</td>
                      <td className="px-3 py-2">{j.lastRun ? statusBadge(j.lastRun.status) : <span className="text-muted-foreground text-xs">No runs</span>}</td>
                      <td className="px-3 py-2 text-xs max-w-md truncate" title={j.lastRun?.message ?? ""}>{j.lastRun?.message ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-xs">
                        <span className={j.failures7d > 0 ? "text-amber-600 font-medium" : "text-green-600"}>
                          {j.successRate7d}%
                        </span>
                        <span className="text-muted-foreground"> ({j.runs7d - j.failures7d}/{j.runs7d})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No scheduled jobs have run yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" /> Connector Status
          </CardTitle>
          <CardDescription>External connector health probes</CardDescription>
        </CardHeader>
        <CardContent>
          {connectorsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : connectorsData?.connectors?.length ? (
            <div className="space-y-3">
              {connectorsData.connectors.map((c) => (
                <div key={c.connectorName} className="flex items-center justify-between border rounded-md p-3">
                  <div className="flex items-center gap-3">
                    {c.status === "healthy" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : c.status === "unhealthy" ? (
                      <XCircle className="h-5 w-5 text-rose-600" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                    )}
                    <div>
                      <div className="font-medium capitalize">{c.connectorName}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Checked {relTime(c.lastCheckedAt)}
                      </div>
                      {c.lastError && (
                        <div className="text-xs text-rose-600 mt-1 font-mono">{c.lastError}</div>
                      )}
                    </div>
                  </div>
                  {statusBadge(c.status)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No connector probes recorded yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-600" /> Worker Activity
          </CardTitle>
          <CardDescription>
            On-demand portal worker. Each run launches a fresh browser to process pending submissions and exits when finished.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workerLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : workerData ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className="text-lg font-semibold mt-1">
                    {workerData.isRunning ? (
                      <Badge className="bg-blue-500 text-white">Running</Badge>
                    ) : workerData.lastRun?.status === "failed" ? (
                      <Badge className="bg-rose-600 text-white">Last run failed</Badge>
                    ) : (
                      <Badge className="bg-green-600 text-white">Idle</Badge>
                    )}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Pending due</div>
                  <div className="text-lg font-semibold mt-1">{workerData.pendingDueCount}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Overdue (&gt;{workerData.overdueThresholdMinutes}m)</div>
                  <div className={`text-lg font-semibold mt-1 ${workerData.overdueCount > 0 ? "text-amber-600" : ""}`}>
                    {workerData.overdueCount}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Next sweep</div>
                  <div className="text-sm font-semibold mt-1">
                    {workerData.nextSweepAt ? relTime(workerData.nextSweepAt) : "—"}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 border-t pt-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-1">Last successful submission</div>
                  {workerData.lastSuccessfulSubmission ? (
                    <div className="text-xs space-y-0.5">
                      <div>
                        <span className="text-muted-foreground">Submission </span>
                        <span className="font-mono">#{workerData.lastSuccessfulSubmission.submissionId}</span>
                        <span className="text-muted-foreground"> · claim </span>
                        <span className="font-mono">#{workerData.lastSuccessfulSubmission.claimId}</span>
                      </div>
                      {workerData.lastSuccessfulSubmission.confNumber ? (
                        <div><span className="text-muted-foreground">Conf #</span> <span className="font-mono">{workerData.lastSuccessfulSubmission.confNumber}</span></div>
                      ) : null}
                      <div className="text-muted-foreground">{relTime(workerData.lastSuccessfulSubmission.at)}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No successful submissions recorded.</div>
                  )}
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-1">Last failed submission</div>
                  {workerData.lastFailedSubmission ? (
                    <div className="text-xs space-y-0.5">
                      <div>
                        <span className="text-muted-foreground">Submission </span>
                        <span className="font-mono">#{workerData.lastFailedSubmission.submissionId}</span>
                        <span className="text-muted-foreground"> · claim </span>
                        <span className="font-mono">#{workerData.lastFailedSubmission.claimId}</span>
                      </div>
                      <div className="text-muted-foreground">
                        Attempts {workerData.lastFailedSubmission.attempts}/{workerData.lastFailedSubmission.maxAttempts}
                        {" · "}{relTime(workerData.lastFailedSubmission.at)}
                      </div>
                      {workerData.lastFailedSubmission.errorMessage ? (
                        <div
                          className="font-mono text-rose-600 break-all line-clamp-3 max-h-16 overflow-hidden"
                          title={workerData.lastFailedSubmission.errorMessage}
                        >
                          {workerData.lastFailedSubmission.errorMessage.length > 240
                            ? `${workerData.lastFailedSubmission.errorMessage.slice(0, 240)}…`
                            : workerData.lastFailedSubmission.errorMessage}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No failed submissions recorded.</div>
                  )}
                </div>
              </div>
              {workerData.lastRun ? (
                <div className="text-sm border-t pt-3">
                  <div className="font-medium mb-1">Last run</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Batch ID</span>
                    <span className="font-mono">{workerData.lastRun.batchId}</span>
                    <span className="text-muted-foreground">Status</span>
                    <span>{statusBadge(workerData.lastRun.status)}</span>
                    <span className="text-muted-foreground">Triggered by</span>
                    <span>{workerData.lastRun.triggeredBy}</span>
                    <span className="text-muted-foreground">Started</span>
                    <span>{relTime(workerData.lastRun.startedAt)}</span>
                    <span className="text-muted-foreground">Finished</span>
                    <span>{relTime(workerData.lastRun.finishedAt)}</span>
                    <span className="text-muted-foreground">Results</span>
                    <span>{workerData.lastRun.succeeded}/{workerData.lastRun.total} succeeded, {workerData.lastRun.failed} failed</span>
                    {workerData.lastRun.lastError ? (
                      <>
                        <span className="text-muted-foreground">Last error</span>
                        <span className="font-mono text-rose-600">{workerData.lastRun.lastError}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No worker runs since the API restarted.</p>
              )}
              {workerData.recentRuns.length > 1 ? (
                <div className="border-t pt-3">
                  <div className="font-medium text-sm mb-2">Recent runs</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground uppercase border-b">
                        <tr>
                          <th className="text-left px-2 py-1">Started</th>
                          <th className="text-left px-2 py-1">Trigger</th>
                          <th className="text-left px-2 py-1">Status</th>
                          <th className="text-right px-2 py-1">Results</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workerData.recentRuns.slice(0, 10).map((r) => (
                          <tr key={r.batchId} className="border-b last:border-0">
                            <td className="px-2 py-1">{relTime(r.startedAt)}</td>
                            <td className="px-2 py-1">{r.triggeredBy}</td>
                            <td className="px-2 py-1">{statusBadge(r.status)}</td>
                            <td className="px-2 py-1 text-right">{r.succeeded}/{r.total} ok, {r.failed} fail</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Worker activity unavailable.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailX className="h-5 w-5 text-rose-600" /> Unmatched Email Bounces
          </CardTitle>
          <CardDescription>NDR / bounce messages we couldn't link to a claim or invoice group</CardDescription>
        </CardHeader>
        <CardContent>
          {bouncesLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : bouncesData?.bounces?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase border-b">
                  <tr>
                    <th className="text-left px-3 py-2">Received</th>
                    <th className="text-left px-3 py-2">Failed Recipient</th>
                    <th className="text-left px-3 py-2">Subject</th>
                  </tr>
                </thead>
                <tbody>
                  {bouncesData.bounces.map((b) => (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{relTime(b.receivedAt)}</td>
                      <td className="px-3 py-2 text-xs font-mono">{b.recipientEmail ?? "(unknown)"}</td>
                      <td className="px-3 py-2 text-xs max-w-lg truncate" title={b.subject ?? ""}>{b.subject ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No unmatched bounces — nice.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
