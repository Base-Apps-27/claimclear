import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ReviewHeader,
  type FilterBarSlots,
  type HiddenItemsSlots,
  type SortMode,
} from "./responses-awaiting-review-header";
import { ExportCsvControl } from "@/components/export-csv-control";
import { buildCsvFilename } from "@/lib/csv-export-filename";
import { useRowSettle } from "@/hooks/use-row-settle";
import { Link, useLocation, useParams } from "wouter";
import { resolveBodyRender } from "@/lib/email-body-render";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import {
  useListInvoiceGroups,
  getListInvoiceGroupsQueryKey,
  getExportInvoiceGroupsCsvUrl,
  useGetInvoiceGroup,
  getInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  getGetClaimQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
  useGetResponsesAwaitingReviewHiddenCounts,
  getGetResponsesAwaitingReviewHiddenCountsQueryKey,
  useRecordLegVerdict,
  useClearLegVerdictDraft,
  useGetInvoiceGroupEmailThread,
  useReplyToInvoiceGroupEmailConversation,
  useSendInvoiceGroupEmail,
  getGetInvoiceGroupEmailThreadQueryKey,
  useListErrorTypes,
  useBulkAssignInvoiceGroupErrorType,
  useBulkApproveInvoiceGroups,
  bulkApproveInvoiceGroupsPreflight,
  getBulkApproveProgress,
} from "@workspace/api-client-react";
import { ApiError, type BulkApproveProgress } from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
  InvoiceGroupResponse,
  PortalResponseItem,
} from "@workspace/api-client-react";
import { outcomeRole } from "@workspace/leg-state";
import { PerLegVerdictPicker } from "@/components/per-leg-verdict-picker";
import { useAiCalibrations } from "@/hooks/use-ai-calibration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StateBadge } from "@/components/state-badge";
import { RefNumber } from "@/components/ref-number";
import { EmptyState } from "@/components/empty-state";
import { UrgentTodayBadge } from "@/components/urgent-today-badge";
import {
  pickLatestReviewableResponse,
  getResponseTypeLabel,
  getResponseTypePillClass,
} from "@/components/queue-response-review-panel";
import { WhatsNextCard } from "@/components/whats-next";
import { GroupCommunicationThread } from "@/components/communication/group-communication-thread";
import {
  mapToGroupConversations,
  htmlBodyToPlainText,
} from "@/components/communication/group-thread-adapter";
import { useToast, successToast } from "@/hooks/use-toast";
import { buildBulkApproveSuccessSummary, runBulkApproveSuccessSideEffects } from "./responses-awaiting-review-bulk-approve-flow";
import { useInvoiceGroupsListEvents, useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import { usePresence } from "@/hooks/use-presence";
import { HumanPresenceBanner } from "@/components/presence-banners";
import { formatCurrency, formatDate, formatDateTime, formatDateCompact } from "@/lib/format";
import {
  CheckCircle,
  AlertTriangle,
  Clock,
  Eye,
  ExternalLink,
  Inbox,
  ArrowDownWideNarrow,
  Loader2,
  HelpCircle,
  Activity,
  CalendarDays,
  MailOpen,
  Tag,
  Building2,
  Search,
  X,
} from "lucide-react";
import {
  FacetedFilter,
  FacetSearchableCheckboxList,
  FacetCheckboxList,
  FacetDateRange,
  type FacetedFilterCategory,
  type FacetOption,
} from "@/components/list-table/faceted-filter";
import { type FilterChip } from "@/components/list-table/filter-chip-strip";
import { Input } from "@/components/ui/input";
import { useUrlParams } from "@/lib/use-url-params";
import {
  buildVerdictPendingQuery,
  hasActiveVerdictPendingFilters,
  CLEAR_ALL_VERDICT_PENDING_FILTERS_PAYLOAD,
  VERDICT_PENDING_STATUS_FILTER_VALUES,
  VERDICT_PENDING_RESPONSE_TYPE_FILTER_VALUES,
  parseHiddenBucket,
  type HiddenBucket,
  type VerdictPendingFilterState,
} from "./responses-awaiting-review-filters";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * "Responses Awaiting Review" — top-nav stage-2 verdict workspace.
 *
 * Reworked under Task #236 around the email thread itself: the right pane
 * is a 3-column layout — master list (left), group-level email thread
 * (middle), sticky action rail with verdict / continuation / closure
 * (right). The page sources the thread from the shared
 * `components/communication` mock data layer so the eventual swap to a
 * real group-level email API is a single-place change.
 */

const SORT_OPTIONS: ReadonlyArray<{ value: SortMode; label: string; help: string }> = [
  {
    value: "oldest_response",
    label: "Oldest response first",
    help: "Work the responses that have been waiting the longest first.",
  },
  {
    value: "newest_response",
    label: "Newest response first",
    help: "Surface freshly-arrived payor replies.",
  },
  {
    value: "urgency",
    label: "Urgent today first",
    help: "Groups flagged as urgent (filing window closing) bubble to the top.",
  },
  {
    value: "amount",
    label: "Largest amount first",
    help: "Highest-dollar invoices first.",
  },
];

const SORT_STORAGE_KEY = "claimclear:responses-awaiting-review:sort";

// Task #755 — survives a hard reload mid-bulk-approve. Mirrors the
// runId we generate at submit so a refresh / new tab can reattach to
// the in-flight (or just-finished) run by polling the durable
// progress row server-side.
const BULK_APPROVE_RUN_STORAGE_KEY = "claimclear:bulk-approve:run-id";

function clearStoredBulkApproveRunId(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(BULK_APPROVE_RUN_STORAGE_KEY); } catch { /* ignore */ }
}

// Task #750 — bulk-approve dialog + skip-reason labels live in their own
// module so unit tests can render the dialog without dragging the full
// page (and its api-client/SSE/auth surface) into a node:test harness.
import {
  BulkApproveDialog,
  bulkApproveSkipLabel,
  BULK_APPROVE_MAX_ROWS,
} from "@/components/bulk-approve-dialog";

function readStoredSort(): SortMode {
  if (typeof window === "undefined") return "oldest_response";
  const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
  if (raw && SORT_OPTIONS.some((o) => o.value === raw)) {
    return raw as SortMode;
  }
  return "oldest_response";
}

export default function ResponsesAwaitingReview() {
  // The list-event subscription stays at the shell level so SSE-driven
  // invalidation reaches the verdict-pending workspace whether the
  // operator landed via the bare path or a deep link.
  // Task #759 — Header V2: the page shell no longer renders a stand-alone
  // title + prose blurb. The new <ReviewHeader> (rendered inside
  // <VerdictPendingTabContent>) owns the single-row title + count badge +
  // info tooltip + caption pattern.
  useInvoiceGroupsListEvents();
  return (
    <div className="space-y-5">
      <VerdictPendingTabContent />
    </div>
  );
}

