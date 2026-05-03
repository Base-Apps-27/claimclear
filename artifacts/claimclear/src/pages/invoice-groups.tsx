import { useState, useEffect, useMemo } from "react";
import { useListInvoiceGroups, useListErrorTypes, useBulkAssignInvoiceGroupErrorType, getListInvoiceGroupsQueryKey, getExportInvoiceGroupsCsvUrl, ListInvoiceGroupsSort, ListInvoiceGroupsDir } from "@workspace/api-client-react";
import type { InvoiceGroupResponse, ErrorTypeResponse, ListInvoiceGroupsParams } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/format";
import { Link, useLocation } from "wouter";
import { Tag, X, Loader2, CheckCircle2, FolderOpen, Download, MoreHorizontal, Send, FileText, Files, Filter, Activity, FileCheck, AlertCircle, FileWarning, Calendar as CalendarIcon, CalendarOff, DollarSign, Clock } from "lucide-react";
import { ServiceDateCell, type ServiceDateReason } from "@/components/service-date-cell";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoTooltip } from "@/components/info-tooltip";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { LEG_SUB_STATUSES, type LegSubStatus } from "@workspace/leg-state";
import { OUTCOMES, outcomeLabel } from "@workspace/vocab";
import { SortableHeader } from "@/components/list-table/sortable-header";
import { FilterChipStrip, type FilterChip } from "@/components/list-table/filter-chip-strip";
import { BulkAssignErrorTypeAction } from "@/components/cohesion/bulk-assign-error-type-action";
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
import { CREATED_DATE_PRESETS } from "@/lib/date-presets";
import {
  PageHeader, FilterStrip, type FilterStripTab,
  StatusStrip, StatusDot, StatusPillForStatus,
  Recommended, ToneButton, CrossPageNudge, TONE_STYLE,
} from "@/components/cohesion";
import { ActionsRail, ActionGroup as RailActionGroup, ActionRow } from "@/components/actions-rail";
import { UrgentTodayBadge } from "@/components/urgent-today-badge";
import {
  LIFECYCLE_TABS,
  deriveLifecycleTab,
  ENGAGEMENT_NEEDED_STATUSES,
  type LifecycleTabKey,
} from "@/lib/lifecycle-phase";
import {
  NeedsEngagementToggle,
  HideExpiredToggle,
  readEngagementMode,
} from "@/components/engagement-filter-controls";

const STATUSES = [
  "New", "Needs Review", "Needs Evidence", "Portal Queued", "Generating Email",
  "Ready to Review", "Awaiting Response", "On Hold", "Resolved", "Denied",
  // Expired is selectable here so an operator who flips on the
  // "Show expired" toggle can also narrow the resulting list to
  // just the retired rows. The backend implicitly opens the gate
  // when the status filter contains Expired (see
  // `buildInvoiceGroupWhere` in routes/invoice-groups.ts).
  "Expired",
] as const;

// `OUTCOMES` is re-exported from @workspace/vocab — the constant must
// keep its enum spelling ("Non-Issue") because it's also a valid filter
// value sent over the wire.

// Tabs come from the shared lifecycle vocabulary so Claims and Invoice
// Groups stay in lockstep when a status is added/renamed.
type GroupsTabKey = LifecycleTabKey;
const GROUP_TABS = LIFECYCLE_TABS;
const deriveActiveTab = deriveLifecycleTab;

