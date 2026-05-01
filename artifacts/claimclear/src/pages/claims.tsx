import { useState, useEffect, useMemo } from "react";
import { useListClaims, useListErrorTypes, useBulkAssignErrorType, getListClaimsQueryKey, getExportClaimsCsvUrl, ListClaimsSort, ListClaimsDir } from "@workspace/api-client-react";
import type { ClaimResponse, ErrorTypeResponse, ListClaimsParams } from "@workspace/api-client-react";
import { useClaimsListEvents } from "@/hooks/use-claim-events";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/format";
import { Link, useLocation } from "wouter";
import { Filter, Tag, X, Loader2, CheckCircle2, Inbox, Download, MoreHorizontal, ListTodo, Sparkles, FileText, FolderOpen, Activity, FileCheck, AlertCircle, Calendar as CalendarIcon, DollarSign, Clock } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoTooltip } from "@/components/info-tooltip";
import { EmptyState } from "@/components/empty-state";
import { SortableHeader } from "@/components/list-table/sortable-header";
import { FilterChipStrip, type FilterChip } from "@/components/list-table/filter-chip-strip";
import { ColumnVisibilityMenu, type ColumnDef } from "@/components/list-table/column-visibility-menu";
import { DensityToggle, type Density } from "@/components/list-table/density-toggle";
import { PaginationFooter, type PageSize } from "@/components/list-table/pagination-footer";
import {
  ListTableHeaderStrip,
  FacetSearchableCheckboxList,
  FacetCheckboxList,
  FacetDateRange,
  FacetNumericRange,
  type FacetedFilterCategory,
  type FacetOption,
} from "@/components/list-table/faceted-filter";
import { useUrlParams } from "@/lib/use-url-params";
import { SERVICE_DATE_PRESETS, CREATED_DATE_PRESETS } from "@/lib/date-presets";
import {
  PageHeader,
  StatusStrip, StatusDot, StatusPillForStatus,
  Recommended, ToneButton, CrossPageNudge, TONE_STYLE,
} from "@/components/cohesion";
import { ActionsRail, ActionGroup as RailActionGroup, ActionRow } from "@/components/actions-rail";
import { UrgentTodayBadge } from "@/components/urgent-today-badge";
import {
  LIFECYCLE_TABS,
  deriveLifecycleTab,
  type LifecycleTabKey,
} from "@/lib/lifecycle-phase";
import { type LegSubStatus } from "@workspace/leg-state";
import { legSubStatusLabel } from "@/components/leg-sub-status-pill";

// v2 claims-list tab strip: spec'd six filters in this order.
const CLAIM_LEG_TABS: readonly LegSubStatus[] = [
  "needs_classification",
  "investigating",
  "blocked",
  "ready",
  "dropped",
  "frozen",
];

const STATUSES = [
  "New", "Needs Review", "Needs Evidence", "Portal Queued", "Generating Email",
  "Ready to Review", "Awaiting Response", "On Hold", "Resolved", "Denied",
] as const;

const OUTCOMES = ["Pending", "Approved", "Denied", "Partially Approved", "Non-Issue"] as const;

