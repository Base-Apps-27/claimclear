import { useState } from "react";
import { useListInvoiceGroups, useListErrorTypes, useBulkAssignInvoiceGroupErrorType, getListInvoiceGroupsQueryKey } from "@workspace/api-client-react";
import type { InvoiceGroupResponse, ErrorTypeResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/format";
import { Link } from "wouter";
import { Search, Filter, Tag, X, Loader2, CheckCircle2, FolderOpen } from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const STATUSES = [
  "New", "Needs Review", "Needs Evidence", "Portal Queued", "Generating Email",
  "Ready to Review", "Awaiting Response", "On Hold", "Resolved", "Denied",
] as const;

const OUTCOMES = ["Pending", "Approved", "Denied", "Partially Approved", "Non-Issue"] as const;

export default function InvoiceGroupsList() {
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

  const { data, isLoading } = useListInvoiceGroups({
    search: search || undefined,
    status: filterStatus || undefined,
    outcome: filterOutcome || undefined,
    limit: 50,
  }, {
    query: {
      queryKey: getListInvoiceGroupsQueryKey({
        search: search || undefined,
        status: filterStatus || undefined,
        outcome: filterOutcome || undefined,
        limit: 50,
      })
    }
  });

  const { data: errorTypesData } = useListErrorTypes();
  const bulkAssign = useBulkAssignInvoiceGroupErrorType();

  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  let groups: InvoiceGroupResponse[] = data?.groups ?? [];

  if (filterErrorTypeId === "__unassigned__") {
    groups = groups.filter(g => !g.errorTypeId);
  } else if (filterErrorTypeId) {
    groups = groups.filter(g => g.errorTypeId === filterErrorTypeId);
  }

  const allSelected = groups.length > 0 && groups.every((g) => selectedIds.has(g.id));
  const someSelected = selectedIds.size > 0;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(groups.map((g) => g.id)));
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
          groupIds: Array.from(selectedIds),
          errorTypeId: String(et.id),
          errorTypeName: et.name,
        }
      });
      setBulkAssignSuccess(`Updated ${res.updated} group${res.updated !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setShowBulkAssign(false);
      setBulkErrorTypeId("");
      queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
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
          <h1 className="text-3xl font-bold tracking-tight">Invoice Groups</h1>
          <p className="text-muted-foreground mt-1">Rides grouped by invoice number — the primary unit for disputes.</p>
        </div>
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
              <span className="text-sm font-medium">{selectedIds.size} group{selectedIds.size !== 1 ? "s" : ""} selected</span>
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
              placeholder="Search by Invoice #, Client, Error..." 
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
                      Invoice #
                      <InfoTooltip content="The invoice number parsed from the Ref # field. Groups rides that belong to the same invoice." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Rides
                      <InfoTooltip content="Number of individual rides in this invoice group." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Client
                      <InfoTooltip content="The client/member number associated with this invoice group." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Error Description
                      <InfoTooltip content="The error/denial reason for this invoice group. Collected from rides that have error details." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Error Type
                      <InfoTooltip content="The classification of the denial or error for this group." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Total Amount
                      <InfoTooltip content="Combined dollar amount of all rides in this invoice group." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1">
                      Status
                      <InfoTooltip content="Current stage of the invoice group in the dispute workflow." side="bottom" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading invoice groups...</td>
                  </tr>
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <FolderOpen className="h-8 w-8 text-muted-foreground/50" />
                        <p>No invoice groups found.</p>
                        <p className="text-xs">Import claims to create invoice groups automatically.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  groups.map((group) => (
                    <tr key={group.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${selectedIds.has(group.id) ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selectedIds.has(group.id)}
                          onCheckedChange={() => handleToggle(group.id)}
                          aria-label={`Select group ${group.invoiceNumber}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-primary">
                        <Link href={`/invoice-groups/${group.id}`}>{group.invoiceNumber}</Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-xs">
                          {group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{group.clientNumber || '-'}</td>
                      <td className="px-4 py-3 max-w-[250px]">
                        <span className="text-xs text-muted-foreground line-clamp-2" title={group.errorDetails || ''}>
                          {group.errorDetails || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[160px] truncate" title={group.errorTypeName || ''}>
                        {group.errorTypeName || <span className="text-muted-foreground italic">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{formatCurrency(group.totalAmount)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={group.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/invoice-groups/${group.id}`}>View</Link>
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
