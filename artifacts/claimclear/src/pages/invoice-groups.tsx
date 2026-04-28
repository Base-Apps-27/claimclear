import { useState, useEffect, useMemo } from "react";
import { useListInvoiceGroups, useListErrorTypes, useBulkAssignInvoiceGroupErrorType, getListInvoiceGroupsQueryKey, getExportInvoiceGroupsCsvUrl, ListInvoiceGroupsSort, ListInvoiceGroupsDir } from "@workspace/api-client-react";
import type { InvoiceGroupResponse, ErrorTypeResponse, ListInvoiceGroupsParams } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { Link } from "wouter";
import { Search, Filter, Tag, X, Loader2, CheckCircle2, FolderOpen, Download } from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import { EmptyState } from "@/components/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/list-table/sortable-header";
import { FilterChipStrip, type FilterChip } from "@/components/list-table/filter-chip-strip";
import { ColumnVisibilityMenu, type ColumnDef } from "@/components/list-table/column-visibility-menu";
import { DensityToggle, type Density } from "@/components/list-table/density-toggle";
import { PaginationFooter, type PageSize } from "@/components/list-table/pagination-footer";
import { useUrlParams } from "@/lib/use-url-params";

const STATUSES = [
  "New", "Needs Review", "Needs Evidence", "Portal Queued", "Generating Email",
  "Ready to Review", "Awaiting Response", "On Hold", "Resolved", "Denied",
] as const;

const OUTCOMES = ["Pending", "Approved", "Denied", "Partially Approved", "Non-Issue"] as const;

const ALL_COLUMNS: ColumnDef[] = [
  { key: "invoiceNumber", label: "Invoice #", hideable: false },
  { key: "rideCount", label: "Rides" },
  { key: "clientNumber", label: "Client" },
  { key: "errorDetails", label: "Error Description" },
  { key: "errorTypeName", label: "Error Type" },
  { key: "totalAmount", label: "Total Amount" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created" },
  { key: "action", label: "Action", hideable: false },
];

const STORAGE_KEY_COLS = "ig_visible_cols";
const STORAGE_KEY_DENSITY = "ig_density";

function getInitialVisibleCols(): Set<string> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_COLS);
    if (saved) return new Set(JSON.parse(saved));
  } catch {}
  return new Set(ALL_COLUMNS.map(c => c.key));
}

function getInitialDensity(): Density {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_DENSITY);
    if (saved === "compact" || saved === "comfortable") return saved;
  } catch {}
  return "comfortable";
}