function VerdictPendingTabContent() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sortMode, setSortMode] = useState<SortMode>(() => readStoredSort());

  const selectedId = params.id ? parseInt(params.id, 10) || null : null;

  // Verdict Pending is sourced from the `response-pending` macro phase.
  // `includeExpired: true` keeps past-deadline groups in (operators
  // pick verdicts off response signals, not the clock).
  // `errorTypeAssigned: true` restricts to classified groups so the
  // server total reflects exactly what this list renders.
  // Task #753 — URL-state filter bar. The seven facets (date of service,
  // response received, status, response type, error type, payor/client,
  // free-text) live in the URL via `useUrlParams` so deep links + back/
  // forward preserve the operator's view exactly. The filtered query
  // hits the new server-side params added under Task #753; the cohort
  // is still pinned to `macroPhase=response-pending` + classified +
  // includeExpired so this remains a verdict-pending workspace.
  const url = useUrlParams();
  const filterQ = url.get("q");
  const filterStatuses = url.getAll("status");
  const filterResponseTypes = url.getAll("responseType");
  const filterErrorTypeIds = url.getAll("errorTypeId");
  const filterClientNumbers = url.getAll("clientNumber");
  const filterServiceDateFrom = url.get("serviceDateFrom");
  const filterServiceDateTo = url.get("serviceDateTo");
  const filterResponseReceivedFrom = url.get("responseReceivedFrom");
  const filterResponseReceivedTo = url.get("responseReceivedTo");
  // Task #813 — when set, the "Hidden from this view" chip is acting as
  // a view toggle instead of a navigation link. The URL carries the
  // active bucket so deep links + refresh restore the bucketed view.
  const activeHiddenBucket = parseHiddenBucket(url.get("bucket"));

  const filterState: VerdictPendingFilterState = {
    q: filterQ,
    statuses: filterStatuses,
    responseTypes: filterResponseTypes,
    errorTypeIds: filterErrorTypeIds,
    clientNumbers: filterClientNumbers,
    serviceDateFrom: filterServiceDateFrom,
    serviceDateTo: filterServiceDateTo,
    responseReceivedFrom: filterResponseReceivedFrom,
    responseReceivedTo: filterResponseReceivedTo,
    hiddenBucket: activeHiddenBucket,
  };
  // Task #848 — short signature for the RAR CSV filename. Each token
  // mirrors a knob from buildVerdictPendingQuery so the filename
  // honestly reflects what's in the export.
  const rarFilterTokens = (s: VerdictPendingFilterState): string[] => {
    const tokens: string[] = [];
    if (s.hiddenBucket) tokens.push(`bucket${s.hiddenBucket}`);
    if (s.q && s.q.trim()) tokens.push(`q${s.q.trim()}`);
    if (s.statuses.length) tokens.push(`status${s.statuses.length}`);
    if (s.responseTypes.length) tokens.push(`resp${s.responseTypes.length}`);
    if (s.errorTypeIds.length) tokens.push(`err${s.errorTypeIds.length}`);
    if (s.clientNumbers.length) tokens.push(`client${s.clientNumbers.length}`);
    if (s.serviceDateFrom || s.serviceDateTo) tokens.push("svcDate");
    if (s.responseReceivedFrom || s.responseReceivedTo) tokens.push("rcvd");
    return tokens;
  };

  const verdictPendingQuery = useMemo(
    () => buildVerdictPendingQuery(filterState),
    [
      filterQ, filterStatuses.join(","), filterResponseTypes.join(","),
      filterErrorTypeIds.join(","), filterClientNumbers.join(","),
      filterServiceDateFrom, filterServiceDateTo,
      filterResponseReceivedFrom, filterResponseReceivedTo,
      activeHiddenBucket,
    ],
  );

  // Task #813 — toggle helper for the hidden-bucket chips. Clicking the
  // active chip clears it (returning to the default Awaiting Review
  // cohort); clicking the other chip swaps the view (one bucket at a
  // time).
  const setHiddenBucket = (next: HiddenBucket | null) => {
    url.set({ bucket: next ?? null }, false);
  };
  const { data, isLoading, isError, refetch } = useListInvoiceGroups(
    verdictPendingQuery,
    {
      query: {
        queryKey: getListInvoiceGroupsQueryKey(verdictPendingQuery),
      },
    },
  );

  const hasActiveFilters = hasActiveVerdictPendingFilters(filterState);

  const setMultiParam = (key: string, values: string[]) => {
    url.set({ [key]: values.length > 0 ? values.join(",") : null }, false);
  };
  const toggleMulti = (current: string[], id: string, next: boolean) => {
    if (next) return current.includes(id) ? current : [...current, id];
    return current.filter(v => v !== id);
  };
  const clearAllFilters = () => {
    url.set(CLEAR_ALL_VERDICT_PENDING_FILTERS_PAYLOAD, false);
  };

  const { data: errorTypesForFilter } = useListErrorTypes();
  const errorTypesList = errorTypesForFilter ?? [];
  const clientOptions = useMemo(() => {
    const seen = new Map<string, string>();
    const rows = (data?.groups ?? []) as Array<{ clientNumber?: string | null }>;
    for (const g of rows) {
      const cn = g.clientNumber;
      if (cn && !seen.has(cn)) seen.set(cn, cn);
    }
    for (const cn of filterClientNumbers) {
      if (!seen.has(cn)) seen.set(cn, cn);
    }
    return Array.from(seen.values()).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.groups, filterClientNumbers.join(",")]);

  // This page is single-purpose: pick verdicts on payor responses.
  // Re-attestation work lives on the standalone /attestation-queue
  // page; MAS-action elevation has been removed entirely.

  // Server already restricts to classified groups via `errorTypeAssigned`.
  const baseGroups: InvoiceGroupResponse[] = useMemo(
    () => data?.groups || [],
    [data?.groups],
  );

  // Fan out per-group detail fetches in parallel for every row in the
  // list. Two reasons:
  //   1. The "oldest/newest response first" sort modes need each group's
  //      latest reviewable response timestamp (the list endpoint doesn't
  //      ship responses).
  //   2. Task #299 safety net — if a group's status/response state
  //      drifted between status='Needs Review' and "no reviewable
  //      response on file", drop it from the list before rendering so
  //      it can't show as a blank "Response details unavailable" row.
  //      The API endpoint already filters this case via an EXISTS check;
  //      this is belt-and-suspenders, and makes the UI self-healing if
  //      the cached list is briefly stale after a status change.
  // Each query is keyed exactly the way `useGetInvoiceGroup(g.id)` keys
  // its detail fetch in the row component, so this hoists the fetch up
  // to the parent without firing any extra network requests.
  const detailQueries = useQueries({
    queries: baseGroups.map((g) => ({
      queryKey: getGetInvoiceGroupQueryKey(g.id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        getInvoiceGroup(g.id, { signal }),
      // Stale window long enough that flipping sort mode doesn't
      // re-trigger a network storm; SSE invalidation keeps it fresh.
      staleTime: 30_000,
    })),
  });

  // Per-group derived signals — `hasReviewable` is undefined while the
  // detail query is still loading (we keep the row visible during
  // hydration to avoid flicker), `true` once a reviewable response is
  // confirmed, `false` once the detail loaded and showed nothing
  // reviewable (drop the row).
  const reviewableByGroupId = useMemo(() => {
    const map = new Map<number, boolean | undefined>();
    baseGroups.forEach((g, idx) => {
      const q = detailQueries[idx];
      if (!q || q.isLoading || q.data === undefined) {
        map.set(g.id, undefined);
        return;
      }
      const latest = pickLatestReviewableResponse(q.data.responses);
      map.set(g.id, !!latest);
    });
    return map;
  }, [baseGroups, detailQueries]);

  // Task #750 — per-group bulk-approve eligibility. The latest reviewable
  // response must be ai-classified, response_type=approval (not partial),
  // and high-confidence. Also expose the latest response id so the bulk
  // mutation (which keys off portal_response ids) and the dollar total
  // can be derived without re-fetching anything.
  const bulkApproveByGroupId = useMemo(() => {
    const map = new Map<number, {
      portalResponseId: number | null;
      eligible: boolean;
      reason: string | null;
      totalAmount: number;
      refNumber: string | null;
    }>();
    baseGroups.forEach((g, idx) => {
      const detail = detailQueries[idx]?.data;
      const latest = pickLatestReviewableResponse(detail?.responses);
      const totalAmount = parseFloat(g.totalAmount ?? "") || 0;
      let reason: string | null = null;
      if (!latest) reason = "no_response";
      else if (latest.classifierSource !== "ai") reason = "not_ai";
      else if (latest.responseType === "partial_approval") reason = "partial_approval";
      else if (latest.responseType !== "approval") reason = "not_approval";
      else if (latest.classifierConfidence !== "high") reason = "low_confidence";
      map.set(g.id, {
        portalResponseId: latest?.id ?? null,
        eligible: reason === null,
        reason,
        totalAmount,
        refNumber: g.invoiceNumber ?? null,
      });
    });
    return map;
  }, [baseGroups, detailQueries]);

  const responseTimeByGroupId = useMemo(() => {
    const map = new Map<number, number | null>();
    baseGroups.forEach((g, idx) => {
      const detail = detailQueries[idx]?.data;
      const latest = pickLatestReviewableResponse(detail?.responses);
      const time = latest?.receivedAt
        ? new Date(latest.receivedAt).getTime()
        : null;
      map.set(g.id, time);
    });
    return map;
  }, [baseGroups, detailQueries]);

  const groups: InvoiceGroupResponse[] = useMemo(() => {
    // Safety net: drop rows whose detail loaded and had no reviewable
    // response. Rows whose detail hasn't loaded yet (`undefined`) stay
    // in so the list renders immediately on mount.
    const arr = baseGroups.filter(
      (g) => reviewableByGroupId.get(g.id) !== false,
    );
    // totalAmount comes off the wire as a string (decimal preserved); parse
    // once and treat NaN/null as 0 so numeric sorting still terminates.
    const amountOf = (g: InvoiceGroupResponse) => {
      const n = parseFloat(g.totalAmount ?? "");
      return Number.isFinite(n) ? n : 0;
    };
    arr.sort((a, b) => {
      switch (sortMode) {
        case "urgency": {
          // Urgent first (true > false), then dollar amount as tiebreaker.
          const urgencyDelta =
            (b.isUrgent ? 1 : 0) - (a.isUrgent ? 1 : 0);
          if (urgencyDelta !== 0) return urgencyDelta;
          return amountOf(b) - amountOf(a);
        }
        case "amount":
          return amountOf(b) - amountOf(a);
        case "newest_response":
        case "oldest_response": {
          const aTime = responseTimeByGroupId.get(a.id) ?? null;
          const bTime = responseTimeByGroupId.get(b.id) ?? null;
          // Rows whose detail hasn't loaded yet (or have no response
          // metadata) sink to the bottom — keeps the sort stable while
          // queries hydrate instead of shuffling rows around.
          if (aTime === null && bTime === null) return a.id - b.id;
          if (aTime === null) return 1;
          if (bTime === null) return -1;
          return sortMode === "oldest_response" ? aTime - bTime : bTime - aTime;
        }
        default:
          return 0;
      }
    });
    return arr;
  }, [baseGroups, sortMode, responseTimeByGroupId, reviewableByGroupId]);

  const handleSortChange = (value: string) => {
    const next = SORT_OPTIONS.find((o) => o.value === value)?.value ?? "oldest_response";
    setSortMode(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SORT_STORAGE_KEY, next);
    }
  };

  // The awaiting-review list hides the global tour-sample invoice group
  // (migration 0029) by virtue of the API list filter. But tour step 14
  // navigates to `/responses-awaiting-review/<tourSampleGroupId>` so we
  // also fetch the group directly when its id appears in the URL but
  // isn't in the list. The fallback fires only when needed (selectedId
  // set + not in list), so it costs nothing in normal operation.
  const inListGroup = selectedId
    ? groups.find((g) => g.id === selectedId) ?? null
    : null;
  const needsFallbackFetch = selectedId !== null && inListGroup === null;
  const { data: fallbackGroupDetail } = useGetInvoiceGroup(
    selectedId ?? 0,
    { query: { enabled: needsFallbackFetch, queryKey: getGetInvoiceGroupQueryKey(selectedId ?? 0) } },
  );
  const selectedGroup: InvoiceGroupResponse | null =
    inListGroup
    ?? (needsFallbackFetch && fallbackGroupDetail
      ? (fallbackGroupDetail as unknown as InvoiceGroupResponse)
      : null);

  const selectGroup = (id: number) => {
    navigate(`/responses-awaiting-review/${id}`);
  };

  // Auto-select the first row when nothing is selected and the list has
  // entries. Keeps the right pane from flashing the empty state on landing.
  useEffect(() => {
    if (selectedId === null && groups.length > 0) {
      navigate(`/responses-awaiting-review/${groups[0].id}`, { replace: true });
    }
  }, [selectedId, groups, navigate]);

  // If the selected row leaves the list (verdict applied, status changed,
  // moved to another bucket), advance focus to the next row so review feels
  // like a queue. When the list is empty, drop the selection so the empty
  // state can render.
  //
  // EXCEPTION: when the fallback fetch resolved a real group for the
  // current selectedId (the tour-sample group, which is hidden from
  // the awaiting-review list by design), keep the selection so the
  // tour's anchored step 14 has a DetailPane to point at.
  useEffect(() => {
    if (selectedId === null) return;
    const stillVisible = groups.some((g) => g.id === selectedId);
    if (stillVisible) return;
    // Task #813 — keep the selection while the fallback fetch is in
    // flight too. Without this guard, clicking a row from the inline
    // unclassified panel (which targets a group that isn't in the
    // verdict-pending `groups` list) caused this effect to fire one
    // render before `fallbackGroupDetail` resolved and instantly
    // bounce focus back to the first list row.
    if (needsFallbackFetch) return;
    if (groups.length === 0) {
      navigate(`/responses-awaiting-review`, { replace: true });
    } else {
      navigate(`/responses-awaiting-review/${groups[0].id}`, { replace: true });
    }
  }, [selectedId, groups, navigate, needsFallbackFetch, fallbackGroupDetail]);

  // Task #343: under the new draft-saving picker, picking a verdict in
  // Step 3 does NOT move the group out of `response-pending`, so the
  // master list + nav badge can't change as a result of a per-leg
  // selection. Refetching them used to cause the row to vanish (and
  // the auto-navigate-to-next-group `useEffect` to fire) the moment
  // the operator clicked a single pill — exactly the bug Task #343 is
  // here to fix. We still toast, but we leave list/count invalidation
  // to the Step 4 commit path (re-attest / queue / closure), which is
  // where the group genuinely leaves the queue. The picker itself
  // invalidates the per-group + per-claim detail queries so the lit-up
  // pill state stays consistent.
  const onAfterVerdict = (message: string) => {
    successToast({
      title: "__VERB__",
      description: message,
      duration: 2500,
    });
  };

  // Task #750 — bulk-approve selection state. Lives at the page level so
  // the bar above the workspace and the row checkboxes share one source
  // of truth, and the selection survives DetailPane re-renders. Stored
  // as a Set of group ids (not portal_response ids) so the row UI stays
  // simple — we resolve to portal_response ids at submit time.
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(() => new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Drop selections that have left the visible list (verdict applied,
  // SSE pushed the row off, sort filter changed) so the bar's count
  // never lies.
  useEffect(() => {
    const visible = new Set(groups.map((g) => g.id));
    setSelectedGroupIds((prev) => {
      let dirty = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else dirty = true;
      }
      return dirty ? next : prev;
    });
  }, [groups]);

  const toggleGroupSelected = (id: number, checked: boolean) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const selectAllEligible = () => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      for (const g of groups) {
        if (bulkApproveByGroupId.get(g.id)?.eligible) next.add(g.id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedGroupIds(new Set());

  // Pre-flight skip preview shown in the confirm dialog. Re-validated
  // server-side; this is purely for the operator's visibility.
  const selectionPreview = useMemo(() => {
    const eligible: Array<{ groupId: number; portalResponseId: number; refNumber: string | null; totalAmount: number }> = [];
    const skipped: Array<{ groupId: number; refNumber: string | null; reason: string }> = [];
    for (const id of selectedGroupIds) {
      const meta = bulkApproveByGroupId.get(id);
      if (!meta || meta.portalResponseId == null) {
        skipped.push({ groupId: id, refNumber: meta?.refNumber ?? null, reason: "no_response" });
        continue;
      }
      if (!meta.eligible) {
        skipped.push({ groupId: id, refNumber: meta.refNumber, reason: meta.reason ?? "ineligible" });
        continue;
      }
      eligible.push({ groupId: id, portalResponseId: meta.portalResponseId, refNumber: meta.refNumber, totalAmount: meta.totalAmount });
    }
    const totalDollars = eligible.reduce((acc, r) => acc + r.totalAmount, 0);
    const eligibleAll: number[] = [];
    for (const g of groups) {
      if (bulkApproveByGroupId.get(g.id)?.eligible) eligibleAll.push(g.id);
    }
    return { eligible, skipped, totalDollars, eligibleAll };
  }, [selectedGroupIds, bulkApproveByGroupId, groups]);

  const allSelectionsEligible = selectionPreview.skipped.length === 0 && selectionPreview.eligible.length > 0;
  const overCap = selectionPreview.eligible.length > BULK_APPROVE_MAX_ROWS;

  const bulkApproveMutation = useBulkApproveInvoiceGroups();

  // Preflight: when the dialog opens, call the dedicated preflight
  // endpoint to evaluate the selection server-side and merge the
  // resulting skips (presence_locked, active_submission,
  // already_queued, no_disputed_legs, …) into the dialog so the
  // operator sees them before committing. Tracked by an opaque request
  // key so a stale response from a previous open doesn't overwrite a
  // fresh one. The preflight endpoint has its own typed response
  // shape (BulkApprovePreflightResult), so no unsafe cast is needed.
  const [serverPreflightSkipped, setServerPreflightSkipped] = useState<
    Array<{ groupId: number; refNumber: string | null; reason: string }>
  >([]);
  const preflightReqId = useRef(0);
  // Stable primitive key for the effect dep. `selectionPreview.eligible`
  // is a fresh array on every render (its upstream `bulkApproveByGroupId`
  // memo depends on `useQueries`'s detailQueries, which returns a new
  // array each render). Depending on the array ref directly made the
  // effect fire on every render and call `setServerPreflightSkipped([])`
  // with a fresh `[]` ref — React's Object.is bail-out doesn't apply to
  // distinct empty arrays, so each call scheduled another render and the
  // page crashed with "Maximum update depth exceeded" (React #185). The
  // sorted, joined id list is a primitive — React compares deps by
  // Object.is, which compares strings by value, so the effect now only
  // re-runs when the actual selection changes.
  const eligibleIdsKey = useMemo(
    () =>
      selectionPreview.eligible
        .map((e) => e.portalResponseId)
        .sort((a, b) => a - b)
        .join(","),
    [selectionPreview.eligible],
  );
  useEffect(() => {
    if (!bulkConfirmOpen) {
      setServerPreflightSkipped((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const portalResponseIds = eligibleIdsKey
      ? eligibleIdsKey.split(",").map((s) => parseInt(s, 10))
      : [];
    if (portalResponseIds.length === 0) {
      setServerPreflightSkipped((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const reqId = ++preflightReqId.current;
    void bulkApproveInvoiceGroupsPreflight({ portalResponseIds })
      .then((resp) => {
        if (preflightReqId.current !== reqId) return;
        setServerPreflightSkipped(
          resp.skipped
            .filter((r) => r.id != null)
            .map((r) => ({ groupId: r.id as number, refNumber: r.refNumber ?? null, reason: r.reason })),
        );
      })
      .catch(() => {
        // Preflight is best-effort — if it fails, the dialog still
        // shows the client-derived skipped list and the real run will
        // surface the same skips on commit.
      });
  }, [bulkConfirmOpen, eligibleIdsKey]);

  // Merge client + server skip rows for the dialog. Dedup by groupId;
  // server reason wins (it's authoritative).
  const dialogSkipped = useMemo(() => {
    const merged = new Map<number, { groupId: number; refNumber: string | null; reason: string }>();
    for (const s of selectionPreview.skipped) merged.set(s.groupId, s);
    for (const s of serverPreflightSkipped) merged.set(s.groupId, s);
    return Array.from(merged.values());
  }, [selectionPreview.skipped, serverPreflightSkipped]);

  // Eligible list for the dialog excludes anything the server says
  // would be skipped (e.g. another reviewer just opened it).
  const dialogEligible = useMemo(() => {
    const skipIds = new Set(serverPreflightSkipped.map((s) => s.groupId));
    return selectionPreview.eligible.filter((e) => !skipIds.has(e.groupId));
  }, [selectionPreview.eligible, serverPreflightSkipped]);
  const dialogTotalDollars = useMemo(
    () => dialogEligible.reduce((acc, e) => acc + e.totalAmount, 0),
    [dialogEligible],
  );

  // Task #755 — live progress for the in-flight bulk-approve. We
  // generate the runId on the client and ship it in the POST body so
  // the server keys its durable progress row off it. While the POST
  // request is in flight (or after a page reload that lands while a
  // previous run is still going) we poll
  // `GET /invoice-groups/bulk-approve/:runId/progress` every 750ms and
  // hand the snapshot to the dialog.
  //
  // To survive a hard reload / new tab we mirror the active runId into
  // `localStorage` at submit start and clear it on terminal status
  // (`complete`) or after the row ages out (poll returns 404). On
  // mount, if a stored runId exists we reopen the dialog and resume
  // polling — the server-side progress row, persisted in Postgres
  // (Task #755), is what makes that reattach actually show counts.
  const [bulkProgress, setBulkProgress] = useState<BulkApproveProgress | null>(null);
  const bulkRunIdRef = useRef<string | null>(null);
  // Drives the polling effect: any non-null runId here means "keep
  // polling progress for this id until it completes or 404s". Driving
  // polling off a state value (instead of `mutation.isPending`) is
  // what lets a resumed run keep ticking without needing the original
  // POST promise.
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);

  // Restore an in-flight runId from localStorage on mount. If the
  // stored row is already complete we clear immediately; otherwise
  // we open the dialog and let the polling effect take over.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let storedId: string | null = null;
    try {
      storedId = window.localStorage.getItem(BULK_APPROVE_RUN_STORAGE_KEY);
    } catch {
      storedId = null;
    }
    if (!storedId) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getBulkApproveProgress(storedId);
        if (cancelled) return;
        bulkRunIdRef.current = storedId;
        setBulkProgress(snap);
        if (snap.status === "complete") {
          // Run finished while we were away — drop the stale id; the
          // operator will see fresh data after the normal refetch.
          clearStoredBulkApproveRunId();
        } else {
          setBulkConfirmOpen(true);
          setPollingRunId(storedId);
        }
      } catch (err) {
        // Only treat a definitive 404 as "row aged out, nothing to
        // reattach" and clear the stored id. A transient network /
        // 5xx error keeps the id around so we can retry: optimistic
        // reattach by opening the dialog and letting the polling
        // loop catch up when the API comes back.
        if (err instanceof ApiError && err.status === 404) {
          clearStoredBulkApproveRunId();
          return;
        }
        if (cancelled) return;
        bulkRunIdRef.current = storedId;
        setBulkConfirmOpen(true);
        setPollingRunId(storedId);
      }
    })();
    return () => { cancelled = true; };
    // Mount-only restore — intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset transient progress UI when the dialog closes after a
  // completed run. The runId itself is cleared on terminal status by
  // the polling effect / submitBulkApprove finally branch, so closing
  // a still-running dialog does NOT abandon the run.
  useEffect(() => {
    if (!bulkConfirmOpen && pollingRunId == null) {
      setBulkProgress(null);
      bulkRunIdRef.current = null;
    }
  }, [bulkConfirmOpen, pollingRunId]);

  // Polling driver. Active whenever `pollingRunId` is set. Stops on
  // terminal status (`complete`) — at that point the POST promise (if
  // we own it) handles success-side-effects, and a resumed run just
  // shows the final snapshot until the dialog is closed.
  useEffect(() => {
    if (!pollingRunId) return;
    let cancelled = false;
    const startedAt = Date.now();
    // Tolerate 404s during a startup grace window so we don't drop
    // tracking when the very first poll races ahead of the POST that
    // INSERTs the progress row, OR while the API restarts mid-run
    // before the row is rehydrated. Once we've ever seen the row we
    // exit the grace state for good — any later 404 means the row
    // truly aged out (>5 min after completion).
    const STARTUP_GRACE_MS = 20_000;
    let everSeen = false;
    const tick = async () => {
      try {
        const snap = await getBulkApproveProgress(pollingRunId);
        if (cancelled) return;
        everSeen = true;
        setBulkProgress(snap);
        if (snap.status === "complete") {
          clearStoredBulkApproveRunId();
          setPollingRunId(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          // Within the startup grace window AND we've never seen the
          // row → assume the POST hasn't INSERTed yet; keep polling.
          if (!everSeen && Date.now() - startedAt < STARTUP_GRACE_MS) {
            return;
          }
          // Otherwise the row aged out (>5 min after completion).
          // Stop polling and clear so we don't loop forever.
          clearStoredBulkApproveRunId();
          setPollingRunId(null);
        }
        // Transient network / 5xx errors keep the id around so the
        // next tick (or a future mount) retries.
      }
    };
    void tick();
    const handle = setInterval(() => { void tick(); }, 750);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [pollingRunId]);

  const submitBulkApprove = async (note: string) => {
    const portalResponseIds = dialogEligible.map((e) => e.portalResponseId);
    if (portalResponseIds.length === 0) return;
    const runId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    bulkRunIdRef.current = runId;
    setBulkProgress(null);
    // Persist BEFORE awaiting the POST so a reload mid-flight reattaches.
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(BULK_APPROVE_RUN_STORAGE_KEY, runId); } catch { /* ignore */ }
    }
    setPollingRunId(runId);
    try {
      const result = await bulkApproveMutation.mutateAsync({
        data: { portalResponseIds, note, bulkApproveRunId: runId },
      });
      successToast({
        title: `Approved ${result.approved} response${result.approved === 1 ? "" : "s"}`,
        description: buildBulkApproveSuccessSummary(result),
        duration: 5000,
      });
      await runBulkApproveSuccessSideEffects({
        result,
        queryClient,
        verdictPendingQuery,
        setSelectedGroupIds,
        setBulkConfirmOpen,
      });
    } catch (err) {
      toast({
        title: "Bulk approve failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      // Don't unconditionally clear the stored id here: a network /
      // 5xx failure on the client doesn't tell us whether the server
      // accepted any work, and the durable progress row may still be
      // ticking. Leave the polling loop attached — it will clear the
      // id itself on either a definitive 404 or terminal `complete`.
    }
    // Success path: the polling loop will see `status === "complete"`
    // on its next tick and clear both the stored id and pollingRunId.
    // No `finally` clear, so an in-flight or just-finished run stays
    // reattachable across an unexpected reload.
  };

  // Task #759 — Header V2 ("Controls / State Split"). The header used to
  // stack 7 vertical strips (title, two prose blurbs, hidden items,
  // filter bar, active chips, sort row, bulk bar) eating ~280px before
  // the first row. ReviewHeader collapses that into:
  //   row 1: title + count badge + info tooltip + caption
  //   row 2: toolbar (filter, search, HC-shortcut OR bulk-bar, sort)
  //   row 3: collapsible "Showing / Hiding" state strip (only when
  //          filters or hidden buckets are active)
  // The composition pulls FilterBar's pieces apart via the
  // useFilterBarSlots hook so the trigger + search live in the toolbar
  // while the active chips live in the state strip.
  const filterSlots = useFilterBarSlots({
    filterQ,
    filterStatuses,
    filterResponseTypes,
    filterErrorTypeIds,
    filterClientNumbers,
    filterServiceDateFrom,
    filterServiceDateTo,
    filterResponseReceivedFrom,
    filterResponseReceivedTo,
    errorTypes: errorTypesList,
    clientOptions,
    onSetQ: (q) => url.set({ q: q || null }, false),
    setMultiParam,
    toggleMulti,
    onSetServiceDateRange: (v) =>
      url.set({ serviceDateFrom: v.from || null, serviceDateTo: v.to || null }, false),
    onSetResponseReceivedRange: (v) =>
      url.set({ responseReceivedFrom: v.from || null, responseReceivedTo: v.to || null }, false),
    clearAllFilters,
  });
  const hiddenSlots = useHiddenItemsChips({
    activeBucket: activeHiddenBucket,
    onToggleBucket: setHiddenBucket,
  });

  return (
    <div className="space-y-5" data-testid="verdict-pending-tab-content">
      <UnclassifiedResponsesSection
        selectedId={selectedId}
        onSelect={selectGroup}
      />

      <ReviewHeader
        groupCount={groups.length}
        hasActiveFilters={hasActiveFilters || activeHiddenBucket !== null}
        activeHiddenBucket={activeHiddenBucket}
        sortMode={sortMode}
        sortOptions={SORT_OPTIONS}
        onSortChange={handleSortChange}
        filterSlots={filterSlots}
        hiddenSlots={hiddenSlots}
        clearAllFilters={clearAllFilters}
        selectionEligibleAllCount={selectionPreview.eligibleAll.length}
        onSelectAllEligible={selectAllEligible}
        actionsSlot={
          <ExportCsvControl
            testIdPrefix="rar-export-csv"
            buildUrl={(allFields) =>
              getExportInvoiceGroupsCsvUrl({
                ...(verdictPendingQuery as Record<string, unknown>),
                allFields: allFields || undefined,
                filename: buildCsvFilename(
                  "responses-awaiting-review",
                  rarFilterTokens(filterState),
                ),
              } as Parameters<typeof getExportInvoiceGroupsCsvUrl>[0])
            }
            buildFilename={(allFields) =>
              buildCsvFilename("responses-awaiting-review", [
                ...rarFilterTokens(filterState),
                allFields ? "allFields" : null,
              ])
            }
          />
        }
        bulkBar={
          selectedGroupIds.size > 0 ? (
            <BulkApproveBar
              selectedCount={selectedGroupIds.size}
              eligibleCount={selectionPreview.eligible.length}
              skippedCount={selectionPreview.skipped.length}
              totalDollars={selectionPreview.totalDollars}
              allEligible={allSelectionsEligible}
              overCap={overCap}
              cap={BULK_APPROVE_MAX_ROWS}
              onSelectAllEligible={selectAllEligible}
              onClear={clearSelection}
              onOpenConfirm={() => setBulkConfirmOpen(true)}
            />
          ) : null
        }
      />

      <Workspace
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        groups={groups}
        selectedGroup={selectedGroup}
        onSelect={selectGroup}
        onAfterVerdict={onAfterVerdict}
        selectedGroupIds={selectedGroupIds}
        bulkApproveByGroupId={bulkApproveByGroupId}
        onToggleSelected={toggleGroupSelected}
        onSelectAllEligible={selectAllEligible}
        onClearSelection={clearSelection}
        hasActiveFilters={hasActiveFilters || activeHiddenBucket !== null}
        onClearFilters={() => {
          clearAllFilters();
          if (activeHiddenBucket !== null) setHiddenBucket(null);
        }}
        activeHiddenBucket={activeHiddenBucket}
      />
      <BulkApproveDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => {
          if (!bulkApproveMutation.isPending) setBulkConfirmOpen(open);
        }}
        eligible={dialogEligible}
        skipped={dialogSkipped}
        totalDollars={dialogTotalDollars}
        cap={BULK_APPROVE_MAX_ROWS}
        isSubmitting={bulkApproveMutation.isPending || pollingRunId != null}
        progress={bulkProgress}
        onConfirm={submitBulkApprove}
      />
    </div>
  );
}

interface BulkApproveBarProps {
  selectedCount: number;
  eligibleCount: number;
  skippedCount: number;
  totalDollars: number;
  allEligible: boolean;
  overCap: boolean;
  cap: number;
  onSelectAllEligible: () => void;
  onClear: () => void;
  onOpenConfirm: () => void;
}

function BulkApproveBar({
  selectedCount,
  eligibleCount,
  skippedCount,
  totalDollars,
  allEligible,
  overCap,
  cap,
  onSelectAllEligible,
  onClear,
  onOpenConfirm,
}: BulkApproveBarProps) {
  const disabledReason = overCap
    ? `Selection exceeds the ${cap}-row cap. Narrow the selection.`
    : eligibleCount === 0
      ? "No eligible high-confidence Approval responses in the selection."
      : !allEligible
        ? `${skippedCount} selected row(s) fail the AI/approval/high-confidence gate.`
        : null;
  return (
    <div
      className="sticky top-0 z-10 flex items-center gap-3 flex-wrap rounded-md border bg-background/95 backdrop-blur px-3 py-2 shadow-sm"
      data-testid="bulk-approve-bar"
    >
      <span className="text-sm font-semibold" data-testid="bulk-approve-bar-count">
        {selectedCount} selected
      </span>
      {/* Task #759 — adverse-selection color coding: eligible reads
          green (good to go), skipped reads amber (heads-up) so the
          operator can spot a partly-ineligible selection at a glance.
          Falls back to muted styling when the count is zero so a clean
          "8 eligible · 0 would be skipped" line doesn't shout. */}
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1 flex-wrap">
        <span
          className={
            eligibleCount > 0
              ? "font-semibold text-green-700"
              : "text-muted-foreground"
          }
        >
          {eligibleCount} eligible
        </span>
        <span aria-hidden="true">·</span>
        <span
          className={
            skippedCount > 0
              ? "font-semibold text-amber-700"
              : "text-muted-foreground"
          }
        >
          {skippedCount} would be skipped
        </span>
        <span aria-hidden="true">·</span>
        <span>total {formatCurrency(String(totalDollars))}</span>
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSelectAllEligible}
          data-testid="bulk-approve-select-all-eligible"
        >
          Select all High-confidence Approvals
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          data-testid="bulk-approve-clear"
        >
          Clear
        </Button>
        {disabledReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  size="sm"
                  disabled
                  data-testid="bulk-approve-button"
                >
                  Bulk Approve
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{disabledReason}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={onOpenConfirm}
            data-testid="bulk-approve-button"
          >
            Bulk Approve
          </Button>
        )}
      </div>
    </div>
  );
}


/**
 * Inline workflow for the "unclassified responses" hidden bucket.
 *
 * Background: groups in the response-pending macro phase that don't yet
 * have an error type assigned are hidden from the main awaiting-review
 * list (the verdict UI keys off error type). Historically they were
 * surfaced only as a passive chip on `HiddenItemsStrip` linking out to
 * the Invoice Groups list — operators frequently missed it, leaving
 * real payor responses sitting silent.
 *
 * This section pulls those groups inline and gives each row a one-click
 * error-type picker that POSTs `bulk-assign-error-type` for that single
 * group. After a successful assignment the group flows into the main
 * list below on the next refetch, so no navigation is required.
 *
 * The list and the picker share the same `inboxHiddenBucket=unclassified`
 * predicate as the count endpoint, so the section count, the chip count,
 * and the rows we render can never disagree.
 */
interface UnclassifiedResponsesSectionProps {
  /** Task #813 — currently-selected group id (from the URL), so the
   *  active unclassified row gets a "selected" treatment instead of
   *  pretending nothing is open. */
  selectedId: number | null;
  /** Task #813 — opens the row in the existing detail pane instead of
   *  navigating away to `/invoice-groups/:id`. */
  onSelect: (id: number) => void;
}

function UnclassifiedResponsesSection({
  selectedId,
  onSelect,
}: UnclassifiedResponsesSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const listParams = {
    inboxHiddenBucket: "unclassified",
    limit: 100,
  } as const;
  const { data: listData, isLoading: groupsLoading } = useListInvoiceGroups(
    listParams,
    { query: { queryKey: getListInvoiceGroupsQueryKey(listParams) } },
  );
  const { data: errorTypesData, isLoading: typesLoading } = useListErrorTypes();
  const bulkAssign = useBulkAssignInvoiceGroupErrorType();
  const [pendingId, setPendingId] = useState<number | null>(null);

  const groups = listData?.groups ?? [];
  const errorTypes = errorTypesData ?? [];

  if (groupsLoading) {
    return (
      <Skeleton
        className="h-24 w-full"
        data-testid="unclassified-responses-section-loading"
      />
    );
  }
  if (groups.length === 0) {
    return null;
  }

  const handleAssign = async (groupId: number, errorTypeId: string) => {
    if (!errorTypeId) return;
    const et = errorTypes.find((t) => String(t.id) === errorTypeId);
    if (!et) return;
    setPendingId(groupId);
    try {
      await bulkAssign.mutateAsync({
        data: {
          groupIds: [groupId],
          errorTypeId: String(et.id),
          errorTypeName: et.name,
        },
      });
      successToast({
        title: "Error type assigned",
        description: `${et.name} applied — group will appear in the list below.`,
        duration: 2500,
      });
      // Re-fetch the unclassified list (this section), the awaiting-review
      // list (so the newly classified group appears below), and the
      // hidden-counts (so the strip total stays accurate).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey(listParams) }),
        queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey({ macroPhase: "response-pending", limit: 500, includeExpired: true, errorTypeAssigned: true }) }),
        queryClient.invalidateQueries({ queryKey: getGetResponsesAwaitingReviewHiddenCountsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetResponsesAwaitingReviewCountQueryKey() }),
      ]);
    } catch (err) {
      toast({
        title: "Couldn't assign error type",
        description: err instanceof Error ? err.message : "Try again or refresh.",
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card
      className="border-amber-300 bg-amber-50/40"
      data-testid="unclassified-responses-section"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          {groups.length} payor response{groups.length === 1 ? "" : "s"} waiting on an error type
        </CardTitle>
        <p className="text-xs text-amber-900/80">
          The payor replied on these but no error type has been picked yet,
          so they can't show up in the queue below. Pick a type to send each
          one into review.
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {groups.map((g) => {
          const isActive = selectedId === g.id;
          return (
          <div
            key={g.id}
            className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
              isActive
                ? "border-amber-500 bg-amber-100/60 ring-1 ring-amber-400"
                : "border-amber-200 bg-background"
            }`}
            data-testid={`unclassified-row-${g.id}`}
            data-active={isActive ? "true" : undefined}
          >
            {/* Task #813 — primary click target now opens the group in
                the existing detail pane on the right instead of
                navigating to the standalone /invoice-groups detail
                page. The inline error-type Select below still works
                exactly as before, including stopPropagation so its
                trigger click doesn't double as a row click. */}
            <button
              type="button"
              onClick={() => onSelect(g.id)}
              aria-pressed={isActive}
              className="font-medium text-sm hover:underline text-left"
              data-testid={`unclassified-row-select-${g.id}`}
            >
              <RefNumber value={g.invoiceNumber} />
            </button>
            <StateBadge variant="status" value={g.status} />
            <span className="text-xs text-muted-foreground">
              Updated {formatDateTime(g.updatedAt as unknown as string)}
            </span>
            <div
              className="ml-auto flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-xs text-muted-foreground">Error type:</span>
              <Select
                disabled={typesLoading || (pendingId === g.id) || bulkAssign.isPending}
                onValueChange={(value) => handleAssign(g.id, value)}
              >
                <SelectTrigger
                  className="h-8 w-[260px] text-xs bg-background"
                  data-testid={`unclassified-error-type-select-${g.id}`}
                  aria-label={`Assign error type to ${g.invoiceNumber}`}
                >
                  <SelectValue placeholder="Select error type…" />
                </SelectTrigger>
                <SelectContent>
                  {errorTypes.map((et) => (
                    <SelectItem key={et.id} value={String(et.id)}>
                      {et.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pendingId === g.id && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-700" />
              )}
            </div>
          </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * Task #546 — "what's hidden from this view" summary strip.
 *
 * The Responses Awaiting Review inbox silently filters out groups that
 * don't satisfy every criterion (no error type, "wait for payor again"
 * suppression active, every response demoted to acknowledgment/abstain).
 * Without this strip an operator can't tell "nothing to do" apart from
 * "things are hiding". The chips give per-bucket counts that link to
 * exactly those groups; when every bucket is zero the strip collapses
 * to a single quiet line so the absence of items is itself reassuring.
 *
 * Counts come from `GET /responses/awaiting-review/hidden-counts`,
 * which is invalidated on the same SSE pulse the inbox uses (see
 * `useInvoiceGroupsListEvents`).
 */
/**
 * Task #759 — Header V2 split. The "Hidden from this view" strip used to
 * render its own card wrapper (or a "Nothing hidden" italic line, or a
 * skeleton) directly between the prose blurb and the FilterBar. The V2
 * layout puts those chips inside the collapsible "Showing/Hiding" state
 * strip alongside the active filter chips, and collapses the strip
 * entirely when both groups are empty.
 *
 * This hook returns ready-to-render chip nodes plus visibility flags so
 * the <ReviewHeader> composer can decide whether the state strip
 * appears at all. Loading / empty markers are still rendered as
 * sr-only spans so existing test ids
 * (`hidden-items-strip-loading`, `hidden-items-strip-empty`) keep
 * resolving in the canonical states.
 */
interface UseHiddenItemsChipsArgs {
  activeBucket: HiddenBucket | null;
  onToggleBucket: (next: HiddenBucket | null) => void;
}

function useHiddenItemsChips({
  activeBucket,
  onToggleBucket,
}: UseHiddenItemsChipsArgs): HiddenItemsSlots {
  const { data, isLoading } = useGetResponsesAwaitingReviewHiddenCounts({
    query: { queryKey: getGetResponsesAwaitingReviewHiddenCountsQueryKey() },
  });

  if (isLoading || !data) {
    return {
      isLoading: true,
      hasChips: false,
      chips: null,
      activeBucket: null,
      marker: (
        <Skeleton
          className="sr-only"
          data-testid="hidden-items-strip-loading"
        />
      ),
    };
  }

  const { awaitingPayorAgain, acknowledgmentOnly } = data;
  // `unclassified` is intentionally excluded — it has its own actionable
  // section above (UnclassifiedResponsesSection), so this collapses to
  // "Nothing hidden" when the only hidden items are unclassified ones.
  const totalHidden = awaitingPayorAgain + acknowledgmentOnly;

  // Task #813 — the chips now double as inline view toggles. We render
  // them even when their count drops to zero IF that bucket is the
  // currently active view, so the operator always has an obvious way
  // to step back out of the bucket.
  if (totalHidden === 0 && activeBucket === null) {
    return {
      isLoading: false,
      hasChips: false,
      chips: null,
      activeBucket: null,
      marker: (
        <span className="sr-only" data-testid="hidden-items-strip-empty">
          Nothing hidden from this view.
        </span>
      ),
    };
  }

  // Task #813 — chip metadata. The chips are buttons that toggle the
  // view URL param rather than navigation links to a different page.
  const chips: Array<{
    key: HiddenBucket;
    label: string;
    tooltip: string;
    toneClass: string;
    activeToneClass: string;
    show: boolean;
  }> = [
    {
      key: "awaitingPayorAgain",
      label: `${awaitingPayorAgain} waiting for payor again`,
      tooltip:
        "Operator clicked \"I replied — wait for payor again\" and no newer reply has arrived. Click to view these in place; click again to return to the default Awaiting Review list.",
      toneClass: "bg-blue-50 hover:bg-blue-100 border-blue-300 text-blue-900",
      activeToneClass: "bg-blue-600 hover:bg-blue-700 border-blue-700 text-white",
      show: awaitingPayorAgain > 0 || activeBucket === "awaitingPayorAgain",
    },
    {
      key: "acknowledgmentOnly",
      label:
        acknowledgmentOnly === 1
          ? "1 has only acknowledgment/abstain responses"
          : `${acknowledgmentOnly} have only acknowledgment/abstain responses`,
      tooltip:
        "Every response on file has been (re)classified as acknowledgment or abstain, so there's no verdict to take. Click to view these in place; click again to return to the default Awaiting Review list.",
      toneClass: "bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-800",
      activeToneClass: "bg-slate-700 hover:bg-slate-800 border-slate-800 text-white",
      show: acknowledgmentOnly > 0 || activeBucket === "acknowledgmentOnly",
    },
  ];

  const visibleChips = chips.filter((c) => c.show);

  return {
    isLoading: false,
    hasChips: visibleChips.length > 0,
    activeBucket,
    chips: (
      <>
        {visibleChips.map((chip) => {
          const isActive = activeBucket === chip.key;
          return (
            <Tooltip key={chip.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onToggleBucket(isActive ? null : chip.key)}
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${isActive ? chip.activeToneClass : chip.toneClass}`}
                  data-testid={`hidden-items-chip-${chip.key}`}
                  data-active={isActive ? "true" : undefined}
                >
                  {chip.label}
                  {isActive && (
                    <X
                      className="h-3 w-3"
                      aria-hidden="true"
                      data-testid={`hidden-items-chip-${chip.key}-clear`}
                    />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{chip.tooltip}</TooltipContent>
            </Tooltip>
          );
        })}
      </>
    ),
    marker: null,
  };
}

/**
 * Task #759 — Header V2 ("Controls / State Split") composer.
 *
 * Renders three rows:
 *   1. Title row: page title + verdict-pending count badge + info-icon
 *      tooltip carrying the long "Stage 2 inbox…" copy + a short
 *      "Stage 2 inbox · oldest first" caption.
 *   2. Toolbar row: filter trigger + search + (HC-shortcut OR sort) on
 *      the right. Hidden when the inbox is genuinely empty (no rows AND
 *      no active filters), so the empty-state success card stands alone.
 *   3. Bulk-approve bar (slides in below the toolbar when the operator
 *      has selected rows; replaces the inline HC-shortcut on the right
 *      of the toolbar to avoid duplication).
 *   4. State strip: collapsible "Showing / Hiding" block surfacing
 *      active filter chips and hidden-bucket chips. The whole strip
 *      disappears when there are no chips on either side.
 *
 * The duplicate "Select all High-confidence Approvals" header button has
 * been removed; only the inline toolbar shortcut (when selection = 0)
 * and the bulk-bar instance (when selection > 0) remain.
 */
interface BulkApproveRowMeta {
  portalResponseId: number | null;
  eligible: boolean;
  reason: string | null;
  totalAmount: number;
  refNumber: string | null;
}

interface WorkspaceProps {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  groups: InvoiceGroupResponse[];
  selectedGroup: InvoiceGroupResponse | null;
  onSelect: (id: number) => void;
  onAfterVerdict: (message: string) => void;
  selectedGroupIds: Set<number>;
  bulkApproveByGroupId: Map<number, BulkApproveRowMeta>;
  onToggleSelected: (id: number, checked: boolean) => void;
  onSelectAllEligible: () => void;
  onClearSelection: () => void;
  /** Task #753 — switches the empty state copy + adds a "Clear filters"
   *  affordance when the zero-row state is the result of an active
   *  filter rather than a genuinely empty inbox. */
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  /** Task #813 — when a hidden bucket is being viewed inline, the
   *  empty-state copy should reflect that ("Nothing in this bucket
   *  right now") instead of the default filtered-empty messaging. */
  activeHiddenBucket?: HiddenBucket | null;
}

function Workspace({
  isLoading,
  isError,
  onRetry,
  groups,
  selectedGroup,
  onSelect,
  onAfterVerdict,
  selectedGroupIds,
  bulkApproveByGroupId,
  onToggleSelected,
  onSelectAllEligible,
  onClearSelection,
  hasActiveFilters = false,
  onClearFilters,
  activeHiddenBucket = null,
}: WorkspaceProps) {
  // Per-group scroll position cache. Each row click captures the
  // current scroll position under the *previous* selection, so when the
  // operator returns to that group the page restores their place
  // instead of jerking back to the top of the thread. Lives in the
  // parent so it survives DetailPane unmount/remount across selections.
  const scrollByGroupRef = useRef<Map<number, number>>(new Map());
  const previousIdRef = useRef<number | null>(selectedGroup?.id ?? null);
  useEffect(() => {
    const prev = previousIdRef.current;
    const next = selectedGroup?.id ?? null;
    if (prev !== null && prev !== next && typeof window !== "undefined") {
      scrollByGroupRef.current.set(prev, window.scrollY);
    }
    previousIdRef.current = next;
  }, [selectedGroup?.id]);
  if (isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <AlertTriangle className="h-6 w-6 mx-auto text-destructive" />
          <p className="text-sm text-muted-foreground">
            Couldn't load awaiting-review groups. The server may be busy — try again.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <SkeletonSwap
      loading={isLoading}
      skeleton={
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_360px] gap-4">
          <Skeleton className="h-[480px] w-full" />
          <Skeleton className="h-[480px] w-full" />
          <Skeleton className="h-[480px] w-full" />
        </div>
      }
    >
      {groups.length === 0 ? (
        hasActiveFilters ? (
          <Card data-testid="empty-state-filtered">
            <CardContent className="py-6 text-center space-y-3">
              <EmptyState
                icon={Inbox}
                title={
                  activeHiddenBucket === "awaitingPayorAgain"
                    ? "Nothing waiting for the payor again right now"
                    : activeHiddenBucket === "acknowledgmentOnly"
                      ? "No groups with only acknowledgment/abstain responses"
                      : "No matches for the active filters"
                }
                description={
                  activeHiddenBucket !== null
                    ? "Clear this view to return to the default Awaiting Review list."
                    : "Try widening a date range, dropping a status, or clearing the search to see more responses."
                }
              />
              {onClearFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClearFilters}
                  data-testid="empty-state-clear-filters"
                >
                  {activeHiddenBucket !== null ? "Back to Awaiting Review" : "Clear filters"}
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card data-testid="empty-state">
            <CardContent className="py-6">
              <EmptyState
                icon={CheckCircle}
                title="All caught up — no payor responses awaiting a verdict"
                description="When a payor reply needs a human decision, it'll show up here so you can act on it."
              />
            </CardContent>
          </Card>
        )
      ) : (
    <div
      className="grid grid-cols-1 lg:grid-cols-[320px_1fr_360px] gap-4 items-start"
      data-testid="awaiting-review-workspace"
    >
      {/*
        Column 1 — master list. Wrapped in a sticky container so the
        step-1 pill stays glued to the list card. Sticky moved off the
        Card itself onto the wrapper so the pill scrolls with it.
      */}
      <ListColumn
        groups={groups}
        selectedGroup={selectedGroup}
        onSelect={onSelect}
        selectedGroupIds={selectedGroupIds}
        bulkApproveByGroupId={bulkApproveByGroupId}
        onToggleSelected={onToggleSelected}
        onSelectAllEligible={onSelectAllEligible}
        onClearSelection={onClearSelection}
      />

      {selectedGroup && (
        <DetailPane
          key={selectedGroup.id}
          group={selectedGroup}
          onAfterVerdict={onAfterVerdict}
          restoreScrollY={scrollByGroupRef.current.get(selectedGroup.id) ?? null}
        />
      )}
    </div>
      )}
    </SkeletonSwap>
  );
}

