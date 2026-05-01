import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import {
  useListInvoiceGroups,
  getListInvoiceGroupsQueryKey,
  useGetInvoiceGroup,
  getInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useGetClaimEmailThread,
  useReplyToEmailConversation,
  useProcessResponse,
  getGetClaimEmailThreadQueryKey,
  getListResponsesQueryKey,
  getGetClaimQueryKey,
  getListClaimAuditLogsQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
  useListClaimEvidence,
  getListClaimEvidenceQueryKey,
  useRecordLegVerdict,
  useCompleteLegMasAction,
  useCompleteGroupReattest,
  ProcessResponseBodyResponseType,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
  InvoiceGroupResponse,
  PortalResponseItem,
  PortalSubmissionResponse,
  EmailThreadConversation,
  ClaimResponseClosureReason,
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
import { ConversationsCard } from "@/components/conversations-card";
import {
  pickLatestReviewableResponse,
  getResponseTypeLabel,
  getResponseTypePillClass,
} from "@/components/queue-response-review-panel";
import { useToast } from "@/hooks/use-toast";
import { useInvoiceGroupsListEvents, useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useGetAttestationCounts } from "@workspace/api-client-react";
import {
  CheckCircle,
  AlertTriangle,
  Clock,
  Edit2,
  Eye,
  ExternalLink,
  Inbox,
  FileText,
  ArrowDownWideNarrow,
  ArrowRight,
  ListChecks,
  ShieldCheck,
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
 * The Queue page card from Task #162 is a peek; this is the dedicated
 * workspace for sitting in response review. Master/detail layout: list of
 * verdict-pending groups on the left, full review context (response thread,
 * submission details, verdict actions) on the right. URL reflects the
 * selected group id so direct links and back/forward work.
 *
 * Data shape mirrors the Queue card on purpose: same filter (Needs Review +
 * has errorTypeId) and same row meta (`pickLatestReviewableResponse`,
 * `ResponseReviewRowMeta`), so the two surfaces stay in lockstep visually.
 *
 * The body is intentionally wrapped in a Tabs container with a single
 * "Verdict pending" tab today. Task #165 will plug the Attestation surface
 * in as a second tab here without restructuring.
 */
/**
 * Narrow `PortalResponseItem.responseType` to the subset the
 * /process endpoint accepts. Both unions resolve to the same string set
 * today, but they're distinct branded types from codegen — using the
 * runtime enum as the source of truth keeps this honest if either side
 * adds a value later.
 */
function toProcessResponseType(
  type: string | null | undefined,
): ProcessResponseBodyResponseType | null {
  if (!type) return null;
  const allowed = Object.values(ProcessResponseBodyResponseType) as string[];
  return allowed.includes(type) ? (type as ProcessResponseBodyResponseType) : null;
}

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
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
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
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
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
  const { data: detail } = useGetInvoiceGroup(group.id);
  const latestResponse = pickLatestReviewableResponse(detail?.responses);

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
            {group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}
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
}

function DetailPane({
  group,
  onAfterVerdict,
}: DetailPaneProps) {
  // Subscribe to per-group SSE events so the detail pane refreshes as the
  // payor's response gets re-tagged or as siblings move through verdict
  // actions in another tab.
  useInvoiceGroupEvents(group.id);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: detail, isLoading: detailLoading } = useGetInvoiceGroup(group.id);

  const submissions: PortalSubmissionResponse[] = detail?.submissions ?? [];
  const responses: PortalResponseItem[] = detail?.responses ?? [];
  const latestResponse = pickLatestReviewableResponse(responses);

  // Conversations live on the claim that received the inbound response —
  // there is no group-level email thread endpoint. We pull the thread for
  // the latest reviewable response's claim so the operator can read the
  // exchange and reply via the same composer used on the claim page.
  const threadClaimId = latestResponse?.claimId ?? null;
  const { data: emailThreadData } = useGetClaimEmailThread(threadClaimId ?? 0, {
    query: {
      queryKey: getGetClaimEmailThreadQueryKey(threadClaimId ?? 0),
      enabled: threadClaimId !== null && threadClaimId > 0,
    },
  });
  const conversations: EmailThreadConversation[] =
    emailThreadData?.conversations ?? [];
  const claimResponses: PortalResponseItem[] = useMemo(
    () => responses.filter((r) => r.claimId === threadClaimId),
    [responses, threadClaimId],
  );

  // Available evidence for the reply composer's attach picker. Mirrors the
  // claim-detail filter: only file-backed `/objects/...` rows are eligible
  // (the API rejects arbitrary URLs). Stays empty when no claim is selected
  // (e.g. response with no matched claim).
  const { data: evidenceList } = useListClaimEvidence(threadClaimId ?? 0, {
    query: {
      queryKey: getListClaimEvidenceQueryKey(threadClaimId ?? 0),
      enabled: threadClaimId !== null && threadClaimId > 0,
    },
  });
  const availableEvidence = useMemo(() => {
    const items = Array.isArray(evidenceList?.evidence) ? evidenceList.evidence : [];
    return items
      .filter(
        (ev) =>
          typeof ev.imageUrl === "string" &&
          (ev.imageUrl as string).trim().startsWith("/objects/"),
      )
      .map((ev) => {
        const url = (ev.imageUrl as string).trim();
        const tail = url.split("?")[0]?.split("/").pop() ?? "";
        const fileName = tail && tail !== "" ? decodeURIComponent(tail) : null;
        return {
          id: ev.id as number,
          label: ev.evidenceTypeName as string,
          fileName,
        };
      });
  }, [evidenceList]);

  const replyMutation = useReplyToEmailConversation();
  const processResponseMutation = useProcessResponse();

  const invalidateThread = () => {
    if (threadClaimId === null) return;
    queryClient.invalidateQueries({
      queryKey: getGetClaimEmailThreadQueryKey(threadClaimId),
    });
    queryClient.invalidateQueries({
      queryKey: getListResponsesQueryKey({ claimId: threadClaimId }),
    });
    queryClient.invalidateQueries({
      queryKey: getGetClaimQueryKey(threadClaimId),
    });
    queryClient.invalidateQueries({
      queryKey: getListClaimAuditLogsQueryKey(threadClaimId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetInvoiceGroupQueryKey(group.id),
    });
  };

  // ConversationsCard expects a `Pick<ClaimResponse, "closureReason">`.
  // The group's closureReason enum mirrors the claim's enum value-for-value
  // (`denied_by_payor` / `cannot_dispute` / `non_issue`), so we cast across
  // — same string union, just a different brand from codegen.
  const claimContext: { closureReason: ClaimResponseClosureReason | undefined } = {
    closureReason: detail?.closureReason as ClaimResponseClosureReason | undefined,
  };

  return (
    <div className="space-y-4" data-testid={`detail-pane-${group.id}`}>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1 min-w-0">
              <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                <span className="font-mono">#{group.invoiceNumber}</span>
                <StatusBadge status={group.status} />
                <UrgentTodayBadge isUrgent={group.isUrgent} />
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {group.errorTypeName ?? "Unclassified"} ·{" "}
                {group.rideCount} ride{group.rideCount !== 1 ? "s" : ""} ·{" "}
                {formatCurrency(group.totalAmount)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/invoice-groups/${group.id}`}>
                <Button variant="outline" size="sm" data-testid="open-full-invoice">
                  Open full details
                  <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>
      </Card>

      <SubmissionDetailsBlock
        submissions={submissions}
        loading={detailLoading && !detail}
      />

      {threadClaimId !== null && conversations.length > 0 ? (
        <ConversationsCard
          conversations={conversations}
          claimResponses={claimResponses}
          claim={claimContext}
          availableEvidence={availableEvidence}
          isReplying={replyMutation.isPending}
          onApprove={async (responseId) => {
            await processResponseMutation.mutateAsync({
              id: responseId,
              data: { responseType: "approval" },
            });
            invalidateThread();
          }}
          onDeny={async (responseId) => {
            await processResponseMutation.mutateAsync({
              id: responseId,
              data: { responseType: "denial" },
            });
            invalidateThread();
          }}
          onMarkReviewed={async (resp) => {
            // PortalResponseItem.responseType and ProcessResponseBody.responseType
            // are two distinct codegen unions over the same string values
            // (`approval`/`denial`/`partial_approval`/`info_request`/
            // `acknowledgment`/`other`). Narrow through the runtime enum so
            // the call is type-safe — and bail with a clear error if the
            // payor response carries an unexpected value (the API would
            // reject it anyway).
            const narrowed = toProcessResponseType(resp.responseType);
            if (!narrowed) {
              throw new Error(
                `Cannot mark response reviewed — unsupported response type: ${resp.responseType}`,
              );
            }
            await processResponseMutation.mutateAsync({
              id: resp.id,
              data: { responseType: narrowed },
            });
            invalidateThread();
          }}
          onReassign={() => {
            // Reassign opens a chooser dialog on the claim-detail page; from
            // this surface we deep-link there so operators don't need a
            // duplicate dialog implementation here.
            if (threadClaimId !== null) {
              window.open(`/claims/${threadClaimId}#reassign`, "_blank");
            }
          }}
          onReply={async (input) => {
            if (threadClaimId === null) {
              throw new Error("No claim is associated with this response yet.");
            }
            try {
              const created = await replyMutation.mutateAsync({
                id: threadClaimId,
                // Outlook conversation IDs may contain reserved URL chars
                // (+, /, =) so encode before the codegen interpolates them.
                conversationId: encodeURIComponent(input.conversationId),
                data: {
                  subject: input.subject,
                  bodyText: input.bodyText,
                  to: input.to,
                  cc: input.cc,
                  evidenceIds: input.evidenceIds,
                },
              });
              invalidateThread();
              toast({
                title: "Reply sent",
                description: `Threaded into the conversation with ${input.to.join(", ")}.`,
                duration: 3500,
              });
              return created;
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "Failed to send reply.";
              toast({
                title: "Couldn't send reply",
                description: msg,
                variant: "destructive",
              });
              throw err;
            }
          }}
        />
      ) : threadClaimId !== null ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground text-center space-y-2">
            <Inbox className="h-5 w-5 mx-auto text-muted-foreground" />
            <p>
              No email conversation is associated with this response yet. The
              verdict actions below still apply.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground text-center space-y-2">
            <Inbox className="h-5 w-5 mx-auto text-muted-foreground" />
            <p>
              The latest response isn't matched to a specific claim. Open the
              full invoice page to read the response and pick a verdict.
            </p>
          </CardContent>
        </Card>
      )}

      {detail && (
        <PerLegPickerStack
          group={detail as InvoiceGroupDetailResponse}
          onAfterVerdict={onAfterVerdict}
        />
      )}
    </div>
  );
}

