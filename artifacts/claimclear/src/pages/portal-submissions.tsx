import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPortalSubmissions, getListPortalSubmissionsQueryKey,
  useRetryPortalSubmission, useCancelPortalSubmission,
  useListBotActivity, getListBotActivityQueryKey,
  useListBotInstances,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { RefreshCw, XCircle, Eye, Bot, Play, CheckSquare, Loader2, Clock, AlertTriangle, CheckCircle } from "lucide-react";
import { InfoTooltip, WrapTooltip } from "@/components/info-tooltip";

const statusColors: Record<string, string> = {
  draft: "bg-blue-500/20 text-blue-700 border-blue-300",
  pending: "bg-amber-500/20 text-amber-700 border-amber-300",
  in_progress: "bg-blue-500/20 text-blue-700 border-blue-300",
  submitted: "bg-green-500/20 text-green-700 border-green-300",
  failed: "bg-red-500/20 text-red-700 border-red-300",
  cancelled: "bg-gray-500/20 text-gray-700 border-gray-300",
  dry_run: "bg-purple-500/20 text-purple-700 border-purple-300",
};

const statusDescriptions: Record<string, string> = {
  draft: "Preview generated — awaiting review and confirmation before queuing.",
  pending: "Waiting in the queue for processing.",
  in_progress: "Currently being processed — filling out the dispute form on the MAS portal.",
  submitted: "Successfully submitted to the portal. A ticket ID should be assigned.",
  failed: "Encountered an error during submission. Review the error and retry if needed.",
  cancelled: "This submission was manually cancelled and will not be processed.",
  dry_run: "Dry run completed — form was filled but not submitted.",
};

interface BatchJob {
  id: string;
  status: "running" | "completed" | "failed";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string;
  results: { submissionId: number; status: string; message: string }[];
}

