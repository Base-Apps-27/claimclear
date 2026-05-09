import { useEffect, useMemo, useRef, useState } from "react";
import { useRowSettle } from "@/hooks/use-row-settle";
import { Link, useLocation, useParams } from "wouter";
import { resolveBodyRender } from "@/lib/email-body-render";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import {
  useListInvoiceGroups,
  getListInvoiceGroupsQueryKey,
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
  getGetInvoiceGroupEmailThreadQueryKey,
} from "@workspace/api-client-react";
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
import { useInvoiceGroupsListEvents, useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import { formatCurrency, formatDateTime } from "@/lib/format";
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
} from "lucide-react";
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

type SortMode = "oldest_response" | "newest_response" | "urgency" | "amount";

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
  useInvoiceGroupsListEvents();
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">
          Responses Awaiting Review
        </h2>
        <p className="text-muted-foreground text-sm">
          Pick a verdict on each payor reply. Re-attestation work lives on the
          dedicated Attestation Queue page.
        </p>
      </div>
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
  const verdictPendingQuery = {
    macroPhase: "response-pending",
    limit: 500,
    includeExpired: true,
    errorTypeAssigned: true,
  } as const;
  const { data, isLoading, isError, refetch } = useListInvoiceGroups(
    verdictPendingQuery,
    {
      query: {
        queryKey: getListInvoiceGroupsQueryKey(verdictPendingQuery),
      },
    },
  );

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
    if (needsFallbackFetch && fallbackGroupDetail) return;
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

  return (
    <div className="space-y-5" data-testid="verdict-pending-tab-content">
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-muted-foreground text-sm">
            Stage 2 inbox. The payor responded — read what they said,
            weigh the AI hint, and pick the verdict (continue the
            dispute, mark paid, or close as denied). Oldest response
            first.
          </p>
          {groups.length > 0 && (
            <Badge variant="secondary" data-testid="page-count-badge">
              {groups.length} verdict pending
            </Badge>
          )}
        </div>
      </div>

      <HiddenItemsStrip />


      {groups.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <ArrowDownWideNarrow className="h-4 w-4 text-muted-foreground" />
          <Select value={sortMode} onValueChange={handleSortChange}>
            <SelectTrigger
              className="w-[220px] h-8 text-xs"
              data-testid="sort-mode-select"
              aria-label="Sort responses awaiting review"
            >
              <SelectValue placeholder="Sort by…" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="block">
                    <span className="font-medium">{opt.label}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {opt.help}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <Workspace
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        groups={groups}
        selectedGroup={selectedGroup}
        onSelect={selectGroup}
        onAfterVerdict={onAfterVerdict}
      />
    </div>
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
function HiddenItemsStrip() {
  const { data, isLoading } = useGetResponsesAwaitingReviewHiddenCounts({
    query: { queryKey: getGetResponsesAwaitingReviewHiddenCountsQueryKey() },
  });

  if (isLoading || !data) {
    return <Skeleton className="h-9 w-full max-w-xl" data-testid="hidden-items-strip-loading" />;
  }

  const { unclassified, awaitingPayorAgain, acknowledgmentOnly } = data;
  const totalHidden = unclassified + awaitingPayorAgain + acknowledgmentOnly;

  if (totalHidden === 0) {
    return (
      <div
        className="text-xs text-muted-foreground italic"
        data-testid="hidden-items-strip-empty"
      >
        Nothing hidden from this view.
      </div>
    );
  }

  // Click-through destinations reuse existing list pages with precise
  // filters so the chip count and the resulting page list always agree.
  const chips: Array<{
    key: string;
    count: number;
    label: string;
    tooltip: string;
    href: string;
    toneClass: string;
  }> = [];

  if (unclassified > 0) {
    chips.push({
      key: "unclassified",
      count: unclassified,
      label: `${unclassified} unclassified — needs an error type`,
      tooltip:
        "These groups have a payor response but no Error Type yet, so the inbox can't show them. Click through to the classification view to assign one.",
      // `inboxHiddenBucket=unclassified` runs the exact same SQL on the
      // list endpoint that the count endpoint uses, so the chip count
      // and the destination list can never disagree.
      href: "/invoice-groups?inboxHiddenBucket=unclassified",
      toneClass: "bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-900",
    });
  }
  if (awaitingPayorAgain > 0) {
    chips.push({
      key: "awaitingPayorAgain",
      count: awaitingPayorAgain,
      label: `${awaitingPayorAgain} waiting for payor again`,
      tooltip:
        "Operator clicked \"I replied — wait for payor again\" and no newer reply has arrived. The inbox suppresses these until a fresh response lands.",
      href: "/invoice-groups?inboxHiddenBucket=awaitingPayorAgain",
      toneClass: "bg-blue-50 hover:bg-blue-100 border-blue-300 text-blue-900",
    });
  }
  if (acknowledgmentOnly > 0) {
    chips.push({
      key: "acknowledgmentOnly",
      count: acknowledgmentOnly,
      label:
        acknowledgmentOnly === 1
          ? "1 has only acknowledgment/abstain responses"
          : `${acknowledgmentOnly} have only acknowledgment/abstain responses`,
      tooltip:
        "Every response on file has been (re)classified as acknowledgment or abstain, so there's no verdict to take. The inbox hides these because there's nothing reviewable.",
      href: "/invoice-groups?inboxHiddenBucket=acknowledgmentOnly",
      toneClass: "bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-800",
    });
  }

  return (
    <div
      className="flex items-center gap-2 flex-wrap rounded-md border border-dashed bg-muted/30 px-3 py-2"
      data-testid="hidden-items-strip"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
        <Eye className="h-3.5 w-3.5" />
        Hidden from this view
      </span>
      {chips.map((chip) => (
        <Tooltip key={chip.key}>
          <TooltipTrigger asChild>
            <Link
              href={chip.href}
              className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${chip.toneClass}`}
              data-testid={`hidden-items-chip-${chip.key}`}
            >
              {chip.label}
            </Link>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{chip.tooltip}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

interface WorkspaceProps {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  groups: InvoiceGroupResponse[];
  selectedGroup: InvoiceGroupResponse | null;
  onSelect: (id: number) => void;
  onAfterVerdict: (message: string) => void;
}

function Workspace({
  isLoading,
  isError,
  onRetry,
  groups,
  selectedGroup,
  onSelect,
  onAfterVerdict,
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
        <Card data-testid="empty-state">
          <CardContent className="py-6">
            <EmptyState
              icon={CheckCircle}
              title="All caught up — no payor responses awaiting a verdict"
              description="When a payor reply needs a human decision, it'll show up here so you can act on it."
            />
          </CardContent>
        </Card>
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
}

function ListColumn({ groups, selectedGroup, onSelect }: ListColumnProps) {
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
            {settle.slots.map((slot) => (
              <ListRow
                key={slot.item.id}
                group={slot.item}
                isSelected={selectedGroup?.id === slot.item.id}
                onSelect={() => onSelect(slot.item.id)}
                isSettling={slot.isSettling}
                isJustSelected={settle.isJustSelected(slot.item.id)}
              />
            ))}
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
}

function ListRow({ group, isSelected, onSelect, isSettling = false, isJustSelected = false }: ListRowProps) {
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

  return (
    <li
      className={`${isSettling ? "cc-row-settling" : ""} ${isJustSelected ? "cc-row-just-selected" : ""}`}
      data-settling={isSettling ? "true" : undefined}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={isSettling}
        aria-pressed={isSelected}
        data-testid={`awaiting-review-row-${group.id}`}
        className={`w-full text-left px-4 py-3 transition-colors ${
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
            isSending={replyMutation.isPending}
            onReply={async (input) => {
              try {
                await replyMutation.mutateAsync({
                  id: group.id,
                  conversationId: input.conversationId,
                  data: {
                    subject: input.subject,
                    bodyText: htmlBodyToPlainText(input.bodyHtml),
                    to: input.to,
                    cc: input.cc.length > 0 ? input.cc : undefined,
                  },
                });
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
            help="The next-step controls are derived from the verdicts you just recorded — re-attest the approved legs in the portal, capture the payor's reason for any denials, close out, or stamp the group as awaiting another payor reply."
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