const ALL_COLUMNS: ColumnDef[] = [
  { key: "invoiceNumber", label: "Invoice #", hideable: false },
  // Service Date is the earliest ride date in the group — it's what the
  // 30-day filing deadline is measured against, so it sits right next to
  // the invoice number rather than being buried.
  { key: "serviceDate", label: "Service Date" },
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
    if (saved) {
      const set = new Set<string>(JSON.parse(saved));
      // Migration: surface newly added columns for users with a saved layout
      // so they discover them rather than wondering why they don't appear.
      if (!set.has("serviceDate")) set.add("serviceDate");
      return set;
    }
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
  const { get, getAll, set } = useUrlParams();
  const [, navigate] = useLocation();

  // Post-cutover: the per-row leg sub-status breakdown is always
  // rendered next to the ride count when the group is in a state where
  // it's meaningful. The feature-flag gate was removed in Task #199.
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
  const filterExpiringRaw = get("expiring");
  const filterExpiring: "" | "soon" | "urgent" =
    filterExpiringRaw === "soon" || filterExpiringRaw === "urgent" ? filterExpiringRaw : "";
  // "Missing service date" facet (Task #353). The boolean lights the
  // facet up; the optional reason narrows to a specific empty-state
  // branch (no_claims, no_dated_claims, parse_failed, all_dated_legs_excluded).
  const filterMissingServiceDate = get("missingServiceDate") === "true";
  const filterMissingReasonRaw = get("missingServiceDateReason");
  const MISSING_REASONS = ["no_claims", "no_dated_claims", "parse_failed", "all_dated_legs_excluded"] as const;
  type MissingReason = typeof MISSING_REASONS[number];
  const filterMissingReason: MissingReason | "" =
    (MISSING_REASONS as readonly string[]).includes(filterMissingReasonRaw)
      ? (filterMissingReasonRaw as MissingReason)
      : "";

  // `?importBatch=<id>` is the link payload from the Import flow's
  // post-upload right rail ("View invoice groups"). Scopes the list to
  // just the groups the user created in their most recent import so
  // they can see what they just brought in instead of getting dumped
  // into the global list.
  const filterImportBatch = get("importBatch") || "";
  // "Show expired" toggle. Expired groups are hidden by default
  // everywhere; flipping this on adds `?includeExpired=true` to the
  // list query so the retired rows surface alongside the live ones.
  const filterIncludeExpired = get("includeExpired") === "true";
  // "Needs engagement" filter — defaults to `needs`. See claims.tsx for
  // the same pattern: explicit status pick wins; otherwise the
  // engagement-needed set is injected into the API call.
  const engagementMode = readEngagementMode(get("engagement"));

  const activeTab: GroupsTabKey = deriveActiveTab(filterStatuses);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAssignSuccess, setBulkAssignSuccess] = useState("");
  // External "open the picker" trigger from the right-rail action; the
  // BulkAssignErrorTypeAction component is otherwise self-managing.
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(getInitialVisibleCols);
  const [density, setDensity] = useState<Density>(getInitialDensity);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify([...visibleCols]));
  }, [visibleCols]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DENSITY, density);
  }, [density]);

  const effectiveStatuses: readonly string[] =
    filterStatuses.length > 0
      ? filterStatuses
      : engagementMode === "needs"
        ? ENGAGEMENT_NEEDED_STATUSES
        : [];

  const listParams: ListInvoiceGroupsParams = {
    search: search || undefined,
    status: effectiveStatuses.length > 0 ? effectiveStatuses.join(",") : undefined,
    outcome: filterOutcomes.length > 0 ? filterOutcomes.join(",") : undefined,
    errorTypeId: filterErrorTypeIds.length > 0 ? filterErrorTypeIds.join(",") : undefined,
    errorDetails: (filterErrorDetails || undefined) as "empty" | "present" | undefined,
    createdFrom: filterCreatedFrom || undefined,
    createdTo: filterCreatedTo || undefined,
    amountMin: filterAmountMin || undefined,
    amountMax: filterAmountMax || undefined,
    expiring: (filterExpiring || undefined) as ListInvoiceGroupsParams["expiring"],
    missingServiceDate: (filterMissingServiceDate || filterMissingReason ? true : undefined) as ListInvoiceGroupsParams["missingServiceDate"],
    missingServiceDateReason: (filterMissingReason || undefined) as ListInvoiceGroupsParams["missingServiceDateReason"],
    sort: (sortCol || undefined) as typeof ListInvoiceGroupsSort[keyof typeof ListInvoiceGroupsSort] | undefined,
    dir: (sortDir || undefined) as typeof ListInvoiceGroupsDir[keyof typeof ListInvoiceGroupsDir] | undefined,
    importBatch: filterImportBatch || undefined,
    includeExpired: filterIncludeExpired || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const { data, isLoading, isError } = useListInvoiceGroups(listParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(listParams) }
  });

  const { data: errorTypesData } = useListErrorTypes();
  const bulkAssign = useBulkAssignInvoiceGroupErrorType();

  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  // Past-deadline groups are now hidden server-side via the
  // unified `includeExpired=false` guard. The total, page count, and
  // "Showing A–B of N" all match the visible set without any
  // client-side post-fetch filter. Operators opt past-deadline rows
  // back in by toggling Show expired (`?includeExpired=true`) or
  // drilling into a deadline tier with `?expiring=…`.
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


  const handleSort = (key: string, dir: "asc" | "desc" | "") => {
    set({ sort: key || null, dir: dir || null, page: null }, false);
  };

  const handleTabChange = (key: GroupsTabKey) => {
    const tab = GROUP_TABS.find(t => t.key === key);
    if (!tab) return;
    const statusValue = tab.statuses.length > 0 ? tab.statuses.join(",") : null;
    set({ status: statusValue, page: null }, false);
  };

  const clearFilters = () => {
    set({ status: null, outcome: null, errorTypeId: null, errorDetails: null, createdFrom: null, createdTo: null, amountMin: null, amountMax: null, expiring: null, missingServiceDate: null, missingServiceDateReason: null, page: null }, false);
  };

  const hasActiveFilters = filterStatuses.length > 0 || filterOutcomes.length > 0 || filterErrorTypeIds.length > 0 || !!filterErrorDetails || !!filterCreatedFrom || !!filterCreatedTo || !!filterAmountMin || !!filterAmountMax || !!filterExpiring || filterMissingServiceDate || !!filterMissingReason;

  const chips = useMemo((): FilterChip[] => {
    const result: FilterChip[] = [];
    if (filterImportBatch) {
      // Short, friendly label — the full batch ID is a long ULID and
      // dumping it into the chip just creates noise. The user knows
      // they just imported; they need a way to clear, not the raw id.
      result.push({
        key: "importBatch",
        label: "From most recent import",
        onRemove: () => set({ importBatch: null, page: null }, false),
      });
    }
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
    if (filterExpiring) {
      const label = filterExpiring === "urgent" ? "Must file today" : "Expiring soon (≤ 10 days)";
      result.push({ key: "expiring", label, onRemove: () => set({ expiring: null, page: null }, false) });
    }
    if (filterMissingServiceDate || filterMissingReason) {
      const reasonLabel: Record<MissingReason | "", string> = {
        "": "Missing service date",
        no_claims: "Missing service date · No claims attached",
        no_dated_claims: "Missing service date · No dated claims",
        parse_failed: "Missing service date · Couldn't read dates",
        all_dated_legs_excluded: "Missing service date · All dated legs excluded",
      };
      result.push({
        key: "missingServiceDate",
        label: reasonLabel[filterMissingReason],
        onRemove: () => set({ missingServiceDate: null, missingServiceDateReason: null, page: null }, false),
      });
    }
    return result;
  }, [search, filterStatuses, filterOutcomes, filterErrorTypeIds, filterErrorDetails, filterCreatedFrom, filterCreatedTo, filterAmountMin, filterAmountMax, filterExpiring, filterMissingServiceDate, filterMissingReason, errorTypes, activeTab]);

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
    () => OUTCOMES.map(o => ({ id: o, label: outcomeLabel(o) })),
    [],
  );

  const statusCount = filterStatuses.length;
  const outcomeCount = filterOutcomes.length;
  const errorTypeCount = filterErrorTypeIds.length;
  const errorDetailsCount = filterErrorDetails ? 1 : 0;
  const createdDateCount = filterCreatedFrom || filterCreatedTo ? 1 : 0;
  const amountCount = filterAmountMin || filterAmountMax ? 1 : 0;
  const deadlineCount = filterExpiring ? 1 : 0;
  const missingServiceDateCount = (filterMissingServiceDate || filterMissingReason) ? 1 : 0;

  const totalAppliedFilters =
    statusCount + outcomeCount + errorTypeCount + errorDetailsCount +
    createdDateCount + amountCount + deadlineCount + missingServiceDateCount;

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
      id: "errorDetails",
      label: "Error Description",
      icon: FileWarning,
      appliedCount: errorDetailsCount,
      render: () => (
        <FacetCheckboxList
          heading="Error description"
          exclusive
          options={[
            { id: "empty", label: "No description" },
            { id: "present", label: "Has description" },
          ]}
          selected={filterErrorDetails ? [filterErrorDetails] : []}
          onToggle={(id, next) =>
            set({ errorDetails: next ? id : null, page: null }, false)
          }
          testIdPrefix="facet-errorDetails"
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
          hint="Only counts groups with actionable status; weekend deadlines are shifted to Friday."
        />
      ),
    },
    // "Missing service date" facet (Task #353). The first option is a
    // catch-all (`true`) so an operator can sweep up every empty-state
    // group; the per-reason options narrow to a specific branch.
    // Single-select because the sub-reason filter implies the boolean,
    // and stacking two would be confusing in the chip strip.
    {
      id: "missingServiceDate",
      label: "Missing Service Date",
      icon: CalendarOff,
      appliedCount: missingServiceDateCount,
      render: () => (
        <FacetCheckboxList
          heading="Missing service date"
          exclusive
          options={[
            { id: "any", label: "Any reason" },
            { id: "no_claims", label: "No claims attached" },
            { id: "no_dated_claims", label: "No dated claims" },
            { id: "parse_failed", label: "Couldn't read claim dates" },
            { id: "all_dated_legs_excluded", label: "All dated legs excluded" },
          ]}
          selected={
            filterMissingReason
              ? [filterMissingReason]
              : filterMissingServiceDate
                ? ["any"]
                : []
          }
          onToggle={(id, next) => {
            if (!next) {
              set({ missingServiceDate: null, missingServiceDateReason: null, page: null }, false);
              return;
            }
            if (id === "any") {
              set({ missingServiceDate: "true", missingServiceDateReason: null, page: null }, false);
            } else {
              set({ missingServiceDate: "true", missingServiceDateReason: id, page: null }, false);
            }
          }}
          testIdPrefix="facet-missingServiceDate"
          hint="Replaces the bare em-dash with a labeled empty state; pick a reason to drill in."
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
      label: "Total Amount",
      icon: DollarSign,
      appliedCount: amountCount,
      render: () => (
        <FacetNumericRange
          heading="Total amount range"
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
    statusCount, outcomeCount, errorTypeCount, errorDetailsCount,
    createdDateCount, amountCount, deadlineCount, missingServiceDateCount,
    statusOptions, outcomeOptions, errorTypeOptions,
    filterStatuses, filterOutcomes, filterErrorTypeIds, filterErrorDetails,
    filterExpiring,
    filterMissingServiceDate, filterMissingReason,
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
  const csvUrl = getExportInvoiceGroupsCsvUrl(csvParams as Parameters<typeof getExportInvoiceGroupsCsvUrl>[0]);

  const tdPy = density === "compact" ? "py-1.5" : "py-3";

  const tabs: FilterStripTab<GroupsTabKey>[] = GROUP_TABS.map(t => ({
    key: t.key,
    label: t.label,
    count: t.key === activeTab ? total : null,
  }));

  const purpleRowTint = TONE_STYLE.purple.bg;

  const stripDescriptor = (() => {
    if (activeTab === "All") return "All groups";
    return activeTab;
  })();

  return (
    <div className="space-y-4" data-testid="page-invoice-groups">
      <PageHeader
        title="Invoice Groups"
        sub={`${total} ${activeTab === "All" ? "active" : activeTab.toLowerCase()} ${total === 1 ? "group" : "groups"} · the unit you actually file in the MAS portal`}
        accent="purple"
      />

      {bulkAssignSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-center gap-2" data-testid="bulk-assign-success">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-800">{bulkAssignSuccess}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip<GroupsTabKey>
          tabs={tabs}
          active={activeTab}
          onChange={handleTabChange}
          accent="purple"
          ariaLabel="Filter invoice groups by status"
        />
      </div>

      <StatusStrip>
        <StatusDot tone={activeTab === "Action Required" ? "amber" : "blue"} />
        <span className="font-medium text-foreground">{stripDescriptor}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {total.toLocaleString()} matching · {hasActiveFilters || search ? "filters active" : "no filters"}
        </span>
        <Link href="/queue" className="ml-auto text-xs font-medium" style={{ color: TONE_STYLE.purple.fg }}>
          Open Queue →
        </Link>
      </StatusStrip>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4 min-w-0">
          <ListTableHeaderStrip
            searchValue={search}
            onSearchChange={v => set({ q: v || null, page: null }, false)}
            searchPlaceholder="Search by Invoice #, Client, Error..."
            searchTestId="input-search-groups"
            matchingCount={total}
            matchingNoun={{ one: "group", other: "groups" }}
            filterOpen={filterOpen}
            onFilterOpenChange={setFilterOpen}
            filterCategories={filterCategories}
            totalApplied={totalAppliedFilters}
            onClearAllFilters={clearFilters}
            extras={
              <>
                <NeedsEngagementToggle
                  mode={engagementMode}
                  onChange={(next) => set({ engagement: next === "needs" ? null : "all", page: null }, false)}
                  testidPrefix="engagement-toggle-groups"
                />
                <HideExpiredToggle
                  includeExpired={filterIncludeExpired}
                  onChange={(nextIncludeExpired) => set({ includeExpired: nextIncludeExpired ? "true" : null, page: null }, false)}
                  testid="toggle-hide-expired-groups"
                />
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
              onClearAll={() => { set({ q: null, status: null, outcome: null, errorTypeId: null, errorDetails: null, createdFrom: null, createdTo: null, amountMin: null, amountMax: null, expiring: null, missingServiceDate: null, missingServiceDateReason: null, page: null }, false); }}
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
                      {visibleCols.has("serviceDate") && (
                        <th className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-1">
                            <SortableHeader label="Service Date" sortKey="serviceDate" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                            <InfoTooltip content="Earliest ride date in the group. The 30-day filing deadline counts from this date." side="bottom" />
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
                            <Button variant="ghost" size="sm" className="mt-1" onClick={() => window.location.reload()}>Retry</Button>
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
                      <>
                      {groups.map(group => {
                        const isSel = selectedIds.has(group.id);
                        return (
                          <tr
                            key={group.id}
                            className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                            style={isSel ? { background: purpleRowTint } : undefined}
                            data-testid={`row-group-${group.id}`}
                          >
                            <td className={`px-4 ${tdPy}`}>
                              <Checkbox checked={isSel} onCheckedChange={() => handleToggle(group.id)} aria-label={`Select group ${group.invoiceNumber}`} />
                            </td>
                            {visibleCols.has("invoiceNumber") && (
                              <td className={`px-4 ${tdPy} font-medium font-mono text-xs`} style={{ color: TONE_STYLE.purple.fg }}>
                                <div className="flex items-center gap-2">
                                  <UrgentTodayBadge isUrgent={group.isUrgent} submittedStuck={group.submittedStuck} />
                                  <Link href={`/invoice-groups/${group.id}`}>{group.invoiceNumber}</Link>
                                </div>
                              </td>
                            )}
                            {visibleCols.has("serviceDate") && (
                              <td className={`px-4 ${tdPy}`}>
                                <ServiceDateCell
                                  groupId={group.id}
                                  earliestDate={group.earliestDate}
                                  reason={group.serviceDateReason as ServiceDateReason | null | undefined}
                                  isUrgent={group.isUrgent}
                                />
                              </td>
                            )}
                            {visibleCols.has("rideCount") && (
                              <td className={`px-4 ${tdPy}`}>
                                <div className="flex flex-col gap-1">
                                  <Badge variant="secondary" className="text-xs">{group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}</Badge>
                                  {group.legSubStatusCounts &&
                                    (group.status === "New" || group.status === "Needs Evidence") && (
                                    <div className="flex flex-wrap gap-0.5" data-testid={`leg-breakdown-${group.id}`}>
                                      {LEG_SUB_STATUSES.map((s) => {
                                        const counts = group.legSubStatusCounts as Record<string, number> | undefined;
                                        const n = counts?.[s] ?? 0;
                                        if (n === 0) return null;
                                        return (
                                          <span key={s} className="inline-flex items-center gap-0.5">
                                            <LegSubStatusPill subStatus={s as LegSubStatus} className="text-[10px] px-1.5 py-0" />
                                            <span className="text-[10px] tabular-nums text-muted-foreground">{n}</span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </td>
                            )}
                            {visibleCols.has("clientNumber") && (
                              <td className={`px-4 ${tdPy} font-mono text-xs text-muted-foreground`}>{group.clientNumber || '-'}</td>
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
                              <td className={`px-4 ${tdPy} font-medium tabular-nums whitespace-nowrap`}>{formatCurrency(group.totalAmount)}</td>
                            )}
                            {visibleCols.has("status") && (
                              <td className={`px-4 ${tdPy}`}><StatusPillForStatus status={group.status} /></td>
                            )}
                            {visibleCols.has("createdAt") && (
                              <td className={`px-4 ${tdPy} text-muted-foreground whitespace-nowrap`}>{group.createdAt ? formatDate(group.createdAt) : '—'}</td>
                            )}
                            {visibleCols.has("action") && (
                              <td className={`px-4 ${tdPy} text-right`}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Open invoice group actions" data-testid={`button-group-actions-${group.id}`}>
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem asChild>
                                      <Link href={`/invoice-groups/${group.id}`}>View details</Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={(e) => {
                                        e.preventDefault();
                                        window.open(`/invoice-groups/${group.id}`, "_blank", "noopener,noreferrer");
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
                      })}
                      </>
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
            text={<>To work one at a time with full evidence, open</>}
            linkLabel="Queue"
            href="/queue"
            linkTone="blue"
          />
        </div>

        <aside className="xl:col-span-4 space-y-3 xl:sticky xl:top-4 self-start">
          <ActionsRail
            title="What you can do"
            variant="group"
            meta={someSelected ? `${selectedIds.size} selected` : undefined}
          >
            {someSelected ? (
              <BulkAssignErrorTypeAction
                selectedCount={selectedIds.size}
                errorTypes={errorTypes}
                tone="purple"
                entityNoun="group"
                body="Tag every selected group with the same error classification so the bot files them under one rule."
                isPending={bulkAssign.isPending}
                open={showBulkAssign}
                onOpenChange={setShowBulkAssign}
                onApply={async (errorTypeId, errorType) => {
                  const res = await bulkAssign.mutateAsync({
                    data: {
                      groupIds: Array.from(selectedIds),
                      errorTypeId: String(errorType.id),
                      errorTypeName: errorType.name,
                    },
                  });
                  setBulkAssignSuccess(`Updated ${res.updated} group${res.updated !== 1 ? "s" : ""}`);
                  setSelectedIds(new Set());
                  queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
                  setTimeout(() => setBulkAssignSuccess(""), 3000);
                }}
              />
            ) : (
              <Recommended
                tone="purple"
                title="Open Queue to dispute"
                body="Walk through each group in the workflow player — review evidence, generate the email, file in MAS."
                cta={
                  <ToneButton tone="purple" onClick={() => navigate("/queue")} testId="button-rail-open-queue">
                    <Send className="w-4 h-4" /> Open Queue
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
                label="Apply note template…"
                muted
                disabled
                disabledReason="Coming soon."
              />
            </RailActionGroup>

            <RailActionGroup label="Selection">
              {/*
                "Open Queue" intentionally NOT repeated here — the rail's
                Recommended primary button above already routes to /queue.
                Surfacing the same destination twice in one rail (once as
                the headline CTA, once as a row) reads as a duplicate
                affordance, the same anti-pattern we hit on /import.
              */}
              <ActionRow
                icon={<Download className="w-3.5 h-3.5" />}
                label="Export current view (CSV)"
                sub={`${total.toLocaleString()} matching ${total === 1 ? "group" : "groups"}`}
                onClick={() => { window.location.href = csvUrl; }}
                testId="rail-action-export-csv"
              />
              <ActionRow
                icon={<Files className="w-3.5 h-3.5" />}
                label="Open Claims"
                sub="See individual claims, not groups"
                onClick={() => navigate("/claims")}
              />
            </RailActionGroup>
          </ActionsRail>
        </aside>
      </div>
    </div>
  );
}