export default function PortalSubmissions() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [activeBatch, setActiveBatch] = useState<BatchJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: submissions, isLoading } = useListPortalSubmissions(
    statusFilter ? { status: statusFilter } : undefined
  );
  const retrySubmission = useRetryPortalSubmission();
  const cancelSubmission = useCancelPortalSubmission();
  const { data: botInstances } = useListBotInstances();
  const { data: activityLogs } = useListBotActivity(selectedId || 0, {
    query: { queryKey: getListBotActivityQueryKey(selectedId || 0), enabled: !!selectedId }
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPortalSubmissionsQueryKey() });

  const pendingSubmissions = (submissions || []).filter(s => s.status === "pending");
  const allPendingChecked = pendingSubmissions.length > 0 && pendingSubmissions.every(s => checkedIds.has(s.id));

  const handleToggle = (id: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAll = () => {
    if (allPendingChecked) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(pendingSubmissions.map(s => s.id)));
    }
  };

  const pollBatchStatus = (batchId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/portal-submissions/batch-status/${batchId}`);
        if (res.ok) {
          const job: BatchJob = await res.json();
          setActiveBatch(job);
          invalidate();
          if (job.status !== "running") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setBatchRunning(false);
          }
        }
      } catch {}
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleBatchProcess = async (ids: number[] | "all") => {
    setBatchRunning(true);
    setActiveBatch(null);
    try {
      const res = await fetch("/api/portal-submissions/batch-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionIds: ids }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to start batch");
      }
      const { batchId } = await res.json();
      pollBatchStatus(batchId);
      setCheckedIds(new Set());
    } catch (err) {
      setBatchRunning(false);
      alert(err instanceof Error ? err.message : "Failed to start batch processing");
    }
  };

  const handleRetry = async (id: number) => {
    await retrySubmission.mutateAsync({ id });
    invalidate();
  };

  const handleCancel = async (id: number) => {
    await cancelSubmission.mutateAsync({ id });
    invalidate();
  };

  const selected = selectedId ? (submissions || []).find(s => s.id === selectedId) : null;
  const checkedCount = checkedIds.size;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Portal Submissions</h2>
          <p className="text-muted-foreground">MAS portal submission queue and status</p>
        </div>
        <div className="flex items-center gap-4">
          {botInstances && botInstances.length > 0 && (
            <WrapTooltip content="Number of automation bots currently connected and processing submissions.">
              <div className="flex items-center gap-2 cursor-help">
                <Bot className="h-4 w-4 text-green-500" />
                <span className="text-sm text-muted-foreground">{botInstances.length} bot(s) active</span>
              </div>
            </WrapTooltip>
          )}
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {pendingSubmissions.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-800">
                  {pendingSubmissions.length} pending submission{pendingSubmissions.length !== 1 ? "s" : ""}
                </span>
                {checkedCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {checkedCount} selected
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleToggleAll}
                  disabled={batchRunning}
                >
                  <CheckSquare className="h-4 w-4 mr-1" />
                  {allPendingChecked ? "Deselect All" : "Select All Pending"}
                </Button>
                {checkedCount > 0 && (
                  <Button
                    size="sm"
                    onClick={() => handleBatchProcess(Array.from(checkedIds))}
                    disabled={batchRunning}
                  >
                    {batchRunning ? (
                      <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Processing...</>
                    ) : (
                      <><Play className="h-4 w-4 mr-1" />Process Selected ({checkedCount})</>
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleBatchProcess("all")}
                  disabled={batchRunning}
                >
                  {batchRunning ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Processing...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-1" />Process All Pending</>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeBatch && (
        <Card className={`border-2 ${
          activeBatch.status === "running" ? "border-blue-300 bg-blue-50/50" :
          activeBatch.status === "completed" ? "border-green-300 bg-green-50/50" :
          "border-red-300 bg-red-50/50"
        }`}>
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {activeBatch.status === "running" ? (
                  <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                ) : activeBatch.status === "completed" ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                )}
                <div>
                  <p className="text-sm font-semibold">
                    Batch Processing — {activeBatch.status === "running" ? "In Progress" : activeBatch.status === "completed" ? "Complete" : "Failed"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Triggered by {activeBatch.triggeredBy} · {formatDateTime(activeBatch.startedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span>{activeBatch.processed} / {activeBatch.total} processed</span>
                {activeBatch.succeeded > 0 && <Badge className="bg-green-100 text-green-700">{activeBatch.succeeded} succeeded</Badge>}
                {activeBatch.failed > 0 && <Badge variant="destructive">{activeBatch.failed} failed</Badge>}
              </div>
            </div>

            {activeBatch.status === "running" && (
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${activeBatch.total > 0 ? (activeBatch.processed / activeBatch.total) * 100 : 0}%` }}
                />
              </div>
            )}

            {activeBatch.status !== "running" && activeBatch.results.length > 0 && (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {activeBatch.results.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                    r.status === "success" ? "bg-green-50 text-green-700" :
                    r.status === "skipped" ? "bg-gray-50 text-gray-600" :
                    "bg-red-50 text-red-700"
                  }`}>
                    {r.status === "success" ? <CheckCircle className="h-3 w-3" /> :
                     r.status === "skipped" ? <Clock className="h-3 w-3" /> :
                     <AlertTriangle className="h-3 w-3" />}
                    <span>Submission #{r.submissionId}: {r.message}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : (submissions || []).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No portal submissions found.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {(submissions || []).map(sub => (
            <Card key={sub.id} className="hover:bg-accent/30 transition-colors">
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {sub.status === "pending" && (
                    <Checkbox
                      checked={checkedIds.has(sub.id)}
                      onCheckedChange={() => handleToggle(sub.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  <span className="font-mono font-semibold text-sm">{sub.confNumber}</span>
                  <WrapTooltip content={statusDescriptions[sub.status] || sub.status}>
                    <Badge className={`${statusColors[sub.status] || ""} cursor-help`} variant="outline">{sub.status === "dry_run" ? "Dry Run" : sub.status}</Badge>
                  </WrapTooltip>
                  {sub.portalTicketId && (
                    <WrapTooltip content="The ticket ID assigned by the MAS portal after submission.">
                      <Badge variant="outline" className="cursor-help">Ticket: {sub.portalTicketId}</Badge>
                    </WrapTooltip>
                  )}
                  {sub.errorMessage && (
                    <WrapTooltip content={sub.errorMessage}>
                      <AlertTriangle className="h-4 w-4 text-red-500 cursor-help" />
                    </WrapTooltip>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{formatCurrency(sub.claimAmount)}</span>
                  <span className="text-xs text-muted-foreground">
                    {sub.createdAt ? formatDateTime(sub.createdAt) : ""}
                  </span>
                  <WrapTooltip content="View full submission details and bot activity timeline.">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedId(sub.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </WrapTooltip>
                  {sub.status === "failed" && (
                    <WrapTooltip content="Reset to pending and retry.">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRetry(sub.id)}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </WrapTooltip>
                  )}
                  {sub.status === "pending" && (
                    <WrapTooltip content="Cancel this submission.">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleCancel(sub.id)}>
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </WrapTooltip>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selectedId} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submission Details</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm min-w-0">
                <div className="min-w-0"><span className="text-muted-foreground">Conf #:</span> <span className="font-mono break-all">{selected.confNumber}</span></div>
                <div className="min-w-0"><span className="text-muted-foreground">Status:</span> <WrapTooltip content={statusDescriptions[selected.status] || selected.status}><Badge className={`${statusColors[selected.status] || ""} cursor-help`} variant="outline">{selected.status}</Badge></WrapTooltip></div>
                <div className="min-w-0"><span className="text-muted-foreground">Issue Type:</span> {selected.issueType || "-"}</div>
                <div className="min-w-0 truncate"><span className="text-muted-foreground">Subject:</span> {selected.subject || "-"}</div>
                <div className="min-w-0 truncate"><span className="text-muted-foreground">Email:</span> {selected.requesterEmail || "-"}</div>
                <div className="min-w-0 truncate"><span className="text-muted-foreground">Provider:</span> {selected.transportationProviderName || "-"}</div>
                <div className="min-w-0"><span className="text-muted-foreground">Invoice:</span> {selected.invoiceNumber || "-"}</div>
                <div className="min-w-0"><span className="text-muted-foreground">Amount:</span> {formatCurrency(selected.claimAmount)}</div>
                <div className="min-w-0"><span className="text-muted-foreground">Attempts:</span> {selected.attempts}</div>
                {selected.portalTicketId && <div className="min-w-0"><span className="text-muted-foreground">Ticket ID:</span> {selected.portalTicketId}</div>}
                {selected.submittedAt && <div className="min-w-0"><span className="text-muted-foreground">Submitted:</span> {formatDateTime(selected.submittedAt)}</div>}
                {selected.errorMessage && <div className="col-span-2 min-w-0"><span className="text-muted-foreground">Error:</span> <span className="text-red-600 break-words">{selected.errorMessage}</span></div>}
              </div>

              {selected.disputeReason && (
                <div className="min-w-0">
                  <span className="text-sm text-muted-foreground">Dispute Reason:</span>
                  <p className="text-sm mt-1 break-words">{selected.disputeReason}</p>
                </div>
              )}

              {selected.descriptionHtml && (
                <div className="min-w-0">
                  <span className="text-sm text-muted-foreground block mb-1">Dispute Text</span>
                  <div className="bg-muted/50 p-3 rounded-md text-sm whitespace-pre-wrap border break-words">
                    {selected.descriptionHtml}
                  </div>
                </div>
              )}

              <Separator />

              <div>
                <h4 className="font-medium mb-2 flex items-center gap-1.5">
                  Bot Activity
                  <InfoTooltip content="Timeline of actions taken for this submission. Green entries are successful steps, red entries indicate errors." />
                </h4>
                {activityLogs && activityLogs.length > 0 ? (
                  <div className="space-y-2">
                    {activityLogs.map(log => (
                      <div key={log.id} className="text-sm border-l-2 pl-3 py-1" style={{ borderColor: log.success ? 'var(--color-primary)' : 'var(--color-destructive)' }}>
                        <p className="font-medium">{log.action}</p>
                        {log.message && <p className="text-muted-foreground text-xs">{log.message}</p>}
                        <p className="text-muted-foreground/70 text-xs">{formatDateTime(log.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
