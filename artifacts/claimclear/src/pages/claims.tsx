import { useState } from "react";
import { useListClaims, useListErrorTypes, useBulkAssignErrorType, getListClaimsQueryKey } from "@workspace/api-client-react";
import type { ClaimResponse, ErrorTypeResponse, ListClaimsStatus, ListClaimsOutcome } from "@workspace/api-client-react";
import { useClaimsListEvents } from "@/hooks/use-claim-events";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { Link } from "wouter";
import { Search, Filter, Tag, X, Loader2, CheckCircle2, Inbox } from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import { EmptyState } from "@/components/empty-state";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";

const STATUSES = [
  "New", "Needs Review", "Needs Evidence", "Portal Queued", "Generating Email",
  "Ready to Review", "Awaiting Response", "On Hold", "Resolved", "Denied",
] as const;

const OUTCOMES = ["Pending", "Approved", "Denied", "Partially Approved", "Non-Issue"] as const;

export default function ClaimsList() {
  useClaimsListEvents();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkErrorTypeId, setBulkErrorTypeId] = useState("");
  const [bulkAssignSuccess, setBulkAssignSuccess] = useState("");

  const [filterStatus, setFilterStatus] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("");
  const [filterErrorTypeId, setFilterErrorTypeId] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const activeFilterCount = [filterStatus, filterOutcome, filterErrorTypeId].filter(Boolean).length;

  const listParams = {
    search: search || undefined,
    status: (filterStatus || undefined) as ListClaimsStatus | undefined,
    outcome: (filterOutcome || undefined) as ListClaimsOutcome | undefined,
    limit: 50,
  };
  const { data, isLoading } = useListClaims(listParams, {
    query: { queryKey: getListClaimsQueryKey(listParams) },
  });

  const { data: errorTypesData } = useListErrorTypes();
  const bulkAssign = useBulkAssignErrorType();

  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  let claims: ClaimResponse[] = data?.claims ?? [];

  if (filterErrorTypeId === "__unassigned__") {
    claims = claims.filter(c => !c.errorTypeId);
  } else if (filterErrorTypeId) {
    claims = claims.filter(c => c.errorTypeId === filterErrorTypeId);
  }

  const allSelected = claims.length > 0 && claims.every((c) => selectedIds.has(c.id));
  const someSelected = selectedIds.size > 0;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(claims.map((c) => c.id)));
    }
  };

  const handleToggle = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkAssign = async () => {
    if (!bulkErrorTypeId || selectedIds.size === 0) return;

    const et = errorTypes.find((t) => String(t.id) === bulkErrorTypeId);
    if (!et) return;

    try {
      const res = await bulkAssign.mutateAsync({
        data: {
          claimIds: Array.from(selectedIds),
          errorTypeId: Number(bulkErrorTypeId),
        }
      });
      setBulkAssignSuccess(`Updated ${res.updated} claim${res.updated !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setShowBulkAssign(false);
      setBulkErrorTypeId("");
      queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
      setTimeout(() => setBulkAssignSuccess(""), 3000);
    } catch {
    }
  };

  const clearFilters = () => {
    setFilterStatus("");
    setFilterOutcome("");
    setFilterErrorTypeId("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">All Claims</h1>
          <p className="text-muted-foreground mt-1">Search and filter through the entire claims database.</p>
        </div>
        <Button asChild>
          <Link href="/claims/new">Create Claim</Link>
        </Button>
      </div>

      {bulkAssignSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-800">{bulkAssignSuccess}</span>
        </div>
      )}

      {someSelected && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{selectedIds.size} claim{selectedIds.size !== 1 ? "s" : ""} selected</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {showBulkAssign ? (
                <>
                  <Select value={bulkErrorTypeId} onValueChange={setBulkErrorTypeId}>
                    <SelectTrigger className="w-[200px] h-8 text-sm">
                      <SelectValue placeholder="Select error type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {errorTypes.map((et) => (
                        <SelectItem key={et.id} value={String(et.id)}>{et.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleBulkAssign}
                    disabled={!bulkErrorTypeId || bulkAssign.isPending}
                  >
                    {bulkAssign.isPending ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Assigning...</>
                    ) : (
                      "Apply"
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowBulkAssign(false); setBulkErrorTypeId(""); }}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setShowBulkAssign(true)}>
                  <Tag className="h-3 w-3 mr-1" /> Assign Error Type
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="p-4 border-b flex flex-row items-center justify-between space-y-0">
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by Conf #, Client, Error..." 
              className="pl-9 pr-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-muted-foreground gap-1">
                <X className="h-3 w-3" /> Clear filters
              </Button>
            )}
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={activeFilterCount > 0 ? "border-primary text-primary" : ""}>
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                  {activeFilterCount > 0 && (
                    <span className="ml-1.5 bg-primary text-primary-foreground rounded-full text-[10px] font-bold h-4 w-4 inline-flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-4 space-y-4" align="end">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Status</Label>
                  <Select value={filterStatus || "__all__"} onValueChange={v => setFilterStatus(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All statuses</SelectItem>
                      {STATUSES.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Error Type</Label>
                  <Select value={filterErrorTypeId || "__all__"} onValueChange={v => setFilterErrorTypeId(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="All error types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All error types</SelectItem>
                      <SelectItem value="__unassigned__">Unassigned</SelectItem>
                      {errorTypes.map(et => (
                        <SelectItem key={et.id} value={String(et.id)}>{et.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Outcome</Label>
                  <Select value={filterOutcome || "__all__"} onValueChange={v => setFilterOutcome(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="All outcomes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All outcomes</SelectItem>
                      {OUTCOMES.map(o => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs">
                    Clear all
                  </Button>
                  <Button size="sm" onClick={() => setFilterOpen(false)} className="text-xs">
                    Done
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Conf #
                      <InfoTooltip content="The unique trip confirmation number from MAS. Click a number to view the full claim details." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Service Date
                      <InfoTooltip content="The date the transportation service was performed. Claims must be disputed within the filing deadline from this date." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Client
                      <InfoTooltip content="The client/member number associated with the trip passenger." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Error Description
                      <InfoTooltip content="The raw error/denial reason from the MAS report. Use this to identify the issue and assign the correct error type." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Error Type
                      <InfoTooltip content="The classification of the denial or error. Each error type has its own SOP, evidence requirements, and decision tree." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Amount
                      <InfoTooltip content="The dollar amount being disputed for this claim." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Status
                      <InfoTooltip content="Current stage of the claim in the dispute workflow. Hover over any status badge to see what it means." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium text-right">
                    <span className="flex items-center gap-1 justify-end">
                      Action
                      <InfoTooltip content="Click View to open the full claim detail page with evidence, notes, and submission history." side="bottom" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading claims...</td>
                  </tr>
                ) : claims.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-0">
                      {(search || activeFilterCount > 0) ? (
                        <EmptyState
                          icon={Filter}
                          title="No claims match your filters"
                          description="Try removing a filter or adjusting your search to see more results."
                          primaryAction={{
                            label: "Clear filters",
                            onClick: () => { clearFilters(); setSearch(""); },
                          }}
                        />
                      ) : (
                        <EmptyState
                          icon={Inbox}
                          title="No claims yet"
                          description="Import a MAS report to bring in claims, or create one manually."
                          primaryAction={{ label: "Import claims", href: "/import" }}
                          secondaryAction={{ label: "Create a claim", href: "/claims/new" }}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  claims.map((claim) => (
                    <tr key={claim.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${selectedIds.has(claim.id) ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selectedIds.has(claim.id)}
                          onCheckedChange={() => handleToggle(claim.id)}
                          aria-label={`Select claim ${claim.confNumber}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-primary">
                        <Link href={`/claims/${claim.id}`}>{claim.confNumber}</Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(claim.date)}</td>
                      <td className="px-4 py-3">{claim.clientNumber || '-'}</td>
                      <td className="px-4 py-3 max-w-[250px]">
                        <span className="text-xs text-muted-foreground line-clamp-2" title={claim.errorDetails || ''}>
                          {claim.errorDetails || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[160px] truncate" title={claim.errorTypeName || ''}>
                        {claim.errorTypeName || <span className="text-muted-foreground italic">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{formatCurrency(claim.claimAmount)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={claim.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/claims/${claim.id}`}>View</Link>
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
