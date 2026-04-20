import { useParams, Link } from "wouter";
import { useGetInvoiceGroup, useUpdateInvoiceGroupStatus, useUpdateInvoiceGroupOutcome, useTriageInvoiceGroup, useHoldInvoiceGroup, useRemoveInvoiceGroupHold, getGetInvoiceGroupQueryKey, useListInvoiceGroupEvidence, getListInvoiceGroupEvidenceQueryKey, useDeleteInvoiceGroupEvidence } from "@workspace/api-client-react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  FileText,
  DollarSign,
  Hash,
  User,
  Calendar,
  Car,
  Trash2,
  StickyNote,
  Mail,
  Filter,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  humanizeAuditAction,
  ACTION_CATEGORY_LABELS,
  type ActionCategory,
} from "@/lib/audit-action-meta";

export default function InvoiceGroupDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();

  const { data: group, isLoading, error } = useGetInvoiceGroup(id, {
    query: { enabled: id > 0, queryKey: getGetInvoiceGroupQueryKey(id) },
  });

  const { data: collectedEvidence } = useListInvoiceGroupEvidence(id, {
    query: { enabled: id > 0, queryKey: getListInvoiceGroupEvidenceQueryKey(id) },
  });

  const updateStatus = useUpdateInvoiceGroupStatus();
  const updateOutcome = useUpdateInvoiceGroupOutcome();
  const triageGroup = useTriageInvoiceGroup();
  const holdGroup = useHoldInvoiceGroup();
  const removeHold = useRemoveInvoiceGroupHold();
  const deleteEvidence = useDeleteInvoiceGroupEvidence();

  const [holdReason, setHoldReason] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActionCategory | "all">("all");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(id) });
  };

  const handleDeleteEvidence = async (evidenceId: number) => {
    await deleteEvidence.mutateAsync({ id, evidenceId });
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupEvidenceQueryKey(id) });
    invalidate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/invoice-groups"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Link>
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            Invoice group not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const rides: ClaimResponse[] = (group as any).rides ?? [];
  const auditLogs: any[] = (group as any).auditLogs ?? [];
  const notes: any[] = (group as any).notes ?? [];

  const handleTriage = async (outcome: "non_issue" | "issue_found") => {
    await triageGroup.mutateAsync({
      id,
      data: { triageOutcome: outcome },
    });
    invalidate();
  };

  const handleHold = async () => {
    await holdGroup.mutateAsync({
      id,
      data: { reason: holdReason },
    });
    setHoldReason("");
    invalidate();
  };

  const handleRemoveHold = async () => {
    await removeHold.mutateAsync({ id });
    invalidate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/invoice-groups"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight font-mono">Invoice #{group.invoiceNumber}</h1>
            <StatusBadge status={group.status} />
            {group.outcome !== "Pending" && (
              <Badge variant={group.outcome === "Approved" ? "default" : group.outcome === "Denied" ? "destructive" : "secondary"}>
                {group.outcome}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {group.rideCount} ride{group.rideCount !== 1 ? "s" : ""} &middot; {formatCurrency(group.totalAmount)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Group Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Invoice Number</Label>
                  <p className="font-mono font-medium">{group.invoiceNumber}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Client Number</Label>
                  <p>{group.clientNumber || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Total Amount</Label>
                  <p className="font-medium">{formatCurrency(group.totalAmount)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Error Type</Label>
                  <p>{group.errorTypeName || <span className="text-muted-foreground italic">Unassigned</span>}</p>
                </div>
              </div>
              {group.errorDetails && (
                <div>
                  <Label className="text-xs text-muted-foreground">Error Details</Label>
                  <p className="text-sm mt-1 bg-muted/50 rounded px-3 py-2">{group.errorDetails}</p>
                </div>
              )}
              {group.holdReason && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md px-4 py-3">
                  <p className="text-sm font-medium text-yellow-800">On Hold</p>
                  <p className="text-sm text-yellow-700">{group.holdReason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Evidence</CardTitle>
              <CardDescription>Evidence items collected for this invoice group during workflow execution.</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const evidenceItems = Array.isArray(collectedEvidence?.evidence) ? collectedEvidence.evidence : [];
                if (evidenceItems.length === 0) {
                  return (
                    <p className="text-sm text-muted-foreground">No group evidence collected yet.</p>
                  );
                }
                return (
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground">Collected Evidence ({evidenceItems.length} items)</Label>
                    <div className="grid gap-3">
                      {evidenceItems.map((ev) => (
                        <div key={ev.id} className="border rounded-lg p-3 space-y-2 bg-muted/30">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm font-medium">{ev.evidenceTypeName}</p>
                              {ev.treeNodeId && (
                                <p className="text-[10px] text-muted-foreground">
                                  Tree node: {ev.treeNodeId}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground">
                                {ev.collectedBy && `by ${ev.collectedBy} · `}
                                {formatDateTime(ev.collectedAt)}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive"
                                onClick={() => handleDeleteEvidence(ev.id)}
                                disabled={deleteEvidence.isPending}
                                title="Delete evidence"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          {ev.imageUrl && (
                            <a
                              href={ev.imageUrl.startsWith("/objects/") ? `/api/storage${ev.imageUrl}` : ev.imageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <img
                                src={ev.imageUrl.startsWith("/objects/") ? `/api/storage${ev.imageUrl}` : ev.imageUrl}
                                alt={ev.evidenceTypeName}
                                className="rounded border max-h-40 w-auto hover:opacity-90 transition-opacity"
                              />
                            </a>
                          )}
                          {ev.notes && (
                            <p className="text-xs bg-white dark:bg-background rounded p-2 border">{ev.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Rides ({rides.length})</CardTitle>
              <CardDescription>Individual rides in this invoice group.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b">
                    <tr>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> Conf #</span>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Ref #</span>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Date</span>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><User className="h-3 w-3" /> Client</span>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><Car className="h-3 w-3" /> Car #</span>
                      </th>
                      <th className="px-4 py-3 font-medium">Error Details</th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> Amount</span>
                      </th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rides.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                          No rides in this group.
                        </td>
                      </tr>
                    ) : (
                      rides.map((ride) => (
                        <tr key={ride.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-mono font-medium text-primary">
                            <Link href={`/claims/${ride.id}`}>{ride.confNumber}</Link>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{ride.refNumber || '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{formatDate(ride.date)}</td>
                          <td className="px-4 py-3">{ride.clientNumber || '-'}</td>
                          <td className="px-4 py-3">{ride.carNumber || '-'}</td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <span className="text-xs text-muted-foreground line-clamp-2">{ride.errorDetails || '-'}</span>
                          </td>
                          <td className="px-4 py-3 font-medium whitespace-nowrap">{formatCurrency(ride.claimAmount)}</td>
                          <td className="px-4 py-3"><StatusBadge status={ride.status} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {group.status === "Needs Review" && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardHeader>
                <CardTitle className="text-sm">Triage Required</CardTitle>
                <CardDescription className="text-xs">This group has no error details — review on the portal and classify.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => handleTriage("non_issue")}
                  disabled={triageGroup.isPending}
                >
                  Non-Issue (Resolve)
                </Button>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => handleTriage("issue_found")}
                  disabled={triageGroup.isPending}
                >
                  Issue Found
                </Button>
              </CardContent>
            </Card>
          )}

          {group.status === "On Hold" && (
            <Card className="border-yellow-200 bg-yellow-50/50">
              <CardHeader>
                <CardTitle className="text-sm">On Hold</CardTitle>
                <CardDescription className="text-xs">{group.holdReason || "No reason provided"}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleRemoveHold}
                  disabled={removeHold.isPending}
                >
                  Remove Hold
                </Button>
              </CardContent>
            </Card>
          )}

          {group.status !== "On Hold" && group.status !== "Resolved" && group.status !== "Denied" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Place on Hold</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  placeholder="Reason for hold..."
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  rows={2}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={handleHold}
                  disabled={holdGroup.isPending || !holdReason.trim()}
                >
                  Place on Hold
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Activity</CardTitle>
              <Select value={activityFilter} onValueChange={(v) => setActivityFilter(v as ActionCategory | "all")}>
                <SelectTrigger className="h-7 w-[170px] text-xs" data-testid="select-activity-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACTION_CATEGORY_LABELS) as Array<ActionCategory | "all">).map((key) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {ACTION_CATEGORY_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {(() => {
                type FeedItem =
                  | { kind: "audit"; id: number; timestamp: string; log: any; category: ActionCategory }
                  | { kind: "note"; id: number; timestamp: string; note: any };

                const feed: FeedItem[] = [
                  ...auditLogs.map((log: any) => {
                    const meta = humanizeAuditAction(log.action, "group");
                    return {
                      kind: "audit" as const,
                      id: log.id,
                      timestamp: log.timestamp,
                      log,
                      category: meta.category,
                    };
                  }),
                  ...notes.map((note: any) => ({
                    kind: "note" as const,
                    id: note.id,
                    timestamp: note.createdAt,
                    note,
                  })),
                ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                const filtered = activityFilter === "all"
                  ? feed
                  : feed.filter((item) =>
                      item.kind === "audit"
                        ? item.category === activityFilter
                        : activityFilter === "communication",
                    );

                if (filtered.length === 0) {
                  return activityFilter === "all" ? (
                    <EmptyState
                      icon={StickyNote}
                      title="No activity yet"
                      description="Status changes, notes, and edits on this group will appear here."
                      className="py-6"
                    />
                  ) : (
                    <EmptyState
                      icon={Filter}
                      title="No matching activity"
                      description="Try a different category to see more activity."
                      primaryAction={{ label: "Clear filter", onClick: () => setActivityFilter("all") }}
                      className="py-6"
                    />
                  );
                }

                return (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto" data-testid="list-activity-feed">
                    {filtered.map((item) => {
                      if (item.kind === "audit") {
                        const meta = humanizeAuditAction(item.log.action, "group");
                        const Icon = meta.icon;
                        return (
                          <div key={`audit-${item.id}`} className="flex gap-2 border-l-2 border-muted pl-3 py-1">
                            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.iconClass}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{meta.label}</p>
                              {item.log.details && (
                                <p className="text-xs text-muted-foreground break-words">{item.log.details}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground/60">
                                <span>{item.log.userName || item.log.userEmail || "System"} · </span>
                                {new Date(item.timestamp).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        );
                      }
                      const isEmail = item.note.type === "email";
                      const Icon = isEmail ? Mail : StickyNote;
                      return (
                        <div key={`note-${item.id}`} className="flex gap-2 border-l-2 border-muted pl-3 py-1">
                          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${isEmail ? "text-blue-600" : "text-amber-600"}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium">
                              {isEmail ? "Email note" : "Note added"}
                              {item.note.emailSubject && (
                                <span className="text-muted-foreground font-normal"> · {item.note.emailSubject}</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{item.note.content}</p>
                            <p className="text-[10px] text-muted-foreground/60">
                              {item.note.author && <span>{item.note.author} · </span>}
                              {new Date(item.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