// Tabs come from the shared lifecycle vocabulary so Claims and Invoice
// Groups stay in lockstep when a status is added/renamed.
type ClaimsTabKey = LifecycleTabKey;
const CLAIM_TABS = LIFECYCLE_TABS;
const deriveActiveTab = deriveLifecycleTab;

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
  const [, navigate] = useLocation();

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
  const filterCarNumber = get("carNumber");
  const filterClientNumber = get("clientNumber");
  const filterExpiringRaw = get("expiring");
  const filterExpiring: "" | "soon" | "urgent" =
    filterExpiringRaw === "soon" || filterExpiringRaw === "urgent" ? filterExpiringRaw : "";

  // Post-cutover: the secondary tab strip that filters the list by
  // per-leg sub-status is always shown (the legacy status-tab strip was
  // removed in Task #199).
  const filterLegSubStatusRaw = get("legSubStatus");
  const filterLegSubStatus = (CLAIM_LEG_TABS as readonly string[]).includes(filterLegSubStatusRaw)
    ? (filterLegSubStatusRaw as LegSubStatus)
    : "";

  const activeTab: ClaimsTabKey = deriveActiveTab(filterStatuses);

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
    carNumber: filterCarNumber || undefined,
    clientNumber: filterClientNumber || undefined,
    expiring: (filterExpiring || undefined) as ListClaimsParams["expiring"],
    legSubStatus: filterLegSubStatus || undefined,
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
    set({ status: null, outcome: null, errorTypeId: null, createdFrom: null, createdTo: null, amountMin: null, amountMax: null, serviceDateFrom: null, serviceDateTo: null, carNumber: null, clientNumber: null, expiring: null, page: null }, false);
  };

  const hasActiveFilters = filterStatuses.length > 0 || filterOutcomes.length > 0 || filterErrorTypeIds.length > 0 || !!filterCreatedFrom || !!filterCreatedTo || !!filterAmountMin || !!filterAmountMax || !!filterServiceDateFrom || !!filterServiceDateTo || !!filterCarNumber || !!filterClientNumber || !!filterExpiring;

  const chips = useMemo((): FilterChip[] => {
    const result: FilterChip[] = [];
    if (search) {
      result.push({ key: "q", label: `Search: "${search}"`, onRemove: () => set({ q: null }, false) });
    }
    if (filterStatuses.length > 0 && activeTab === "All") {
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
    if (filterCarNumber) {
      result.push({ key: "carNumber", label: `Vehicle: ${filterCarNumber}`, onRemove: () => set({ carNumber: null, page: null }, false) });
    }
    if (filterClientNumber) {
      result.push({ key: "clientNumber", label: `Member: ${filterClientNumber}`, onRemove: () => set({ clientNumber: null, page: null }, false) });
    }
    if (filterExpiring) {
      const label = filterExpiring === "urgent" ? "Must file today" : "Expiring soon (≤ 10 days)";
      result.push({ key: "expiring", label, onRemove: () => set({ expiring: null, page: null }, false) });
    }
    return result;
  }, [search, filterStatuses, filterOutcomes, filterErrorTypeIds, filterCreatedFrom, filterCreatedTo, filterAmountMin, filterAmountMax, filterServiceDateFrom, filterServiceDateTo, filterCarNumber, filterClientNumber, filterExpiring, errorTypes, activeTab, set]);

  const toggleCol = (key: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const setMultiParam = (key: string, values: string[]) => {
    set({ [key]: values.length > 0 ? values.join(",") : null, page: null }, false);
  };

  const toggleMulti = (current: string[], id: string, next: boolean) => {
    if (next) return current.includes(id) ? current : [...current, id];
    return current.filter(v => v !== id);
  };

  const errorTypeOptions: FacetOption[] = useMemo(
    () => [
      { id: "__unassigned__", label: "Unassigned", italic: true },
      ...errorTypes.map(et => ({ id: String(et.id), label: et.name })),
    ],
    [errorTypes],
  );
  const statusOptions: FacetOption[] = useMemo(
    () => STATUSES.map(s => ({ id: s, label: s })),
    [],
  );
  const outcomeOptions: FacetOption[] = useMemo(
    () => OUTCOMES.map(o => ({ id: o, label: o })),
    [],
  );

  // Per-category applied counts drive both the left-rail badges and the
  // shell's total badge. Date and amount ranges count as 1 even when only
  // one bound is set, matching the chip behavior.
  const statusCount = filterStatuses.length;
  const outcomeCount = filterOutcomes.length;
  const errorTypeCount = filterErrorTypeIds.length;
  const serviceDateCount = filterServiceDateFrom || filterServiceDateTo ? 1 : 0;
  const createdDateCount = filterCreatedFrom || filterCreatedTo ? 1 : 0;
  const amountCount = filterAmountMin || filterAmountMax ? 1 : 0;
  const deadlineCount = filterExpiring ? 1 : 0;

  const totalAppliedFilters =
    statusCount + outcomeCount + errorTypeCount + serviceDateCount +
    createdDateCount + amountCount + deadlineCount;

  const filterCategories: FacetedFilterCategory[] = useMemo(() => [
    {
      id: "status",
      label: "Status",
      icon: Activity,
      appliedCount: statusCount,
      render: () => (
        <FacetSearchableCheckboxList
          options={statusOptions}
          selected={filterStatuses}
          onToggle={(id, next) =>
            setMultiParam("status", toggleMulti(filterStatuses, id, next))
          }
          placeholder="Filter statuses..."
          pinSelected
          testIdPrefix="facet-status"
        />
      ),
    },
    {
      id: "outcome",
      label: "Outcome",
      icon: FileCheck,
      appliedCount: outcomeCount,
      render: () => (
        <FacetSearchableCheckboxList
          options={outcomeOptions}
          selected={filterOutcomes}
          onToggle={(id, next) =>
            setMultiParam("outcome", toggleMulti(filterOutcomes, id, next))
          }
          placeholder="Filter outcomes..."
          testIdPrefix="facet-outcome"
        />
      ),
    },
    {
      id: "errorType",
      label: "Error Type",
      icon: AlertCircle,
      appliedCount: errorTypeCount,
      render: () => (
        <FacetSearchableCheckboxList
          options={errorTypeOptions}
          selected={filterErrorTypeIds}
          onToggle={(id, next) =>
            setMultiParam(
              "errorTypeId",
              toggleMulti(filterErrorTypeIds, id, next),
            )
          }
          placeholder="Filter error types..."
          pinSelected
          testIdPrefix="facet-errorType"
        />
      ),
    },
    {
      id: "deadline",
      label: "Filing Deadline",
      icon: Clock,
      appliedCount: deadlineCount,
      render: () => (
        <FacetCheckboxList
          heading="Filing deadline"
          exclusive
          options={[
            { id: "soon", label: "Expiring soon (≤ 10 days)" },
            { id: "urgent", label: "Must file today" },
          ]}
          selected={filterExpiring ? [filterExpiring] : []}
          onToggle={(id, next) =>
            set({ expiring: next ? id : null, page: null }, false)
          }
          testIdPrefix="facet-deadline"
          hint="Only counts claims with actionable status; weekend deadlines are shifted to Friday."
        />
      ),
    },
    {
      id: "serviceDate",
      label: "Service Date",
      icon: CalendarIcon,
      appliedCount: serviceDateCount,
      render: () => (
        <FacetDateRange
          value={{ from: filterServiceDateFrom, to: filterServiceDateTo }}
          onChange={v =>
            set(
              {
                serviceDateFrom: v.from || null,
                serviceDateTo: v.to || null,
                page: null,
              },
              false,
            )
          }
          presets={SERVICE_DATE_PRESETS}
          testIdPrefix="facet-serviceDate"
        />
      ),
    },
    {
      id: "createdDate",
      label: "Created Date",
      icon: CalendarIcon,
      appliedCount: createdDateCount,
      render: () => (
        <FacetDateRange
          value={{ from: filterCreatedFrom, to: filterCreatedTo }}
          onChange={v =>
            set(
              {
                createdFrom: v.from || null,
                createdTo: v.to || null,
                page: null,
              },
              false,
            )
          }
          presets={CREATED_DATE_PRESETS}
          testIdPrefix="facet-createdDate"
        />
      ),
    },
    {
      id: "amount",
      label: "Amount",
      icon: DollarSign,
      appliedCount: amountCount,
      render: () => (
        <FacetNumericRange
          heading="Amount range"
          value={{ min: filterAmountMin, max: filterAmountMax }}
          onChange={v =>
            set(
              {
                amountMin: v.min || null,
                amountMax: v.max || null,
                page: null,
              },
              false,
            )
          }
          prefix="$"
          minPlaceholder="0.00"
          maxPlaceholder="Any"
          testIdPrefix="facet-amount"
        />
      ),
    },
  ], [
    statusCount, outcomeCount, errorTypeCount, serviceDateCount,
    createdDateCount, amountCount, deadlineCount,
    statusOptions, outcomeOptions, errorTypeOptions,
    filterStatuses, filterOutcomes, filterErrorTypeIds, filterExpiring,
    filterServiceDateFrom, filterServiceDateTo,
    filterCreatedFrom, filterCreatedTo,
    filterAmountMin, filterAmountMax,
    set,
  ]);

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

  const blueRowTint = TONE_STYLE.blue.bg;

  return (
    <div className="space-y-4" data-testid="page-claims">
      <PageHeader
        title="Claims"
        sub={`${total} ${activeTab === "All" ? "active" : activeTab.toLowerCase()} ${total === 1 ? "claim" : "claims"} · search and classify individual claims`}
        accent="blue"
        actions={
          <Button asChild data-testid="button-create-claim">
            <Link href="/claims/new">Create Claim</Link>
          </Button>
        }
      />

      {bulkAssignSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-center gap-2" data-testid="bulk-assign-success">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-800">{bulkAssignSuccess}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex flex-wrap items-center gap-1"
          role="tablist"
          aria-label="Filter claims by leg sub-status"
          data-testid="leg-sub-status-tabs"
        >
          {CLAIM_LEG_TABS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={filterLegSubStatus === s}
              onClick={() => set({ legSubStatus: s })}
              className={`px-3 py-1.5 rounded-full border text-sm ${
                filterLegSubStatus === s
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-foreground border-border hover:bg-muted"
              }`}
              data-testid={`leg-sub-status-tab-${s}`}
            >
              {legSubStatusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      <StatusStrip>
        <StatusDot tone="blue" />
        <span className="font-medium text-foreground">
          {activeTab === "All" ? "All claims" : activeTab}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {total.toLocaleString()} matching · {hasActiveFilters || search ? "filters active" : "no filters"}
        </span>
        <Link href="/insights" className="ml-auto text-xs font-medium" style={{ color: TONE_STYLE.blue.fg }}>
          Open Insights →
        </Link>
      </StatusStrip>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4 min-w-0">
          <ListTableHeaderStrip
            searchValue={search}
            onSearchChange={v => set({ q: v || null, page: null }, false)}
            searchPlaceholder="Search by Conf #, Client, Error..."
            searchTestId="input-search-claims"
            matchingCount={total}
            matchingNoun={{ one: "claim", other: "claims" }}
            filterOpen={filterOpen}
            onFilterOpenChange={setFilterOpen}
            filterCategories={filterCategories}
            totalApplied={totalAppliedFilters}
            onClearAllFilters={clearFilters}
            extras={
              <>
                <DensityToggle density={density} onToggle={() => setDensity(d => d === "comfortable" ? "compact" : "comfortable")} />
                <ColumnVisibilityMenu columns={ALL_COLUMNS} visibleColumns={visibleCols} onToggle={toggleCol} />
                <a href={csvUrl} download>
                  <Button variant="outline" size="sm" data-testid="button-export-csv">
                    <Download className="mr-2 h-4 w-4" />
                    Export CSV
                  </Button>
                </a>
              </>
            }
          >
          <Card>
            <FilterChipStrip
              chips={chips}
              onClearAll={() => { set({ q: null, status: null, outcome: null, errorTypeId: null, createdFrom: null, createdTo: null, amountMin: null, amountMax: null, serviceDateFrom: null, serviceDateTo: null, carNumber: null, clientNumber: null, expiring: null, page: null }, false); }}
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
                            <InfoTooltip content="The date the service was provided." side="bottom" />
                          </div>
                        </th>
                      )}
                      {visibleCols.has("clientNumber") && (
                        <th className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-1">
                            <SortableHeader label="Client" sortKey="clientNumber" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                            <InfoTooltip content="The client/member number associated with this claim." side="bottom" />
                          </div>
                        </th>
                      )}
                      {visibleCols.has("errorDetails") && (
                        <th className="px-4 py-3 font-medium">
                          <span className="flex items-center gap-1">
                            Error Description
                            <InfoTooltip content="The error/denial reason for this claim." side="bottom" />
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
                            <InfoTooltip content="The dollar amount of the claim." side="bottom" />
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
                            <InfoTooltip content="Open the per-row actions menu." side="bottom" />
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
                      claims.map(claim => {
                        const isSel = selectedIds.has(claim.id);
                        return (
                          <tr
                            key={claim.id}
                            className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                            style={isSel ? { background: blueRowTint } : undefined}
                            data-testid={`row-claim-${claim.id}`}
                          >
                            <td className={`px-4 ${tdPy}`}>
                              <Checkbox checked={isSel} onCheckedChange={() => handleToggle(claim.id)} aria-label={`Select claim ${claim.confNumber}`} />
                            </td>
                            {visibleCols.has("confNumber") && (
                              <td className={`px-4 ${tdPy} font-medium font-mono text-xs`} style={{ color: TONE_STYLE.blue.fg }}>
                                <div className="flex items-center gap-2">
                                  <UrgentTodayBadge isUrgent={claim.isUrgent} />
                                  <Link href={`/claims/${claim.id}`}>{claim.confNumber}</Link>
                                </div>
                              </td>
                            )}
                            {visibleCols.has("date") && (
                              <td className={`px-4 ${tdPy} text-muted-foreground whitespace-nowrap`}>{formatDate(claim.date)}</td>
                            )}
                            {visibleCols.has("clientNumber") && (
                              <td className={`px-4 ${tdPy} font-mono text-xs text-muted-foreground`}>{claim.clientNumber || '-'}</td>
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
                              <td className={`px-4 ${tdPy} font-medium tabular-nums whitespace-nowrap`}>{formatCurrency(claim.claimAmount)}</td>
                            )}
                            {visibleCols.has("status") && (
                              <td className={`px-4 ${tdPy}`}><StatusPillForStatus status={claim.status} /></td>
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
                        );
                      })
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
          </ListTableHeaderStrip>

          <CrossPageNudge
            text={<>To dispute many at once, work from</>}
            linkLabel="Invoice Groups"
            href="/invoice-groups"
            linkTone="purple"
          />
        </div>

        <aside className="xl:col-span-4 space-y-3 xl:sticky xl:top-4 self-start">
          <ActionsRail
            title="What you can do"
            variant="claim"
            meta={someSelected ? `${selectedIds.size} selected` : undefined}
          >
            {someSelected ? (
              <Recommended
                tone="blue"
                title={`Apply error type to ${selectedIds.size}`}
                body="Tag every selected claim with the same error classification — keeps your data clean for filtering and reporting."
                cta={
                  showBulkAssign ? (
                    <div className="space-y-2">
                      <Select value={bulkErrorTypeId} onValueChange={setBulkErrorTypeId}>
                        <SelectTrigger className="h-9 text-sm bg-background">
                          <SelectValue placeholder="Select error type..." />
                        </SelectTrigger>
                        <SelectContent>
                          {errorTypes.map(et => (
                            <SelectItem key={et.id} value={String(et.id)}>{et.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <ToneButton
                          tone="blue"
                          onClick={handleBulkAssign}
                          disabled={!bulkErrorTypeId || bulkAssign.isPending}
                          testId="button-bulk-assign-apply"
                        >
                          {bulkAssign.isPending ? <><Loader2 className="h-3 w-3 animate-spin" /> Applying…</> : "Apply"}
                        </ToneButton>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="bg-background/40"
                          onClick={() => { setShowBulkAssign(false); setBulkErrorTypeId(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <ToneButton tone="blue" onClick={() => setShowBulkAssign(true)} testId="button-bulk-assign-open">
                      <Tag className="w-4 h-4" /> Apply error type to {selectedIds.size}
                    </ToneButton>
                  )
                }
              />
            ) : (
              <Recommended
                tone="blue"
                title="Open Queue to classify"
                body="Step through claims one at a time with full evidence and decision tools."
                cta={
                  <ToneButton tone="blue" onClick={() => navigate("/queue")} testId="button-rail-open-queue">
                    <Sparkles className="w-4 h-4" /> Open Queue
                  </ToneButton>
                }
              />
            )}

            <RailActionGroup label="On selection">
              <ActionRow
                icon={<Tag className="w-3.5 h-3.5" />}
                label={`Apply error type to ${selectedIds.size || ""}…`.replace(" …", "…")}
                disabled={!someSelected}
                disabledReason={!someSelected ? "Select one or more rows first." : undefined}
                onClick={() => setShowBulkAssign(true)}
                testId="rail-action-apply-error-type"
              />
              <ActionRow
                icon={<X className="w-3.5 h-3.5" />}
                label="Clear selection"
                disabled={!someSelected}
                onClick={() => setSelectedIds(new Set())}
                muted
                testId="rail-action-clear-selection"
              />
            </RailActionGroup>

            <RailActionGroup label="Bulk edit">
              <ActionRow
                icon={<FileText className="w-3.5 h-3.5" />}
                label="Reassign owner…"
                muted
                disabled
                disabledReason="Coming soon."
              />
              <ActionRow
                icon={<FileText className="w-3.5 h-3.5" />}
                label="Add internal note to selected…"
                muted
                disabled
                disabledReason="Coming soon."
              />
            </RailActionGroup>

            <RailActionGroup label="Selection">
              <ActionRow
                icon={<Download className="w-3.5 h-3.5" />}
                label="Export current view (CSV)"
                sub={`${total.toLocaleString()} matching ${total === 1 ? "row" : "rows"}`}
                onClick={() => { window.location.href = csvUrl; }}
                testId="rail-action-export-csv"
              />
              <ActionRow
                icon={<ListTodo className="w-3.5 h-3.5" />}
                label="Open Queue"
                sub="Step through one at a time"
                onClick={() => navigate("/queue")}
              />
              <ActionRow
                icon={<FolderOpen className="w-3.5 h-3.5" />}
                label="Open Invoice Groups"
                sub="Switch to bulk file mode"
                onClick={() => navigate("/invoice-groups")}
              />
            </RailActionGroup>
          </ActionsRail>
        </aside>
      </div>
    </div>
  );
}