interface ListColumnProps {
  groups: InvoiceGroupResponse[];
  selectedGroup: InvoiceGroupResponse | null;
  onSelect: (id: number) => void;
  selectedGroupIds: Set<number>;
  bulkApproveByGroupId: Map<number, BulkApproveRowMeta>;
  onToggleSelected: (id: number, checked: boolean) => void;
  onSelectAllEligible: () => void;
  onClearSelection: () => void;
}

function ListColumn({
  groups,
  selectedGroup,
  onSelect,
  selectedGroupIds,
  bulkApproveByGroupId,
  onToggleSelected,
}: ListColumnProps) {
  // Task #490 — soften row removal. When the operator records a verdict
  // the previously-selected row holds its slot for ~360ms while the
  // success-tint settle plays, then unmounts; the auto-advanced row
  // gets a brief highlight ring so the change reads as the system
  // moving the operator forward rather than a silent jump.
  const settle = useRowSettle(groups, (g) => g.id, selectedGroup?.id ?? null);
  return (
    <div className="lg:sticky lg:top-4 space-y-2" data-tour="responses-thread">
      <StepPill
        number={1}
        label="Pick a response"
        testId="step-pill-1"
        help="Choose the payor reply you want to work on. The list is sorted oldest-first by default so the longest-waiting responses bubble to the top."
      />
      <Card>
        <ScrollArea className="h-[calc(100vh-260px)] max-h-[720px]">
          <ul className="divide-y" data-testid="awaiting-review-list">
            {settle.slots.map((slot) => {
              const meta = bulkApproveByGroupId.get(slot.item.id);
              return (
                <ListRow
                  key={slot.item.id}
                  group={slot.item}
                  isSelected={selectedGroup?.id === slot.item.id}
                  onSelect={() => onSelect(slot.item.id)}
                  isSettling={slot.isSettling}
                  isJustSelected={settle.isJustSelected(slot.item.id)}
                  bulkEligible={meta?.eligible ?? false}
                  bulkSkipReason={meta?.reason ?? null}
                  bulkSelected={selectedGroupIds.has(slot.item.id)}
                  onBulkToggle={(checked) => onToggleSelected(slot.item.id, checked)}
                />
              );
            })}
          </ul>
        </ScrollArea>
      </Card>
    </div>
  );
}

