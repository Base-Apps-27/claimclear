import {
  useGetSystemHealthCronRuns,
  useGetSystemHealthConnectors,
  useGetSystemHealthBounces,
  useGetSystemHealthWorkerActivity,
  useGetSystemHealthRollup,
  useGetSystemHealthClassifierStats,
  useGetSystemHealthDailyBrief,
  useRunExpiredSweep,
  getGetSystemHealthCronRunsQueryKey,
  getGetSystemHealthConnectorsQueryKey,
  getGetSystemHealthBouncesQueryKey,
  getGetSystemHealthWorkerActivityQueryKey,
  getGetSystemHealthRollupQueryKey,
  getGetSystemHealthClassifierStatsQueryKey,
  getGetSystemHealthDailyBriefQueryKey,
  type ClassifierStatsResponse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast, successToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, AlertTriangle, Clock, MailX, Activity, Bot, Info, Sparkles, CalendarOff } from "lucide-react";
import { formatRelative, absoluteTooltip } from "@/lib/time";
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

// Relative time renders as a hover-aware element: tooltip surfaces the
// absolute timestamp in the configured display timezone, so operators
// can always disambiguate "5m ago" without leaving the page (#562).
function relTime(iso: string | null | undefined) {
  if (!iso) return <>—</>;
  const rel = formatRelative(iso) || "—";
  return <span title={absoluteTooltip(iso)}>{rel}</span>;
}

