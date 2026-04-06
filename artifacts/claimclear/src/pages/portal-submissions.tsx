import { useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { RefreshCw, XCircle, Eye, Bot } from "lucide-react";

const statusColors: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-700 border-amber-300",
  in_progress: "bg-blue-500/20 text-blue-700 border-blue-300",
  submitted: "bg-green-500/20 text-green-700 border-green-300",
  failed: "bg-red-500/20 text-red-700 border-red-300",
  cancelled: "bg-gray-500/20 text-gray-700 border-gray-300",
};

export default function PortalSubmissions() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  const handleRetry = async (id: number) => {
    await retrySubmission.mutateAsync({ id });
    invalidate();
  };

  const handleCancel = async (id: number) => {
    await cancelSubmission.mutateAsync({ id });
    invalidate();
  };

  const selected = selectedId ? (submissions || []).find(s => s.id === selectedId) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Portal Submissions</h2>
          <p className="text-muted-foreground">MAS portal submission queue and status</p>
        </div>
        <div className="flex items-center gap-4">
          {botInstances && botInstances.length > 0 && (
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">{botInstances.length} bot(s) active</span>
            </div>
          )}
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

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
                  <span className="font-mono font-semibold text-sm">{sub.confNumber}</span>
                  <Badge className={statusColors[sub.status] || ""} variant="outline">{sub.status}</Badge>
                  {sub.portalTicketId && <Badge variant="outline">Ticket: {sub.portalTicketId}</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{formatCurrency(sub.claimAmount)}</span>
                  <span className="text-xs text-muted-foreground">Attempt {sub.attempts}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedId(sub.id)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  {sub.status === "failed" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRetry(sub.id)}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}
                  {sub.status === "pending" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleCancel(sub.id)}>
                      <XCircle className="h-4 w-4" />
                    </Button>
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
                <div className="min-w-0"><span className="text-muted-foreground">Status:</span> <Badge className={statusColors[selected.status] || ""} variant="outline">{selected.status}</Badge></div>
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

              <Separator />

              <div>
                <h4 className="font-medium mb-2">Bot Activity</h4>
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
                  <p className="text-sm text-muted-foreground">No bot activity recorded yet.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