interface ListRowProps {
  group: InvoiceGroupResponse;
  isSelected: boolean;
  onSelect: () => void;
  /** Task #490 — settle animation while the row is being removed. */
  isSettling?: boolean;
  /** Task #490 — brief highlight ring after auto-advance. */
  isJustSelected?: boolean;
  /** Task #750 — does this row pass the AI/approval/high-confidence
   *  client-side gate? Drives whether the bulk-approve checkbox is
   *  enabled and which tooltip the operator sees. */
  bulkEligible?: boolean;
  bulkSkipReason?: string | null;
  bulkSelected?: boolean;
  onBulkToggle?: (checked: boolean) => void;
}

function ListRow({
  group,
  isSelected,
  onSelect,
  isSettling = false,
  isJustSelected = false,
  bulkEligible = false,
  bulkSkipReason = null,
  bulkSelected = false,
  onBulkToggle,
}: ListRowProps) {
  // Lightweight per-row enrichment: pull the group's latest reviewable
  // response so the row can show the response-type pill + AI summary one-
  // liner. Same data the Queue card surfaces — kept in sync deliberately.
  // Per Task #236: the visible "X of Y rides" reflects post-exclusion
  // counts so the master list and the detail rail agree.
  const { data: detail } = useGetInvoiceGroup(group.id);
  const latestResponse = pickLatestReviewableResponse(detail?.responses);
  const includedCount = useMemo(() => {
    const rides = detail?.rides;
    if (!Array.isArray(rides)) return null;
    return rides.filter((r) => r.includedInDispute !== false).length;
  }, [detail?.rides]);
  const totalCount = group.rideCount;

  const checkboxTooltip = bulkEligible
    ? "Select for Bulk Approve (high-confidence AI Approval)"
    : bulkSkipReason
      ? `Not eligible for Bulk Approve — ${bulkApproveSkipLabel(bulkSkipReason)}`
      : "Not eligible for Bulk Approve";

  return (
    <li
      className={`${isSettling ? "cc-row-settling" : ""} ${isJustSelected ? "cc-row-just-selected" : ""} flex items-stretch ${isSelected ? "bg-muted" : ""}`}
      data-settling={isSettling ? "true" : undefined}
    >
      {onBulkToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center pl-3 pr-1">
              <Checkbox
                checked={bulkSelected}
                disabled={isSettling}
                onCheckedChange={(checked) => onBulkToggle(checked === true)}
                onClick={(e) => e.stopPropagation()}
                aria-label={checkboxTooltip}
                data-testid={`bulk-approve-row-checkbox-${group.id}`}
                data-bulk-eligible={bulkEligible ? "true" : "false"}
                {...(bulkSkipReason ? { "data-bulk-skip-reason": bulkSkipReason } : {})}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{checkboxTooltip}</TooltipContent>
        </Tooltip>
      )}
      <button
        type="button"
        onClick={onSelect}
        disabled={isSettling}
        aria-pressed={isSelected}
        data-testid={`awaiting-review-row-${group.id}`}
        className={`flex-1 text-left px-4 py-3 transition-colors ${
          isSelected ? "bg-muted" : "hover:bg-muted/50"
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <UrgentTodayBadge isUrgent={group.isUrgent} />
          <span className="font-mono text-sm font-semibold inline-flex items-center gap-1">
            #<RefNumber value={group.invoiceNumber} variant="inline" />
          </span>
          <span className="text-xs text-muted-foreground">
            {includedCount !== null && includedCount !== totalCount
              ? `${includedCount} of ${totalCount} rides`
              : `${totalCount} ride${totalCount !== 1 ? "s" : ""}`}
          </span>
          <span className="ml-auto text-sm font-medium whitespace-nowrap">
            {formatCurrency(group.totalAmount)}
          </span>
        </div>

        {/* Task #753 — service-date + leg-of-record context line. Pairs
            the row with the leg the latest reviewable response belongs
            to (server-resolved `primaryLeg`), and surfaces "+N more" so
            the operator knows when the group spans multiple legs. */}
        {(group.earliestDate || group.primaryLeg) && (
          <div
            className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap"
            data-testid={`row-leg-meta-${group.id}`}
          >
            {group.earliestDate && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {formatDateCompact(group.earliestDate)}
              </span>
            )}
            {group.primaryLeg && (
              <>
                {group.earliestDate && <span aria-hidden>·</span>}
                <span className="font-mono inline-flex items-center gap-1">
                  {group.primaryLeg.confNumber
                    ? <>Leg #<RefNumber value={group.primaryLeg.confNumber} variant="inline" /></>
                    : <>Leg #{group.primaryLeg.id}</>}
                </span>
              </>
            )}
            {typeof group.legCount === "number" && group.legCount > 1 && (
              <>
                <span aria-hidden>·</span>
                <span>+{group.legCount - 1} more</span>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <StateBadge variant="status" value={group.status} />
          {latestResponse ? (
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${getResponseTypePillClass(latestResponse.responseType)}`}
              title="AI / keyword classification — a hint, not the verdict"
            >
              {getResponseTypeLabel(latestResponse.responseType)}
            </span>
          ) : null}
        </div>

        {latestResponse?.aiSummary && (
          <p
            className="text-xs text-muted-foreground mt-1.5 line-clamp-2"
            title={latestResponse.aiSummary}
          >
            {latestResponse.aiSummary}
          </p>
        )}
        {latestResponse?.receivedAt && (
          <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Received {formatDateTime(latestResponse.receivedAt)}
          </div>
        )}
        {!latestResponse && (
          <p className="text-xs text-muted-foreground italic mt-1.5">
            Response details unavailable.
          </p>
        )}
      </button>
    </li>
  );
}

