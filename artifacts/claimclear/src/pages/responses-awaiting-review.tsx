import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import DOMPurify from "dompurify";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import {
  useListInvoiceGroups,
  getListInvoiceGroupsQueryKey,
  useGetInvoiceGroup,
  getInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useGetInvoiceGroupValidTransitions,
  getGetInvoiceGroupValidTransitionsQueryKey,
  useUpdateInvoiceGroupStatus,
  getGetClaimQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
  getListWithdrawalsQueryKey,
  useRecordLegVerdict,
  useCompleteLegMasAction,
  useCompleteGroupReattest,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
  InvoiceGroupResponse,
  PortalResponseItem,
  PortalSubmissionResponse,
} from "@workspace/api-client-react";
import { PerLegVerdictPicker } from "@/components/per-leg-verdict-picker";
import { MasActionChecklist } from "@/components/mas-action-checklist";
import { useAiCalibrations } from "@/hooks/use-ai-calibration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/status-badge";
import { UrgentTodayBadge } from "@/components/urgent-today-badge";
import {
  pickLatestReviewableResponse,
  getResponseTypeLabel,
  getResponseTypePillClass,
} from "@/components/queue-response-review-panel";
import { ClosureActions } from "@/components/closure/closure-actions";
import { GroupCommunicationThread } from "@/components/communication/group-communication-thread";
import { ResponseReceivedBanner } from "@/components/communication/response-received-banner";
import {
  getMockConversations,
  getMockBannerData,
} from "@/components/communication/mock-data";
import { PortalSubmissionDrawer } from "@/components/portal-submission-drawer";
import { useToast } from "@/hooks/use-toast";
import { useInvoiceGroupsListEvents, useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useGetAttestationCounts } from "@workspace/api-client-react";
import {
  CheckCircle,
  AlertTriangle,
  Clock,
  Eye,
  ExternalLink,
  Inbox,
  ChevronDown,
  ChevronUp,
  ArrowDownWideNarrow,
  ArrowRight,
  ListChecks,
  ShieldCheck,
  Send,
  RefreshCw,
  Loader2,
  FileText,
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

type ActiveTab = "verdict-pending" | "mas-action" | "attestation";

export default function ResponsesAwaitingReview() {
  useInvoiceGroupsListEvents();
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sortMode, setSortMode] = useState<SortMode>(() => readStoredSort());
  const [activeTab, setActiveTab] = useState<ActiveTab>("verdict-pending");

  const selectedId = params.id ? parseInt(params.id, 10) || null : null;

  // Post-cutover: the Verdict Pending list is sourced from the
  // `response-pending` macro phase and the MAS Action tab is always
  // available. The legacy "Needs Review" status query and the
  // PER_INVOICE_TRANSITION_ENABLED gate were removed in Task #199.
  const verdictPendingQuery = { macroPhase: "response-pending", limit: 500 } as const;
  const { data, isLoading, isError, refetch } = useListInvoiceGroups(
    verdictPendingQuery,
    {
      query: {
        queryKey: getListInvoiceGroupsQueryKey(verdictPendingQuery),
      },
    },
  );

  const {
    data: masData,
    isLoading: masLoading,
    isError: masIsError,
    refetch: refetchMas,
  } = useListInvoiceGroups(
    { macroPhase: "mas-action-required", limit: 500 },
    {
      query: {
        queryKey: getListInvoiceGroupsQueryKey({
          macroPhase: "mas-action-required",
          limit: 500,
        }),
      },
    },
  );
  const masGroups: InvoiceGroupResponse[] = masData?.groups ?? [];

  const { data: attestationCounts } = useGetAttestationCounts();
  const attestationPending = attestationCounts?.pending ?? 0;
  const attestationQueued = attestationCounts?.queued ?? 0;

  // Mirror the Queue card's split: only post-classification (errorTypeId set)
  // groups belong in this surface. The Classification Inbox handles the
  // unclassified rows on the Queue page.
  const baseGroups: InvoiceGroupResponse[] = useMemo(
    () => (data?.groups || []).filter((g) => !!g.errorTypeId),
    [data?.groups],
  );

  // For "oldest/newest response first" sort modes we need each group's
  // latest reviewable response timestamp. The list endpoint doesn't
  // include responses, so fan out per-group detail fetches in parallel
  // (cached, so each row re-uses the same query the row itself reads).
  // Other sort modes (urgency, amount) don't need this data.
  const needsResponseTimes =
    sortMode === "oldest_response" || sortMode === "newest_response";
  const detailQueries = useQueries({
    queries: needsResponseTimes
      ? baseGroups.map((g) => ({
          queryKey: getGetInvoiceGroupQueryKey(g.id),
          queryFn: ({ signal }: { signal?: AbortSignal }) =>
            getInvoiceGroup(g.id, { signal }),
          // Stale window long enough that flipping sort mode doesn't
          // re-trigger a network storm; SSE invalidation keeps it fresh.
          staleTime: 30_000,
        }))
      : [],
  });
  const responseTimeByGroupId = useMemo(() => {
    const map = new Map<number, number | null>();
    if (!needsResponseTimes) return map;
    baseGroups.forEach((g, idx) => {
      const detail = detailQueries[idx]?.data;
      const latest = pickLatestReviewableResponse(detail?.responses);
      const time = latest?.receivedAt
        ? new Date(latest.receivedAt).getTime()
        : null;
      map.set(g.id, time);
    });
    return map;
  }, [needsResponseTimes, baseGroups, detailQueries]);

  const groups: InvoiceGroupResponse[] = useMemo(() => {
    const arr = [...baseGroups];
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
  }, [baseGroups, sortMode, responseTimeByGroupId]);

  const handleSortChange = (value: string) => {
    const next = SORT_OPTIONS.find((o) => o.value === value)?.value ?? "oldest_response";
    setSortMode(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SORT_STORAGE_KEY, next);
    }
  };

  const selectedGroup = selectedId
    ? groups.find((g) => g.id === selectedId) ?? null
    : null;

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
  useEffect(() => {
    if (selectedId === null) return;
    const stillVisible = groups.some((g) => g.id === selectedId);
    if (stillVisible) return;
    if (groups.length === 0) {
      navigate(`/responses-awaiting-review`, { replace: true });
    } else {
      navigate(`/responses-awaiting-review/${groups[0].id}`, { replace: true });
    }
  }, [selectedId, groups, navigate]);

  // Re-fetch the master list and the nav badge after every verdict so the
  // operator's view never lags the action they just took.
  const onAfterVerdict = (message: string) => {
    toast({
      title: "Verdict applied",
      description: message,
      duration: 3500,
    });
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold tracking-tight">Responses Awaiting Review</h2>
          {groups.length > 0 && (
            <Badge variant="secondary" data-testid="page-count-badge">
              {groups.length} verdict pending
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm">
          Stage 2 inbox. The payor responded — read what they said, weigh the AI hint, and pick the verdict (continue the dispute, mark paid, or close as denied). Oldest response first.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ActiveTab)}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList>
            <TabsTrigger value="verdict-pending" data-testid="tab-verdict-pending">
              <Eye className="h-4 w-4 mr-1.5" />
              Verdict pending
              {groups.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {groups.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="mas-action" data-testid="tab-mas-action">
              <ListChecks className="h-4 w-4 mr-1.5" />
              MAS action
              {masGroups.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {masGroups.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="attestation" data-testid="tab-attestation">
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              Attestation
              {(attestationPending + attestationQueued) > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {attestationPending + attestationQueued}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          {activeTab === "verdict-pending" && (
            <div className="flex items-center gap-2">
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
        </div>
        <TabsContent value="verdict-pending" className="mt-4">
          <Workspace
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
            groups={groups}
            selectedGroup={selectedGroup}
            onSelect={selectGroup}
            onAfterVerdict={onAfterVerdict}
          />
        </TabsContent>
        <TabsContent value="mas-action" className="mt-4">
          <MasActionWorkspace
            isLoading={masLoading}
            isError={masIsError}
            onRetry={() => refetchMas()}
            groups={masGroups}
          />
        </TabsContent>
        <TabsContent value="attestation" className="mt-4">
          <AttestationPointerCard
            pending={attestationPending}
            queued={attestationQueued}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AttestationPointerCard({
  pending,
  queued,
}: {
  pending: number;
  queued: number;
}) {
  const total = pending + queued;
  return (
    <Card data-testid="attestation-pointer-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Attestation queue
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting on attestation right now.
          </p>
        ) : (
          <div className="text-sm space-y-1">
            <p>
              <span className="font-medium text-foreground">{pending}</span>{" "}
              <span className="text-muted-foreground">pending re-attestation</span>
            </p>
            <p>
              <span className="font-medium text-foreground">{queued}</span>{" "}
              <span className="text-muted-foreground">queued for review</span>
            </p>
          </div>
        )}
        <Button asChild variant="outline" size="sm" data-testid="link-attestation-queue">
          <Link href="/attestation-queue" className="inline-flex items-center gap-1.5">
            Open Attestation Queue
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
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
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_360px] gap-4">
        <Skeleton className="h-[480px] w-full" />
        <Skeleton className="h-[480px] w-full" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  }

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

  if (groups.length === 0) {
    return (
      <Card data-testid="empty-state">
        <CardContent className="py-12 text-center space-y-2">
          <CheckCircle className="h-8 w-8 mx-auto text-emerald-500" />
          <p className="font-medium">All caught up.</p>
          <p className="text-sm text-muted-foreground">
            No payor responses are waiting on a human verdict.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[320px_1fr_360px] gap-4 items-start"
      data-testid="awaiting-review-workspace"
    >
      <Card className="lg:sticky lg:top-4">
        <ScrollArea className="h-[calc(100vh-260px)] max-h-[720px]">
          <ul className="divide-y" data-testid="awaiting-review-list">
            {groups.map((group) => (
              <ListRow
                key={group.id}
                group={group}
                isSelected={selectedGroup?.id === group.id}
                onSelect={() => onSelect(group.id)}
              />
            ))}
          </ul>
        </ScrollArea>
      </Card>

      {selectedGroup && (
        <DetailPane
          key={selectedGroup.id}
          group={selectedGroup}
          onAfterVerdict={onAfterVerdict}
          restoreScrollY={scrollByGroupRef.current.get(selectedGroup.id) ?? null}
        />
      )}
    </div>
  );
}

interface MasActionWorkspaceProps {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  groups: InvoiceGroupResponse[];
}

function MasActionWorkspace({
  isLoading,
  isError,
  onRetry,
  groups,
}: MasActionWorkspaceProps) {
  if (isLoading) {
    return <Skeleton className="h-[420px] w-full" />;
  }
  if (isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <AlertTriangle className="h-6 w-6 mx-auto text-destructive" />
          <p className="text-sm text-muted-foreground">
            Couldn't load MAS-action groups. Try again.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (groups.length === 0) {
    return (
      <Card data-testid="mas-action-empty-state">
        <CardContent className="py-12 text-center space-y-2">
          <CheckCircle className="h-8 w-8 mx-auto text-emerald-500" />
          <p className="font-medium">No MAS work owed.</p>
          <p className="text-sm text-muted-foreground">
            Every cancellation is stamped and every group is re-attested.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4" data-testid="mas-action-workspace">
      {groups.map((g) => (
        <MasActionGroupCard key={g.id} group={g} />
      ))}
    </div>
  );
}

function MasActionGroupCard({ group }: { group: InvoiceGroupResponse }) {
  useInvoiceGroupEvents(group.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: detail } = useGetInvoiceGroup(group.id);
  const completeMas = useCompleteLegMasAction();
  const completeReattest = useCompleteGroupReattest();

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getGetInvoiceGroupQueryKey(group.id),
    });
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
    });
  };

  return (
    <Card data-testid={`mas-action-group-${group.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <span className="font-mono">#{group.invoiceNumber}</span>
              <StatusBadge status={group.status} />
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {group.errorTypeName ?? "Unclassified"} ·{" "}
              {group.rideCount} ride{group.rideCount !== 1 ? "s" : ""} ·{" "}
              {formatCurrency(group.totalAmount)}
            </p>
          </div>
          <Link href={`/invoice-groups/${group.id}`}>
            <Button variant="outline" size="sm" data-testid={`open-full-${group.id}`}>
              Open full details
              <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {detail ? (
          <MasActionChecklist
            group={detail as InvoiceGroupDetailResponse}
            onCompleteLegMasAction={async (claimId, body) => {
              await completeMas.mutateAsync({ id: claimId, data: body });
              invalidate();
              toast({
                title: "MAS cancellation recorded",
                duration: 3000,
              });
            }}
            onCompleteGroupReattest={async (body) => {
              await completeReattest.mutateAsync({ id: group.id, data: body });
              invalidate();
              toast({
                title: "Re-attest confirmed",
                description: "Group is now awaiting payout.",
                duration: 3000,
              });
            }}
          />
        ) : (
          <Skeleton className="h-32 w-full" />
        )}
      </CardContent>
    </Card>
  );
}

interface ListRowProps {
  group: InvoiceGroupResponse;
  isSelected: boolean;
  onSelect: () => void;
}

function ListRow({ group, isSelected, onSelect }: ListRowProps) {
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
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        data-testid={`awaiting-review-row-${group.id}`}
        className={`w-full text-left px-4 py-3 transition-colors ${
          isSelected ? "bg-muted" : "hover:bg-muted/50"
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <UrgentTodayBadge isUrgent={group.isUrgent} />
          <span className="font-mono text-sm font-semibold">
            #{group.invoiceNumber}
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
          <StatusBadge status={group.status} />
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
  const { data: detail, isLoading: detailLoading } = useGetInvoiceGroup(group.id);

  const submissions: PortalSubmissionResponse[] = detail?.submissions ?? [];
  const responses: PortalResponseItem[] = detail?.responses ?? [];
  const allRides: ClaimResponse[] = detail?.rides ?? [];

  // Mock thread + banner: same data layer used by invoice-group-detail-v2,
  // so the eventual swap to a real group-level email API is one-place.
  const mockLegIds = useMemo(
    () =>
      allRides.map((r) => ({
        id: r.id,
        label: r.confNumber ? `${r.confNumber}` : `Leg #${r.id}`,
      })),
    [allRides],
  );
  const mockConversations = useMemo(
    () => getMockConversations(mockLegIds),
    [mockLegIds],
  );
  const [bannerData, setBannerData] = useState(() => getMockBannerData());

  // The thread component's own `id="invoice-thread"` anchor is what the
  // banner scrolls to — the same anchor used on the invoice-group detail
  // page, so one implementation serves both callers. On first visit we
  // jump to the thread anchor; on a return visit we restore the
  // operator's previous scroll position so re-reading mid-thread doesn't
  // bounce them back to the top.
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
  // synced). Today the mock returns a conversation unconditionally, so
  // this branch is dormant; once #240 swaps in real conversation data
  // it activates automatically and the operator gets the response body
  // inline with a disabled composer rationale.
  const hasConversations = mockConversations.length > 0;

  return (
    <>
      <div
        className="space-y-4 min-w-0"
        data-testid={`detail-pane-${group.id}`}
      >
        <ResponseReceivedBanner
          response={bannerData}
          onDismiss={() => setBannerData(null)}
        />

        {hasReviewableResponse && hasConversations ? (
          <GroupCommunicationThread
            conversations={mockConversations}
            groupInvoiceNumber={group.invoiceNumber || `#${group.id}`}
            onSyncInbox={() => {
              toast({ title: "Inbox sync queued" });
            }}
            onReply={async (input) => {
              toast({
                title: "Reply sent",
                description: `Sent to ${input.to.join(", ")}`,
              });
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
        <ActionRail
          group={group}
          detail={detail as InvoiceGroupDetailResponse | undefined}
          detailLoading={detailLoading}
          submissions={submissions}
          allRides={allRides}
          onAfterVerdict={onAfterVerdict}
        />
      )}
    </>
  );
}

interface ActionRailProps {
  group: InvoiceGroupResponse;
  detail: InvoiceGroupDetailResponse | undefined;
  detailLoading: boolean;
  submissions: PortalSubmissionResponse[];
  allRides: ClaimResponse[];
  onAfterVerdict: (message: string) => void;
}

/**
 * Sticky right-side action rail. Mirrors the Group Rail pattern: rounded
 * card container, sticky on lg+, single-column field stack. Hosts the
 * group header, the submissions strip, the per-leg verdict picker, and
 * the continuation/closure actions.
 */
function ActionRail({
  group,
  detail,
  detailLoading,
  submissions,
  allRides,
  onAfterVerdict,
}: ActionRailProps) {
  // Real, actionable legs the operator can pick a verdict on. Mirrors
  // the predicate from invoice-group-detail-v2: included, not excluded,
  // has errorTypeId. Auto-excluded legs (per #232) and `Processed` legs
  // (per #231) flow through naturally — excluded legs render below as a
  // read-only summary and Processed legs stay in the picker stack.
  const actionableRides = useMemo(
    () =>
      allRides.filter(
        (r) => r.includedInDispute !== false && !!r.errorTypeId,
      ),
    [allRides],
  );
  const excludedRides = useMemo(
    () => allRides.filter((r) => r.includedInDispute === false),
    [allRides],
  );

  return (
    <div className="lg:sticky lg:top-4 space-y-3" data-testid="action-rail">
      <div className="rounded-md border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold">
              #{group.invoiceNumber}
            </span>
            <StatusBadge status={group.status} />
            <UrgentTodayBadge isUrgent={group.isUrgent} />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs">
            <RailField label="Error type">
              {group.errorTypeName || "—"}
            </RailField>
            <RailField label="Total">
              {formatCurrency(group.totalAmount)}
            </RailField>
            <RailField label="Rides">
              {actionableRides.length === allRides.length
                ? `${allRides.length}`
                : `${actionableRides.length} of ${allRides.length}`}
            </RailField>
          </div>
          <div className="mt-2">
            <Link
              href={`/invoice-groups/${group.id}`}
              className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
              data-testid="open-full-invoice"
            >
              Open full details
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>

        <SubmissionsStrip
          submissions={submissions}
          loading={detailLoading && !detail}
        />
      </div>

      {detail && (
        <PerLegVerdictRailSection
          actionableRides={actionableRides}
          excludedRides={excludedRides}
          onAfterVerdict={onAfterVerdict}
          groupId={group.id}
        />
      )}

      {detail && (
        <ContinuationAndClosureSection
          group={group}
          onAfterVerdict={onAfterVerdict}
        />
      )}
    </div>
  );
}

function RailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-border/60 last:border-b-0 pb-1 last:pb-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground shrink-0">
        {label}
      </span>
      <span className="text-xs text-foreground font-medium text-right truncate">
        {children}
      </span>
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
          Pick the verdict for each actionable leg. Excluded legs are listed
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
              latestSuggestion={claim.latestAiSuggestion ?? null}
              calibration={
                claim.errorTypeId
                  ? calibrationByErrorType.get(claim.errorTypeId)
                  : undefined
              }
              onConfirm={async (outcome, note, inspectionTimeMs) => {
                await recordVerdict.mutateAsync({
                  id: claim.id,
                  data: {
                    source: "operator_confirmed",
                    outcome,
                    note,
                    inspectionTimeMs,
                  },
                });
                queryClient.invalidateQueries({
                  queryKey: getGetInvoiceGroupQueryKey(groupId),
                });
                queryClient.invalidateQueries({
                  queryKey: getGetClaimQueryKey(claim.id),
                });
                queryClient.invalidateQueries({
                  queryKey: getListInvoiceGroupsQueryKey(),
                });
                queryClient.invalidateQueries({
                  queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
                });
                onAfterVerdict(`Verdict recorded for #${claim.confNumber}.`);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ContinuationActionDef {
  key: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
  toneClass: string;
  targetStatus: string;
  reason: string;
}

interface ContinuationAndClosureSectionProps {
  group: InvoiceGroupResponse;
  onAfterVerdict: (message: string) => void;
}

/**
 * Continuation actions (re-dispute / re-attest / submit new invoice) and
 * closure actions live together in one rail card. Continuation logic is
 * the same as the Queue page panel — reading
 * `validTransitions.postResponseActions` for the legal set, every action
 * routes through `Needs Evidence` until #185 wires per-action endpoints.
 */
function ContinuationAndClosureSection({
  group,
  onAfterVerdict,
}: ContinuationAndClosureSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateStatus = useUpdateInvoiceGroupStatus();

  const { data: validTransitions } = useGetInvoiceGroupValidTransitions(group.id);
  const postResponseActions = (validTransitions?.postResponseActions || []) as string[];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(group.id) });
    queryClient.invalidateQueries({
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(group.id),
    });
    queryClient.invalidateQueries({
      queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
    });
  };

  const continuationActions: ContinuationActionDef[] = [];
  if (postResponseActions.includes("re_dispute")) {
    continuationActions.push({
      key: "re_dispute",
      label: "Re-dispute",
      sub: "Gather more evidence and re-submit",
      icon: <Send className="h-3.5 w-3.5" />,
      toneClass: "bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-900",
      targetStatus: "Needs Evidence",
      reason:
        "Re-dispute with additional points — returned to evidence gathering after payor response",
    });
  }
  if (postResponseActions.includes("resolve_reattest")) {
    continuationActions.push({
      key: "resolve_reattest",
      label: "Re-attest",
      sub: "Capture re-attestation; keep the dispute moving",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      toneClass: "bg-blue-50 hover:bg-blue-100 border-blue-300 text-blue-900",
      targetStatus: "Needs Evidence",
      reason:
        "Resolve via re-attestation — returned to evidence gathering to attach re-attested documentation",
    });
  }
  if (postResponseActions.includes("resolve_new_invoice")) {
    continuationActions.push({
      key: "resolve_new_invoice",
      label: "Submit new invoice",
      sub: "Set up the new invoice # and re-submit",
      icon: <CheckCircle className="h-3.5 w-3.5" />,
      toneClass: "bg-indigo-50 hover:bg-indigo-100 border-indigo-300 text-indigo-900",
      targetStatus: "Needs Evidence",
      reason:
        "Resolve via new invoice number — returned to evidence gathering for re-issued invoice details",
    });
  }

  const handleContinuation = async (action: ContinuationActionDef) => {
    try {
      await updateStatus.mutateAsync({
        id: group.id,
        data: { status: action.targetStatus, reason: action.reason },
      });
      invalidate();
      onAfterVerdict(`${action.label} — moved to ${action.targetStatus}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Action failed.";
      toast({
        title: `Couldn't apply "${action.label}"`,
        description: msg,
        variant: "destructive",
      });
    }
  };

  const isPending = updateStatus.isPending;

  return (
    <div
      className="rounded-md border bg-card overflow-hidden"
      data-testid="continuation-and-closure"
    >
      <div className="px-4 py-2.5 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">What's next?</h3>
        <p className="text-[11px] text-muted-foreground">
          Continue the dispute or close it out.
        </p>
      </div>
      <div className="p-3 space-y-3">
        <div className="space-y-1.5" data-testid="verdict-lane-continuation">
          <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
            Continuation
          </div>
          {continuationActions.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No continuation actions available for this response type.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {continuationActions.map((action) => (
                <Button
                  key={action.key}
                  variant="outline"
                  className={`h-auto py-2 px-3 flex flex-col items-start gap-0.5 ${action.toneClass}`}
                  disabled={isPending}
                  onClick={() => handleContinuation(action)}
                  data-testid={`button-continuation-${action.key}`}
                >
                  <span className="flex items-center gap-2 font-semibold text-xs">
                    {action.icon}
                    {action.label}
                  </span>
                  <span className="text-[11px] font-normal opacity-80 text-left">
                    {action.sub}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-1.5" data-testid="verdict-lane-closure">
          <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
            Closure — payor formally denied
          </div>
          <ClosureActions
            target={{ kind: "invoice_group", id: group.id }}
            outcome={group.outcome}
            closureReason={group.closureReason}
            triggers={[
              {
                reason: "denied_by_payor",
                label: "Denied by Payor",
                sub: "Payor formally denied — close out, no further dispute",
                icon: <ArrowRight className="h-3.5 w-3.5" />,
                testId: "button-closure-denied-by-payor",
              },
            ]}
            onAfterSuccess={() => {
              invalidate();
              onAfterVerdict(`#${group.invoiceNumber} closed as Denied by Payor`);
            }}
          />
        </div>

        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Applying verdict…
          </div>
        )}
      </div>
    </div>
  );
}

interface SubmissionsStripProps {
  submissions: PortalSubmissionResponse[];
  loading: boolean;
}

/**
 * Compact, collapsible "Submissions ({n}, latest: {status})" strip in the
 * action rail. Replaces the old top-of-pane SubmissionDetailsBlock card
 * which competed with the thread for vertical space and excerpted the
 * dispute body. Expanding a row opens the canonical PortalSubmissionDrawer
 * — same drawer used elsewhere — so there's no inline excerpt.
 */
function SubmissionsStrip({ submissions, loading }: SubmissionsStripProps) {
  const [expanded, setExpanded] = useState(false);
  const [drawerSubmissionId, setDrawerSubmissionId] = useState<number | null>(null);

  // Newest first — operators care most about the most recent filing.
  const sorted = useMemo(
    () =>
      [...submissions].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      }),
    [submissions],
  );
  const latest = sorted[0];

  if (loading) {
    return (
      <div className="px-4 py-2.5 border-t">
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div
        className="px-4 py-2.5 border-t text-xs text-muted-foreground italic"
        data-testid="submissions-strip-empty"
      >
        <FileText className="h-3.5 w-3.5 inline mr-1" />
        No submissions on file yet.
      </div>
    );
  }

  return (
    <div className="border-t" data-testid="submissions-strip">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-muted/40 text-xs"
        data-testid="submissions-strip-toggle"
        aria-expanded={expanded}
      >
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium">
          Submissions ({sorted.length}
          {latest?.status ? `, latest: ${latest.status}` : ""})
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <ul
          className="border-t divide-y"
          data-testid="submissions-strip-list"
        >
          {sorted.map((sub) => (
            <li key={sub.id}>
              <button
                type="button"
                onClick={() => setDrawerSubmissionId(sub.id)}
                className="w-full px-4 py-2 flex items-center gap-2 text-left text-xs hover:bg-muted/40"
                data-testid={`submissions-strip-row-${sub.id}`}
              >
                <Badge variant="outline" className="text-[10px]">
                  {sub.status}
                </Badge>
                <span className="text-muted-foreground truncate">
                  {sub.createdAt ? formatDateTime(sub.createdAt) : "—"}
                </span>
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <PortalSubmissionDrawer
        submissionId={drawerSubmissionId}
        open={drawerSubmissionId !== null}
        onOpenChange={(open) => {
          if (!open) setDrawerSubmissionId(null);
        }}
      />
    </div>
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
  const sanitizedHtml = useMemo(() => {
    if (response.bodyFormat !== "html") return null;
    const raw = response.content || response.rawContent || "";
    if (!raw) return null;
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: [
        "p", "br", "strong", "em", "u", "b", "i", "ul", "ol", "li",
        "a", "blockquote", "pre", "code", "h1", "h2", "h3", "h4",
        "h5", "h6", "span", "div",
      ],
      ALLOWED_ATTR: ["href", "target", "rel"],
    });
  }, [response.bodyFormat, response.content, response.rawContent]);

  const plainText = response.content || response.rawContent || "";
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
              {invoiceNumber}
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

        {sanitizedHtml ? (
          <div
            className="prose prose-sm max-w-none text-sm"
            data-testid="inline-response-fallback-body-html"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        ) : plainText ? (
          <pre
            className="whitespace-pre-wrap text-sm font-sans"
            data-testid="inline-response-fallback-body-text"
          >
            {plainText}
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
