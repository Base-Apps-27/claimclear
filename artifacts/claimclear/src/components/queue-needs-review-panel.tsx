import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  useListErrorTypes,
  useTriageInvoiceGroup,
  useUpdateInvoiceGroupStatus,
  useCreateErrorType,
  getListInvoiceGroupsQueryKey,
  getListErrorTypesQueryKey,
} from "@workspace/api-client-react";
import type { InvoiceGroupResponse, ErrorTypeResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/format";
import {
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

  const [notes, setNotes] = useState("");
  const [selectedErrorTypeId, setSelectedErrorTypeId] = useState("");
  const [showCreateErrorType, setShowCreateErrorType] = useState(false);
  const [newErrorType, setNewErrorType] = useState({ name: "", category: "", description: "" });

  const { data: errorTypesData } = useListErrorTypes();
  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  const triageGroup = useTriageInvoiceGroup();
  const updateGroupStatus = useUpdateInvoiceGroupStatus();
  const createErrorType = useCreateErrorType();
  const { toast } = useToast();

  useEffect(() => {
    setNotes("");
    setSelectedErrorTypeId("");
    setShowCreateErrorType(false);
    setNewErrorType({ name: "", category: "", description: "" });
  }, [group.id]);

  const handleAssignErrorType = async () => {
    if (!selectedErrorTypeId) return;
    const et = errorTypes.find(t => String(t.id) === selectedErrorTypeId);
    if (!et) return;
    const triaged = await triageGroup.mutateAsync({
      id: group.id,
      data: {
        triageOutcome: "issue_found",
        errorTypeId: String(et.id),
        errorTypeName: et.name,
        notes: notes || undefined,
      },
    });

    // The /triage endpoint sets status to "New" for issue_found; the closure
    // foundation auto-advance only fires on PATCH. Force the move to
    // "Needs Evidence" so the group lands in Build Case immediately.
    if (triaged?.status === "Needs Review" || triaged?.status === "New") {
      try {
        await updateGroupStatus.mutateAsync({
          id: group.id,
          data: { status: "Needs Evidence" },
        });
      } catch {
        toast({
          title: "Couldn't move to Build Case",
          description: "Error type was saved, but the status update failed. Please refresh.",
          variant: "destructive",
        });
      }
    }

    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    onCompleted(`Classified as "${et.name}" — moved to Build Case`);
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
          <div className="space-y-1">
            <CardTitle className="text-lg">Classify this claim</CardTitle>
            <p className="text-xs text-muted-foreground">
              Pick the Error Type that matches the rejection reason. The claim moves to Build Case automatically.
            </p>
          </div>
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
              Check the portal for this invoice group to confirm the rejection reason before assigning an Error Type.
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

        <div className="space-y-3">
          {!showCreateErrorType ? (
            <>
              <div>
                <Label className="text-sm font-medium">Error Type</Label>
                <Select value={selectedErrorTypeId} onValueChange={setSelectedErrorTypeId}>
                  <SelectTrigger className="mt-1 bg-white" data-testid="select-needs-review-error-type">
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
                onClick={handleAssignErrorType}
                disabled={!selectedErrorTypeId || triageGroup.isPending}
                className="w-full"
                data-testid="button-needs-review-assign-error-type"
              >
                {triageGroup.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                ) : (
                  <><Tag className="h-4 w-4 mr-2" />Assign Error Type</>
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
      </CardContent>
    </Card>
  );
}