export default function InvoiceGroupsList() {
  const queryClient = useQueryClient();
  const { get, getAll, set, searchParams } = useUrlParams();

  const search = get("q");
  const sortCol = get("sort");
  const sortDir = (get("dir") || "") as "asc" | "desc" | "";
  const page = Math.max(1, parseInt(get("page") || "1", 10));
  const pageSize = (([25, 50, 100, 200].includes(parseInt(get("ps") || "50", 10)) ? parseInt(get("ps") || "50", 10) : 50) as PageSize);

  const filterStatuses = getAll("status");
  const filterOutcomes = getAll("outcome");
  const filterErrorTypeIds = getAll("errorTypeId");
  const filterErrorDetails = get("errorDetails") as "" | "empty" | "present";
  const filterCreatedFrom = get("createdFrom");
  const filterCreatedTo = get("createdTo");
  const filterAmountMin = get("amountMin");
  const filterAmountMax = get("amountMax");

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkErrorTypeId, setBulkErrorTypeId] = useState("");
  const [bulkAssignSuccess, setBulkAssignSuccess] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(getInitialVisibleCols);
  const [density, setDensity] = useState<Density>(getInitialDensity);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify([...visibleCols]));
  }, [visibleCols]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DENSITY, density);
  }, [density]);

  const listParams: ListInvoiceGroupsParams = {
    search: search || undefined,
    status: filterStatuses.length > 0 ? filterStatuses.join(",") : undefined,
    outcome: filterOutcomes.length > 0 ? filterOutcomes.join(",") : undefined,
    errorTypeId: filterErrorTypeIds.length > 0 ? filterErrorTypeIds.join(",") : undefined,
    errorDetails: (filterErrorDetails || undefined) as "empty" | "present" | undefined,
    createdFrom: filterCreatedFrom || undefined,
    createdTo: filterCreatedTo || undefined,
    amountMin: filterAmountMin || undefined,
    amountMax: filterAmountMax || undefined,
    sort: (sortCol || undefined) as typeof ListInvoiceGroupsSort[keyof typeof ListInvoiceGroupsSort] | undefined,
    dir: (sortDir || undefined) as typeof ListInvoiceGroupsDir[keyof typeof ListInvoiceGroupsDir] | undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const { data, isLoading, isError } = useListInvoiceGroups(listParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(listParams) }
  });

  const { data: errorTypesData } = useListErrorTypes();
  const bulkAssign = useBulkAssignInvoiceGroupErrorType();

  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  const groups: InvoiceGroupResponse[] = data?.groups ?? [];
  const total = data?.total ?? 0;

  const allSelected = groups.length > 0 && groups.every(g => selectedIds.has(g.id));
  const someSelected = selectedIds.size > 0;

  const handleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(groups.map(g => g.id)));
  };

  const handleToggle = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkAssign = async () => {
    if (!bulkErrorTypeId || selectedIds.size === 0) return;
    const et = errorTypes.find(t => String(t.id) === bulkErrorTypeId);
    if (!et) return;
    try {
      const res = await bulkAssign.mutateAsync({
        data: { groupIds: Array.from(selectedIds), errorTypeId: String(et.id), errorTypeName: et.name }
      });
      setBulkAssignSuccess(`Updated ${res.updated} group${res.updated !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setShowBulkAssign(false);
      setBulkErrorTypeId("");
      queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
      setTimeout(() => setBulkAssignSuccess(""), 3000);
    } catch {}
  };

  const handleSort = (key: string, dir: "asc" | "desc" | "") => {
    set({ sort: key || null, dir: dir || null, page: null }, false);
  };

  const clearFilters = () => {
    set({ status: null, outcome: null, errorTypeId: null, errorDetails: null, createdFrom: null, createdTo: null, amountMin: null, amountMax: null, page: null }, false);
  };

  const hasActiveFilters = filterStatuses.length > 0 || filterOutcomes.length > 0 || filterErrorTypeIds.length > 0 || !!filterErrorDetails || !!filterCreatedFrom || !!filterCreatedTo || !!filterAmountMin || !!filterAmountMax;

  const chips = useMemo((): FilterChip[] => {
    const result: FilterChip[] = [];
    if (search) {
      result.push({ key: "q", label: `Search: "${search}"`, onRemove: () => set({ q: null }, false) });
    }
    if (filterStatuses.length > 0) {
      result.push({ key: "status", label: `Status: ${filterStatuses.join(", ")}`, onRemove: () => set({ status: null, page: null }, false) });
    }
    if (filterOutcomes.length > 0) {
      result.push({ key: "outcome", label: `Outcome: ${filterOutcomes.join(", ")}`, onRemove: () => set({ outcome: null, page: null }, false) });
    }
    if (filterErrorTypeIds.length > 0) {
      const labels = filterErrorTypeIds.map(id => id === "__unassigned__" ? "Unassigned" : (errorTypes.find(et => String(et.id) === id)?.name ?? id));
      result.push({ key: "errorTypeId", label: `Error Type: ${labels.join(", ")}`, onRemove: () => set({ errorTypeId: null, page: null }, false) });
    }
    if (filterErrorDetails) {
      result.push({ key: "errorDetails", label: filterErrorDetails === "empty" ? "No description" : "Has description", onRemove: () => set({ errorDetails: null, page: null }, false) });
    }
    if (filterCreatedFrom || filterCreatedTo) {
      const label = filterCreatedFrom && filterCreatedTo ? `Created: ${filterCreatedFrom} – ${filterCreatedTo}` : filterCreatedFrom ? `Created ≥ ${filterCreatedFrom}` : `Created ≤ ${filterCreatedTo}`;
      result.push({ key: "created", label, onRemove: () => set({ createdFrom: null, createdTo: null, page: null }, false) });
    }
    if (filterAmountMin || filterAmountMax) {
      const label = filterAmountMin && filterAmountMax ? `Amount: $${filterAmountMin} – $${filterAmountMax}` : filterAmountMin ? `Amount ≥ $${filterAmountMin}` : `Amount ≤ $${filterAmountMax}`;
      result.push({ key: "amount", label, onRemove: () => set({ amountMin: null, amountMax: null, page: null }, false) });
    }
    return result;
  }, [search, filterStatuses, filterOutcomes, filterErrorTypeIds, filterErrorDetails, filterCreatedFrom, filterCreatedTo, filterAmountMin, filterAmountMax, errorTypes]);

  const toggleCol = (key: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const visibleColumnKeys = ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(c => c.key);

  const colCount = visibleColumnKeys.length + 1;

  const csvParams = {
    ...listParams,
    limit: undefined,
    offset: undefined,
    columns: visibleColumnKeys.filter(k => k !== "action").join(","),
  };
  const csvUrl = getExportInvoiceGroupsCsvUrl(csvParams as Parameters<typeof getExportInvoiceGroupsCsvUrl>[0]);

  const tdPy = density === "compact" ? "py-1.5" : "py-3";

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
                      {errorTypes.map(et => (
                        <SelectItem key={et.id} value={String(et.id)}>{et.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={handleBulkAssign} disabled={!bulkErrorTypeId || bulkAssign.isPending}>
                    {bulkAssign.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Assigning...</> : "Apply"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowBulkAssign(false); setBulkErrorTypeId(""); }}>Cancel</Button>
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
        <CardHeader className="p-4 border-b flex flex-row items-center justify-between space-y-0 gap-3">
          <div className="relative w-72 flex-shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Invoice #, Client, Error..."
              className="pl-9 pr-8"
              value={search}
              onChange={e => set({ q: e.target.value || null, page: null }, false)}
            />
            {search && (
              <button onClick={() => set({ q: null, page: null }, false)} className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DensityToggle density={density} onToggle={() => setDensity(d => d === "comfortable" ? "compact" : "comfortable")} />
            <ColumnVisibilityMenu columns={ALL_COLUMNS} visibleColumns={visibleCols} onToggle={toggleCol} />
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={hasActiveFilters ? "border-primary text-primary" : ""}>
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                  {hasActiveFilters && (
                    <span className="ml-1.5 bg-primary text-primary-foreground rounded-full text-[10px] font-bold h-4 w-4 inline-flex items-center justify-center">
                      {chips.filter(c => c.key !== "q").length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4 space-y-4 max-h-[80vh] overflow-y-auto" align="end">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Status</Label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {STATUSES.map(s => (
                      <div key={s} className="flex items-center gap-2 py-0.5">
                        <Checkbox
                          id={`ig-status-${s}`}
                          checked={filterStatuses.includes(s)}
                          onCheckedChange={checked => {
                            const next = checked ? [...filterStatuses, s] : filterStatuses.filter(x => x !== s);
                            set({ status: next.length > 0 ? next.join(",") : null, page: null }, false);
                          }}
                        />
                        <Label htmlFor={`ig-status-${s}`} className="text-sm font-normal cursor-pointer">{s}</Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Outcome</Label>
                  <div className="space-y-1">
                    {OUTCOMES.map(o => (
                      <div key={o} className="flex items-center gap-2 py-0.5">
                        <Checkbox
                          id={`ig-outcome-${o}`}
                          checked={filterOutcomes.includes(o)}
                          onCheckedChange={checked => {
                            const next = checked ? [...filterOutcomes, o] : filterOutcomes.filter(x => x !== o);
                            set({ outcome: next.length > 0 ? next.join(",") : null, page: null }, false);
                          }}
                        />
                        <Label htmlFor={`ig-outcome-${o}`} className="text-sm font-normal cursor-pointer">{o}</Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Error Type</Label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    <div className="flex items-center gap-2 py-0.5">
                      <Checkbox
                        id="ig-et-unassigned"
                        checked={filterErrorTypeIds.includes("__unassigned__")}
                        onCheckedChange={checked => {
                          const next = checked ? [...filterErrorTypeIds, "__unassigned__"] : filterErrorTypeIds.filter(x => x !== "__unassigned__");
                          set({ errorTypeId: next.length > 0 ? next.join(",") : null, page: null }, false);
                        }}
                      />
                      <Label htmlFor="ig-et-unassigned" className="text-sm font-normal cursor-pointer italic text-muted-foreground">Unassigned</Label>
                    </div>
                    {errorTypes.map(et => (
                      <div key={et.id} className="flex items-center gap-2 py-0.5">
                        <Checkbox
                          id={`ig-et-${et.id}`}
                          checked={filterErrorTypeIds.includes(String(et.id))}
                          onCheckedChange={checked => {
                            const next = checked ? [...filterErrorTypeIds, String(et.id)] : filterErrorTypeIds.filter(x => x !== String(et.id));
                            set({ errorTypeId: next.length > 0 ? next.join(",") : null, page: null }, false);
                          }}
                        />
                        <Label htmlFor={`ig-et-${et.id}`} className="text-sm font-normal cursor-pointer">{et.name}</Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Error Description</Label>
                  <Select value={filterErrorDetails || "__all__"} onValueChange={v => set({ errorDetails: v === "__all__" ? null : v, page: null }, false)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="All groups" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All groups</SelectItem>
                      <SelectItem value="empty">No description</SelectItem>
                      <SelectItem value="present">Has description</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Created Date</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">From</Label>
                      <Input type="date" className="h-8 text-sm" value={filterCreatedFrom} onChange={e => set({ createdFrom: e.target.value || null, page: null }, false)} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">To</Label>
                      <Input type="date" className="h-8 text-sm" value={filterCreatedTo} onChange={e => set({ createdTo: e.target.value || null, page: null }, false)} />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Total Amount</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Min ($)</Label>
                      <Input type="number" min="0" step="0.01" placeholder="0.00" className="h-8 text-sm" value={filterAmountMin} onChange={e => set({ amountMin: e.target.value || null, page: null }, false)} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Max ($)</Label>
                      <Input type="number" min="0" step="0.01" placeholder="Any" className="h-8 text-sm" value={filterAmountMax} onChange={e => set({ amountMax: e.target.value || null, page: null }, false)} />
                    </div>
                  </div>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <Button variant="ghost" size="sm" onClick={() => { clearFilters(); setFilterOpen(false); }} className="text-xs">Clear all</Button>
                  <Button size="sm" onClick={() => setFilterOpen(false)} className="text-xs">Done</Button>
                </div>
              </PopoverContent>
            </Popover>
            <a href={csvUrl} download>
              <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </a>
          </div>
        </CardHeader>

        <FilterChipStrip
          chips={chips}
          onClearAll={() => { set({ q: null, status: null, outcome: null, errorTypeId: null, errorDetails: null, createdFrom: null, createdTo: null, amountMin: null, amountMax: null, page: null }, false); }}
        />

        <CardContent className="p-0">
          <div className="overflow-auto max-h-[calc(100vh-22rem)]">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <Checkbox checked={allSelected} onCheckedChange={handleSelectAll} aria-label="Select all" />
                  </th>
                  {visibleCols.has("invoiceNumber") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Invoice #" sortKey="invoiceNumber" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="The invoice number parsed from the Ref # field. Groups rides that belong to the same invoice." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("rideCount") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Rides" sortKey="rideCount" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="Number of individual rides in this invoice group." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("clientNumber") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Client" sortKey="clientNumber" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="The client/member number associated with this invoice group." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("errorDetails") && (
                    <th className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-1">
                        Error Description
                        <InfoTooltip content="The error/denial reason for this invoice group." side="bottom" />
                      </span>
                    </th>
                  )}
                  {visibleCols.has("errorTypeName") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Error Type" sortKey="errorTypeName" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="The classification of the denial or error for this group." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("totalAmount") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Total Amount" sortKey="totalAmount" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="Combined dollar amount of all rides in this invoice group." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("status") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Status" sortKey="status" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="Current stage of the invoice group in the dispute workflow." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("createdAt") && (
                    <th className="px-4 py-3 font-medium">
                      <SortableHeader label="Created" sortKey="createdAt" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    </th>
                  )}
                  {visibleCols.has("action") && (
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-8 text-center text-muted-foreground">Loading invoice groups...</td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-8 text-center">
                      <div className="flex flex-col items-center gap-2 text-destructive">
                        <span className="font-medium">Failed to load invoice groups</span>
                        <span className="text-sm text-muted-foreground">Check your connection and try again.</span>
                        <button className="mt-1 text-sm underline text-primary" onClick={() => window.location.reload()}>Retry</button>
                      </div>
                    </td>
                  </tr>
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-0">
                      {(search || hasActiveFilters) ? (
                        <EmptyState
                          icon={Filter}
                          title="No invoice groups match your filters"
                          description="Try removing a filter or adjusting your search to see more results."
                          primaryAction={{ label: "Clear filters", onClick: () => { clearFilters(); set({ q: null }, false); } }}
                        />
                      ) : (
                        <EmptyState
                          icon={FolderOpen}
                          title="No invoice groups yet"
                          description="Import claims to create invoice groups automatically."
                          primaryAction={{ label: "Import claims", href: "/import" }}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  groups.map(group => (
                    <tr key={group.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${selectedIds.has(group.id) ? "bg-primary/5" : ""}`}>
                      <td className={`px-4 ${tdPy}`}>
                        <Checkbox checked={selectedIds.has(group.id)} onCheckedChange={() => handleToggle(group.id)} aria-label={`Select group ${group.invoiceNumber}`} />
                      </td>
                      {visibleCols.has("invoiceNumber") && (
                        <td className={`px-4 ${tdPy} font-medium text-primary`}>
                          <Link href={`/invoice-groups/${group.id}`}>{group.invoiceNumber}</Link>
                        </td>
                      )}
                      {visibleCols.has("rideCount") && (
                        <td className={`px-4 ${tdPy}`}>
                          <Badge variant="secondary" className="text-xs">{group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}</Badge>
                        </td>
                      )}
                      {visibleCols.has("clientNumber") && (
                        <td className={`px-4 ${tdPy}`}>{group.clientNumber || '-'}</td>
                      )}
                      {visibleCols.has("errorDetails") && (
                        <td className={`px-4 ${tdPy} max-w-[250px]`}>
                          <span className="text-xs text-muted-foreground line-clamp-2" title={group.errorDetails || ''}>
                            {group.errorDetails || '-'}
                          </span>
                        </td>
                      )}
                      {visibleCols.has("errorTypeName") && (
                        <td className={`px-4 ${tdPy} max-w-[160px] truncate`} title={group.errorTypeName || ''}>
                          {group.errorTypeName || <span className="text-muted-foreground italic">Unassigned</span>}
                        </td>
                      )}
                      {visibleCols.has("totalAmount") && (
                        <td className={`px-4 ${tdPy} font-medium whitespace-nowrap`}>{formatCurrency(group.totalAmount)}</td>
                      )}
                      {visibleCols.has("status") && (
                        <td className={`px-4 ${tdPy}`}><StatusBadge status={group.status} /></td>
                      )}
                      {visibleCols.has("createdAt") && (
                        <td className={`px-4 ${tdPy} text-muted-foreground whitespace-nowrap`}>{group.createdAt ? formatDate(group.createdAt) : '—'}</td>
                      )}
                      {visibleCols.has("action") && (
                        <td className={`px-4 ${tdPy} text-right`}>
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/invoice-groups/${group.id}`}>View</Link>
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <PaginationFooter
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={p => set({ page: String(p) }, false)}
            onPageSizeChange={s => set({ ps: String(s), page: null }, false)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