interface DetailPaneProps {
  group: InvoiceGroupResponse;
  onAfterVerdict: (message: string) => void;
  /** Cached window.scrollY from the last time this group was viewed.
   *  Null means "first visit, leave scroll alone". Restored once on
   *  mount so the operator returns to the message they were reading. */
  restoreScrollY: number | null;
}

/**
 * The right side of the workspace — renders two grid cells (thread main +
 * sticky action rail) as siblings inside the parent grid. Returning a
 * fragment lets the parent CSS Grid place each in its own column without
 * an extra wrapping element.
 */
function DetailPane({ group, onAfterVerdict, restoreScrollY }: DetailPaneProps) {
  // Subscribe to per-group SSE events so the detail pane refreshes as the
  // payor's response gets re-tagged or as siblings move through verdict
  // actions in another tab.
  useInvoiceGroupEvents(group.id);
  const { viewers } = usePresence("invoice_group", group.id);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: detail, isPending: detailPending } = useGetInvoiceGroup(group.id);

  const responses: PortalResponseItem[] = detail?.responses ?? [];
  const allRides: ClaimResponse[] = detail?.rides ?? [];

  // Real group email thread (Task #240). Swap-in for the prior mock — same
  // data layer feeds the full invoice-group detail page, so reviewers see
  // identical conversations on either screen.
  const { data: emailThread, isPending: emailThreadPending } =
    useGetInvoiceGroupEmailThread(group.id);
  const legIdToLabel = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of allRides) {
      map.set(r.id, r.confNumber ? `${r.confNumber}` : `Leg #${r.id}`);
    }
    return map;
  }, [allRides]);
  const conversations = useMemo(
    () => mapToGroupConversations(emailThread, legIdToLabel),
    [emailThread, legIdToLabel],
  );

  // Gates the "I replied — wait for payor again" button on the
  // What's-next card: the button must stay disabled until the operator
  // has actually sent at least one outbound reply on this group's
  // email thread. Reading the merged thread directly (not the page-
  // local conversation adapter) so a reply sent from anywhere on this
  // page — or from the full invoice-group detail page — flips the
  // gate without us having to maintain a parallel signal.
  const hasOperatorReply = useMemo(
    () => (emailThread?.messages ?? []).some((m) => m.direction === "outbound"),
    [emailThread],
  );

  const replyMutation = useReplyToInvoiceGroupEmailConversation();
  // Fallback for legacy threads with no conversationId — see the matching
  // wiring on the invoice-group detail page.
  const freshSendMutation = useSendInvoiceGroupEmail();

  // The thread component's own `id="invoice-thread"` anchor is what the
  // page scrolls to on first visit — the same anchor used on the
  // invoice-group detail page, so one implementation serves both
  // callers. On first visit we jump to the thread anchor; on a return
  // visit we restore the operator's previous scroll position so
  // re-reading mid-thread doesn't bounce them back to the top.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.requestAnimationFrame(() => {
      if (restoreScrollY !== null) {
        window.scrollTo({ top: restoreScrollY, behavior: "auto" });
      } else {
        const el = document.getElementById("invoice-thread");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    return () => window.cancelAnimationFrame(id);
    // Intentionally only on mount of this specific group — the parent
    // remounts DetailPane via `key={selectedGroup.id}`, so this effect
    // runs exactly once per selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestResponse = useMemo(
    () => pickLatestReviewableResponse(responses),
    [responses],
  );
  // Empty-thread state: the group has no reviewable responses at all.
  // Hide the action rail entirely (no work to record) and surface a
  // single link out so the operator can investigate.
  const hasReviewableResponse = !!latestResponse;
  // Real-data fallback: a reviewable response exists but no conversation
  // has been linked to it (e.g. portal-only response, email never
  // synced). Now that #240 wires real conversation data, this branch
  // activates whenever the group has zero email conversations on file
  // and the operator gets the response body inline instead.
  const hasConversations = conversations.length > 0;

  return (
    <>
      <div
        className="space-y-2 min-w-0"
        data-testid={`detail-pane-${group.id}`}
        data-tour="responses-airead"
      >
        <HumanPresenceBanner viewers={viewers} resourceLabel="group" />
        {/*
          Step 2 pill — sits flush above the email thread so the 1-2-3
          reading order is obvious to a new operator at a glance. On
          stacked (mobile) layouts the columns reflow vertically and the
          pill keeps its position above its own column, preserving the
          1-2-3 order. Per Task #262 the previous "Jump to thread"
          banner is intentionally gone — the email is already on screen.
        */}
        <StepPill
          number={2}
          label="Read the reply"
          testId="step-pill-2"
          help="Read the payor's words in full. The AI summary is a hint — never the verdict. Reply in-thread if you need clarification."
        />

        {/* Task #753 — invoice + leg pair header for the middle column.
            Mirrors the leg-of-record line on the list row so the operator
            can confirm at a glance which invoice + leg the thread + AI
            hint + verdict actions all refer to. Falls back to
            primaryLeg.id when confNumber is null. */}
        <div
          className="text-xs text-muted-foreground font-mono inline-flex items-center gap-1.5 flex-wrap"
          data-testid="middle-column-invoice-leg-pair"
        >
          <span>#<RefNumber value={group.invoiceNumber || `${group.id}`} variant="inline" /></span>
          {group.primaryLeg && (
            <>
              <span aria-hidden>·</span>
              {group.primaryLeg.confNumber
                ? <span>Leg #<RefNumber value={group.primaryLeg.confNumber} variant="inline" /></span>
                : <span>Leg #{group.primaryLeg.id}</span>}
            </>
          )}
        </div>

        {detailPending || (hasReviewableResponse && emailThreadPending) ? (
          <Card data-testid="thread-loading-state">
            <CardContent className="py-10">
              <Skeleton className="h-6 w-1/3 mb-4" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-5/6 mb-2" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ) : hasReviewableResponse && hasConversations ? (
          <GroupCommunicationThread
            conversations={conversations}
            groupInvoiceNumber={group.invoiceNumber || `#${group.id}`}
            groupId={group.id}
            isSending={replyMutation.isPending || freshSendMutation.isPending}
            onReply={async (input) => {
              try {
                if (!input.conversationId) {
                  await freshSendMutation.mutateAsync({
                    id: group.id,
                    data: {
                      subject: input.subject,
                      bodyText: htmlBodyToPlainText(input.bodyHtml),
                      to: input.to,
                      cc: input.cc.length > 0 ? input.cc : undefined,
                      attachments:
                        input.attachments.length > 0 ? input.attachments : undefined,
                    },
                  });
                } else {
                  await replyMutation.mutateAsync({
                    id: group.id,
                    conversationId: input.conversationId,
                    data: {
                      subject: input.subject,
                      bodyText: htmlBodyToPlainText(input.bodyHtml),
                      to: input.to,
                      cc: input.cc.length > 0 ? input.cc : undefined,
                      attachments:
                        input.attachments.length > 0 ? input.attachments : undefined,
                    },
                  });
                }
                successToast({
                  title: "__VERB__",
                  description: `Reply sent to ${input.to.join(", ")}`,
                });
                // Repaint the thread immediately with the persisted
                // outbound row + refresh other surfaces (group detail,
                // responses count) that depend on the new audit row.
                await queryClient.invalidateQueries({
                  queryKey: getGetInvoiceGroupEmailThreadQueryKey(group.id),
                });
                await queryClient.invalidateQueries({
                  queryKey: getGetInvoiceGroupQueryKey(group.id),
                });
              } catch (err) {
                toast({
                  title: "Failed to send reply",
                  description:
                    err instanceof Error ? err.message : "Please try again.",
                  variant: "destructive",
                });
                // Re-throw so the composer keeps the draft body for retry.
                throw err;
              }
            }}
          />
        ) : hasReviewableResponse && latestResponse ? (
          <InlineResponseFallback
            response={latestResponse}
            invoiceNumber={group.invoiceNumber || `#${group.id}`}
            groupId={group.id}
          />
        ) : (
          <Card data-testid="thread-empty-state">
            <CardContent className="py-10 text-center space-y-3">
              <Inbox className="h-6 w-6 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No payor reply on file for this group yet — open full details
                to investigate.
              </p>
              <Link href={`/invoice-groups/${group.id}`}>
                <Button variant="outline" size="sm" data-testid="empty-thread-open-full">
                  Open full details
                  <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {hasReviewableResponse && (
        // Wrapper carries both the step-3 pill *and* the sticky behaviour
        // so the rail still pins to the viewport on lg+ while keeping the
        // pill flush above its first card.
        <div className="lg:sticky lg:top-4 space-y-2">
          <StepPill
            number={3}
            label="Record the verdict"
            testId="step-pill-3"
            help="For each leg the payor addressed, mark whether they approved or denied your dispute. Verdicts are per-leg and binary — Approved / Partially Approved roll up the same way."
          />
          <ActionRail
            group={group}
            detail={detail as InvoiceGroupDetailResponse | undefined}
            allRides={allRides}
            responses={responses}
            hasOperatorReply={hasOperatorReply}
            onAfterVerdict={onAfterVerdict}
          />
        </div>
      )}
    </>
  );
}

interface StepPillProps {
  number: 1 | 2 | 3 | 4;
  label: string;
  testId: string;
  /** Optional hover/focus tooltip explaining the step in plain English. */
  help?: string;
}

/**
 * Small numbered guidance label rendered flush above the first card in
 * each of the four workflow columns ("1. Pick a response",
 * "2. Read the reply", "3. Record the verdict",
 * "4. Pick the next step"). Style is intentionally subtle — uppercase
 * tracking, muted accent, no boxed background — so it reads as
 * guidance, not chrome.
 *
 * When `help` is provided we render a small `(?)` icon beside the
 * label that pops a tooltip on hover or keyboard focus. The icon is a
 * real `<button>` so it's keyboard-reachable; the icon button uses
 * the verbatim copy passed in via `help` (no remapping in here — the
 * call site owns the wording so review is one-stop).
 */
function StepPill({ number, label, testId, help }: StepPillProps) {
  return (
    <div
      className="text-[11px] uppercase font-semibold tracking-wide text-muted-foreground flex items-center gap-1.5"
      data-testid={testId}
    >
      <span className="text-primary">{number}.</span>
      <span>{label}</span>
      {help && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`What does step ${number} mean?`}
              className="inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`${testId}-help`}
            >
              <HelpCircle className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-w-xs text-xs leading-relaxed normal-case font-normal tracking-normal"
          >
            {help}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface ActionRailProps {
  group: InvoiceGroupResponse;
  detail: InvoiceGroupDetailResponse | undefined;
  allRides: ClaimResponse[];
  /** Latest payor responses on the group — feeds the WhatsNextCard's
   *  metadata derivation (new invoice number, AI denial-reason hint). */
  responses: PortalResponseItem[];
  /** Forwarded to WhatsNextCard so the "I replied" button stays
   *  disabled until the operator has actually sent a reply. */
  hasOperatorReply: boolean;
  onAfterVerdict: (message: string) => void;
}

/**
 * Right-side action rail. Hosts the per-leg verdict picker and the
 * verdict-derived "What's next?" card — the workflow-relevant controls.
 *
 * Per Task #262 the rail no longer renders a top summary card. Per
 * Task #322 the legacy `postResponseActions` continuation lane is
 * gone — re-attest, denial-reason capture, and closure are all driven
 * by the per-leg verdict mix and live in `WhatsNextCard`.
 *
 * Sticky positioning is applied by the parent wrapper so step pills 3
 * and 4 stay glued to the rail.
 */
// Task #196 contract: an operator-recordable verdict requires the leg's
// `sop_outcome` to be in the submitted set. Mirrored on the API side at
// `POST /claims/:id/verdict`. Pulled out so the action-rail filter and
// the per-leg picker stay in lockstep.
const SUBMITTED_SOP_OUTCOMES = new Set<string>(["portal_dispute", "dispute"]);

function isLegReadyForActionablePicker(r: ClaimResponse): boolean {
  // Sibling duplicates derive their verdict from the primary leg
  // (Task #309) — they MUST NEVER appear in the per-leg picker stack.
  // Use `outcomeRole` as the single source of truth for "is duplicate"
  // so this filter can't drift from the leg-state classifier the rest
  // of the app already trusts.
  if (outcomeRole(r) === "duplicate") return false;
  return (
    r.includedInDispute !== false &&
    !!r.errorTypeId &&
    // Either the modern SOP gate has been crossed, or the leg already
    // has an operator-confirmed verdict on file (so the picker can render
    // its "Verdict recorded" confirmation card). The second clause keeps
    // legs healed via the Task #301 reconcile path visible inside the
    // normal stack after their verdict lands, even though the leg's
    // `sop_outcome` is still NULL.
    (SUBMITTED_SOP_OUTCOMES.has(r.sopOutcome ?? "") ||
      r.latestVerdict?.source === "operator_confirmed")
  );
}

function isLegPreGroupReconcileCandidate(r: ClaimResponse): boolean {
  return (
    r.includedInDispute !== false &&
    !!r.errorTypeId &&
    !SUBMITTED_SOP_OUTCOMES.has(r.sopOutcome ?? "") &&
    r.latestVerdict?.source !== "operator_confirmed"
  );
}

function ActionRail({
  group,
  detail,
  allRides,
  responses,
  hasOperatorReply,
  onAfterVerdict,
}: ActionRailProps) {
  // Real, actionable legs the operator can pick a verdict on. Mirrors
  // the predicate from invoice-group-detail-v2 plus the API-side
  // `sop_outcome ∈ {portal_dispute, dispute}` gate so the picker never
  // shows Approved/Denied buttons the API will reject (Task #301).
  // Per-leg "Partial" was retired — verdicts are binary at the leg level.
  // Auto-excluded legs (per #232) and `Processed` legs (per #231) flow
  // through naturally — excluded legs render below as a read-only summary
  // and Processed legs stay in the picker stack.
  const actionableRides = useMemo(
    () => allRides.filter(isLegReadyForActionablePicker),
    [allRides],
  );
  // Task #301: legs that pre-date the invoice-group flow — included,
  // classified, but no `sop_outcome` because they were filed before the
  // SOP walk shipped. Surfaced in their own section with a "Record
  // outcome anyway" affordance that goes through the verdict endpoint's
  // `reconcile: true` flag.
  const preGroupRides = useMemo(
    () => allRides.filter(isLegPreGroupReconcileCandidate),
    [allRides],
  );
  const excludedRides = useMemo(
    () => allRides.filter((r) => r.includedInDispute === false),
    [allRides],
  );
  // Task #309: Sibling-duplicate legs are filtered out of
  // `actionableRides` (no per-leg pick — the verdict follows the
  // primary). Collect them here so the rail can show a small
  // muted section that makes the relationship visible. `outcomeRole`
  // is the single source of truth for "is duplicate" — the action
  // rail filter and this memo MUST agree.
  const duplicateRides = useMemo(
    () => allRides.filter((r) => outcomeRole(r) === "duplicate"),
    [allRides],
  );

  return (
    <div className="space-y-3" data-testid="action-rail" data-tour="responses-verdict">
      {detail && (
        <PerLegVerdictRailSection
          actionableRides={actionableRides}
          excludedRides={excludedRides}
          onAfterVerdict={onAfterVerdict}
          groupId={group.id}
        />
      )}

      {detail && duplicateRides.length > 0 && (
        <DuplicateLegsRailSection
          duplicateRides={duplicateRides}
          allRides={allRides}
        />
      )}

      {detail && preGroupRides.length > 0 && (
        <PreGroupReconcileRailSection
          rides={preGroupRides}
          onAfterVerdict={onAfterVerdict}
          groupId={group.id}
        />
      )}

      {/*
        Step 4 — verdict-derived "What's next?" card. Pill renders flush
        above the card so the 1-2-3-4 numbering reads top-to-bottom in
        the rail just like the columns to its left. Pill only renders
        when the card is going to render (we already gate on `detail`).
      */}
      {detail && (
        <div className="space-y-2" data-testid="whats-next-section">
          <StepPill
            number={4}
            label="Pick the next step"
            testId="step-pill-4"
            help="The 'I replied — wait for payor' option opens up as soon as you send an in-thread reply, so you can drop a mid-conversation group off the queue without recording per-leg verdicts. Re-attest and Close out still wait until every leg has a verdict."
          />
          <WhatsNextCard
            group={group}
            rides={allRides}
            responses={responses}
            hasOperatorReply={hasOperatorReply}
            onAfterAction={onAfterVerdict}
          />
        </div>
      )}

      {/*
        Bottom escape hatch — single small link out for operators who
        need the full invoice page (filings audit, attachments,
        per-leg drilldown). Replaces the deleted top-of-rail link so the
        path out is still one click away without dominating the rail.
      */}
      <div className="flex justify-end">
        <Link
          href={`/invoice-groups/${group.id}`}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline inline-flex items-center gap-1"
          data-testid="open-full-invoice"
        >
          Open full details
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

interface PerLegVerdictRailSectionProps {
  actionableRides: ClaimResponse[];
  excludedRides: ClaimResponse[];
  onAfterVerdict: (message: string) => void;
  groupId: number;
}

function PerLegVerdictRailSection({
  actionableRides,
  excludedRides,
  onAfterVerdict,
  groupId,
}: PerLegVerdictRailSectionProps) {
  const queryClient = useQueryClient();
  const recordVerdict = useRecordLegVerdict();
  const clearVerdictDraft = useClearLegVerdictDraft();
  const { calibrationByErrorType } = useAiCalibrations(
    actionableRides.map((r) => r.errorTypeId),
  );

  const allResolved = actionableRides.length === 0;

  return (
    <div
      className="rounded-md border bg-card overflow-hidden"
      data-testid="per-leg-picker-stack"
    >
      <div className="px-4 py-2.5 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">Per-leg verdict</h3>
        <p className="text-[11px] text-muted-foreground">
          Pick the verdict for each actionable leg. Non-issue legs are listed
          but not pickable.
        </p>
      </div>
      <div className="p-3 space-y-3">
        {excludedRides.length > 0 && (
          <ul
            className="space-y-1.5 text-xs"
            data-testid="excluded-legs-summary"
          >
            {excludedRides.map((r) => (
              <li
                key={r.id}
                className="flex items-start gap-2 text-muted-foreground"
                data-testid={`excluded-leg-${r.id}`}
              >
                <span className="font-mono shrink-0">#{r.confNumber}</span>
                <span className="italic">
                  auto: {(r.dropReason as string | null) ?? "non-issue"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {allResolved ? (
          <p
            className="text-xs text-muted-foreground italic"
            data-testid="all-legs-resolved"
          >
            All legs already resolved at the group level.
          </p>
        ) : (
          actionableRides.map((claim) => (
            <PerLegVerdictPicker
              key={claim.id}
              claim={claim}
              latestVerdict={claim.latestVerdict ?? null}
              latestDraft={claim.latestDraft ?? null}
              latestSuggestion={claim.latestAiSuggestion ?? null}
              calibration={
                claim.errorTypeId
                  ? calibrationByErrorType.get(claim.errorTypeId)
                  : undefined
              }
              onSelect={async (outcome) => {
                // Task #343: Step 3 saves a draft only — no MAS, no
                // attestation, no group transition. Step 4 commit
                // (re-attest / queue / closure) is what later promotes
                // the drafts to `operator_confirmed` atomically.
                await recordVerdict.mutateAsync({
                  id: claim.id,
                  data: {
                    source: "operator_draft",
                    outcome,
                  },
                });
                // Only invalidate what's needed to reflect the lit-up
                // state. The master list + Responses-Awaiting-Review
                // count are deliberately NOT touched here — drafts
                // don't move the group out of `response-pending`, so
                // re-fetching them would either no-op or, worse, race
                // with the auto-navigate effect on the page.
                queryClient.invalidateQueries({
                  queryKey: getGetInvoiceGroupQueryKey(groupId),
                });
                queryClient.invalidateQueries({
                  queryKey: getGetClaimQueryKey(claim.id),
                });
                onAfterVerdict(`Selection saved for #${claim.confNumber}.`);
              }}
              onClear={async () => {
                // Task #344: clicking the lit pill clears the draft.
                // Same invalidation set as `onSelect` because the
                // change is also draft-only (no group transition, no
                // master-list re-count) — Step 4 hasn't been touched.
                await clearVerdictDraft.mutateAsync({ id: claim.id });
                queryClient.invalidateQueries({
                  queryKey: getGetInvoiceGroupQueryKey(groupId),
                });
                queryClient.invalidateQueries({
                  queryKey: getGetClaimQueryKey(claim.id),
                });
                onAfterVerdict(`Selection cleared for #${claim.confNumber}.`);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Task #309 — Sibling-Duplicate rail section ──────────────────────────
//
// Companion section to PerLegVerdictRailSection. Sibling Duplicates
// have their per-leg pick suppressed (the verdict follows the primary
// leg in the same invoice group), so they're filtered out of
// `actionableRides`. We surface them in their own muted section so the
// operator can SEE that the leg exists, knows it's a duplicate, and
// knows which primary leg it rides along with — without offering a
// pick that would be rejected at the API.
//
// Primary lookup is done by id within `allRides`; if the primary isn't
// in the same group's rides (e.g. paged out, different group view),
// we degrade gracefully to a generic "primary not visible here" line
// rather than throwing or hiding the duplicate entirely.

interface DuplicateLegsRailSectionProps {
  duplicateRides: ClaimResponse[];
  allRides: ClaimResponse[];
}

function DuplicateLegsRailSection({
  duplicateRides,
  allRides,
}: DuplicateLegsRailSectionProps) {
  const ridesById = useMemo(() => {
    const map = new Map<number, ClaimResponse>();
    for (const r of allRides) map.set(r.id, r);
    return map;
  }, [allRides]);

  return (
    <div
      className="rounded-md border bg-card overflow-hidden"
      data-testid="duplicate-legs-rail"
    >
      <div className="px-4 py-2.5 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">
          Duplicates — verdict follows the primary
        </h3>
        <p className="text-[11px] text-muted-foreground">
          These legs share the primary leg's outcome and don't get a
          separate pick.
        </p>
      </div>
      <ul className="p-3 space-y-1.5 text-xs">
        {duplicateRides.map((leg) => {
          const primary =
            leg.duplicateOfClaimId != null
              ? ridesById.get(leg.duplicateOfClaimId)
              : undefined;
          const primaryVerdict = primary?.latestVerdict?.outcome ?? null;
          // Click-through: when the primary is in the same rail view,
          // make its CLM ref a button that scrolls the primary's
          // picker (or its "verdict recorded" card) into view. The
          // PerLegVerdictPicker stamps both states with a stable
          // `per-leg-verdict-{picker|confirmed}-<id>` testid, which
          // we use as a query selector. Falls back to a no-op if the
          // primary isn't currently mounted in the DOM.
          const scrollToPrimary = primary
            ? () => {
                if (typeof document === "undefined") return;
                const el =
                  document.querySelector(
                    `[data-testid="per-leg-verdict-picker-${primary.id}"]`,
                  ) ??
                  document.querySelector(
                    `[data-testid="per-leg-verdict-confirmed-${primary.id}"]`,
                  );
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            : null;
          return (
            <li
              key={leg.id}
              className="flex items-start gap-2 text-muted-foreground"
              data-testid={`duplicate-leg-${leg.id}`}
            >
              <span className="font-mono shrink-0">#{leg.confNumber}</span>
              <span>
                duplicate of{" "}
                {primary ? (
                  <button
                    type="button"
                    onClick={scrollToPrimary ?? undefined}
                    className="font-mono underline-offset-2 hover:underline hover:text-foreground"
                    data-testid={`duplicate-leg-${leg.id}-primary-link`}
                  >
                    #{primary.confNumber}
                  </button>
                ) : (
                  <span className="italic">primary not visible here</span>
                )}
                {primaryVerdict && (
                  <>
                    {" — primary verdict: "}
                    <span className="font-medium">{primaryVerdict}</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Task #301 — pre-invoice-group reconcile rail ────────────────────────
//
// Companion to PerLegVerdictRailSection. Renders legs whose
// `sop_outcome` is NULL (or otherwise not in the submitted set) — the
// API's verdict gate refuses these, so we surface them in a separate
// section with a single explicit affordance ("Record outcome anyway")
// that opens a confirm dialog and posts the verdict with the
// `reconcile: true` flag set.

// Per-leg verdicts are binary — a leg either approved or denied. Mixed
// outcomes across an invoice come from per-leg verdicts in aggregate,
// not from a per-leg "Partial" pick. Kept in lockstep with the modern
// PerLegVerdictPicker (see components/per-leg-verdict-picker.tsx).
const RECONCILE_OUTCOMES: Array<"Approved" | "Denied"> = [
  "Approved",
  "Denied",
];

interface PreGroupReconcileRailSectionProps {
  rides: ClaimResponse[];
  onAfterVerdict: (message: string) => void;
  groupId: number;
}

function PreGroupReconcileRailSection({
  rides,
  onAfterVerdict,
  groupId,
}: PreGroupReconcileRailSectionProps) {
  const [activeLeg, setActiveLeg] = useState<ClaimResponse | null>(null);

  return (
    <div
      className="rounded-md border bg-card overflow-hidden"
      data-testid="pre-group-reconcile-stack"
    >
      <div className="px-4 py-2.5 border-b bg-amber-50/60 dark:bg-amber-950/20">
        <h3 className="text-sm font-semibold">Filed before invoice groups</h3>
        <p className="text-[11px] text-muted-foreground">
          These legs were filed before the modern flow set per-leg state, so
          the normal picker can't accept their verdict. Record the payor's
          outcome here to keep the trail intact.
        </p>
      </div>
      <div className="p-3 space-y-2">
        {rides.map((ride) => (
          <div
            key={ride.id}
            className="flex items-center justify-between gap-3 rounded border bg-background px-3 py-2"
            data-testid={`pre-group-leg-${ride.id}`}
          >
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs">#{ride.confNumber}</span>
              {ride.errorTypeName && (
                <Badge variant="secondary" className="text-[10px]">
                  {ride.errorTypeName}
                </Badge>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setActiveLeg(ride)}
              data-testid={`button-record-outcome-anyway-${ride.id}`}
            >
              Record outcome anyway
            </Button>
          </div>
        ))}
      </div>
      <ReconcileVerdictDialog
        leg={activeLeg}
        groupId={groupId}
        onClose={() => setActiveLeg(null)}
        onAfterVerdict={(msg) => {
          setActiveLeg(null);
          onAfterVerdict(msg);
        }}
      />
    </div>
  );
}

interface ReconcileVerdictDialogProps {
  leg: ClaimResponse | null;
  groupId: number;
  onClose: () => void;
  onAfterVerdict: (message: string) => void;
}

function ReconcileVerdictDialog({
  leg,
  groupId,
  onClose,
  onAfterVerdict,
}: ReconcileVerdictDialogProps) {
  const queryClient = useQueryClient();
  const recordVerdict = useRecordLegVerdict();
  const [picked, setPicked] = useState<"Approved" | "Denied" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local form state every time a new leg opens the dialog.
  useEffect(() => {
    if (leg) {
      setPicked(null);
      setNote("");
      setSubmitting(false);
      setError(null);
    }
  }, [leg?.id]);

  if (!leg) return null;

  const trimmedNote = note.trim();
  const canConfirm = !!picked && trimmedNote.length > 0 && !submitting;

  const handleConfirm = async () => {
    if (!picked || !canConfirm) return;
    setError(null);
    setSubmitting(true);
    try {
      await recordVerdict.mutateAsync({
        id: leg.id,
        data: {
          source: "operator_confirmed",
          outcome: picked,
          note: trimmedNote,
          reconcile: true,
        },
      });
      queryClient.invalidateQueries({
        queryKey: getGetInvoiceGroupQueryKey(groupId),
      });
      queryClient.invalidateQueries({
        queryKey: getGetClaimQueryKey(leg.id),
      });
      queryClient.invalidateQueries({
        queryKey: getListInvoiceGroupsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
      });
      onAfterVerdict(
        `Verdict recorded for #${leg.confNumber} (manual reconciliation).`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to record verdict.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={!!leg}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        data-testid="reconcile-verdict-dialog"
      >
        <DialogHeader>
          <DialogTitle>Record outcome for #{leg.confNumber}</DialogTitle>
          <DialogDescription>
            This leg was filed before the invoice-group flow recorded per-leg
            state, so the normal verdict picker can't accept it. Choose the
            outcome the payor returned and add a one-line note — the verdict
            and note will be saved to the audit log as a manual reconciliation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Pick an outcome
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {RECONCILE_OUTCOMES.map((o) => (
                <Button
                  key={o}
                  type="button"
                  variant={picked === o ? "default" : "outline"}
                  size="sm"
                  disabled={submitting}
                  onClick={() => setPicked(o)}
                  data-testid={`button-reconcile-pick-${o.toLowerCase()}-${leg.id}`}
                >
                  {o}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor={`reconcile-note-${leg.id}`}
              className="text-xs text-muted-foreground"
            >
              Note (required)
            </Label>
            <Textarea
              id={`reconcile-note-${leg.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="e.g. Payor email on Apr 30 confirmed the leg was approved."
              data-testid={`input-reconcile-note-${leg.id}`}
            />
          </div>

          {error && (
            <p
              className="text-xs text-red-700 bg-red-50 rounded px-2 py-1"
              data-testid={`error-reconcile-${leg.id}`}
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={onClose}
            data-testid={`button-reconcile-cancel-${leg.id}`}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
            data-testid={`button-reconcile-confirm-${leg.id}`}
          >
            {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Confirm verdict
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface InlineResponseFallbackProps {
  response: PortalResponseItem;
  invoiceNumber: string;
  groupId: number;
}

/**
 * Fallback rendered when a reviewable response exists but no email
 * conversation has been linked to the group (the response came in via
 * the portal and was never attached to an email thread, or the email
 * sync hasn't run yet). Surfaces the response body inline so the
 * operator can still read the payor's words and pick a verdict from
 * the rail. The composer is intentionally absent — there's no thread
 * to reply into — and a short rationale explains why, with a deep link
 * to the full invoice page where the operator can sync or attach a
 * conversation.
 */
function InlineResponseFallback({
  response,
  invoiceNumber,
  groupId,
}: InlineResponseFallbackProps) {
  // Prefer rawContent (the full body) over content (legacy preview) for both
  // the HTML and the plain-text branches. resolveBodyRender handles the
  // sanitizer, the bodyFormat==="html" path, and the defensive fallback for
  // plain-text rows that contain raw HTML markup.
  const rawBody = response.rawContent || response.content || "";
  const rendered = useMemo(
    () =>
      resolveBodyRender({
        bodyHtml: response.bodyFormat === "html" ? rawBody : null,
        bodyFormat: (response.bodyFormat as "html" | "text" | undefined) ?? "text",
        bodyPreview: rawBody,
      }),
    [rawBody, response.bodyFormat],
  );
  const senderLabel =
    response.senderName ||
    response.senderEmail ||
    "Payor";

  return (
    <Card
      id="invoice-thread"
      data-testid="inline-response-fallback"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Inbox className="h-4 w-4" />
              Response from {senderLabel}
            </CardTitle>
            {response.subject && (
              <p
                className="text-sm font-medium truncate"
                title={response.subject}
              >
                {response.subject}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Received {formatDateTime(response.receivedAt)} ·{" "}
              <RefNumber value={invoiceNumber} variant="inline" />
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${getResponseTypePillClass(response.responseType)}`}
            title="AI / keyword classification — a hint, not the verdict"
          >
            {getResponseTypeLabel(response.responseType)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2"
          data-testid="inline-response-fallback-rationale"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">No email conversation linked yet.</p>
            <p>
              This response came in without a matching email thread, so
              the reply composer is unavailable here. Open the full
              invoice page to sync the inbox or attach a conversation.
            </p>
          </div>
        </div>

        {rendered.kind === "html" ? (
          <div
            className="email-body prose prose-sm max-w-none text-sm overflow-x-auto"
            data-testid="inline-response-fallback-body-html"
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        ) : rendered.text ? (
          <pre
            className="whitespace-pre-wrap text-sm font-sans"
            data-testid="inline-response-fallback-body-text"
          >
            {rendered.text}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No body content recorded for this response.
          </p>
        )}

        <div className="flex items-center justify-end pt-1">
          <Link href={`/invoice-groups/${groupId}`}>
            <Button
              variant="outline"
              size="sm"
              data-testid="inline-response-fallback-open-full"
            >
              Open full details
              <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}


// =====================================================================
// Task #753 — Filter bar
// =====================================================================
// Faceted filter rail above the verdict-pending list. The seven facets
// (free-text q, status, response type, error type, payor/client number,
// service-date range, response-received range) live in URL params via
// `useUrlParams` so back/forward and deep links restore the operator's
// view. Selections are echoed below the rail as a row of removable
// chips with a "Clear all" affordance — same pattern as the Invoice
// Groups list page.

const RESPONSE_TYPE_LABELS: Record<string, string> = {
  approval: "Approval",
  denial: "Denial",
  partial_approval: "Partial approval",
  info_request: "Info request",
  acknowledgment: "Acknowledgment",
  other: "Other",
};

const RESPONSE_TYPE_FILTER_OPTIONS: FacetOption[] =
  VERDICT_PENDING_RESPONSE_TYPE_FILTER_VALUES.map((id) => ({
    id,
    label: RESPONSE_TYPE_LABELS[id] ?? id,
  }));

// Response-pending phase statuses, narrowed to values from the canonical
// `claim_status` pgEnum (lib/db/src/schema/claims.ts) that can actually
// appear on a verdict-pending row (`macroPhase=response-pending` +
// `errorTypeAssigned`). The exact set lives in the filters helper so a
// frontend test can pin it against the canonical enum.
const STATUS_FILTER_OPTIONS: FacetOption[] =
  VERDICT_PENDING_STATUS_FILTER_VALUES.map((id) => ({ id, label: id }));

interface ErrorTypeLite {
  id: number;
  name: string;
}

interface FilterBarProps {
  filterQ: string | null;
  filterStatuses: string[];
  filterResponseTypes: string[];
  filterErrorTypeIds: string[];
  filterClientNumbers: string[];
  filterServiceDateFrom: string | null;
  filterServiceDateTo: string | null;
  filterResponseReceivedFrom: string | null;
  filterResponseReceivedTo: string | null;
  errorTypes: ErrorTypeLite[];
  clientOptions: string[];
  onSetQ: (q: string) => void;
  setMultiParam: (key: string, values: string[]) => void;
  toggleMulti: (current: string[], id: string, next: boolean) => string[];
  onSetServiceDateRange: (v: { from?: string; to?: string }) => void;
  onSetResponseReceivedRange: (v: { from?: string; to?: string }) => void;
  clearAllFilters: () => void;
}

/**
 * Task #759 — Header V2 split. The filter UI used to render as a single
 * <FilterBar> wrapper with trigger + search on top and active chips
 * underneath. The V2 layout puts the trigger + search inside the toolbar
 * row and the active chips inside the collapsible "Showing/Hiding" state
 * strip. This hook returns those pieces as ready-to-render slots so the
 * <ReviewHeader> composer can place them in the right rows without
 * re-implementing any of the filter wiring.
 *
 * Behavior preserved verbatim:
 *  - free-text input is locally shadowed and pushed to the URL on
 *    blur/Enter (no per-keystroke navigations)
 *  - chip removal calls back into the same setMultiParam / onSet* paths
 *  - "Clear all" surface still requires 2+ chips (handled in
 *    <ReviewHeader> against `chipCount`)
 *  - the FacetedFilter trigger keeps `responses-awaiting-review-filter-trigger`
 *  - the search input keeps `responses-awaiting-review-search-input`
 */
function useFilterBarSlots({
  filterQ,
  filterStatuses,
  filterResponseTypes,
  filterErrorTypeIds,
  filterClientNumbers,
  filterServiceDateFrom,
  filterServiceDateTo,
  filterResponseReceivedFrom,
  filterResponseReceivedTo,
  errorTypes,
  clientOptions,
  onSetQ,
  setMultiParam,
  toggleMulti,
  onSetServiceDateRange,
  onSetResponseReceivedRange,
  clearAllFilters,
}: FilterBarProps): FilterBarSlots {
  const [open, setOpen] = useState(false);
  // Local-shadow the free-text input so the operator can type without
  // an effect cycle reflowing the value back into the input on every
  // keystroke. Pushed to the URL on blur or Enter.
  const [qDraft, setQDraft] = useState(filterQ ?? "");
  useEffect(() => {
    setQDraft(filterQ ?? "");
  }, [filterQ]);

  const errorTypeOptions: FacetOption[] = useMemo(
    () => errorTypes.map((et) => ({ id: String(et.id), label: et.name })),
    [errorTypes],
  );
  const clientOptionsFacet: FacetOption[] = useMemo(
    () => clientOptions.map((c) => ({ id: c, label: c })),
    [clientOptions],
  );
  const errorTypeNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const et of errorTypes) m.set(String(et.id), et.name);
    return m;
  }, [errorTypes]);

  const serviceDateCount = filterServiceDateFrom || filterServiceDateTo ? 1 : 0;
  const responseReceivedCount = filterResponseReceivedFrom || filterResponseReceivedTo ? 1 : 0;
  const totalApplied =
    filterStatuses.length +
    filterResponseTypes.length +
    filterErrorTypeIds.length +
    filterClientNumbers.length +
    serviceDateCount +
    responseReceivedCount +
    (filterQ ? 1 : 0);

  const categories: FacetedFilterCategory[] = useMemo(() => [
    {
      id: "serviceDate",
      label: "Date of service",
      icon: CalendarDays,
      appliedCount: serviceDateCount,
      render: () => (
        <FacetDateRange
          value={{ from: filterServiceDateFrom ?? undefined, to: filterServiceDateTo ?? undefined }}
          onChange={onSetServiceDateRange}
          fromLabel="On or after"
          toLabel="On or before"
          testIdPrefix="facet-serviceDate"
        />
      ),
    },
    {
      id: "responseReceived",
      label: "Response received",
      icon: MailOpen,
      appliedCount: responseReceivedCount,
      render: () => (
        <FacetDateRange
          value={{ from: filterResponseReceivedFrom ?? undefined, to: filterResponseReceivedTo ?? undefined }}
          onChange={onSetResponseReceivedRange}
          fromLabel="Received on or after"
          toLabel="Received on or before"
          testIdPrefix="facet-responseReceived"
        />
      ),
    },
    {
      id: "status",
      label: "Status",
      icon: Activity,
      appliedCount: filterStatuses.length,
      render: () => (
        <FacetSearchableCheckboxList
          options={STATUS_FILTER_OPTIONS}
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
      id: "responseType",
      label: "Response type",
      icon: Tag,
      appliedCount: filterResponseTypes.length,
      render: () => (
        <FacetCheckboxList
          heading="Response type"
          options={RESPONSE_TYPE_FILTER_OPTIONS}
          selected={filterResponseTypes}
          onToggle={(id, next) =>
            setMultiParam(
              "responseType",
              toggleMulti(filterResponseTypes, id, next),
            )
          }
          testIdPrefix="facet-responseType"
        />
      ),
    },
    {
      id: "errorType",
      label: "Error type",
      icon: AlertTriangle,
      appliedCount: filterErrorTypeIds.length,
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
      id: "clientNumber",
      label: "Payor / client",
      icon: Building2,
      appliedCount: filterClientNumbers.length,
      render: () => (
        clientOptionsFacet.length > 0 ? (
          <FacetSearchableCheckboxList
            options={clientOptionsFacet}
            selected={filterClientNumbers}
            onToggle={(id, next) =>
              setMultiParam(
                "clientNumber",
                toggleMulti(filterClientNumbers, id, next),
              )
            }
            placeholder="Filter clients..."
            pinSelected
            testIdPrefix="facet-clientNumber"
          />
        ) : (
          <div className="p-4 text-xs text-muted-foreground">
            No payor/client numbers in the current cohort yet.
          </div>
        )
      ),
    },
  ], [
    serviceDateCount, responseReceivedCount,
    filterServiceDateFrom, filterServiceDateTo,
    filterResponseReceivedFrom, filterResponseReceivedTo,
    filterStatuses, filterResponseTypes, filterErrorTypeIds, filterClientNumbers,
    errorTypeOptions, clientOptionsFacet,
    onSetServiceDateRange, onSetResponseReceivedRange, setMultiParam, toggleMulti,
  ]);

  const chips: FilterChip[] = [];
  if (filterQ) {
    chips.push({
      key: "q",
      label: `Search: "${filterQ}"`,
      onRemove: () => onSetQ(""),
    });
  }
  if (filterServiceDateFrom || filterServiceDateTo) {
    const lbl = `Service date ${filterServiceDateFrom || "…"}${filterServiceDateTo ? ` → ${filterServiceDateTo}` : filterServiceDateFrom ? "+" : ""}`;
    chips.push({
      key: "serviceDate",
      label: lbl,
      onRemove: () => onSetServiceDateRange({ from: undefined, to: undefined }),
    });
  }
  if (filterResponseReceivedFrom || filterResponseReceivedTo) {
    const lbl = `Received ${filterResponseReceivedFrom || "…"}${filterResponseReceivedTo ? ` → ${filterResponseReceivedTo}` : filterResponseReceivedFrom ? "+" : ""}`;
    chips.push({
      key: "responseReceived",
      label: lbl,
      onRemove: () => onSetResponseReceivedRange({ from: undefined, to: undefined }),
    });
  }
  for (const s of filterStatuses) {
    chips.push({
      key: `status:${s}`,
      label: `Status: ${s}`,
      onRemove: () => setMultiParam("status", filterStatuses.filter(v => v !== s)),
    });
  }
  for (const rt of filterResponseTypes) {
    const found = RESPONSE_TYPE_FILTER_OPTIONS.find(o => o.id === rt);
    chips.push({
      key: `responseType:${rt}`,
      label: `Response: ${found?.label ?? rt}`,
      onRemove: () => setMultiParam("responseType", filterResponseTypes.filter(v => v !== rt)),
    });
  }
  for (const id of filterErrorTypeIds) {
    chips.push({
      key: `errorType:${id}`,
      label: `Error: ${errorTypeNameById.get(id) ?? id}`,
      onRemove: () => setMultiParam("errorTypeId", filterErrorTypeIds.filter(v => v !== id)),
    });
  }
  for (const c of filterClientNumbers) {
    chips.push({
      key: `client:${c}`,
      label: `Client: ${c}`,
      onRemove: () => setMultiParam("clientNumber", filterClientNumbers.filter(v => v !== c)),
    });
  }

  const trigger = (
    <FacetedFilter
      open={open}
      onOpenChange={setOpen}
      categories={categories}
      totalApplied={totalApplied - (filterQ ? 1 : 0)}
      onClearAll={clearAllFilters}
      triggerTestId="responses-awaiting-review-filter-trigger"
    />
  );

  const search = (
    <div className="relative flex-1 min-w-[220px] max-w-md">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={qDraft}
        onChange={(e) => setQDraft(e.target.value)}
        onBlur={() => {
          if ((qDraft || "") !== (filterQ ?? "")) onSetQ(qDraft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSetQ(qDraft);
          }
        }}
        placeholder="Search invoice #, client, error description…"
        className="pl-7 h-8 text-xs"
        data-testid="responses-awaiting-review-search-input"
      />
    </div>
  );

  // Render chips inline (matches the V2 mockup's pill style); chip removal
  // routes through the same setMultiParam / onSet* paths as the legacy
  // FilterChipStrip render.
  const chipNodes = chips.length > 0 ? (
    <>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium px-2.5 py-0.5"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5 transition-colors"
            aria-label={`Remove ${chip.label} filter`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
    </>
  ) : null;

  return {
    trigger,
    search,
    chips: chipNodes,
    chipCount: chips.length,
    hasActiveChips: chips.length > 0,
  };
}