interface PerLegPickerStackProps {
  group: InvoiceGroupDetailResponse;
  onAfterVerdict: (message: string) => void;
}

function PerLegPickerStack({ group, onAfterVerdict }: PerLegPickerStackProps) {
  const queryClient = useQueryClient();
  const recordVerdict = useRecordLegVerdict();
  const rides: ClaimResponse[] = useMemo(
    () =>
      (group.rides ?? []).filter(
        (r) => r.includedInDispute && !!r.errorTypeId,
      ),
    [group.rides],
  );
  const { calibrationByErrorType } = useAiCalibrations(
    rides.map((r) => r.errorTypeId),
  );

  if (rides.length === 0) return null;

  return (
    <Card data-testid="per-leg-picker-stack">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Per-leg verdict</CardTitle>
        <p className="text-xs text-muted-foreground">
          Capture the verdict for each leg individually. The legacy
          group-level verdict panel below still works as a fallback.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rides.map((claim) => (
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
                queryKey: getGetInvoiceGroupQueryKey(group.id),
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
        ))}
      </CardContent>
    </Card>
  );
}

interface SubmissionDetailsBlockProps {
  submissions: PortalSubmissionResponse[];
  loading: boolean;
}

/**
 * Compact summary of every portal submission filed for the group. Includes
 * status, ticket id, dispute body excerpt, and a link to the canonical
 * preview drawer on the invoice-group page so operators can drill in.
 *
 * Kept on the page (rather than reusing the bigger SubmissionCard from the
 * claim-detail page) because we only want at-a-glance context here — the
 * deep dive lives on the full-details surface.
 */
