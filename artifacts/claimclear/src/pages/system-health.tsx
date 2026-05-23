import { useState } from "react";
import {
  useGetSystemHealthCronRuns,
  useGetSystemHealthConnectors,
  useGetSystemHealthBounces,
  useGetSystemHealthWorkerActivity,
  useGetSystemHealthRollup,
  useGetSystemHealthClassifierStats,
  useGetSystemHealthDailyBrief,
  useGetSystemHealthPortalScrape,
  useGetSystemHealthBots,
  useGetSystemHealthBotRuns,
  useRunExpiredSweep,
  getGetSystemHealthCronRunsQueryKey,
  getGetSystemHealthConnectorsQueryKey,
  getGetSystemHealthBouncesQueryKey,
  getGetSystemHealthWorkerActivityQueryKey,
  getGetSystemHealthRollupQueryKey,
  getGetSystemHealthClassifierStatsQueryKey,
  getGetSystemHealthDailyBriefQueryKey,
  getGetSystemHealthPortalScrapeQueryKey,
  getGetSystemHealthBotsQueryKey,
  getGetSystemHealthBotRunsQueryKey,
  type ClassifierStatsResponse,
  type BotHealthCard as BotHealthCardData,
} from "@workspace/api-client-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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
    // Task #738. The cron-runs layer stamps the success status as
    // `completed` (see `mapResultStatus` in cron-runs.ts), but every
    // verdict chip across the System Health page must paint
    // success-states in the same green token regardless of which
    // upstream alias the backend returned. Treat `completed` as an
    // ok-equivalent so the new "Last portal scrape" panel chip lines
    // up with the rest of the page (Daily Brief, Connectors, Worker).
    case "completed":
      return <Badge className="bg-green-600 text-white">{status === "completed" ? "ok" : status}</Badge>;
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
  // Task #738. Per-ticket detail for the most recent
  // `portal_response_sync` cron sweep — drives the "Last portal scrape"
  // panel below "Last Daily Brief".
  const { data: scrapeDetail, isLoading: scrapeDetailLoading } = useGetSystemHealthPortalScrape({
    query: {
      queryKey: getGetSystemHealthPortalScrapeQueryKey(),
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

      <BotsSection />

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

      {/* Task #738 — mirror of "Last Daily Brief" but for the
          `portal_response_sync` cron. The header counts come from the
          run's metadata snapshot; the per-ticket table comes from the
          per-submission `last_scrape_outcome` columns the orchestrator
          stamps for every considered ticket. */}
      <Card id="last-portal-scrape" data-testid="last-portal-scrape-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-600" /> Last portal scrape
          </CardTitle>
          <CardDescription>
            Per-ticket outcome of the most recent <span className="font-mono">portal_response_sync</span> sweep —
            new replies, no-change passes, and any reader/poster errors with their excerpts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SkeletonSwap loading={scrapeDetailLoading} skeleton={<Skeleton className="h-32 w-full" />}>
          {!scrapeDetail?.lastRun ? (
            <p className="text-sm text-muted-foreground">No portal scrape has run yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                {statusBadge(scrapeDetail.lastRun.status)}
                <span className="text-xs text-muted-foreground">
                  Started {relTime(scrapeDetail.lastRun.startedAt)}
                </span>
                {/* Task #738 — header parity with the Daily Brief panel:
                    finished + duration shown alongside started so an
                    operator can see a stuck/long sweep at a glance. */}
                {scrapeDetail.lastRun.finishedAt ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      Finished {relTime(scrapeDetail.lastRun.finishedAt)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({Math.max(0, Math.round((new Date(scrapeDetail.lastRun.finishedAt).getTime() - new Date(scrapeDetail.lastRun.startedAt).getTime()) / 1000))}s)
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-blue-600">running…</span>
                )}
                <span className="text-xs">
                  <span className="text-green-600 font-medium">{scrapeDetail.scraped ?? 0}</span>
                  {" / "}
                  <span className="font-medium">{scrapeDetail.considered ?? 0}</span>
                  {" scraped"}
                  {scrapeDetail.errored && scrapeDetail.errored > 0 ? (
                    <span className="text-rose-600 ml-1">({scrapeDetail.errored} errored)</span>
                  ) : null}
                  {scrapeDetail.newResponses && scrapeDetail.newResponses > 0 ? (
                    <span className="text-indigo-600 ml-1">· {scrapeDetail.newResponses} new repl{scrapeDetail.newResponses === 1 ? "y" : "ies"}</span>
                  ) : null}
                </span>
              </div>
              {scrapeDetail.lastRun.message ? (
                <p className="text-xs text-muted-foreground">{scrapeDetail.lastRun.message}</p>
              ) : null}
              {scrapeDetail.submissions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="portal-scrape-table">
                    <thead className="text-xs text-muted-foreground uppercase border-b">
                      <tr>
                        <th className="text-left px-3 py-2">Submission</th>
                        <th className="text-left px-3 py-2">Ticket</th>
                        <th className="text-left px-3 py-2">Last checked</th>
                        <th className="text-left px-3 py-2">Outcome</th>
                        <th className="text-left px-3 py-2">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scrapeDetail.submissions.map((s) => (
                        <tr key={s.submissionId} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono text-xs">
                            {s.invoiceNumber ?? `#${s.submissionId}`}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                            {s.portalTicketId ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {relTime(s.lastScrapedAt)}
                          </td>
                          <td className="px-3 py-2">
                            {s.outcome === "new_reply" ? (
                              <Badge className="bg-indigo-600 text-white">new reply</Badge>
                            ) : s.outcome === "no_change" ? (
                              <Badge variant="secondary">no change</Badge>
                            ) : s.outcome === "error" ? (
                              <Badge className="bg-rose-600 text-white">error</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs max-w-md truncate" title={s.errorExcerpt ?? ""}>
                            {s.errorExcerpt ? (
                              <span className="text-rose-600">{s.errorExcerpt}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No tickets were considered on this run (zero-due window).
                </p>
              )}
              {/* Task #738. Surface the capped error-row digest's
                  overflow count so a sweep that errored on hundreds
                  of tickets shows "+N more" rather than silently
                  hiding them. The route returns at most 50 error
                  rows in `errors[]`. */}
              {scrapeDetail.errorOverflow && scrapeDetail.errorOverflow > 0 ? (
                <p className="text-xs text-rose-600" data-testid="portal-scrape-error-overflow">
                  +{scrapeDetail.errorOverflow} more errored ticket{scrapeDetail.errorOverflow === 1 ? "" : "s"} not shown
                </p>
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

// Task #841. Per-bot health cards for the three risky surfaces: submit,
// payor response scan, and portal scrape. Cards summarize "is this bot
// alive?" — last success, last failure, queue depth, 7-day duration
// sparkline, and a Healthy/Degraded/Down pill. Clicking a card opens a
// drawer with the last 20 cron_runs for that bot.
function BotsSection() {
  const [openBotId, setOpenBotId] = useState<string | null>(null);
  const { data, isLoading } = useGetSystemHealthBots({
    query: {
      queryKey: getGetSystemHealthBotsQueryKey(),
      refetchInterval: REFRESH_MS,
    },
  });
  return (
    <Card data-testid="bots-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-600" /> Bots
        </CardTitle>
        <CardDescription>
          Per-bot health for the submit, payor response scan, and portal scrape workers.
          Status reflects the last 24h of runs; click a card for the run history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SkeletonSwap loading={isLoading} skeleton={<Skeleton className="h-32 w-full" />}>
          {data?.bots?.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.bots.map((b) => (
                <BotCard key={b.id} bot={b} onOpen={() => setOpenBotId(b.id)} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No bot data available.</p>
          )}
        </SkeletonSwap>
      </CardContent>
      <BotRunsDrawer
        botId={openBotId}
        label={data?.bots?.find((b) => b.id === openBotId)?.label ?? null}
        onOpenChange={(open) => { if (!open) setOpenBotId(null); }}
      />
    </Card>
  );
}

function botStatusBadge(status: "healthy" | "degraded" | "down") {
  if (status === "healthy") return <Badge className="bg-green-600 text-white">Healthy</Badge>;
  if (status === "degraded") return <Badge className="bg-amber-500 text-white">Degraded</Badge>;
  return <Badge className="bg-rose-600 text-white">Down</Badge>;
}

function BotCard({ bot, onOpen }: { bot: BotHealthCardData; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`bot-card-${bot.id}`}
      className="text-left rounded-md border p-3 hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{bot.label}</div>
        {botStatusBadge(bot.status)}
      </div>
      <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{bot.jobName}</div>
      {bot.statusReason ? (
        <div className="text-xs text-muted-foreground mt-1">{bot.statusReason}</div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-xs">
        <dt className="text-muted-foreground">Last success</dt>
        <dd className="text-right">{relTime(bot.lastSuccessAt)}</dd>
        <dt className="text-muted-foreground">Last failure</dt>
        <dd className="text-right">{relTime(bot.lastFailureAt)}</dd>
        {bot.queueDepth !== null ? (
          <>
            <dt className="text-muted-foreground">Queue depth</dt>
            <dd className="text-right tabular-nums">
              {bot.queueDepth}{bot.queueLabel ? ` ${bot.queueLabel}` : ""}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Avg run (7d)</dt>
        <dd className="text-right tabular-nums">{fmtDuration(bot.avgDurationMs7d)}</dd>
      </dl>
      {bot.lastFailureMessage ? (
        <div
          className="mt-2 text-[11px] font-mono text-rose-600 line-clamp-2"
          title={bot.lastFailureMessage}
        >
          {bot.lastFailureMessage}
        </div>
      ) : null}
      <div className="mt-2">
        <Sparkline values={bot.durationSparkline} />
        <div className="text-[10px] text-muted-foreground mt-1 text-right">
          {bot.runs7d} run{bot.runs7d === 1 ? "" : "s"} / 7d
          {bot.failures7d > 0 ? <span className="text-rose-600"> · {bot.failures7d} failed</span> : null}
        </div>
      </div>
    </button>
  );
}

// Tiny inline SVG sparkline. Days with no runs render as gaps so a
// zero-duration bar doesn't mislead the reader.
function Sparkline({ values }: { values: (number | null)[] }) {
  const width = 100;
  const height = 24;
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return <div className="h-6 text-[10px] text-muted-foreground italic">no runs in 7d</div>;
  }
  const max = Math.max(...present);
  const min = Math.min(...present);
  const range = Math.max(1, max - min);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    if (v === null) return null;
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return { x, y, v };
  });
  // Build segmented polyline so null buckets create gaps.
  const segments: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p === null) {
      if (cur.length > 0) { segments.push(cur); cur = []; }
    } else {
      cur.push({ x: p.x, y: p.y });
    }
  }
  if (cur.length > 0) segments.push(cur);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="text-blue-600"
      aria-label="7-day duration sparkline"
    >
      {segments.map((seg, i) => (
        <polyline
          key={i}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
        />
      ))}
      {points.map((p, i) => p ? (
        <circle key={i} cx={p.x} cy={p.y} r="1.5" fill="currentColor" />
      ) : null)}
    </svg>
  );
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const remS = Math.round(s - m * 60);
  return `${m}m ${remS}s`;
}

function BotRunsDrawer({
  botId,
  label,
  onOpenChange,
}: {
  botId: string | null;
  label: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = botId !== null;
  const { data, isLoading } = useGetSystemHealthBotRuns(botId ?? "submit", {
    query: {
      enabled: open && botId !== null,
      queryKey: getGetSystemHealthBotRunsQueryKey(botId ?? "submit"),
      refetchInterval: open ? REFRESH_MS : false,
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto" data-testid="bot-runs-drawer">
        <SheetHeader>
          <SheetTitle>{label ?? "Bot"} — recent runs</SheetTitle>
          <SheetDescription>
            Last 20 runs recorded in <span className="font-mono">cron_runs</span>
            {data?.jobName ? <> for <span className="font-mono">{data.jobName}</span></> : null}.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <SkeletonSwap loading={isLoading} skeleton={<Skeleton className="h-32 w-full" />}>
            {!data?.runs?.length ? (
              <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground uppercase border-b">
                    <tr>
                      <th className="text-left px-2 py-2">Started</th>
                      <th className="text-right px-2 py-2">Duration</th>
                      <th className="text-left px-2 py-2">Status</th>
                      <th className="text-left px-2 py-2">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="px-2 py-1.5 text-xs">{relTime(r.startedAt)}</td>
                        <td className="px-2 py-1.5 text-xs text-right tabular-nums">{fmtDuration(r.durationMs ?? null)}</td>
                        <td className="px-2 py-1.5">{statusBadge(r.status)}</td>
                        <td className="px-2 py-1.5 text-xs max-w-xs truncate" title={r.message ?? ""}>
                          {r.message ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SkeletonSwap>
        </div>
      </SheetContent>
    </Sheet>
  );
}
