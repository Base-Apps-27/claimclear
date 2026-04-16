import { useParams, Link } from "wouter";
import { useGetInvoiceGroup, useUpdateInvoiceGroupStatus, useUpdateInvoiceGroupOutcome, useTriageInvoiceGroup, useHoldInvoiceGroup, useRemoveInvoiceGroupHold, getGetInvoiceGroupQueryKey } from "@workspace/api-client-react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";
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
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function InvoiceGroupDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();

  const { data: group, isLoading, error } = useGetInvoiceGroup(id, {
    query: { enabled: id > 0, queryKey: getGetInvoiceGroupQueryKey(id) },
  });

  const updateStatus = useUpdateInvoiceGroupStatus();
  const updateOutcome = useUpdateInvoiceGroupOutcome();
  const triageGroup = useTriageInvoiceGroup();
  const holdGroup = useHoldInvoiceGroup();
  const removeHold = useRemoveInvoiceGroupHold();

  const [holdReason, setHoldReason] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(id) });
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
            <CardHeader>
              <CardTitle className="text-sm">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {auditLogs.length === 0 && notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {auditLogs.map((log: any) => (
                    <div key={`audit-${log.id}`} className="border-l-2 border-muted pl-3 py-1">
                      <p className="text-xs font-medium">{log.action}</p>
                      <p className="text-xs text-muted-foreground">{log.details}</p>
                      <p className="text-[10px] text-muted-foreground/60">{new Date(log.timestamp).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
