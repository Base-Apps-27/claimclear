import { useState } from "react";
import { useListClaims, getListClaimsQueryKey, useListErrorTypes, useTriageClaim } from "@workspace/api-client-react";
import type { ClaimResponse, ErrorTypeResponse } from "@workspace/api-client-react";
import { useClaimsListEvents } from "@/hooks/use-claim-events";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDate } from "@/lib/format";
import { Link } from "wouter";
import { Search, CheckCircle2, XCircle, AlertTriangle, ChevronRight, Eye, Tag, Loader2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { useCreateErrorType, getListErrorTypesQueryKey } from "@workspace/api-client-react";

export default function Review() {
  useClaimsListEvents();
  const queryClient = useQueryClient();

  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const [triageAction, setTriageAction] = useState<"non_issue" | "issue_found" | null>(null);
  const [notes, setNotes] = useState("");
  const [selectedErrorTypeId, setSelectedErrorTypeId] = useState("");
  const [showCreateErrorType, setShowCreateErrorType] = useState(false);
  const [newErrorType, setNewErrorType] = useState({ name: "", category: "", description: "" });
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const { data, isLoading } = useListClaims(
    { status: "Needs Review", limit: 100 },
    { query: { queryKey: getListClaimsQueryKey({ status: "Needs Review", limit: 100 }) } }
  );
  const { data: errorTypesData } = useListErrorTypes();
  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  const triageClaim = useTriageClaim();
  const createErrorType = useCreateErrorType();

  const claims: ClaimResponse[] = data?.claims ?? [];
  const filteredClaims = search
    ? claims.filter(c =>
        c.confNumber.toLowerCase().includes(search.toLowerCase()) ||
        (c.clientNumber || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.carNumber || "").toLowerCase().includes(search.toLowerCase())
      )
    : claims;

  const selectedClaim = selectedClaimId ? claims.find(c => c.id === selectedClaimId) || null : null;

  const resetForm = () => {
    setTriageAction(null);
    setNotes("");
    setSelectedErrorTypeId("");
    setShowCreateErrorType(false);
    setNewErrorType({ name: "", category: "", description: "" });
  };

  const handleSelectClaim = (claim: ClaimResponse) => {
    setSelectedClaimId(claim.id);
    resetForm();
  };

  const handleNonIssue = async () => {
    if (!selectedClaimId) return;
    await triageClaim.mutateAsync({
      id: selectedClaimId,
      data: { action: "non_issue", triageNotes: notes || undefined },
    });
    setSuccessMessage(`Claim marked as non-issue — financial impact set to $0`);
    setSelectedClaimId(null);
    resetForm();
    queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
    setTimeout(() => setSuccessMessage(""), 4000);
  };

  const handleIssueFound = async () => {
    if (!selectedClaimId || !selectedErrorTypeId) return;
    const et = errorTypes.find(t => String(t.id) === selectedErrorTypeId);
    if (!et) return;
    await triageClaim.mutateAsync({
      id: selectedClaimId,
      data: {
        action: "issue_found",
        errorTypeId: String(et.id),
        errorTypeName: et.name,
        triageNotes: notes || undefined,
      },
    });
    setSuccessMessage(`Issue identified — claim moved to normal workflow with error type "${et.name}"`);
    setSelectedClaimId(null);
    resetForm();
    queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
    setTimeout(() => setSuccessMessage(""), 4000);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Review Queue</h1>
        <p className="text-muted-foreground mt-1">
          Claims imported with no details — review each one on the portal and classify it.
        </p>
      </div>

      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-800">{successMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Badge variant="secondary" className="text-sm">
              {claims.length} claim{claims.length !== 1 ? "s" : ""} pending review
            </Badge>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Conf #, Client, Car #..."
              className="pl-9 pr-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {isLoading ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">Loading...</CardContent>
            </Card>
          ) : filteredClaims.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {claims.length === 0
                  ? "No claims need review right now."
                  : "No matching claims found."}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredClaims.map((claim) => (
                <Card
                  key={claim.id}
                  className={`cursor-pointer transition-colors ${
                    selectedClaimId === claim.id ? "ring-2 ring-primary" : "hover:bg-accent/50"
                  }`}
                  onClick={() => handleSelectClaim(claim)}
                >
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div>
                          <span className="font-mono font-semibold">{claim.confNumber}</span>
                          <span className="text-muted-foreground ml-3 text-sm">{formatDate(claim.date)}</span>
                        </div>
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                          No Details
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        {claim.clientNumber && (
                          <span className="text-muted-foreground">Client: {claim.clientNumber}</span>
                        )}
                        <span className="font-medium">{formatCurrency(claim.claimAmount)}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          {selectedClaim ? (
            <div className="sticky top-4 space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Review Claim</CardTitle>
                    <Link href={`/claims/${selectedClaim.id}`}>
                      <Button variant="ghost" size="sm">
                        Full Details <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">Conf #</Label>
                      <p className="font-mono font-semibold">{selectedClaim.confNumber}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Service Date</Label>
                      <p>{formatDate(selectedClaim.date) || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Client #</Label>
                      <p>{selectedClaim.clientNumber || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Car #</Label>
                      <p>{selectedClaim.carNumber || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Amount</Label>
                      <p className="font-semibold">{formatCurrency(selectedClaim.claimAmount)}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Ref #</Label>
                      <p className="font-mono text-xs">{selectedClaim.refNumber || "-"}</p>
                    </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                    <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      No error details on file
                    </div>
                    <p className="text-xs text-amber-600 mt-1">
                      Check the portal for this claim and determine if there is an actual issue or if this is a non-issue.
                    </p>
                  </div>

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
                            No action needed. Resolve and zero out.
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
                        This will resolve the claim and set the financial impact to $0.
                      </p>
                      <Button
                        onClick={handleNonIssue}
                        disabled={triageClaim.isPending}
                        className="w-full bg-green-600 hover:bg-green-700"
                      >
                        {triageClaim.isPending ? (
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
                            disabled={!selectedErrorTypeId || triageClaim.isPending}
                            className="w-full bg-red-600 hover:bg-red-700"
                          >
                            {triageClaim.isPending ? (
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
            </div>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Select a claim to review</p>
                <p className="text-sm mt-1">
                  Click on a claim from the list to check it on the portal and classify it
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
