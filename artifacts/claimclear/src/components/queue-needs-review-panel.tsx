import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  useListErrorTypes,
  useTriageInvoiceGroup,
  useCreateErrorType,
  getListInvoiceGroupsQueryKey,
  getListErrorTypesQueryKey,
} from "@workspace/api-client-react";
import type { InvoiceGroupResponse, ErrorTypeResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/format";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Tag,
  Loader2,
  Plus,
} from "lucide-react";

interface QueueNeedsReviewPanelProps {
  group: InvoiceGroupResponse;
  onCompleted: (message: string) => void;
}

export function QueueNeedsReviewPanel({ group, onCompleted }: QueueNeedsReviewPanelProps) {
  const queryClient = useQueryClient();

  const [triageAction, setTriageAction] = useState<"non_issue" | "issue_found" | null>(null);
  const [notes, setNotes] = useState("");
  const [selectedErrorTypeId, setSelectedErrorTypeId] = useState("");
  const [showCreateErrorType, setShowCreateErrorType] = useState(false);
  const [newErrorType, setNewErrorType] = useState({ name: "", category: "", description: "" });

  const { data: errorTypesData } = useListErrorTypes();
  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  const triageGroup = useTriageInvoiceGroup();
  const createErrorType = useCreateErrorType();

  useEffect(() => {
    setTriageAction(null);
    setNotes("");
    setSelectedErrorTypeId("");
    setShowCreateErrorType(false);
    setNewErrorType({ name: "", category: "", description: "" });
  }, [group.id]);

  const handleNonIssue = async () => {
    await triageGroup.mutateAsync({
      id: group.id,
      data: { triageOutcome: "non_issue", notes: notes || undefined },
    });
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    onCompleted(`Invoice group marked as non-issue — all rides resolved with $0 impact`);
  };

  const handleIssueFound = async () => {
    if (!selectedErrorTypeId) return;
    const et = errorTypes.find(t => String(t.id) === selectedErrorTypeId);
    if (!et) return;
    await triageGroup.mutateAsync({
      id: group.id,
      data: {
        triageOutcome: "issue_found",
        errorTypeId: String(et.id),
        errorTypeName: et.name,
        notes: notes || undefined,
      },
    });
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    onCompleted(`Issue identified — invoice group moved to workflow with error type "${et.name}"`);
  };

  const handleCreateAndSelect = async () => {
    if (!newErrorType.name.trim()) return;
    const created = await createErrorType.mutateAsync({ data: newErrorType });
    queryClient.invalidateQueries({ queryKey: getListErrorTypesQueryKey() });
    setSelectedErrorTypeId(String(created.id));
    setShowCreateErrorType(false);
    setNewErrorType({ name: "", category: "", description: "" });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Review Invoice Group</CardTitle>
          <Link href={`/invoice-groups/${group.id}`}>
            <Button variant="ghost" size="sm">
              Full Details <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <Label className="text-xs text-muted-foreground">Invoice #</Label>
            <p className="font-mono font-semibold">{group.invoiceNumber}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Client #</Label>
            <p>{group.clientNumber || "-"}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Ride Count</Label>
            <p className="font-semibold">{group.rideCount}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Total Amount</Label>
            <p className="font-semibold">{formatCurrency(group.totalAmount)}</p>
          </div>
          {group.errorTypeName && (
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">Error Type</Label>
              <p>{group.errorTypeName}</p>
            </div>
          )}
        </div>

        {group.errorDetails ? (
          <div className="bg-muted/50 rounded-md p-3">
            <Label className="text-xs text-muted-foreground">Error Details</Label>
            <p className="text-sm mt-1">{group.errorDetails}</p>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              No error details on file
            </div>
            <p className="text-xs text-amber-600 mt-1">
              Check the portal for this invoice group and determine if there is an actual issue or if this is a non-issue.
            </p>
          </div>
        )}

        <Separator />

        <div>
          <Label className="text-sm font-medium">Review Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe what you found on the portal..."
            rows={3}
            className="mt-1"
          />
        </div>

        {!triageAction && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">What did you find?</Label>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center gap-2 border-green-200 hover:bg-green-50 hover:border-green-300"
                onClick={() => setTriageAction("non_issue")}
              >
                <XCircle className="h-6 w-6 text-green-600" />
                <span className="font-medium text-green-700">Non-Issue</span>
                <span className="text-[11px] text-muted-foreground text-center leading-tight">
                  No action needed. Resolve group and all rides.
                </span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col items-center gap-2 border-red-200 hover:bg-red-50 hover:border-red-300"
                onClick={() => setTriageAction("issue_found")}
              >
                <AlertTriangle className="h-6 w-6 text-red-600" />
                <span className="font-medium text-red-700">Issue Found</span>
                <span className="text-[11px] text-muted-foreground text-center leading-tight">
                  Define the error type and process.
                </span>
              </Button>
            </div>
          </div>
        )}

        {triageAction === "non_issue" && (
          <div className="space-y-3 p-3 bg-green-50 border border-green-200 rounded-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-800 font-medium text-sm">
                <XCircle className="h-4 w-4" />
                Mark as Non-Issue
              </div>
              <Button variant="ghost" size="sm" onClick={() => setTriageAction(null)} className="h-6 px-2 text-xs">
                Back
              </Button>
            </div>
            <p className="text-xs text-green-700">
              This will resolve the invoice group and all {group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}, setting financial impact to $0.
            </p>
            <Button
              onClick={handleNonIssue}
              disabled={triageGroup.isPending}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {triageGroup.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 mr-2" />Confirm Non-Issue</>
              )}
            </Button>
          </div>
        )}

        {triageAction === "issue_found" && (
          <div className="space-y-3 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-800 font-medium text-sm">
                <AlertTriangle className="h-4 w-4" />
                Define the Issue
              </div>
              <Button variant="ghost" size="sm" onClick={() => setTriageAction(null)} className="h-6 px-2 text-xs">
                Back
              </Button>
            </div>

            {!showCreateErrorType ? (
              <>
                <div>
                  <Label className="text-xs text-red-700">Select Error Type</Label>
                  <Select value={selectedErrorTypeId} onValueChange={setSelectedErrorTypeId}>
                    <SelectTrigger className="mt-1 bg-white">
                      <SelectValue placeholder="Choose error type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {errorTypes.map((et) => (
                        <SelectItem key={et.id} value={String(et.id)}>
                          <div>
                            <span>{et.name}</span>
                            {et.category && <span className="text-muted-foreground ml-2 text-xs">({et.category})</span>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setShowCreateErrorType(true)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Create New Error Type
                </Button>

                <Button
                  onClick={handleIssueFound}
                  disabled={!selectedErrorTypeId || triageGroup.isPending}
                  className="w-full bg-red-600 hover:bg-red-700"
                >
                  {triageGroup.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                  ) : (
                    <><Tag className="h-4 w-4 mr-2" />Assign & Move to Workflow</>
                  )}
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
                  <Input
                    value={newErrorType.name}
                    onChange={e => setNewErrorType({ ...newErrorType, name: e.target.value })}
                    placeholder="e.g. Duplicate Charge"
                    className="mt-1 bg-white"
                  />
                </div>
                <div>
                  <Label className="text-xs">Category</Label>
                  <Input
                    value={newErrorType.category}
                    onChange={e => setNewErrorType({ ...newErrorType, category: e.target.value })}
                    placeholder="e.g. Billing"
                    className="mt-1 bg-white"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleCreateAndSelect}
                    disabled={!newErrorType.name.trim() || createErrorType.isPending}
                    className="flex-1"
                    size="sm"
                  >
                    {createErrorType.isPending ? "Creating..." : "Create & Select"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowCreateErrorType(false)}>
                    Back
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