function SubmissionDetailsBlock({ submissions, loading }: SubmissionDetailsBlockProps) {
  if (loading) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (submissions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Submission details
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground italic">
          No portal submissions on file for this group yet.
        </CardContent>
      </Card>
    );
  }

  // Newest first — operators care most about the most recent filing when
  // they're weighing a follow-up reply. Sort by createdAt desc.
  const sorted = [...submissions].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <Card data-testid="submission-details-block">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Submission details
          <Badge variant="secondary">{submissions.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.map((sub, idx) => (
          <div key={sub.id} className="space-y-2">
            {idx > 0 && <Separator />}
            <SubmissionSummary submission={sub} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SubmissionSummary({ submission: sub }: { submission: PortalSubmissionResponse }) {
  const statusVariant: "default" | "destructive" | "outline" | "secondary" =
    sub.status === "submitted" ? "default" :
    sub.status === "failed" ? "destructive" :
    sub.status === "draft" || sub.status === "dry_run" ? "outline" :
    "secondary";

  // Trim the dispute body to a few lines so it's a peek; the deep link goes
  // to the full preview/edit drawer on the invoice-group detail page.
  const excerpt = (() => {
    const raw = (sub.descriptionHtml || "").replace(/<[^>]+>/g, "").trim();
    if (!raw) return null;
    const compact = raw.replace(/\s+/g, " ");
    return compact.length > 220 ? compact.slice(0, 217) + "…" : compact;
  })();

  return (
    <div className="space-y-1.5" data-testid={`submission-summary-${sub.id}`}>
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="font-medium">Submission #{sub.id}</span>
        <Badge variant={statusVariant} className="text-[10px]">
          {sub.status === "submitted" && <CheckCircle className="h-3 w-3 mr-1" />}
          {sub.status === "failed" && <AlertTriangle className="h-3 w-3 mr-1" />}
          {sub.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
          {sub.status === "draft" && <Edit2 className="h-3 w-3 mr-1" />}
          {sub.status === "dry_run" && <Eye className="h-3 w-3 mr-1" />}
          {sub.status === "dry_run" ? "Dry Run" : sub.status === "draft" ? "Draft" : sub.status}
        </Badge>
        {sub.issueType && (
          <span className="text-xs text-muted-foreground">{sub.issueType}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {sub.createdAt ? formatDateTime(sub.createdAt) : ""}
        </span>
      </div>
      {sub.portalTicketId && (
        <div className="text-xs">
          <span className="text-muted-foreground">Ticket: </span>
          <span className="font-mono">{sub.portalTicketId}</span>
        </div>
      )}
      {sub.subject && (
        <div className="text-xs text-muted-foreground truncate" title={sub.subject}>
          Subject: {sub.subject}
        </div>
      )}
      {sub.errorMessage && (
        <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
          {sub.errorMessage}
        </div>
      )}
      {excerpt && (
        <p className="text-xs text-muted-foreground line-clamp-2" title={excerpt}>
          {excerpt}
        </p>
      )}
    </div>
  );
}
