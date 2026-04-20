import {
  useGetSystemHealthCronRuns,
  useGetSystemHealthConnectors,
  useGetSystemHealthBounces,
  getGetSystemHealthCronRunsQueryKey,
  getGetSystemHealthConnectorsQueryKey,
  getGetSystemHealthBouncesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, AlertTriangle, Clock, MailX, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
