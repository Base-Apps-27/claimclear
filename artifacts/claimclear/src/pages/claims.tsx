import { useState, useEffect, useMemo } from "react";
import { useListClaims, useListErrorTypes, useBulkAssignErrorType, getListClaimsQueryKey, getExportClaimsCsvUrl, ListClaimsSort, ListClaimsDir } from "@workspace/api-client-react";
import type { ClaimResponse, ErrorTypeResponse, ListClaimsParams } from "@workspace/api-client-react";
import { useClaimsListEvents } from "@/hooks/use-claim-events";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { Link } from "wouter";
import { Search, Filter, Tag, X, Loader2, CheckCircle2, Inbox, Download, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoTooltip } from "@/components/info-tooltip";
import { EmptyState } from "@/components/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
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
  { key: "confNumber", label: "Conf #", hideable: false },
  { key: "date", label: "Service Date" },
  { key: "clientNumber", label: "Client" },
  { key: "errorDetails", label: "Error Description" },
  { key: "errorTypeName", label: "Error Type" },
  { key: "claimAmount", label: "Amount" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created" },
  { key: "action", label: "Action", hideable: false },
];

const STORAGE_KEY_COLS = "claims_visible_cols";
const STORAGE_KEY_DENSITY = "claims_density";

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

export default function ClaimsList() {
  useClaimsListEvents();
  const queryClient = useQueryClient();
  const { get, getAll, set } = useUrlParams();

  const search = get("q");
  const sortCol = get("sort");
  const sortDir = (get("dir") || "") as "asc" | "desc" | "";
  const page = Math.max(1, parseInt(get("page") || "1", 10));
  const pageSize = (([25, 50, 100, 200].includes(parseInt(get("ps") || "50", 10)) ? parseInt(get("ps") || "50", 10) : 50) as PageSize);

  const filterStatuses = getAll("status");
  const filterOutcomes = getAll("outcome");
  const filterErrorTypeIds = getAll("errorTypeId");
  const filterCreatedFrom = get("createdFrom");
  const filterCreatedTo = get("createdTo");
  const filterAmountMin = get("amountMin");
  const filterAmountMax = get("amountMax");
  const filterServiceDateFrom = get("serviceDateFrom");
  const filterServiceDateTo = get("serviceDateTo");

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

  const listParams: ListClaimsParams = {
    search: search || undefined,
    status: filterStatuses.length > 0 ? filterStatuses.join(",") : undefined,
    outcome: filterOutcomes.length > 0 ? filterOutcomes.join(",") : undefined,
    errorTypeId: filterErrorTypeIds.length > 0 ? filterErrorTypeIds.join(",") : undefined,
    createdFrom: filterCreatedFrom || undefined,
    createdTo: filterCreatedTo || undefined,
    amountMin: filterAmountMin || undefined,
    amountMax: filterAmountMax || undefined,
    serviceDateFrom: filterServiceDateFrom || undefined,
    serviceDateTo: filterServiceDateTo || undefined,
    sort: (sortCol || undefined) as typeof ListClaimsSort[keyof typeof ListClaimsSort] | undefined,
    dir: (sortDir || undefined) as typeof ListClaimsDir[keyof typeof ListClaimsDir] | undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const { data, isLoading, isError } = useListClaims(listParams, {
    query: { queryKey: getListClaimsQueryKey(listParams) }
  });

  const { data: errorTypesData } = useListErrorTypes();
  const bulkAssign = useBulkAssignErrorType();

  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  const claims: ClaimResponse[] = data?.claims ?? [];
  const total = data?.total ?? 0;

  const allSelected = claims.length > 0 && claims.every(c => selectedIds.has(c.id));
  const someSelected = selectedIds.size > 0;

  const handleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(claims.map(c => c.id)));
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
        data: { claimIds: Array.from(selectedIds), errorTypeId: Number(bulkErrorTypeId) }
      });
      setBulkAssignSuccess(`Updated ${res.updated} claim${res.updated !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setShowBulkAssign(false);
      setBulkErrorTypeId("");
      queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
      setTimeout(() => setBulkAssignSuccess(""), 3000);
    } catch {}
  };

  const handleSort = (key: string, dir: "asc" | "desc" | "") => {
    set({ sort: key || null, dir: dir || null, page: null }, false);
  };

  const clearFilters = () => {
    set({ status: null, outcome: null, errorTypeId: null, createdFrom: null, createdTo: null, amountMin: null, amountMax: null, serviceDateFrom: null, serviceDateTo: null, page: null }, false);
  };

  const hasActiveFilters = filterStatuses.length > 0 || filterOutcomes.length > 0 || filterErrorTypeIds.length > 0 || !!filterCreatedFrom || !!filterCreatedTo || !!filterAmountMin || !!filterAmountMax || !!filterServiceDateFrom || !!filterServiceDateTo;

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
    if (filterCreatedFrom || filterCreatedTo) {
      const label = filterCreatedFrom && filterCreatedTo ? `Created: ${filterCreatedFrom} – ${filterCreatedTo}` : filterCreatedFrom ? `Created ≥ ${filterCreatedFrom}` : `Created ≤ ${filterCreatedTo}`;
      result.push({ key: "created", label, onRemove: () => set({ createdFrom: null, createdTo: null, page: null }, false) });
    }
    if (filterAmountMin || filterAmountMax) {
      const label = filterAmountMin && filterAmountMax ? `Amount: $${filterAmountMin} – $${filterAmountMax}` : filterAmountMin ? `Amount ≥ $${filterAmountMin}` : `Amount ≤ $${filterAmountMax}`;
      result.push({ key: "amount", label, onRemove: () => set({ amountMin: null, amountMax: null, page: null }, false) });
    }
    if (filterServiceDateFrom || filterServiceDateTo) {
      const label = filterServiceDateFrom && filterServiceDateTo ? `Service date: ${filterServiceDateFrom} – ${filterServiceDateTo}` : filterServiceDateFrom ? `Service date ≥ ${filterServiceDateFrom}` : `Service date ≤ ${filterServiceDateTo}`;
      result.push({ key: "serviceDate", label, onRemove: () => set({ serviceDateFrom: null, serviceDateTo: null, page: null }, false) });
    }
    return result;
  }, [search, filterStatuses, filterOutcomes, filterErrorTypeIds, filterCreatedFrom, filterCreatedTo, filterAmountMin, filterAmountMax, filterServiceDateFrom, filterServiceDateTo, errorTypes]);

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
  const csvUrl = getExportClaimsCsvUrl(csvParams as Parameters<typeof getExportClaimsCsvUrl>[0]);

  const tdPy = density === "compact" ? "py-1.5" : "py-3";

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
              placeholder="Search by Conf #, Client, Error..."
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
                          id={`cl-status-${s}`}
                          checked={filterStatuses.includes(s)}
                          onCheckedChange={checked => {
                            const next = checked ? [...filterStatuses, s] : filterStatuses.filter(x => x !== s);
                            set({ status: next.length > 0 ? next.join(",") : null, page: null }, false);
                          }}
                        />
                        <Label htmlFor={`cl-status-${s}`} className="text-sm font-normal cursor-pointer">{s}</Label>
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
                          id={`cl-outcome-${o}`}
                          checked={filterOutcomes.includes(o)}
                          onCheckedChange={checked => {
                            const next = checked ? [...filterOutcomes, o] : filterOutcomes.filter(x => x !== o);
                            set({ outcome: next.length > 0 ? next.join(",") : null, page: null }, false);
                          }}
                        />
                        <Label htmlFor={`cl-outcome-${o}`} className="text-sm font-normal cursor-pointer">{o}</Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Error Type</Label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    <div className="flex items-center gap-2 py-0.5">
                      <Checkbox
                        id="cl-et-unassigned"
                        checked={filterErrorTypeIds.includes("__unassigned__")}
                        onCheckedChange={checked => {
                          const next = checked ? [...filterErrorTypeIds, "__unassigned__"] : filterErrorTypeIds.filter(x => x !== "__unassigned__");
                          set({ errorTypeId: next.length > 0 ? next.join(",") : null, page: null }, false);
                        }}
                      />
                      <Label htmlFor="cl-et-unassigned" className="text-sm font-normal cursor-pointer italic text-muted-foreground">Unassigned</Label>
                    </div>
                    {errorTypes.map(et => (
                      <div key={et.id} className="flex items-center gap-2 py-0.5">
                        <Checkbox
                          id={`cl-et-${et.id}`}
                          checked={filterErrorTypeIds.includes(String(et.id))}
                          onCheckedChange={checked => {
                            const next = checked ? [...filterErrorTypeIds, String(et.id)] : filterErrorTypeIds.filter(x => x !== String(et.id));
                            set({ errorTypeId: next.length > 0 ? next.join(",") : null, page: null }, false);
                          }}
                        />
                        <Label htmlFor={`cl-et-${et.id}`} className="text-sm font-normal cursor-pointer">{et.name}</Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Service Date</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">From</Label>
                      <Input type="date" className="h-8 text-sm" value={filterServiceDateFrom} onChange={e => set({ serviceDateFrom: e.target.value || null, page: null }, false)} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">To</Label>
                      <Input type="date" className="h-8 text-sm" value={filterServiceDateTo} onChange={e => set({ serviceDateTo: e.target.value || null, page: null }, false)} />
                    </div>
                  </div>
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
                  <Label className="text-xs font-medium text-muted-foreground">Amount</Label>
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
          onClearAll={() => { set({ q: null, status: null, outcome: null, errorTypeId: null, createdFrom: null, createdTo: null, amountMin: null, amountMax: null, serviceDateFrom: null, serviceDateTo: null, page: null }, false); }}
        />

        <CardContent className="p-0">
          <div className="overflow-auto max-h-[calc(100vh-22rem)]">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <Checkbox checked={allSelected} onCheckedChange={handleSelectAll} aria-label="Select all" />
                  </th>
                  {visibleCols.has("confNumber") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Conf #" sortKey="confNumber" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="The unique trip confirmation number from MAS." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("date") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Service Date" sortKey="date" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="The date the transportation service was performed." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("clientNumber") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Client" sortKey="clientNumber" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="The client/member number associated with the trip passenger." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("errorDetails") && (
                    <th className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-1">
                        Error Description
                        <InfoTooltip content="The raw error/denial reason from the MAS report." side="bottom" />
                      </span>
                    </th>
                  )}
                  {visibleCols.has("errorTypeName") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Error Type" sortKey="errorTypeName" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="The classification of the denial or error." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("claimAmount") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Amount" sortKey="claimAmount" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="The dollar amount being disputed for this claim." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("status") && (
                    <th className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1">
                        <SortableHeader label="Status" sortKey="status" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                        <InfoTooltip content="Current stage of the claim in the dispute workflow." side="bottom" />
                      </div>
                    </th>
                  )}
                  {visibleCols.has("createdAt") && (
                    <th className="px-4 py-3 font-medium">
                      <SortableHeader label="Created" sortKey="createdAt" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    </th>
                  )}
                  {visibleCols.has("action") && (
                    <th className="px-4 py-3 font-medium text-right">
                      <span className="flex items-center gap-1 justify-end">
                        Action
                        <InfoTooltip content="Click View to open the full claim detail page." side="bottom" />
                      </span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-8 text-center text-muted-foreground">Loading claims...</td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-8 text-center">
                      <div className="flex flex-col items-center gap-2 text-destructive">
                        <span className="font-medium">Failed to load claims</span>
                        <span className="text-sm text-muted-foreground">Check your connection and try again.</span>
                        <Button variant="ghost" size="sm" className="mt-1" onClick={() => window.location.reload()}>Retry</Button>
                      </div>
                    </td>
                  </tr>
                ) : claims.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-0">
                      {(search || hasActiveFilters) ? (
                        <EmptyState
                          icon={Filter}
                          title="No claims match your filters"
                          description="Try removing a filter or adjusting your search to see more results."
                          primaryAction={{ label: "Clear filters", onClick: () => { clearFilters(); set({ q: null }, false); } }}
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
                  claims.map(claim => (
                    <tr key={claim.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${selectedIds.has(claim.id) ? "bg-primary/5" : ""}`}>
                      <td className={`px-4 ${tdPy}`}>
                        <Checkbox checked={selectedIds.has(claim.id)} onCheckedChange={() => handleToggle(claim.id)} aria-label={`Select claim ${claim.confNumber}`} />
                      </td>
                      {visibleCols.has("confNumber") && (
                        <td className={`px-4 ${tdPy} font-medium text-primary`}>
                          <Link href={`/claims/${claim.id}`}>{claim.confNumber}</Link>
                        </td>
                      )}
                      {visibleCols.has("date") && (
                        <td className={`px-4 ${tdPy} text-muted-foreground whitespace-nowrap`}>{formatDate(claim.date)}</td>
                      )}
                      {visibleCols.has("clientNumber") && (
                        <td className={`px-4 ${tdPy}`}>{claim.clientNumber || '-'}</td>
                      )}
                      {visibleCols.has("errorDetails") && (
                        <td className={`px-4 ${tdPy} max-w-[250px]`}>
                          <span className="text-xs text-muted-foreground line-clamp-2" title={claim.errorDetails || ''}>
                            {claim.errorDetails || '-'}
                          </span>
                        </td>
                      )}
                      {visibleCols.has("errorTypeName") && (
                        <td className={`px-4 ${tdPy} max-w-[160px] truncate`} title={claim.errorTypeName || ''}>
                          {claim.errorTypeName || <span className="text-muted-foreground italic">Unassigned</span>}
                        </td>
                      )}
                      {visibleCols.has("claimAmount") && (
                        <td className={`px-4 ${tdPy} font-medium whitespace-nowrap`}>{formatCurrency(claim.claimAmount)}</td>
                      )}
                      {visibleCols.has("status") && (
                        <td className={`px-4 ${tdPy}`}><StatusBadge status={claim.status} /></td>
                      )}
                      {visibleCols.has("createdAt") && (
                        <td className={`px-4 ${tdPy} text-muted-foreground whitespace-nowrap`}>{claim.createdAt ? formatDate(claim.createdAt) : '—'}</td>
                      )}
                      {visibleCols.has("action") && (
                        <td className={`px-4 ${tdPy} text-right`}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Open claim actions" data-testid={`button-claim-actions-${claim.id}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={`/claims/${claim.id}`}>View details</Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  window.open(`/claims/${claim.id}`, "_blank", "noopener,noreferrer");
                                }}
                              >
                                Open in new tab
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
