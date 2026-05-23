import { useState, useEffect, useMemo } from "react";
import { useListInvoiceGroups, useListErrorTypes, useBulkAssignInvoiceGroupErrorType, useBulkSubmitInvoiceGroupsToPortal, useBulkReattestInvoiceGroups, useBulkCloseInvoiceGroups, useBulkGenerateAndReviewInvoiceGroups, bulkReattestInvoiceGroupsDryRun, listInvoiceGroups, getListInvoiceGroupsQueryKey, getExportInvoiceGroupsCsvUrl, ListInvoiceGroupsSort, ListInvoiceGroupsDir } from "@workspace/api-client-react";
import { BulkEligibilityPreviewDialog, type BulkEligibilityRow, type BulkEligibilitySkippedRow } from "@/components/bulk-eligibility-preview-dialog";
import type { InvoiceGroupResponse, ErrorTypeResponse, ListInvoiceGroupsParams } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/format";
import { useRole } from "@/lib/role";
import { Link, useLocation } from "wouter";
import { Tag, X, Loader2, CheckCircle2, FolderOpen, Download, MoreHorizontal, Send, FileText, Files, Filter, Activity, FileCheck, AlertCircle, FileWarning, Calendar as CalendarIcon, CalendarOff, DollarSign, Clock, RefreshCw, XCircle, Sparkles, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ServiceDateCell, type ServiceDateReason } from "@/components/service-date-cell";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoTooltip } from "@/components/info-tooltip";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { PreSubmitBreakdown } from "@/components/pre-submit-breakdown";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { LEG_SUB_STATUSES, type LegSubStatus } from "@workspace/leg-state";
import { OUTCOMES, outcomeLabel, legSubStatusLabel } from "@workspace/vocab";
import { SortableHeader } from "@/components/list-table/sortable-header";
import { FilterChipStrip, type FilterChip } from "@/components/list-table/filter-chip-strip";
import { BulkAssignErrorTypeAction } from "@/components/cohesion/bulk-assign-error-type-action";
import { useRowBreath } from "@/hooks/use-breath";
import { useRowSettle } from "@/hooks/use-row-settle";
import { ColumnVisibilityMenu, type ColumnDef } from "@/components/list-table/column-visibility-menu";
import { DensityToggle, type Density } from "@/components/list-table/density-toggle";
import { PaginationFooter, type PageSize } from "@/components/list-table/pagination-footer";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
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
import { CREATED_DATE_PRESETS, SERVICE_DATE_PRESETS } from "@/lib/date-presets";
import {
  PageHeader, FilterStrip, type FilterStripTab,
  StatusStrip, StatusDot,
  Recommended, ToneButton, CrossPageNudge, TONE_STYLE,
} from "@/components/cohesion";
import { StateBadge } from "@/components/state-badge";
import { ActionsRail, ActionGroup as RailActionGroup, ActionRow } from "@/components/actions-rail";
import { explainEligibilityReason } from "@/lib/eligibility-reasons";
import { WrapTooltip } from "@/components/info-tooltip";
import { UrgentTodayBadge } from "@/components/urgent-today-badge";
import { RefNumber } from "@/components/ref-number";
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
  // "Show past-deadline" toggle can also narrow the resulting list to
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
  // Phase chip (Task #558). The standalone raw-status column was
  // collapsed into the chip — status is now exposed only via the
  // chip's tooltip. Kept on the same `status` column key so saved
  // visibility layouts and the CSV export (which reads `status`
  // server-side) keep working without a migration.
  { key: "status", label: "Phase" },
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
  const { isClerk: clerk } = useRole();

  // Post-cutover: the per-row leg sub-status breakdown is always
  // rendered next to the ride count when the group is in a state where
  // it's meaningful. The feature-flag gate was removed in Task #199.
  const search = get("q");
  const sortCol = get("sort");
  const sortDir = (get("dir") || "") as "asc" | "desc" | "";
  const page = Math.max(1, parseInt(get("page") || "1", 10));
  const pageSize = (([25, 50, 100, 200].includes(parseInt(get("ps") || "50", 10)) ? parseInt(get("ps") || "50", 10) : 50) as PageSize);

  const filterStatuses = getAll("status");
  // Pre-submit-only sub-filter (Task #558). Read straight from the URL
  // so deep-links work, but the facet UI / chip / listParams entry are
  // all gated on `activeTab === "Action Required"` below — outside the
  // Pre-submit tab the filter is silently ignored on this page.
  const filterLegSubStatuses = getAll("legSubStatus") as LegSubStatus[];
  // Pre-submit-only sub-filter (Task #631 follow-up). `reviewed` →
  // drafts marked reviewed (one click from Submit). `unreviewed` →
  // drafts that still need the operator's sign-off. Empty → no filter.
  const filterDraftReviewedRaw = get("draftReviewed");
  const filterDraftReviewed: "" | "reviewed" | "unreviewed" =
    filterDraftReviewedRaw === "true"
      ? "reviewed"
      : filterDraftReviewedRaw === "false"
        ? "unreviewed"
        : "";
  const filterOutcomes = getAll("outcome");
  const filterErrorTypeIds = getAll("errorTypeId");
  const filterErrorDetails = get("errorDetails") as "" | "empty" | "present";
  const filterCreatedFrom = get("createdFrom");
  const filterCreatedTo = get("createdTo");
  // Task #764 — service date (when the ride happened) range + driver
  // (carNumber) filter. Operators almost always look up invoices by
  // when the ride happened, not when the record landed in the system.
  // Drives the prominent "Date of Service" facet next to Created Date,
  // and the Driver facet that the Insights Repeat Offenders row now
  // links into.
  const filterServiceDateFrom = get("serviceDateFrom");
  const filterServiceDateTo = get("serviceDateTo");
  const filterCarNumber = get("carNumber");
  const filterAmountMin = get("amountMin");
  const filterAmountMax = get("amountMax");
  const filterExpiringRaw = get("expiring");
  const filterExpiring: "" | "soon" | "urgent" =
    filterExpiringRaw === "soon" || filterExpiringRaw === "urgent" ? filterExpiringRaw : "";
  // "Missing service date" facet (Task #353). The boolean lights the
  // facet up; the optional reason narrows to a specific empty-state
  // branch (no_claims, no_dated_claims, parse_failed, all_dated_legs_excluded).
  const filterOutlookRaw = get("outlook");
  const OUTLOOK_VALUES = ["ready_to_review", "reattest_only", "nothing_to_do"] as const;
  type OutlookValue = typeof OUTLOOK_VALUES[number];
  const filterOutlook: OutlookValue | "" =
    (OUTLOOK_VALUES as readonly string[]).includes(filterOutlookRaw)
      ? (filterOutlookRaw as OutlookValue)
      : "";

  const filterMissingServiceDate = get("missingServiceDate") === "true";
  const filterMissingReasonRaw = get("missingServiceDateReason");
  const MISSING_REASONS = ["no_claims", "no_dated_claims", "parse_failed", "all_dated_legs_excluded"] as const;
  type MissingReason = typeof MISSING_REASONS[number];
  const filterMissingReason: MissingReason | "" =
    (MISSING_REASONS as readonly string[]).includes(filterMissingReasonRaw)
      ? (filterMissingReasonRaw as MissingReason)
      : "";

  // "Ready to generate" filter (Task #641). When active, the listing
  // shows only groups whose legs are all packageable but whose AI
  // writeup hasn't been generated or marked reviewed yet.
  const filterReadyToGenerate = get("readyToGenerate") === "true";

  // `?importBatch=<id>` is the link payload from the Import flow's
  // post-upload right rail ("View invoice groups"). Scopes the list to
  // just the groups the user created in their most recent import so
  // they can see what they just brought in instead of getting dumped
  // into the global list.
  const filterImportBatch = get("importBatch") || "";
  // "Show past-deadline" toggle. Past-deadline groups (Expired-status
  // and any group whose effective deadline has slipped) are hidden by
  // default everywhere; flipping this on adds `?includeExpired=true` to the
  // list query so the retired rows surface alongside the live ones.
  const filterIncludeExpired = get("includeExpired") === "true";
  // "Needs engagement" filter — defaults to `needs`. See claims.tsx for
  // the same pattern: explicit status pick wins; otherwise the
  // engagement-needed set is injected into the API call.
  const engagementMode = readEngagementMode(get("engagement"));

  const activeTab: GroupsTabKey = deriveActiveTab(filterStatuses);
  // Pre-submit phase is the only tab that should expose the per-leg
  // sub-status sub-filter (Task #558). Outside this tab the facet
  // category, the chip, and the wire param are all suppressed so
  // operators in In Flight / Closed / etc. see the same lean filter
  // strip they always have.
  const isPreSubmitTab = activeTab === "Action Required";
  const effectiveLegSubStatuses: LegSubStatus[] = isPreSubmitTab
    ? filterLegSubStatuses
    : [];
  // Same Pre-submit gate as `legSubStatus` — outside the Action Required
  // tab the draft-reviewed facet/chip/wire param are all suppressed
  // (Task #631 follow-up).
  const effectiveDraftReviewed = isPreSubmitTab ? filterDraftReviewed : "";

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Task #502 — feed `useRowSettle` so a row that leaves the list
  // because of a status change (closed / withdrawn / resolved on the
  // detail page, then back to the list) doesn't vanish instantly.
  // We track the last group whose detail page the operator opened from
  // this list; sessionStorage carries that across the back-navigation
  // refetch so the settle ghost still has a "previously selected" id
  // to settle.
  const [lastTouchedId, setLastTouchedId] = useState<number | null>(() => {
    try {
      const v = sessionStorage.getItem("ig_last_touched");
      if (!v) return null;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (lastTouchedId == null) sessionStorage.removeItem("ig_last_touched");
      else sessionStorage.setItem("ig_last_touched", String(lastTouchedId));
    } catch {}
  }, [lastTouchedId]);
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
    serviceDateFrom: filterServiceDateFrom || undefined,
    serviceDateTo: filterServiceDateTo || undefined,
    carNumber: filterCarNumber || undefined,
    amountMin: filterAmountMin || undefined,
    amountMax: filterAmountMax || undefined,
    expiring: (filterExpiring || undefined) as ListInvoiceGroupsParams["expiring"],
    missingServiceDate: (filterMissingServiceDate || filterMissingReason ? true : undefined) as ListInvoiceGroupsParams["missingServiceDate"],
    missingServiceDateReason: (filterMissingReason || undefined) as ListInvoiceGroupsParams["missingServiceDateReason"],
    legSubStatus: effectiveLegSubStatuses.length > 0 ? effectiveLegSubStatuses.join(",") : undefined,
    draftReviewed: (effectiveDraftReviewed === "reviewed"
      ? true
      : effectiveDraftReviewed === "unreviewed"
        ? false
        : undefined) as ListInvoiceGroupsParams["draftReviewed"],
    readyToGenerate: filterReadyToGenerate || undefined,
    outlook: (isPreSubmitTab && filterOutlook ? filterOutlook : undefined) as ListInvoiceGroupsParams["outlook"],
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
  // Task #631 follow-up — bulk-queue reviewed drafts for portal
  // submission. Toast (`bulkPortalMsg`) mirrors the bulk-assign success
  // banner so the operator sees the queued / skipped breakdown.
  const bulkSubmitToPortal = useBulkSubmitInvoiceGroupsToPortal();
  const bulkReattest = useBulkReattestInvoiceGroups();
  const bulkClose = useBulkCloseInvoiceGroups();
  // Task #840 — confirm-dialog state for bulk-reattest. We pop the
  // dialog from the rail's Re-attest button after running the
  // server-side dry-run, so the operator sees the actual eligible vs
  // skipped breakdown (with reasons) before committing. On confirm we
  // send only the dry-run eligible ids back to /bulk-reattest, so the
  // preview count matches the run's success count.
  const [bulkReattestDialogOpen, setBulkReattestDialogOpen] = useState(false);
  const [bulkReattestPreview, setBulkReattestPreview] = useState<{
    eligible: BulkEligibilityRow[];
    skipped: BulkEligibilitySkippedRow[];
  }>({ eligible: [], skipped: [] });
  const [bulkReattestPreviewLoading, setBulkReattestPreviewLoading] = useState(false);
  const bulkGenerateAndReview = useBulkGenerateAndReviewInvoiceGroups();
  const [bulkPortalMsg, setBulkPortalMsg] = useState("");
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  type BulkGenResult = { id: number; refNumber: string | null; status: "generated" | "skipped" | "failed"; reason?: string };
  const [bulkGenResults, setBulkGenResults] = useState<BulkGenResult[] | null>(null);
  const [bulkGenProcessing, setBulkGenProcessing] = useState(false);
  // Bulk-action shimmer (Task #494): pulse the affected group rows
  // together after a successful bulk assign so the change reads as
  // one confirmed sweep across the table.
  const rowBreath = useRowBreath<number>();

  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  // Past-deadline groups are now hidden server-side via the
  // unified `includeExpired=false` guard. The total, page count, and
  // "Showing A–B of N" all match the visible set without any
  // client-side post-fetch filter. Operators opt past-deadline rows
  // back in by toggling Show past-deadline (`?includeExpired=true`) or
  // drilling into a deadline tier with `?expiring=…`.
  const groups: InvoiceGroupResponse[] = data?.groups ?? [];
  const total = data?.total ?? 0;

  // Task #502 — same settle pattern as Queue / Responses / Attestation.
  // When the previously-touched row leaves the list (status changed it
  // out of view), it holds its slot for ~360ms while the success-tint
  // settle plays, then unmounts. There's no auto-advance on this list
  // (selection is for bulk only), so the highlight ring just no-ops
  // unless future work introduces a single-row selection.
  const settle = useRowSettle(groups, (g) => g.id, lastTouchedId);

  const allSelected = groups.length > 0 && groups.every(g => selectedIds.has(g.id));
  const someSelected = selectedIds.size > 0;

  // Task #702 — per-row eligibility for the 5 bulk actions on the rail.
  // The list endpoint returns an `eligibility` object on every row;
  // we slice it three ways so the rail can label, gate, and recover.
  type BulkActionKey = "submitToPortal" | "generateAndReview" | "reattest" | "close";
  const BULK_ACTIONS: readonly BulkActionKey[] = [
    "submitToPortal",
    "generateAndReview",
    "reattest",
    "close",
  ] as const;

  const eligibilityById = useMemo(() => {
    const m = new Map<number, InvoiceGroupResponse["eligibility"]>();
    for (const g of groups) m.set(g.id, g.eligibility);
    return m;
  }, [groups]);

  // IDs visible on the current page that are eligible for each action.
  // Powers the "Select all eligible for X" sub-row.
  const eligibleVisibleIdsByAction = useMemo(() => {
    const m: Record<BulkActionKey, number[]> = {
      submitToPortal: [],
      generateAndReview: [],
      reattest: [],
      close: [],
    };
    for (const g of groups) {
      const e = g.eligibility;
      for (const k of BULK_ACTIONS) {
        // Defensive fallback (Task #702): if a stale/cached payload
        // omits `eligibility`, optimistically treat the row as
        // eligible for every action and let the server have the final
        // word in the bulk endpoint's `skipped[]`. The opposite
        // (treating it as ineligible) would silently disable the
        // entire rail when the field happens to be missing.
        if (!e || e[k]?.eligible) m[k].push(g.id);
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  // Among the operator's current selection, the eligible-id subset for
  // each action. Drives the "X of Y" label and is the actual list of
  // ids we POST to the bulk endpoint (we never send ineligibles).
  const eligibleSelectedIdsByAction = useMemo(() => {
    const m: Record<BulkActionKey, number[]> = {
      submitToPortal: [],
      generateAndReview: [],
      reattest: [],
      close: [],
    };
    for (const id of selectedIds) {
      const e = eligibilityById.get(id);
      for (const k of BULK_ACTIONS) {
        // Same defensive fallback as `eligibleVisibleIdsByAction`: a
        // missing eligibility object means we let the row through and
        // rely on the server to skip it if needed.
        if (!e || e[k]?.eligible) m[k].push(id);
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, eligibilityById]);

  // For per-row "ineligible" muting + tooltip — return a list of
  // (action, plain-English reason) pairs for any selected row that
  // would be skipped by at least one bulk action. applyErrorType is
  // intentionally excluded: it's universally eligible, so listing it
  // would always read as "Tour-sample groups can't…" on demo data only.
  const ineligibleReasonsForRow = (id: number): { action: BulkActionKey; reason: string }[] => {
    const e = eligibilityById.get(id);
    if (!e) return [];
    const out: { action: BulkActionKey; reason: string }[] = [];
    for (const k of BULK_ACTIONS) {
      if (!e[k]?.eligible) {
        out.push({ action: k, reason: explainEligibilityReason(e[k]?.reason) });
      }
    }
    return out;
  };

  const ACTION_NOUN: Record<BulkActionKey, string> = {
    submitToPortal: "portal submission",
    generateAndReview: "generate & review",
    reattest: "re-attest",
    close: "close",
  };

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
    // Drop the leg-sub-status filter when leaving the Pre-submit tab
    // (Task #558) — the facet only makes sense pre-submit and a stale
    // chip in the URL would silently filter to nothing on the wire.
    const nextLegSub = key === "Action Required" ? get("legSubStatus") : null;
    const nextDraftReviewed = key === "Action Required" ? get("draftReviewed") : null;
    const nextOutlook = key === "Action Required" ? get("outlook") : null;
    set({ status: statusValue, legSubStatus: nextLegSub, draftReviewed: nextDraftReviewed, outlook: nextOutlook, page: null }, false);
  };

  const clearFilters = () => {
    set({ status: null, outcome: null, errorTypeId: null, errorDetails: null, createdFrom: null, createdTo: null, serviceDateFrom: null, serviceDateTo: null, carNumber: null, amountMin: null, amountMax: null, expiring: null, missingServiceDate: null, missingServiceDateReason: null, legSubStatus: null, draftReviewed: null, outlook: null, readyToGenerate: null, page: null }, false);
    setSelectAllMatching(false);
  };

  const hasActiveFilters = filterStatuses.length > 0 || filterOutcomes.length > 0 || filterErrorTypeIds.length > 0 || !!filterErrorDetails || !!filterCreatedFrom || !!filterCreatedTo || !!filterServiceDateFrom || !!filterServiceDateTo || !!filterCarNumber || !!filterAmountMin || !!filterAmountMax || !!filterExpiring || filterMissingServiceDate || !!filterMissingReason || effectiveLegSubStatuses.length > 0 || !!effectiveDraftReviewed || !!filterOutlook || filterReadyToGenerate;

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
    if (effectiveLegSubStatuses.length > 0) {
      result.push({
        key: "legSubStatus",
        label: `Leg state: ${effectiveLegSubStatuses.map(legSubStatusLabel).join(", ")}`,
        onRemove: () => set({ legSubStatus: null, page: null }, false),
      });
    }
    if (effectiveDraftReviewed) {
      result.push({
        key: "draftReviewed",
        label:
          effectiveDraftReviewed === "reviewed"
            ? "Draft: reviewed (one click to queue)"
            : "Draft: not yet reviewed",
        onRemove: () => set({ draftReviewed: null, page: null }, false),
      });
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
    if (filterServiceDateFrom || filterServiceDateTo) {
      const label = filterServiceDateFrom && filterServiceDateTo
        ? `Service date: ${filterServiceDateFrom} – ${filterServiceDateTo}`
        : filterServiceDateFrom
          ? `Service date ≥ ${filterServiceDateFrom}`
          : `Service date ≤ ${filterServiceDateTo}`;
      result.push({ key: "serviceDate", label, onRemove: () => set({ serviceDateFrom: null, serviceDateTo: null, page: null }, false) });
    }
    if (filterCarNumber) {
      // Task #766 — facet now accepts multiple car numbers. Re-split
      // the raw value so the chip reads as a comma+space list
      // ("Driver: 45, 67, 92") regardless of how the operator typed it,
      // and a single Clear wipes the whole list.
      const cars = filterCarNumber.split(",").map(c => c.trim()).filter(Boolean);
      result.push({
        key: "carNumber",
        label: `Driver: ${cars.join(", ")}`,
        onRemove: () => set({ carNumber: null, page: null }, false),
      });
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
    if (filterOutlook) {
      const outlookLabel: Record<OutlookValue, string> = {
        ready_to_review: "Outlook: Ready to review",
        reattest_only: "Outlook: Needs re-attestation",
        nothing_to_do: "Outlook: Ready to close",
      };
      result.push({
        key: "outlook",
        label: outlookLabel[filterOutlook],
        onRemove: () => set({ outlook: null, page: null }, false),
      });
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
    if (filterReadyToGenerate) {
      result.push({
        key: "readyToGenerate",
        label: "Ready to generate",
        onRemove: () => set({ readyToGenerate: null, page: null }, false),
      });
    }
    return result;
  }, [search, filterStatuses, filterOutcomes, filterErrorTypeIds, filterErrorDetails, filterCreatedFrom, filterCreatedTo, filterServiceDateFrom, filterServiceDateTo, filterCarNumber, filterAmountMin, filterAmountMax, filterExpiring, filterMissingServiceDate, filterMissingReason, filterOutlook, errorTypes, activeTab, effectiveLegSubStatuses, effectiveDraftReviewed, filterImportBatch, filterReadyToGenerate, set]);

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
  const serviceDateCount = filterServiceDateFrom || filterServiceDateTo ? 1 : 0;
  const carNumberCount = filterCarNumber ? 1 : 0;
  const amountCount = filterAmountMin || filterAmountMax ? 1 : 0;
  const deadlineCount = filterExpiring ? 1 : 0;
  const missingServiceDateCount = (filterMissingServiceDate || filterMissingReason) ? 1 : 0;
  const legSubStatusCount = effectiveLegSubStatuses.length;
  const draftReviewedCount = effectiveDraftReviewed ? 1 : 0;
  const outlookCount = filterOutlook ? 1 : 0;

  const totalAppliedFilters =
    statusCount + outcomeCount + errorTypeCount + errorDetailsCount +
    createdDateCount + serviceDateCount + carNumberCount +
    amountCount + deadlineCount + missingServiceDateCount +
    legSubStatusCount + draftReviewedCount + outlookCount;

  const legSubStatusOptions: FacetOption[] = useMemo(
    () => LEG_SUB_STATUSES.map((s) => ({ id: s, label: legSubStatusLabel(s) })),
    [],
  );

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
    // Per-leg sub-status sub-filter — only surfaced inside the
    // Pre-submit (Action Required) tab (Task #558). The post-submit
    // tabs collapse the per-leg detail behind the group-level chip,
    // so a top-level facet there would be noise.
    ...(isPreSubmitTab ? [{
      id: "legSubStatus",
      label: "Leg state",
      icon: Activity,
      appliedCount: legSubStatusCount,
      render: () => (
        <FacetCheckboxList
          heading="Leg sub-status"
          options={legSubStatusOptions}
          selected={effectiveLegSubStatuses}
          onToggle={(id, next) =>
            setMultiParam(
              "legSubStatus",
              toggleMulti(effectiveLegSubStatuses, id, next),
            )
          }
          testIdPrefix="facet-legSubStatus"
          hint="Pre-submit only — narrow to groups containing legs in the picked stages."
        />
      ),
    } satisfies FacetedFilterCategory] : []),
    // Draft-reviewed sub-filter (Task #631 follow-up). Same Pre-submit
    // gate as Leg state — outside Action Required the facet, chip, and
    // wire param are all suppressed. Single-select because the two
    // states are mutually exclusive (a draft is either reviewed or not).
    ...(isPreSubmitTab ? [{
      id: "draftReviewed",
      label: "Draft review",
      icon: FileCheck,
      appliedCount: draftReviewedCount,
      render: () => (
        <FacetCheckboxList
          heading="Dispute draft"
          exclusive
          options={[
            { id: "reviewed", label: "Reviewed (one click to queue)" },
            { id: "unreviewed", label: "Not yet reviewed" },
          ]}
          selected={effectiveDraftReviewed ? [effectiveDraftReviewed] : []}
          onToggle={(id, next) =>
            set(
              {
                draftReviewed: next
                  ? id === "reviewed"
                    ? "true"
                    : "false"
                  : null,
                page: null,
              },
              false,
            )
          }
          testIdPrefix="facet-draftReviewed"
          hint="Pre-submit only — find drafts the operator has signed off on so you can bulk-queue them for portal submission."
        />
      ),
    } satisfies FacetedFilterCategory] : []),
    ...(isPreSubmitTab ? [{
      id: "outlook",
      label: "Outlook",
      icon: Activity,
      appliedCount: outlookCount,
      render: () => (
        <FacetCheckboxList
          heading="Dispute outlook"
          exclusive
          options={[
            { id: "ready_to_review", label: "Ready to review (has disputable legs, all resolved)" },
            { id: "reattest_only", label: "Needs re-attestation (no disputable, has survivors)" },
            { id: "nothing_to_do", label: "Ready to close (no disputable, no survivors)" },
          ]}
          selected={filterOutlook ? [filterOutlook] : []}
          onToggle={(id, next) =>
            set({ outlook: next ? id : null, page: null }, false)
          }
          testIdPrefix="facet-outlook"
          hint="Pre-submit only — categorise groups by what action they need next."
        />
      ),
    } satisfies FacetedFilterCategory] : []),
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
    // Task #764 — Date of Service. Listed BEFORE Created Date because
    // operators almost always look up invoices by when the ride
    // happened, not when the record landed in the system. Mirrors the
    // same date-range component / preset pattern as Created Date so
    // both feel equally first-class in the filter rail.
    {
      id: "serviceDate",
      label: "Date of Service",
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
    // Task #764 — Driver / car number text input. We treat carNumber
    // as the driver identifier (matching how Insights' Repeat
    // Offenders section already works).
    // Task #766 — accepts a comma-separated list of car numbers so
    // operators investigating a cluster of repeat offenders can scope
    // the list to several drivers at once. The wire format passes the
    // raw string through; the API splits and turns it into an IN
    // clause inside the EXISTS subquery.
    {
      id: "carNumber",
      label: "Driver",
      icon: Truck,
      appliedCount: carNumberCount,
      render: () => (
        <div className="p-3 space-y-2" data-testid="facet-carNumber">
          <div className="text-xs font-semibold text-muted-foreground uppercase">Driver / car #</div>
          <Input
            type="text"
            value={filterCarNumber || ""}
            onChange={e => {
              // Preserve the operator's in-progress typing (including
              // trailing spaces around commas) — only outer whitespace
              // is trimmed. The chip and API both re-split on commas,
              // so "45, 67, 92" and "45,67,92" behave identically.
              // If the value is just delimiters / whitespace (e.g. ","
              // or " , "), normalize to null so we don't render a
              // blank "Driver:" chip that doesn't actually filter
              // anything server-side.
              const raw = e.target.value.replace(/^\s+|\s+$/g, "");
              const hasToken = raw.split(",").some(c => c.trim().length > 0);
              set({ carNumber: hasToken ? raw : null, page: null }, false);
            }}
            placeholder="e.g. 45, 67, 92"
            data-testid="facet-carNumber-input"
            className="h-8"
          />
          <p className="text-[11px] text-muted-foreground">
            Narrow to invoices that include at least one ride with any of these car numbers. Separate multiple drivers with commas.
          </p>
        </div>
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
    // Amount facet is hidden for clerks — they cannot see money on rows
    // and the server strips amountMin/amountMax from their queries.
    ...(clerk ? [] : [{
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
    }]),
  ], [
    clerk,
    statusCount, outcomeCount, errorTypeCount, errorDetailsCount,
    createdDateCount, serviceDateCount, carNumberCount,
    amountCount, deadlineCount, missingServiceDateCount,
    legSubStatusCount, draftReviewedCount, outlookCount,
    statusOptions, outcomeOptions, errorTypeOptions, legSubStatusOptions,
    filterStatuses, filterOutcomes, filterErrorTypeIds, filterErrorDetails,
    filterExpiring, filterOutlook,
    filterMissingServiceDate, filterMissingReason,
    filterCreatedFrom, filterCreatedTo,
    filterServiceDateFrom, filterServiceDateTo, filterCarNumber,
    filterAmountMin, filterAmountMax,
    isPreSubmitTab, effectiveLegSubStatuses, effectiveDraftReviewed,
    set,
  ]);

  const visibleColumnKeys = ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(c => c.key);

  const colCount = visibleColumnKeys.length + (clerk ? 0 : 1);

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
        actions={
          !clerk ? (
            <Button asChild size="sm" variant="outline" data-testid="button-new-invoice">
              <Link href="/invoices/new">
                <FileText className="h-3.5 w-3.5 mr-1.5" />
                New invoice
              </Link>
            </Button>
          ) : undefined
        }
      />

      {bulkAssignSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-center gap-2" data-testid="bulk-assign-success">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-800">{bulkAssignSuccess}</span>
        </div>
      )}

      {bulkPortalMsg && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-center gap-2" data-testid="bulk-portal-success">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-800">{bulkPortalMsg}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3" data-tour="invoice-groups-tabs">
        <FilterStrip
          tabs={tabs}
          active={activeTab}
          onChange={handleTabChange as (k: string) => void}
          accent="purple"
          ariaLabel="Filter invoice groups by status"
        />
        {isPreSubmitTab && !clerk && (
          <Button
            variant={filterReadyToGenerate ? "default" : "outline"}
            size="sm"
            onClick={() =>
              set(
                { readyToGenerate: filterReadyToGenerate ? null : "true", page: null },
                false,
              )
            }
            data-testid="filter-ready-to-generate"
            className="gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ready to generate
            {filterReadyToGenerate && total > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {total}
              </Badge>
            )}
          </Button>
        )}
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
          {/* `dataTour` is forwarded onto the inner search/filter strip
              `<div>` only — see ListTableHeaderStrip — so the tour
              tooltip lands directly under the filter row instead of
              below the entire 1000-row table. We deliberately do NOT
              wrap the strip in another div with the same data-tour, or
              the anchor expands back out to include the table. */}
          <ListTableHeaderStrip
            dataTour="invoice-groups-filters"
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
                {!clerk && (
                  <Button asChild variant="outline" size="sm" data-testid="button-export-csv">
                    <a href={csvUrl} download>
                      <Download className="mr-2 h-4 w-4" />
                      Export CSV
                    </a>
                  </Button>
                )}
              </>
            }
          >
          <Card data-tour="invoice-groups-table">
            <FilterChipStrip
              chips={chips}
              onClearAll={() => { set({ q: null, status: null, outcome: null, errorTypeId: null, errorDetails: null, createdFrom: null, createdTo: null, amountMin: null, amountMax: null, expiring: null, missingServiceDate: null, missingServiceDateReason: null, readyToGenerate: null, page: null }, false); }}
            />

            {filterReadyToGenerate && !clerk && allSelected && !selectAllMatching && total > groups.length && (
              <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm text-blue-800 flex items-center gap-2" data-testid="select-all-matching-banner">
                <span>All {groups.length} groups on this page are selected.</span>
                <button
                  className="font-medium underline hover:text-blue-900"
                  onClick={() => setSelectAllMatching(true)}
                >
                  Select all {total} matching groups
                </button>
              </div>
            )}
            {filterReadyToGenerate && selectAllMatching && (
              <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm text-blue-800 flex items-center gap-2" data-testid="all-matching-selected-banner">
                <span>All {total} groups matching this filter are selected.</span>
                <button
                  className="font-medium underline hover:text-blue-900"
                  onClick={() => { setSelectAllMatching(false); setSelectedIds(new Set(groups.map(g => g.id))); }}
                >
                  Clear selection
                </button>
              </div>
            )}

            {bulkGenResults && (
              <div className="border-b border-muted bg-muted/30 px-4 py-3 space-y-2" data-testid="bulk-gen-results-panel">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {bulkGenProcessing ? "Generating writeups…" : "Bulk generation results"}
                  </span>
                  {!bulkGenProcessing && (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                      onClick={() => setBulkGenResults(null)}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
                <div className="max-h-48 overflow-auto space-y-1">
                  {bulkGenResults.map((r) => (
                    <div key={r.id} className={`text-xs flex items-center gap-2 px-2 py-1 rounded ${
                      r.status === "generated" ? "bg-green-50 text-green-800" :
                      r.status === "skipped" ? "bg-amber-50 text-amber-800" :
                      "bg-red-50 text-red-800"
                    }`}>
                      {r.status === "generated" ? <CheckCircle2 className="h-3 w-3 shrink-0" /> :
                       r.status === "skipped" ? <AlertCircle className="h-3 w-3 shrink-0" /> :
                       <XCircle className="h-3 w-3 shrink-0" />}
                      <span className="font-medium">{r.refNumber || `#${r.id}`}</span>
                      <span className="text-muted-foreground">—</span>
                      <span>{r.status === "generated" ? "Generated & marked for approval" : r.reason || r.status}</span>
                    </div>
                  ))}
                </div>
                {bulkGenProcessing && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{bulkGenResults.length} processed so far…</span>
                  </div>
                )}
              </div>
            )}

            <CardContent className="p-0">
              <SkeletonSwap
                loading={isLoading}
                skeleton={
                  <div className="p-4 space-y-2" data-testid="invoice-groups-table-skeleton">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                }
              >
              <div className="overflow-auto max-h-[calc(100vh-22rem)]">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b sticky top-0 z-10">
                    <tr>
                      {!clerk && (
                        <th className="px-4 py-3 w-10">
                          <Checkbox checked={allSelected} onCheckedChange={handleSelectAll} aria-label="Select all" />
                        </th>
                      )}
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
                      {!clerk && visibleCols.has("totalAmount") && (
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
                            {/* Task #558 — column collapsed into the
                                phase chip. Sort by underlying status
                                is preserved so a stale ?sort=status URL
                                still does the right thing; the header
                                label reads "Phase" because that's what
                                the cell now renders. */}
                            <SortableHeader label="Phase" sortKey="status" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                            <InfoTooltip content="Lifecycle phase of the invoice group. Hover the chip in each row to see the underlying workflow status." side="bottom" />
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
                    {isError ? (
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
                            (() => {
                              // Task #764 — synthesize a contextual empty-state
                              // title from the driver (carNumber) and the two
                              // date ranges currently in play. The Insights
                              // Repeat Offenders click-through lands here with
                              // `?carNumber=…`, and it's confusing to see a
                              // generic "no groups match your filters" when
                              // you came from a specific driver row. We
                              // prioritize driver + service-date because those
                              // are the new facets and the most common Insights
                              // entry path; created-date falls back behind.
                              const fmtRange = (from: string, to: string) =>
                                from && to ? `between ${from} and ${to}` : from ? `on or after ${from}` : `on or before ${to}`;
                              const parts: string[] = [];
                              if (filterCarNumber) parts.push(`driver ${filterCarNumber}`);
                              if (filterServiceDateFrom || filterServiceDateTo) {
                                parts.push(`service date ${fmtRange(filterServiceDateFrom, filterServiceDateTo)}`);
                              } else if (filterCreatedFrom || filterCreatedTo) {
                                parts.push(`created ${fmtRange(filterCreatedFrom, filterCreatedTo)}`);
                              }
                              const contextualTitle = parts.length > 0
                                ? `No invoices for ${parts.join(" • ")}`
                                : "No invoice groups match your filters";
                              const contextualDescription = parts.length > 0
                                ? "Try widening the date range, clearing the driver, or removing other filters."
                                : "Try removing a filter or adjusting your search to see more results.";
                              return (
                                <EmptyState
                                  icon={Filter}
                                  title={contextualTitle}
                                  description={contextualDescription}
                                  primaryAction={{ label: "Clear filters", onClick: () => { clearFilters(); set({ q: null }, false); } }}
                                />
                              );
                            })()
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
                      {settle.slots.map(slot => {
                        const group = slot.item;
                        const isSettling = slot.isSettling;
                        const isJustSelected = settle.isJustSelected(group.id);
                        const isSel = selectedIds.has(group.id);
                        // Task #702 — when a selected row is ineligible
                        // for one or more bulk actions, dim it and
                        // surface a tooltip listing the per-action
                        // reason so the operator knows up front why the
                        // rail's "X of Y" count fell short of Y.
                        const ineligReasons = isSel ? ineligibleReasonsForRow(group.id) : [];
                        const isIneligibleSelected = ineligReasons.length > 0;
                        const ineligTooltip = isIneligibleSelected
                          ? ineligReasons
                              .map((r) => `${ACTION_NOUN[r.action]}: ${r.reason}`)
                              .join("\n")
                          : "";
                        return (
                          <tr
                            key={group.id}
                            className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${rowBreath.rowClassName(group.id)} ${isSettling ? "cc-row-settling" : ""} ${isJustSelected ? "cc-row-just-selected" : ""} ${isIneligibleSelected ? "opacity-70" : ""}`}
                            style={isSel ? { background: purpleRowTint } : undefined}
                            data-testid={`row-group-${group.id}`}
                            data-settling={isSettling ? "true" : undefined}
                            data-ineligible-selected={isIneligibleSelected ? "true" : undefined}
                          >
                            {!clerk && (
                              <td className={`px-4 ${tdPy}`}>
                                {isIneligibleSelected ? (
                                  <WrapTooltip content={ineligTooltip}>
                                    <span className="inline-flex">
                                      <Checkbox checked={isSel} onCheckedChange={() => handleToggle(group.id)} aria-label={`Select group ${group.invoiceNumber} (ineligible for some bulk actions)`} disabled={isSettling} />
                                    </span>
                                  </WrapTooltip>
                                ) : (
                                  <Checkbox checked={isSel} onCheckedChange={() => handleToggle(group.id)} aria-label={`Select group ${group.invoiceNumber}`} disabled={isSettling} />
                                )}
                              </td>
                            )}
                            {visibleCols.has("invoiceNumber") && (
                              <td className={`px-4 ${tdPy} font-medium font-mono text-xs`} style={{ color: TONE_STYLE.purple.fg }}>
                                <div className="flex items-center gap-2">
                                  <UrgentTodayBadge isUrgent={group.isUrgent} submittedStuck={group.submittedStuck} />
                                  <Link
                                    href={`/invoice-groups/${group.id}`}
                                    className="hover:underline"
                                    onClick={() => setLastTouchedId(group.id)}
                                  >
                                    <RefNumber value={group.invoiceNumber} variant="inline" />
                                  </Link>
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
                                  {/* Task #558 — shared Pre-submit
                                      breakdown atom. Hidden outside
                                      the Pre-submit phase by the
                                      component itself. */}
                                  <PreSubmitBreakdown group={group} />
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
                            {!clerk && visibleCols.has("totalAmount") && (
                              <td className={`px-4 ${tdPy} font-medium tabular-nums whitespace-nowrap`}>{formatCurrency(group.totalAmount)}</td>
                            )}
                            {visibleCols.has("status") && (
                              <td className={`px-4 ${tdPy}`}>
                                <StateBadge
                                  variant="phase"
                                  value={group.phase}
                                  tooltipExtra={`Status: ${group.status}`}
                                />
                              </td>
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
                                      <Link
                                        href={`/invoice-groups/${group.id}`}
                                        onClick={() => setLastTouchedId(group.id)}
                                      >
                                        View details
                                      </Link>
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
              </SkeletonSwap>
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
            meta={!clerk && someSelected ? `${selectedIds.size} selected` : undefined}
          >
            {!clerk && someSelected ? (
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
                  // Task #411 audit, Tier 4: surface the per-row
                  // breakdown so "Updated 5 groups" no longer hides the
                  // case where some selected ids didn't actually change
                  // (e.g. group was deleted out from under the
                  // selection).
                  const updated = res.updated ?? 0;
                  const skipped = Array.isArray(res.skipped) ? res.skipped : [];
                  let msg = `Updated ${updated} group${updated !== 1 ? "s" : ""}`;
                  if (skipped.length > 0) {
                    const sample = skipped.slice(0, 3).map((s) => s.refNumber || `#${s.id}`).join(", ");
                    const more = skipped.length > 3 ? ` +${skipped.length - 3} more` : "";
                    msg += ` · skipped ${skipped.length} (${sample}${more})`;
                  }
                  setBulkAssignSuccess(msg);
                  // Pulse the affected group rows together so the
                  // bulk assign reads as one confirmed sweep — skipped
                  // ids are filtered out of the shimmer set.
                  const skippedIdSet = new Set(skipped.map((s) => s.id));
                  rowBreath.triggerForIds(
                    Array.from(selectedIds).filter((id) => !skippedIdSet.has(id)),
                  );
                  setSelectedIds(new Set());
                  queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
                  setTimeout(() => setBulkAssignSuccess(""), skipped.length > 0 ? 6000 : 3000);
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

            {!clerk && (
            <RailActionGroup label="On selection">
              <ActionRow
                icon={<Tag className="w-3.5 h-3.5" />}
                label={`Apply error type to ${selectedIds.size || ""}…`.replace(" …", "…")}
                disabled={!someSelected}
                disabledReason={!someSelected ? "Select one or more rows first." : undefined}
                onClick={() => setShowBulkAssign(true)}
                testId="rail-action-apply-error-type"
              />
              {/*
                Task #631 follow-up — bulk-queue every selected
                reviewed-draft group for portal submission. Server-side
                validates each row independently (error type set, draft
                non-empty, legs resolved, status pre-submit, draft
                reviewed) and reports per-row reasons in `skipped[]`,
                so the operator just selects rows and clicks. The
                "Draft reviewed" facet above is the natural way to
                line up a clean selection first.
              */}
              {(() => {
                const eligibleIds = eligibleSelectedIdsByAction.submitToPortal;
                const eligVisible = eligibleVisibleIdsByAction.submitToPortal;
                const noneEligible = eligibleIds.length === 0;
                return (<>
              <ActionRow
                icon={bulkSubmitToPortal.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                label={
                  !someSelected
                    ? "Queue selected for portal submission"
                    : eligibleIds.length === selectedIds.size
                      ? `Queue ${eligibleIds.length} for portal submission`
                      : `Queue ${eligibleIds.length} of ${selectedIds.size} selected for portal submission`
                }
                disabled={noneEligible || bulkSubmitToPortal.isPending}
                disabledReason={
                  !someSelected
                    ? "Select one or more reviewed-draft rows first."
                    : noneEligible
                      ? `None of the ${selectedIds.size} selected ${selectedIds.size === 1 ? "row is" : "rows are"} ready for portal submission (need a reviewed draft and all disputed legs resolved).`
                      : undefined
                }
                onClick={async () => {
                  if (noneEligible || bulkSubmitToPortal.isPending) return;
                  const ids = eligibleIds;
                  try {
                    const res = await bulkSubmitToPortal.mutateAsync({ data: { groupIds: ids } });
                    const queued = res.queued ?? 0;
                    const skipped = Array.isArray(res.skipped) ? res.skipped : [];
                    let msg = `Queued ${queued} for portal submission`;
                    if (skipped.length > 0) {
                      const sample = skipped
                        .slice(0, 3)
                        .map((s) => `${s.refNumber || `#${s.id}`} (${explainEligibilityReason(s.reason)})`)
                        .join(", ");
                      const more = skipped.length > 3 ? ` +${skipped.length - 3} more` : "";
                      msg += ` · skipped ${skipped.length} (${sample}${more})`;
                    }
                    setBulkPortalMsg(msg);
                    const skippedIdSet = new Set(skipped.map((s) => s.id));
                    rowBreath.triggerForIds(ids.filter((id) => !skippedIdSet.has(id)));
                    setSelectedIds(new Set());
                    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
                    setTimeout(() => setBulkPortalMsg(""), skipped.length > 0 ? 6000 : 3000);
                  } catch (err) {
                    setBulkPortalMsg(
                      `Couldn't queue: ${err instanceof Error ? err.message : "unknown error"}`,
                    );
                    setTimeout(() => setBulkPortalMsg(""), 6000);
                  }
                }}
                testId="rail-action-bulk-submit-portal"
              />
              <ActionRow
                icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                label={`Select all eligible for portal submission (${eligVisible.length} on this page)`}
                muted
                disabled={eligVisible.length === 0}
                disabledReason={eligVisible.length === 0 ? "No rows on this page are eligible for portal submission." : undefined}
                onClick={() => setSelectedIds(new Set(eligVisible))}
                testId="rail-action-bulk-submit-portal-select-eligible"
              />
                </>);
              })()}
              {filterReadyToGenerate && (() => {
                const eligibleIds = eligibleSelectedIdsByAction.generateAndReview;
                const eligVisible = eligibleVisibleIdsByAction.generateAndReview;
                const noneEligible = eligibleIds.length === 0;
                return (<>
              <ActionRow
                icon={bulkGenProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                label={
                  selectAllMatching
                    ? `Generate & mark all ${total} for approval`
                    : !someSelected
                      ? "Generate & mark for approval"
                      : eligibleIds.length === selectedIds.size
                        ? `Generate & mark ${eligibleIds.length} for approval`
                        : `Generate & mark ${eligibleIds.length} of ${selectedIds.size} selected for approval`
                }
                disabled={(!selectAllMatching && noneEligible) || bulkGenProcessing}
                disabledReason={
                  (!someSelected && !selectAllMatching)
                    ? "Select groups from the list first, or use Select all matching."
                    : (!selectAllMatching && noneEligible)
                      ? `None of the ${selectedIds.size} selected ${selectedIds.size === 1 ? "row is" : "rows are"} ready to generate & mark for approval (need all legs packageable and not already reviewed).`
                      : undefined
                }
                onClick={async () => {
                  if (bulkGenProcessing) return;

                  setBulkGenProcessing(true);
                  setBulkGenResults([]);
                  setBulkPortalMsg("");

                  let ids: number[];
                  if (selectAllMatching) {
                    try {
                      const allMatchingData = await listInvoiceGroups({
                        ...listParams,
                        limit: 10000,
                        offset: 0,
                      });
                      ids = (allMatchingData.groups ?? []).map((g) => g.id);
                    } catch {
                      setBulkGenResults([{ id: 0, refNumber: null, status: "failed", reason: "Failed to fetch matching groups" }]);
                      setBulkGenProcessing(false);
                      return;
                    }
                  } else {
                    ids = eligibleIds;
                  }

                  const results: BulkGenResult[] = [];
                  const successIds: number[] = [];
                  for (let i = 0; i < ids.length; i++) {
                    try {
                      const res = await bulkGenerateAndReview.mutateAsync({ data: { groupIds: [ids[i]] } });
                      for (const item of (res.generatedItems ?? [])) {
                        results.push({ id: item.id, refNumber: item.refNumber ?? null, status: "generated" });
                        successIds.push(item.id);
                      }
                      for (const item of (res.skipped ?? [])) {
                        results.push({ id: item.id, refNumber: item.refNumber ?? null, status: "skipped", reason: item.reason });
                      }
                    } catch (err) {
                      results.push({
                        id: ids[i],
                        refNumber: null,
                        status: "failed",
                        reason: err instanceof Error ? err.message : "request_failed",
                      });
                    }
                    setBulkGenResults([...results]);
                  }

                  rowBreath.triggerForIds(successIds);
                  setSelectedIds(new Set());
                  setSelectAllMatching(false);
                  setBulkGenProcessing(false);
                  queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
                }}
                testId="rail-action-bulk-generate-and-review"
              />
              <ActionRow
                icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                label={`Select all eligible for generate & review (${eligVisible.length} on this page)`}
                muted
                disabled={eligVisible.length === 0}
                disabledReason={eligVisible.length === 0 ? "No rows on this page are eligible for generate & review." : undefined}
                onClick={() => { setSelectAllMatching(false); setSelectedIds(new Set(eligVisible)); }}
                testId="rail-action-bulk-generate-and-review-select-eligible"
              />
                </>);
              })()}
              {(() => {
                const eligibleIds = eligibleSelectedIdsByAction.reattest;
                const eligVisible = eligibleVisibleIdsByAction.reattest;
                const noneEligible = eligibleIds.length === 0;
                return (<>
              <ActionRow
                icon={bulkReattest.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                label={
                  !someSelected
                    ? "Re-attest selected groups"
                    : eligibleIds.length === selectedIds.size
                      ? `Re-attest ${eligibleIds.length} groups`
                      : `Re-attest ${eligibleIds.length} of ${selectedIds.size} selected groups`
                }
                disabled={noneEligible || bulkReattest.isPending}
                disabledReason={
                  !someSelected
                    ? "Select reattest-only groups first."
                    : noneEligible
                      ? `None of the ${selectedIds.size} selected ${selectedIds.size === 1 ? "row has" : "rows have"} approved survivor legs ready for re-attestation.`
                      : undefined
                }
                onClick={async () => {
                  // Task #840 — open the confirm dialog after running
                  // the server-side dry-run so the operator sees the
                  // actual eligible / skipped breakdown (with reasons)
                  // before committing.
                  if (noneEligible || bulkReattest.isPending) return;
                  // Task #840 — send the operator's full selection (not
                  // the client pre-filtered eligible subset) so the
                  // dry-run can surface every skipped row with its
                  // server-side reason in the confirm dialog.
                  const ids = Array.from(selectedIds);
                  setBulkReattestPreview({ eligible: [], skipped: [] });
                  setBulkReattestPreviewLoading(true);
                  setBulkReattestDialogOpen(true);
                  try {
                    const preview = await bulkReattestInvoiceGroupsDryRun({ groupIds: ids });
                    setBulkReattestPreview({
                      eligible: (preview.eligible ?? []).map((e) => ({
                        id: e.id,
                        label: e.refNumber ?? null,
                      })),
                      skipped: (preview.skipped ?? []).map((s) => ({
                        id: s.id,
                        label: s.refNumber ?? null,
                        reason: s.reason,
                      })),
                    });
                  } catch (err) {
                    setBulkReattestDialogOpen(false);
                    setBulkPortalMsg(
                      `Couldn't check eligibility: ${err instanceof Error ? err.message : "unknown error"}`,
                    );
                    setTimeout(() => setBulkPortalMsg(""), 6000);
                  } finally {
                    setBulkReattestPreviewLoading(false);
                  }
                }}
                testId="rail-action-bulk-reattest"
              />
              <ActionRow
                icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                label={`Select all eligible for re-attest (${eligVisible.length} on this page)`}
                muted
                disabled={eligVisible.length === 0}
                disabledReason={eligVisible.length === 0 ? "No rows on this page are eligible for re-attest." : undefined}
                onClick={() => setSelectedIds(new Set(eligVisible))}
                testId="rail-action-bulk-reattest-select-eligible"
              />
                </>);
              })()}
              {(() => {
                const eligibleIds = eligibleSelectedIdsByAction.close;
                const eligVisible = eligibleVisibleIdsByAction.close;
                const noneEligible = eligibleIds.length === 0;
                return (<>
              <ActionRow
                icon={bulkClose.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                label={
                  !someSelected
                    ? "Close selected groups"
                    : eligibleIds.length === selectedIds.size
                      ? `Close ${eligibleIds.length} groups`
                      : `Close ${eligibleIds.length} of ${selectedIds.size} selected groups`
                }
                disabled={noneEligible || bulkClose.isPending}
                disabledReason={
                  !someSelected
                    ? "Select nothing-to-do groups first."
                    : noneEligible
                      ? `None of the ${selectedIds.size} selected ${selectedIds.size === 1 ? "row is" : "rows are"} ready to close (only nothing-to-do groups with no surviving legs can be closed).`
                      : undefined
                }
                onClick={async () => {
                  if (noneEligible || bulkClose.isPending) return;
                  const ids = eligibleIds;
                  try {
                    const res = await bulkClose.mutateAsync({ data: { groupIds: ids } });
                    const closed = res.closed ?? 0;
                    const skipped = Array.isArray(res.skipped) ? res.skipped : [];
                    let msg = `Closed ${closed} groups as Withdrawn`;
                    if (skipped.length > 0) {
                      const sample = skipped
                        .slice(0, 3)
                        .map((s: any) => `${s.refNumber || `#${s.id}`} (${explainEligibilityReason(s.reason)})`)
                        .join(", ");
                      const more = skipped.length > 3 ? ` +${skipped.length - 3} more` : "";
                      msg += ` · skipped ${skipped.length} (${sample}${more})`;
                    }
                    setBulkPortalMsg(msg);
                    const skippedIdSet = new Set(skipped.map((s: any) => s.id));
                    rowBreath.triggerForIds(ids.filter((id) => !skippedIdSet.has(id)));
                    setSelectedIds(new Set());
                    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
                    setTimeout(() => setBulkPortalMsg(""), skipped.length > 0 ? 6000 : 3000);
                  } catch (err) {
                    setBulkPortalMsg(
                      `Couldn't close: ${err instanceof Error ? err.message : "unknown error"}`,
                    );
                    setTimeout(() => setBulkPortalMsg(""), 6000);
                  }
                }}
                testId="rail-action-bulk-close"
              />
              <ActionRow
                icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                label={`Select all eligible for close (${eligVisible.length} on this page)`}
                muted
                disabled={eligVisible.length === 0}
                disabledReason={eligVisible.length === 0 ? "No rows on this page are eligible for close." : undefined}
                onClick={() => setSelectedIds(new Set(eligVisible))}
                testId="rail-action-bulk-close-select-eligible"
              />
                </>);
              })()}
              <ActionRow
                icon={<X className="w-3.5 h-3.5" />}
                label="Clear selection"
                disabled={!someSelected}
                onClick={() => setSelectedIds(new Set())}
                muted
                testId="rail-action-clear-selection"
              />
            </RailActionGroup>
            )}

            {!clerk && (
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
            )}

            {!clerk && (
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
            )}
          </ActionsRail>
        </aside>
      </div>
      <BulkEligibilityPreviewDialog
        open={bulkReattestDialogOpen}
        onOpenChange={setBulkReattestDialogOpen}
        title="Queue groups for re-attestation"
        description="Each eligible group's surviving approved legs will be queued for re-attestation. Groups that have disputable legs left, no survivors, or are already past re-attest are skipped."
        rowNoun="group"
        actionVerb="Queue"
        eligible={bulkReattestPreview.eligible}
        skipped={bulkReattestPreview.skipped}
        isLoadingPreview={bulkReattestPreviewLoading}
        isSubmitting={bulkReattest.isPending}
        onConfirm={async () => {
          const ids = bulkReattestPreview.eligible.map((e) => e.id);
          if (ids.length === 0) return;
          try {
            const res = await bulkReattest.mutateAsync({ data: { groupIds: ids } });
            const queued = res.queued ?? 0;
            const skipped = Array.isArray(res.skipped) ? res.skipped : [];
            let msg = `Queued ${queued} for re-attestation`;
            if (skipped.length > 0) {
              const sample = skipped
                .slice(0, 3)
                .map((s: any) => `${s.refNumber || `#${s.id}`} (${explainEligibilityReason(s.reason)})`)
                .join(", ");
              const more = skipped.length > 3 ? ` +${skipped.length - 3} more` : "";
              msg += ` · skipped ${skipped.length} (${sample}${more})`;
            }
            setBulkPortalMsg(msg);
            const skippedIdSet = new Set(skipped.map((s: any) => s.id));
            rowBreath.triggerForIds(ids.filter((id) => !skippedIdSet.has(id)));
            setSelectedIds(new Set());
            queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
            setTimeout(() => setBulkPortalMsg(""), skipped.length > 0 ? 6000 : 3000);
            setBulkReattestDialogOpen(false);
          } catch (err) {
            setBulkPortalMsg(
              `Couldn't re-attest: ${err instanceof Error ? err.message : "unknown error"}`,
            );
            setTimeout(() => setBulkPortalMsg(""), 6000);
          }
        }}
      />
    </div>
  );
}