export default function SystemHealth() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Manual companion to the nightly 1 AM ET Expired sweep cron. Useful
  // when an operator notices stale past-deadline rows mid-day and
  // wants to retire them without waiting for the next tick.
  const expiredSweep = useRunExpiredSweep({
    mutation: {
      onSuccess: (result) => {
        successToast({
          title: "__VERB__",
          description: result.expired === 0
            ? "No groups to expire — everything past-deadline has already been retired."
            : `Expired ${result.expired} group${result.expired === 1 ? "" : "s"} · Sample IDs: ${result.sampleGroupIds.join(", ")}${result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}`,
        });
        queryClient.invalidateQueries({ queryKey: getGetSystemHealthCronRunsQueryKey() });
      },
      onError: (err) => {
        toast({
          title: "Expired sweep failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });
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
  // Per-recipient detail for the most recent daily_brief run.
  const { data: briefDetail, isLoading: briefDetailLoading } = useGetSystemHealthDailyBrief({
    query: {
      queryKey: getGetSystemHealthDailyBriefQueryKey(),
      refetchInterval: REFRESH_MS,
    },
  });
  const { data: rollupData } = useGetSystemHealthRollup({
    query: {
      queryKey: getGetSystemHealthRollupQueryKey(),
      refetchInterval: REFRESH_MS,
      retry: false,
    },
  });
  const { data: classifierData, isLoading: classifierLoading } =
    useGetSystemHealthClassifierStats(
      { days: 14 },
      {
        query: {
          queryKey: getGetSystemHealthClassifierStatsQueryKey({ days: 14 }),
          refetchInterval: REFRESH_MS,
          retry: false,
        },
      },
    );

  // Surface only components the rollup explicitly marked as informational —
  // e.g. "Awaiting first scheduled run since server boot" right after a
  // deploy, or "Skipped one scheduled tick — recovering" after a brief
  // restart. Filtering on the explicit flag (not just "status==ok &&
  // detail") avoids treating every healthy component's last-run message as
  // an alert.
  const infoNotes = (rollupData?.components ?? []).filter(
    (c) => c.informational && c.detail,
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
            <CalendarOff className="h-5 w-5 text-stone-600" /> Expired Sweep
          </CardTitle>
          <CardDescription>
            Retires invoice groups whose 30-day filing deadline has slipped while still in the pre-submit phase (any group not yet submitted to the payor portal — includes on-hold rows). Runs nightly at 1 AM ET; trigger here to catch up immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => expiredSweep.mutate({ data: {} })}
            disabled={expiredSweep.isPending}
            data-testid="button-run-expired-sweep"
          >
            {expiredSweep.isPending ? "Running…" : "Run Expired sweep now"}
          </Button>
        </CardContent>
      </Card>

      {infoNotes.length > 0 ? (
        <div
          className="rounded-md border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm"
          role="status"
          data-testid="system-health-info-notes"
        >
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-600" />
            <div className="flex-1">
              <p className="font-semibold text-blue-900 dark:text-blue-100">
                Informational
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-blue-900/90 dark:text-blue-100/90">
                {infoNotes.map((c) => (
                  <li key={c.name}>
                    <span className="font-mono">{c.name}</span> — {c.detail}
                  </li>
                ))}
              </ul>
              {rollupData?.bootedAt ? (
                <p className="text-[11px] mt-1.5 text-blue-900/70 dark:text-blue-100/70">
                  API server booted {relTime(rollupData.bootedAt)}.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-600" /> Scheduled Jobs
          </CardTitle>
          <CardDescription>Last 7 days of cron run history</CardDescription>
        </CardHeader>
        <CardContent>
          <SkeletonSwap loading={cronLoading} skeleton={<Skeleton className="h-32 w-full" />}>
          {cronData?.jobs?.length ? (
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
          </SkeletonSwap>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-600" /> Last Daily Brief
          </CardTitle>
          <CardDescription>
            Per-recipient outcome of the most recent <span className="font-mono">daily_brief</span> run —
            success rows carry the Outlook messageId, failure rows carry the error excerpt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SkeletonSwap loading={briefDetailLoading} skeleton={<Skeleton className="h-32 w-full" />}>
          {!briefDetail?.lastRun ? (
            <p className="text-sm text-muted-foreground">No daily brief has run yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                {statusBadge(briefDetail.lastRun.status)}
                <span className="text-xs text-muted-foreground">
                  Started {relTime(briefDetail.lastRun.startedAt)}
                </span>
                <span className="text-xs">
                  <span className="text-green-600 font-medium">{briefDetail.sentCount ?? 0}</span>
                  {" / "}
                  <span className="font-medium">{briefDetail.recipientCount ?? 0}</span>
                  {" sent"}
                  {briefDetail.failureCount && briefDetail.failureCount > 0 ? (
                    <span className="text-rose-600 ml-1">({briefDetail.failureCount} failed)</span>
                  ) : null}
                </span>
                {briefDetail.bounces && briefDetail.bounces.length > 0 ? (
                  <Badge className="bg-amber-500 text-white">
                    {briefDetail.bounces.length} bounce{briefDetail.bounces.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
              {briefDetail.lastRun.message ? (
                <p className="text-xs text-muted-foreground">{briefDetail.lastRun.message}</p>
              ) : null}
              {briefDetail.recipients.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground uppercase border-b">
                      <tr>
                        <th className="text-left px-3 py-2">Recipient</th>
                        <th className="text-left px-3 py-2">Variant</th>
                        <th className="text-left px-3 py-2">Outcome</th>
                        <th className="text-left px-3 py-2">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {briefDetail.recipients.map((r) => (
                        <tr key={r.outboundId} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono text-xs">{r.email}</td>
                          <td className="px-3 py-2 text-xs">
                            {r.roleVariant ? (
                              <Badge variant="secondary">{r.roleVariant}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {r.ok ? (
                              <Badge className="bg-green-600 text-white">sent</Badge>
                            ) : (
                              <Badge className="bg-rose-600 text-white">failed</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs max-w-md truncate" title={r.errorExcerpt ?? r.messageId ?? ""}>
                            {r.ok ? (
                              <span className="text-muted-foreground font-mono">{r.messageId ?? "(no id)"}</span>
                            ) : (
                              <span className="text-rose-600">{r.errorExcerpt ?? "Unknown send error"}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No per-recipient rows recorded for this run.
                </p>
              )}
              {briefDetail.bounces && briefDetail.bounces.length > 0 ? (
                <div className="border-t pt-3">
                  <p className="text-xs font-medium mb-2">Bounces tied to this run:</p>
                  <ul className="text-xs space-y-1">
                    {briefDetail.bounces.slice(0, 8).map((b) => (
                      <li key={b.id} className="font-mono text-amber-700 dark:text-amber-300">
                        {b.recipientEmail ?? "(unknown)"} — {relTime(b.receivedAt)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
          </SkeletonSwap>
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
          <SkeletonSwap loading={connectorsLoading} skeleton={<Skeleton className="h-20 w-full" />}>
          {connectorsData?.connectors?.length ? (
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
          </SkeletonSwap>
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
          <SkeletonSwap loading={workerLoading} skeleton={<Skeleton className="h-32 w-full" />}>
          {workerData ? (
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
                  <div className="text-xs text-muted-foreground">Past expected cycle</div>
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
                        <span className="text-muted-foreground"> · invoice group </span>
                        <span className="font-mono">#{workerData.lastSuccessfulSubmission.invoiceGroupId}</span>
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
                        <span className="text-muted-foreground"> · invoice group </span>
                        <span className="font-mono">#{workerData.lastFailedSubmission.invoiceGroupId}</span>
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
          </SkeletonSwap>
        </CardContent>
      </Card>

      <ClassifierStatsCard data={classifierData} loading={classifierLoading} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailX className="h-5 w-5 text-rose-600" /> Unmatched Email Bounces
          </CardTitle>
          <CardDescription>NDR / bounce messages we couldn't link to a claim or invoice group</CardDescription>
        </CardHeader>
        <CardContent>
          <SkeletonSwap loading={bouncesLoading} skeleton={<Skeleton className="h-20 w-full" />}>
          {bouncesData?.bounces?.length ? (
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
          </SkeletonSwap>
        </CardContent>
      </Card>
    </div>
  );
}

// LLM email-classifier monitoring card (Task #320). Surfaces:
// - 14-day verdict mix from the LLM-first cohort
// - Total Anthropic spend (computed from per-row token usage)
// - Per-day mini-table so trends are visible at a glance
// - Spike alerts when "other" or "abstain" rates jump vs the baseline
//
// Lives in this file rather than its own component because it's tightly
// coupled to the System Health page layout and consumes generated client
// types directly.
function ClassifierStatsCard({
  data,
  loading,
}: {
  data: ClassifierStatsResponse | undefined;
  loading: boolean;
}) {
  return (
    <Card data-testid="card-classifier-stats">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-600" /> LLM Email Classifier
        </CardTitle>
        <CardDescription>
          Inbound-email classifier verdict mix and Anthropic spend over the last{" "}
          {data?.windowDays ?? 14} days. Includes the LLM-first cohort only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SkeletonSwap loading={loading} skeleton={<Skeleton className="h-32 w-full" />}>
        {!data ? (
          <p className="text-sm text-muted-foreground">
            Classifier stats unavailable.
          </p>
        ) : (
          <div className="space-y-4">
            {data.alerts.length > 0 ? (
              <div
                className="rounded-md border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm"
                role="alert"
                data-testid="classifier-stats-alerts"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
                  <div className="flex-1">
                    <p className="font-semibold text-amber-900 dark:text-amber-100">
                      Classifier alert
                    </p>
                    <ul className="mt-1 space-y-1 text-xs text-amber-900/90 dark:text-amber-100/90">
                      {data.alerts.map((a) => (
                        <li key={a.kind}>
                          <span className="font-mono">{a.kind}</span> — {a.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Rows classified" value={fmtInt(data.totals.rows)} />
              <Stat label="AI calls" value={fmtInt(data.totals.aiCalls)} />
              <Stat
                label="Anthropic spend"
                value={fmtUsd(data.totals.spendUsd)}
              />
              <Stat
                label="Tokens (in / out)"
                value={`${fmtInt(data.totals.inputTokens)} / ${fmtInt(
                  data.totals.outputTokens,
                )}`}
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase border-b">
                  <tr>
                    <th className="text-left px-2 py-2">Day</th>
                    <th className="text-right px-2 py-2">Rows</th>
                    <th className="text-right px-2 py-2">AI</th>
                    <th className="text-right px-2 py-2">Phrase</th>
                    <th className="text-right px-2 py-2">Abstain</th>
                    <th className="text-right px-2 py-2">Other</th>
                    <th className="text-right px-2 py-2">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr
                      key={d.day}
                      className="border-b last:border-0"
                      data-testid={`classifier-stats-row-${d.day}`}
                    >
                      <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">
                        {d.day}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        {fmtInt(d.totalRows)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        {fmtInt(d.aiCallCount)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        {fmtInt(d.phraseSignatureCount)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        {d.abstainCount > 0 ? (
                          <span className="text-amber-700 dark:text-amber-300 font-semibold">
                            {fmtInt(d.abstainCount)}
                          </span>
                        ) : (
                          fmtInt(d.abstainCount)
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs">
                        {fmtInt(d.verdicts.other)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs font-mono">
                        {fmtUsd(d.spendUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </SkeletonSwap>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function fmtInt(n: number): string {
  return n.toLocaleString();
}

// Show 4 decimal places below $1 so a Haiku day still surfaces a non-zero
// number (single calls cost fractions of a cent), and 2 decimals above
// that so the dashboard reads naturally for higher-volume days.
function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
