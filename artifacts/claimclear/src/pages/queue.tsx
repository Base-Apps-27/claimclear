import { useEffect, useMemo, useRef, useState } from "react";
import { useServerDayRolloverInvalidator, latestTodayKey } from "@/lib/server-day-rollover";
import { Link } from "wouter";
import { useInvoiceGroupsListEvents, useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import {
  useListInvoiceGroups,
  useGetInvoiceGroup,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import type {
  InvoiceGroupResponse,
  NeedsClassificationInboxGroup,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/status-badge";
import { UrgentTodayWhyLine } from "@/components/urgent-today-why";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertTriangle,
  Inbox,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import {
  parseExpiringParam,
  filterByExpiringParam,
  formatDeadlineLabel,
  formatTabBadge,
  computeAggregateUrgentCount,
  emptyStateCopy,
  type ExpiringFilter,
  type DeadlineTier,
} from "@/lib/queue-urgency";
import { QueueNeedsReviewPanel } from "@/components/queue-needs-review-panel";
import { QueueReadyToPackageCta } from "@/components/queue-ready-to-package-cta";
import { UrgentTodayBadge } from "@/components/urgent-today-badge";
import { usePresence } from "@/hooks/use-presence";
import { HumanPresenceBanner } from "@/components/presence-banners";
import { formatViewerNames } from "@/components/presence-lock";
import { useUrlParams } from "@/lib/use-url-params";
import { InvoiceGroupSubmissionGauntlet } from "@/components/invoice-group-submission-gauntlet";
import { LegConclusionList } from "@/components/leg-conclusion-row";
import { CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { ClaimResponse, InvoiceGroupDetailResponse } from "@workspace/api-client-react";

// Workflow tabs only — Needs Review is intentionally NOT a tab here.
// Triage lives in the Classification Inbox above the workflow grid.
// "Awaiting Response" was removed in Task #232: those groups are still
// visible on /responses-awaiting-review when something needs a verdict.
const VALID_TABS = ["actionable", "portal-queued", "on-hold"] as const;
type QueueTab = typeof VALID_TABS[number];
const DEFAULT_TAB: QueueTab = "actionable";

/**
 * Big urgency hero at the top of the Queue. Mirrors the Dashboard's
 * "File today" card so the operator who clicked through doesn't lose
 * context. Three states:
 * - red    → urgent groups exist; file-today crunch, intensified
 *            (full-width + sticky) when arrived via `?expiring=urgent`.
 * - amber  → on the `?expiring=soon` view; softer signal, no sticky.
 * - green  → urgentCount === 0; calm "all clear" relief state.
 */
function QueueUrgencyHero({
  urgentCount,
  soonCount,
  filter,
}: {
  urgentCount: number;
  soonCount: number;
  filter: ExpiringFilter;
}) {
  if (filter === "soon") {
    return (
      <div
        data-testid="queue-urgency-hero"
        data-tone="amber"
        className="rounded-lg border-2 px-5 py-4 flex items-center gap-4"
        style={{
          background: "hsl(var(--cc-amber-bg))",
          borderColor: "hsl(var(--cc-amber-border))",
          color: "hsl(var(--cc-amber-fg))",
        }}
      >
        <AlertTriangle className="h-6 w-6 shrink-0" style={{ color: "hsl(var(--cc-amber-fg))" }} />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="text-3xl font-bold tabular-nums"
              data-testid="queue-urgency-hero-count"
            >
              {soonCount}
            </span>
            <span className="text-sm">due in the next 3 days · stay ahead of the clock</span>
          </div>
          <UrgentTodayWhyLine tone="amber" testid="queue-urgent-today-why-amber" />
        </div>
      </div>
    );
  }

  if (urgentCount > 0) {
    const intensified = filter === "urgent";
    return (
      <div
        data-testid="queue-urgency-hero"
        data-tone="red"
        data-intensified={intensified ? "true" : undefined}
        className={`rounded-lg border-2 px-5 py-4 flex items-center gap-4 ${
          intensified ? "sticky top-0 z-20 shadow-lg" : ""
        }`}
        style={{
          background: "hsl(var(--cc-red-bg))",
          borderColor: "hsl(var(--cc-red-border))",
          color: "hsl(var(--cc-red-fg))",
        }}
      >
        <AlertTriangle className="h-7 w-7 shrink-0" style={{ color: "hsl(var(--destructive))" }} />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span
              className="text-4xl font-bold tabular-nums"
              style={{ color: "hsl(var(--destructive))" }}
              data-testid="queue-urgency-hero-count"
            >
              {urgentCount}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">
                {urgentCount === 1 ? "group" : "groups"} must be submitted before EOD
              </span>
              <span className="text-xs opacity-80">
                File today across Action Required, Portal Queued, and On Hold.
              </span>
            </div>
          </div>
          <UrgentTodayWhyLine
            tone="red"
            urgentCountOverride={urgentCount}
            testid="queue-urgent-today-why-red"
          />
        </div>
      </div>
    );
  }

  // Green "all clear" relief state — calm white-to-green gradient so it
  // celebrates the cleared file-today queue without screaming.
  return (
    <div
      data-testid="queue-urgency-hero"
      data-tone="green"
      className="rounded-lg border-2 px-5 py-4 flex items-center gap-4"
      style={{
        background:
          "linear-gradient(90deg, hsl(var(--card)) 0%, hsl(var(--cc-green-bg)) 100%)",
        borderColor: "hsl(var(--cc-green-border))",
        color: "hsl(var(--cc-green-fg))",
      }}
    >
      <Sparkles className="h-6 w-6 shrink-0" style={{ color: "hsl(var(--cc-green-fg))" }} />
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            className="text-3xl font-bold tabular-nums"
            style={{ color: "hsl(var(--cc-green-fg))" }}
            data-testid="queue-urgency-hero-count"
          >
            0
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">All clear — nothing must file today.</span>
            <span className="text-xs opacity-80">
              File-today queue is empty. Work the next tier so it stays that way.
            </span>
          </div>
        </div>
        <UrgentTodayWhyLine tone="green" urgentCountOverride={0} testid="queue-urgent-today-why-green" />
      </div>
    </div>
  );
}

/**
 * Inline filter chip below the hero — lets the operator see (and clear)
 * the `?expiring=` filter without spelunking the URL bar.
 */
function ExpiringFilterChip({
  filter,
  count,
  onClear,
}: {
  filter: NonNullable<ExpiringFilter>;
  count: number;
  onClear: () => void;
}) {
  const tone = filter === "urgent"
    ? {
        bg: "hsl(var(--cc-red-bg))",
        border: "hsl(var(--cc-red-border))",
        fg: "hsl(var(--cc-red-fg))",
        label: `Urgent — file today (${count})`,
      }
    : {
        bg: "hsl(var(--cc-amber-bg))",
        border: "hsl(var(--cc-amber-border))",
        fg: "hsl(var(--cc-amber-fg))",
        label: `Due within 3 days (${count})`,
      };
  return (
    <div className="flex items-center gap-2" data-testid="expiring-filter-chip">
      <span className="text-xs text-muted-foreground">Showing:</span>
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
        style={{ background: tone.bg, borderColor: tone.border, color: tone.fg }}
      >
        {tone.label}
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear filter"
          data-testid="expiring-filter-chip-clear"
          className="rounded-full p-0.5 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-1"
          style={{ color: tone.fg }}
        >
          <X className="h-3 w-3" />
        </button>
      </span>
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        Clear filter
      </button>
    </div>
  );
}

/**
 * On-clock tab badge with optional urgent split.
 *
 * - No filter      → "<total>" + red "<N> urgent" pill (when applicable).
 * - ?expiring=urgent → just the red urgent count (totals would lie since
 *   the filter is hiding non-urgent rows).
 * - ?expiring=soon → just the amber soon count for this lane (urgent
 *   pill would mismatch — soon rows are non-urgent by definition).
 */
function TabBadgeSplit({
  total,
  urgent,
  soon,
  filterMode,
  testid,
}: {
  total: number;
  urgent: number;
  soon: number;
  filterMode: ExpiringFilter;
  testid?: string;
}) {
  const badge = formatTabBadge(total, urgent, filterMode, soon);
  if (!badge.total && !badge.urgent && !badge.soon) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1" data-testid={testid}>
      {badge.total != null && (
        <Badge variant="secondary" data-testid={testid ? `${testid}-total` : undefined}>
          {badge.total}
        </Badge>
      )}
      {badge.urgent != null && (
        <Badge
          variant="outline"
          data-testid={testid ? `${testid}-urgent` : undefined}
          style={{
            background: "hsl(var(--cc-red-bg))",
            borderColor: "hsl(var(--cc-red-border))",
            color: "hsl(var(--destructive))",
            fontWeight: 700,
          }}
        >
          {badge.urgent}
        </Badge>
      )}
      {badge.soon != null && (
        <Badge
          variant="outline"
          data-testid={testid ? `${testid}-soon` : undefined}
          style={{
            background: "hsl(var(--cc-amber-bg))",
            borderColor: "hsl(var(--cc-amber-border))",
            color: "hsl(var(--cc-amber-fg))",
            fontWeight: 700,
          }}
        >
          {badge.soon}
        </Badge>
      )}
    </span>
  );
}

export default function Queue() {
  useInvoiceGroupsListEvents();
  const queryClient = useQueryClient();
  const { get, set } = useUrlParams();

  const tabParam = get("tab");
  const activeTab: QueueTab = (VALID_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as QueueTab)
    : DEFAULT_TAB;

  // `?expiring=urgent|soon` is the link payload from the Dashboard's
  // "File today" hero (urgent) and "+ N in next 3 days" footer (soon).
  // Anything else collapses to null so a stale share link can't pin the
  // queue to a state that no longer exists.
  const expiringFilter: ExpiringFilter = parseExpiringParam(get("expiring"));
  const clearExpiringFilter = () => set({ expiring: null }, false);

  // URL-persisted: which workflow group is open in the inline workspace,
  // and whether the Classification Inbox is expanded.
  const groupParam = Number.parseInt(get("group"), 10);
  const selectedWorkflowId: number | null = Number.isFinite(groupParam) && groupParam > 0 ? groupParam : null;
  const inboxOpen = get("inbox") === "open";

  const [selectedTriageId, setSelectedTriageId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  useInvoiceGroupEvents(selectedWorkflowId ?? undefined);
  const { viewers, otherViewers, othersPresent } = usePresence("invoice_group", selectedWorkflowId ?? undefined);
  const lockReason = othersPresent
    ? `Disabled — ${formatViewerNames(otherViewers)} ${otherViewers.length === 1 ? "is" : "are"} currently working on this group. Wait for them to leave or coordinate directly.`
    : null;

  const workflowPanelRef = useRef<HTMLDivElement>(null);

  const setSelectedWorkflowId = (id: number | null) => {
    set({ group: id == null ? null : String(id) }, false);
  };
  const setInboxOpen = (open: boolean) => {
    set({ inbox: open ? "open" : null }, false);
  };

  const selectWorkflow = (id: number) => {
    setSelectedWorkflowId(id);
    window.requestAnimationFrame(() => {
      workflowPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Triage selection drives a modal dialog (see ClassificationInbox +
  // Dialog below). No scroll-into-view needed — the dialog pops up
  // centered over the page and the inbox stays put behind it.
  const selectTriage = (id: number) => {
    setSelectedTriageId(id);
  };

  const handleTabChange = (value: string) => {
    setSuccessMessage("");
    // Selection is intentionally preserved across tab changes — the
    // operator may want to keep a workspace open while quickly checking
    // counts in another tab. URL-backed `?group=` is the source of truth.
    if (value === DEFAULT_TAB) {
      set({ tab: null }, false);
    } else {
      set({ tab: value }, false);
    }
  };

  // Bumped limits so the visible list isn't capped while a real total is
  // available — the tab/section badges use server `total`, not array length.
  //
  // `refetchOnWindowFocus: true` is scoped here (the global QueryClient
  // disables it by default) so the Queue can never drift from the
  // Dashboard the way it did before Task #290 — when an operator left
  // the Queue open, hit lunch, and returned after the deadline tipped,
  // cached rows kept yesterday's `isUrgent: false` while the Dashboard
  // (freshly fetched on its own mount) showed the new urgent count.
  // Refetching on focus + on day rollover (see effect below) keeps both
  // surfaces in sync without a manual refresh.
  const newParams = { status: "New", limit: 500 } as const;
  const needsEvidenceParams = { status: "Needs Evidence", limit: 500 } as const;
  // `Generating Email` is a real, pre-submit, on-clock invoice-group
  // status (set by `POST /invoice-groups/:id/package` when the operator
  // clicks "Ready to package"). It satisfies the same urgency rule as
  // `New` / `Needs Evidence` and folds into the Action Required lane so
  // the Dashboard can never count an urgent group the operator has
  // nowhere to act on.
  const generatingEmailParams = { status: "Generating Email", limit: 500 } as const;
  const portalQueuedParams = { status: "Portal Queued", limit: 500 } as const;
  const onHoldParams = { status: "On Hold", limit: 500 } as const;
  const newQuery = useListInvoiceGroups(newParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(newParams), refetchOnWindowFocus: true },
  });
  const needsEvidenceQuery = useListInvoiceGroups(needsEvidenceParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(needsEvidenceParams), refetchOnWindowFocus: true },
  });
  const generatingEmailQuery = useListInvoiceGroups(generatingEmailParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(generatingEmailParams), refetchOnWindowFocus: true },
  });
  const portalQueuedQuery = useListInvoiceGroups(portalQueuedParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(portalQueuedParams), refetchOnWindowFocus: true },
  });
  const onHoldQuery = useListInvoiceGroups(onHoldParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(onHoldParams), refetchOnWindowFocus: true },
  });

  const newGroups = newQuery.data?.groups || [];
  const needsGroups = needsEvidenceQuery.data?.groups || [];
  const generatingEmailGroups = generatingEmailQuery.data?.groups || [];
  const portalQueuedGroups = portalQueuedQuery.data?.groups || [];
  const onHoldGroups = onHoldQuery.data?.groups || [];

  const actionableTotal =
    (newQuery.data?.total ?? 0) +
    (needsEvidenceQuery.data?.total ?? 0) +
    (generatingEmailQuery.data?.total ?? 0);
  const portalQueuedTotal = portalQueuedQuery.data?.total ?? 0;
  const onHoldTotal = onHoldQuery.data?.total ?? 0;

  // Classification Inbox: piggybacks on `GET /invoice-groups` via
  // `?include=needs_classification`. We pass a tiny status filter
  // (`Needs Review`) and `limit=0` because we only care about the
  // embedded `needsClassificationInbox` payload — not the list itself.
  // Single round trip, single query key, no fork between counts and
  // payload. Same focus-refetch treatment as the lane queries — the
  // Needs Review inbox sits on the same page and the operator expects
  // it to stay current after a tab refocus.
  const inboxParams = {
    status: "Needs Review",
    limit: 0,
    include: "needs_classification",
  } as const;
  const inboxQuery = useListInvoiceGroups(inboxParams, {
    query: { queryKey: getListInvoiceGroupsQueryKey(inboxParams), refetchOnWindowFocus: true },
  });
  const inboxGroups: NeedsClassificationInboxGroup[] =
    inboxQuery.data?.needsClassificationInbox?.groups ?? [];
  const inboxTotal = inboxQuery.data?.needsClassificationInbox?.total ?? 0;

  // Within each on-clock list, sort urgent rows to the top, then by remaining
  // days asc. The API already returns rows in service-date asc order, which is
  // the right baseline; this just biases urgent items above stale-but-not-due
  // ones in the same view.
  const sortByUrgency = (rows: InvoiceGroupResponse[]) =>
    [...rows].sort((a, b) => {
      const aUrgent = a.isUrgent ? 1 : 0;
      const bUrgent = b.isUrgent ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      const aDays = a.effectiveDaysLeft ?? Number.POSITIVE_INFINITY;
      const bDays = b.effectiveDaysLeft ?? Number.POSITIVE_INFINITY;
      return aDays - bDays;
    });

  // Unfiltered, sorted lists drive the urgent split badges (so the
  // "62 urgent" hint still reflects reality even when the operator has
  // narrowed the visible set with `?expiring=`).
  //
  // Action Required = New ∪ Needs Evidence ∪ Generating Email — every
  // pre-submit, on-clock group lands here so the Dashboard's "must file
  // today" hero count and the Queue's `?expiring=urgent` view can never
  // disagree about what's actionable. (See dashboard.ts comment.)
  const actionableAll = sortByUrgency([
    ...newGroups,
    ...needsGroups,
    ...generatingEmailGroups,
  ]);
  const portalQueuedAll = sortByUrgency(portalQueuedGroups);
  const onHoldAll = sortByUrgency(onHoldGroups);

  // Filtered lists are what the row renderer sees.
  const actionableGroups = filterByExpiringParam(actionableAll, expiringFilter);
  const portalQueuedSorted = filterByExpiringParam(portalQueuedAll, expiringFilter);
  const onHoldSorted = filterByExpiringParam(onHoldAll, expiringFilter);

  const actionableUrgent = actionableAll.filter(g => g.isUrgent).length;
  const portalQueuedUrgent = portalQueuedAll.filter(g => g.isUrgent).length;
  const onHoldUrgent = onHoldAll.filter(g => g.isUrgent).length;
  // Hero count comes from the shared helper so the value the Queue's
  // hero shows is provably the same number the Dashboard's "File today"
  // card derives from the same data.
  const urgentCount = computeAggregateUrgentCount(
    actionableAll,
    portalQueuedAll,
    onHoldAll,
  );

  // Per-lane "soon" counts feed the soon-mode tab badge so it reflects
  // what's visible in that lane under `?expiring=soon`.
  const actionableSoonCount = actionableGroups.length;
  const portalQueuedSoonCount = portalQueuedSorted.length;
  const onHoldSoonCount = onHoldSorted.length;

  // Visible-set count for the chip — reflects what the operator is
  // actually looking at, post-filter.
  const visibleFilteredCount =
    actionableGroups.length + portalQueuedSorted.length + onHoldSorted.length;

  const allGroups = [
    ...actionableAll,
    ...portalQueuedAll,
    ...onHoldAll,
  ];
  const selectedWorkflowGroupSummary = selectedWorkflowId
    ? allGroups.find(g => g.id === selectedWorkflowId) || null
    : null;

  // Auto-select when there's exactly one row in the current tab and nothing
  // explicit in the URL. Tab changes blow the URL group, so this re-runs on
  // tab change and lands on the only candidate immediately. We deliberately
  // don't auto-select once the user has cleared a selection within the same
  // tab — that's tracked by URL state, so any click survives a re-render.
  // Filtered candidates so we don't auto-jump to a row that's hidden by
  // `?expiring=` and leave the operator looking at a phantom workspace.
  useEffect(() => {
    if (selectedWorkflowId != null) return;
    const candidates =
      activeTab === "actionable" ? actionableGroups
      : activeTab === "portal-queued" ? portalQueuedSorted
      : onHoldSorted;
    if (candidates.length === 1) {
      setSelectedWorkflowId(candidates[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, actionableGroups.length, portalQueuedSorted.length, onHoldSorted.length]);

  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => setSuccessMessage(""), 4000);
    return () => clearTimeout(t);
  }, [successMessage]);

  // Drop a stale triage selection if the inbox no longer surfaces that group.
  useEffect(() => {
    if (selectedTriageId && !inboxGroups.some(g => g.id === selectedTriageId)) {
      setSelectedTriageId(null);
    }
  }, [selectedTriageId, inboxGroups]);

  const invalidate = () => {
    // Single key — both the workflow tabs and the embedded inbox live
    // under `getListInvoiceGroupsQueryKey()` now that the inbox rides on
    // the `?include=needs_classification` payload.
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  };

  // Day-rollover invalidator (Task #294, replaces Task #290's local
  // midnight `setTimeout`). The server embeds a `today` key on every
  // deadline-driven response; when the value changes vs. the previously-
  // seen one, `useServerDayRolloverInvalidator` invalidates every
  // deadline-driven query family (lane queries, dashboard summary) so
  // the per-row `isUrgent` / `effectiveDaysLeft` flags refresh against
  // the new "today". No client clock involved — the focus refetch on
  // these queries is what surfaces the new server `today` in the first
  // place, which then cascades the invalidation. We pick the *latest*
  // `today` across every lane (not just the first non-null one) so that
  // if any single lane has already seen the new day — e.g. one lane
  // refetched on focus while another is still serving yesterday's
  // cached payload — we react immediately rather than waiting for the
  // preferred-order lane to catch up.
  const serverToday = latestTodayKey(
    newQuery.data?.today,
    needsEvidenceQuery.data?.today,
    generatingEmailQuery.data?.today,
    portalQueuedQuery.data?.today,
    onHoldQuery.data?.today,
    inboxQuery.data?.today,
  );
  useServerDayRolloverInvalidator(serverToday);

  // Per-row deadline pill — renders for *every* on-clock row that has
  // an `effectiveDaysLeft`, including rows past a week. Before Task #274
  // anything beyond the 7-day window rendered nothing, so the legend
  // promised tiers the operator never saw. Tier styling lines up
  // exactly with the legend wording on the Action Required tab.
  const renderDeadlineHint = (group: InvoiceGroupResponse) => {
    const labelInfo = formatDeadlineLabel(group);
    if (!labelInfo) return null;
    const tierStyles: Record<DeadlineTier, React.CSSProperties> = {
      today: {
        background: "hsl(var(--destructive))",
        color: "white",
        borderColor: "hsl(var(--destructive))",
      },
      overdue: {
        background: "hsl(var(--destructive))",
        color: "white",
        borderColor: "hsl(var(--destructive))",
      },
      soon: {
        background: "hsl(var(--cc-amber-bg))",
        color: "hsl(var(--cc-amber-fg))",
        borderColor: "hsl(var(--cc-amber-border))",
      },
      week: {
        background: "hsl(var(--cc-amber-bg))",
        color: "hsl(var(--cc-amber-fg))",
        borderColor: "hsl(var(--cc-amber-border))",
        opacity: 0.85,
      },
      later: {
        background: "hsl(var(--muted))",
        color: "hsl(var(--muted-foreground))",
        borderColor: "transparent",
      },
    };
    return (
      <span
        data-testid={`deadline-hint-${group.invoiceNumber}`}
        data-tier={labelInfo.tier}
        className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
        style={tierStyles[labelInfo.tier]}
        title={labelInfo.tooltip}
      >
        {labelInfo.label}
      </span>
    );
  };

  const renderGroupRow = (
    group: InvoiceGroupResponse,
    opts: {
      onSelect: (id: number) => void;
      selectedId: number | null;
      showDeadline?: boolean;
    },
  ) => {
    const isSelected = opts.selectedId === group.id;
    const meta = group.errorTypeName ? (
      <span className="text-muted-foreground truncate min-w-0" title={group.errorTypeName}>
        {group.errorTypeName}
      </span>
    ) : null;
    // Urgent rows get the strong red row treatment: tinted background,
    // red left border, larger TODAY badge, currency in red. Non-urgent
    // rows that match an active "soon" filter get a softer amber tint
    // so the filter context reads on the row itself, not just the chip.
    const isSoonRow =
      !group.isUrgent &&
      group.effectiveDaysLeft != null &&
      group.effectiveDaysLeft >= 1 &&
      group.effectiveDaysLeft <= 3;
    let rowStyle: React.CSSProperties = {};
    if (group.isUrgent) {
      rowStyle = {
        background: "hsl(var(--cc-red-bg))",
        borderColor: "hsl(var(--cc-red-border))",
        borderLeftWidth: 4,
        borderLeftColor: "hsl(var(--destructive))",
      };
    } else if (expiringFilter === "soon" && isSoonRow) {
      rowStyle = {
        background: "hsl(var(--cc-amber-bg))",
        borderColor: "hsl(var(--cc-amber-border))",
        borderLeftWidth: 4,
        borderLeftColor: "hsl(var(--cc-amber-fg))",
      };
    }
    return (
      <button
        key={group.id}
        type="button"
        data-testid={`queue-row-${group.invoiceNumber}`}
        data-urgent={group.isUrgent ? "true" : undefined}
        aria-pressed={isSelected}
        onClick={() => opts.onSelect(group.id)}
        style={rowStyle}
        className={`w-full text-left rounded-lg border bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isSelected ? "ring-2 ring-primary border-primary" : "hover:bg-accent/50"
        }`}
      >
        {/*
          Two-row layout that gracefully wraps on narrow widths (Task #290).
          Before this change the left cluster used `shrink-0` against a
          `flex-1` right cluster, so on viewports around 375–430 px the
          status badge and the per-row deadline pill (the
          `renderDeadlineHint` output) silently disappeared off the right
          edge of the row. The fix is structural rather than a media
          query: each row is split into a top line that always wraps
          its own children (badge / invoice# / ride count / status / pill)
          and a bottom line that holds the error-type meta + currency +
          chevron. `min-w-0` on the inner clusters lets the truncating
          `meta` span actually truncate instead of forcing horizontal
          overflow that would push the pill out of view.
        */}
        <div className="py-3 px-6 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
            <div className="whitespace-nowrap flex items-center gap-2">
              <UrgentTodayBadge isUrgent={group.isUrgent} size={group.isUrgent ? "md" : "sm"} />
              <span className="font-mono font-semibold">{group.invoiceNumber}</span>
              <span className="text-muted-foreground ml-1 text-sm">{group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}</span>
            </div>
            <StatusBadge status={group.status} />
            {opts.showDeadline && renderDeadlineHint(group)}
          </div>
          <div className="flex items-center gap-4 text-sm min-w-0 justify-between">
            <div className="min-w-0 flex-1 truncate">{meta}</div>
            <div className="flex items-center gap-4 shrink-0">
              <span
                className={`whitespace-nowrap ${group.isUrgent ? "font-bold" : "font-medium"}`}
                style={group.isUrgent ? { color: "hsl(var(--destructive))" } : undefined}
              >
                {formatCurrency(group.totalAmount)}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">Invoice queue</h2>
        <p className="text-muted-foreground">
          Operator workspace. Triage new imports in the <span className="font-medium">Classification Inbox</span> when something lands, then work the <span className="font-medium">Action Required</span> tab. Earliest service date first; red badges mark groups that must file today.
        </p>
      </div>

      <QueueUrgencyHero
        urgentCount={urgentCount}
        soonCount={visibleFilteredCount}
        filter={expiringFilter}
      />

      {expiringFilter && (
        <ExpiringFilterChip
          filter={expiringFilter}
          count={visibleFilteredCount}
          onClear={clearExpiringFilter}
        />
      )}

      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-800">{successMessage}</span>
        </div>
      )}

      {/* Classification Inbox — collapsible, claim-aware. Defaults
          collapsed because most days nothing imports; expanded state is
          URL-persisted (?inbox=open) so a refresh keeps it open while
          someone's actively working through it. The triage workspace
          itself opens in a modal dialog (below) so the inbox list stays
          in place when a row is picked. */}
      <ClassificationInbox
        open={inboxOpen}
        onToggle={() => setInboxOpen(!inboxOpen)}
        loading={inboxQuery.isLoading}
        groups={inboxGroups}
        total={inboxTotal}
        selectedId={selectedTriageId}
        onSelect={selectTriage}
      />

      {/* Triage workspace dialog. Open whenever an inbox row is
          selected; closing it (Esc, overlay, X) clears the selection.
          We re-find the inbox payload row each render so per-claim
          mutations show their effect (the row is a derivation of the
          embedded inbox payload, which the cache invalidate refetches
          under the same query key). */}
      <Dialog
        open={selectedTriageId != null}
        onOpenChange={(open) => {
          if (!open) setSelectedTriageId(null);
        }}
      >
        <DialogContent
          className="max-w-3xl max-h-[90vh] p-0 gap-0"
          data-testid="triage-dialog"
        >
          <DialogTitle className="sr-only">Classification workspace</DialogTitle>
          <DialogDescription className="sr-only">
            Classify or exclude individual claims for the selected invoice group.
          </DialogDescription>
          <div className="overflow-y-auto max-h-[90vh] p-6 pt-10">
            {selectedTriageId != null && (() => {
              const row = inboxGroups.find((g) => g.id === selectedTriageId);
              if (!row) return null;
              return (
                <QueueNeedsReviewPanel
                  inboxGroup={row}
                  onCompleted={(message) => {
                    setSuccessMessage(message);
                    invalidate();
                  }}
                />
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      <div className={`grid grid-cols-1 gap-6 ${selectedWorkflowId ? "lg:grid-cols-3" : ""}`}>
        <div className={`space-y-4 ${selectedWorkflowId ? "lg:col-span-1" : ""}`}>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="actionable" data-testid="tab-actionable">
                Action Required
                <TabBadgeSplit
                  total={actionableTotal}
                  urgent={actionableUrgent}
                  soon={actionableSoonCount}
                  filterMode={expiringFilter}
                  testid="tab-badge-actionable"
                />
              </TabsTrigger>
              <TabsTrigger value="portal-queued" data-testid="tab-portal-queued">
                Portal Queued
                <TabBadgeSplit
                  total={portalQueuedTotal}
                  urgent={portalQueuedUrgent}
                  soon={portalQueuedSoonCount}
                  filterMode={expiringFilter}
                  testid="tab-badge-portal-queued"
                />
              </TabsTrigger>
              <TabsTrigger value="on-hold" data-testid="tab-on-hold">
                On Hold
                <TabBadgeSplit
                  total={onHoldTotal}
                  urgent={onHoldUrgent}
                  soon={onHoldSoonCount}
                  filterMode={expiringFilter}
                  testid="tab-badge-on-hold"
                />
              </TabsTrigger>
            </TabsList>

            <TabsContent value="actionable" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-actionable">
                <span className="font-medium text-foreground">New + Needs Evidence + Generating Email.</span> Pre-submit groups you can act on right now. Sorted earliest service date first.{" "}
                <span className="font-semibold" style={{ color: "hsl(var(--destructive))" }}>Today</span> = must file before EOD,{" "}
                <span className="font-semibold" style={{ color: "hsl(var(--cc-amber-fg))" }}>≤2d</span> = within two days,{" "}
                <span className="font-semibold" style={{ color: "hsl(var(--cc-amber-fg))", opacity: 0.85 }}>≤7d</span> = within a week, neutral = anything past a week. Every row shows its tier.
              </p>
              {actionableGroups.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    {emptyStateCopy("actionable", expiringFilter)}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-actionable">
                  {actionableGroups.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId, showDeadline: true }))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="portal-queued" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-portal-queued">
                <span className="font-medium text-foreground">Drafted, waiting for the next portal submission batch.</span> The clock is still running — every row shows its deadline tier.
              </p>
              {portalQueuedSorted.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    {emptyStateCopy("portal-queued", expiringFilter)}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-portal-queued">
                  {portalQueuedSorted.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId, showDeadline: true }))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="on-hold" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-on-hold">
                <span className="font-medium text-foreground">Manually parked or blocked.</span> Still on the deadline clock — every row shows its deadline tier. Resume from the workflow when you're unblocked.
              </p>
              {onHoldSorted.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    {emptyStateCopy("on-hold", expiringFilter)}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-on-hold">
                  {onHoldSorted.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId, showDeadline: true }))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {selectedWorkflowId && (
          <div ref={workflowPanelRef} className="scroll-mt-4 lg:col-span-2">
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">
                  Process Invoice Group
                  {selectedWorkflowGroupSummary && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {selectedWorkflowGroupSummary.invoiceNumber} · {selectedWorkflowGroupSummary.status}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-1">
                  <Link href={`/invoice-groups/${selectedWorkflowId}`}>
                    <Button variant="ghost" size="sm">
                      Full Details <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedWorkflowId(null)}
                    data-testid="close-inline-workspace"
                  >
                    Close
                  </Button>
                </div>
              </div>
              <HumanPresenceBanner viewers={viewers} resourceLabel="group" />
              {/*
                Ready to package CTA — surfaces the new pre-submit
                "package this group" affordance from main alongside our
                inline workspace. The CTA self-hides once the group is
                past pre-submit, so it stays out of the way once a
                group has progressed. The lockReason is forwarded into
                InlineGroupWorkspace (which renders read-only banners
                in its subcomponents) instead of being shown as a
                separate Card to avoid duplication.
              */}
              {selectedWorkflowGroupSummary && (
                <QueueReadyToPackageCta
                  groupId={selectedWorkflowGroupSummary.id}
                  groupStatusFromList={selectedWorkflowGroupSummary.status}
                />
              )}
              <InlineGroupWorkspace groupId={selectedWorkflowId} lockReason={lockReason} />
            </div>
          </div>
        )}

        {!selectedWorkflowId && (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">Select an invoice group to process</p>
              <p className="text-sm mt-1">
                Click on a group from any workflow tab to start the dispute workflow inline.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// Classification Inbox — claim-aware preview of what's sitting in
// "Needs Review" without an Error Type yet. Each group expands to show
// the underlying claims with errorDetails so the operator can see, at a
// glance, whether anything qualifies before opening triage. Picking a
// row opens the triage workspace in a modal dialog rendered by the
// parent Queue component, so the inbox itself stays in place.
interface ClassificationInboxProps {
  open: boolean;
  onToggle: () => void;
  loading: boolean;
  groups: NeedsClassificationInboxGroup[];
  total: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function ClassificationInbox({
  open,
  onToggle,
  loading,
  groups,
  total,
  selectedId,
  onSelect,
}: ClassificationInboxProps) {
  // Empty inbox is the common case — render a subdued, non-expandable
  // strip so the operator's eye skips it. Anything > 0 makes the card
  // expandable and the count badge prominent.
  const hasWork = total > 0;
  return (
    <div className="space-y-3" data-testid="triage-inbox">
      <Card className={hasWork ? "" : "bg-muted/30"}>
        <CardContent className="p-4 space-y-3">
          {hasWork ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="w-full flex items-center justify-between gap-3 flex-wrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
              data-testid="classification-inbox-toggle"
            >
              <div className="flex items-center gap-2">
                <Inbox className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Classification Inbox</h3>
                <Badge variant="secondary" data-testid="badge-classification-count">
                  {total} to classify
                </Badge>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {open ? (
                  <>
                    Hide <ChevronUp className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Show <ChevronDown className="h-4 w-4" />
                  </>
                )}
              </div>
            </button>
          ) : (
            <div
              className="flex items-center gap-2 text-muted-foreground"
              data-testid="classification-inbox-empty"
            >
              <Inbox className="h-4 w-4" />
              <span className="text-sm">Classification Inbox</span>
              <Badge variant="outline" className="text-[10px]">All caught up</Badge>
            </div>
          )}
          {hasWork && open && (
            <>
              <p className="text-xs text-muted-foreground">
                Imported groups with claims that have no Error Type yet. Pick a label and the
                qualifying claim auto-advances to Build Case; blank-description sibling claims
                are auto-excluded.
              </p>
              {loading ? (
                <div
                  className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
                  data-testid="classification-inbox-loading"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading triage queue…
                </div>
              ) : (
                <div
                  className="space-y-2 max-h-96 overflow-y-auto pr-1"
                  data-testid="queue-list-needs-review"
                >
                  {groups.map((g) => (
                    <ClassificationInboxRow
                      key={g.id}
                      group={g}
                      isSelected={selectedId === g.id}
                      onSelect={() => onSelect(g.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClassificationInboxRow({
  group,
  isSelected,
  onSelect,
}: {
  group: NeedsClassificationInboxGroup;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const qualifying = group.qualifyingSiblingCount;
  const blank = group.needsClassificationCount;
  return (
    <button
      type="button"
      data-testid={`inbox-group-${group.invoiceNumber}`}
      aria-pressed={isSelected}
      onClick={onSelect}
      className={`w-full text-left rounded-lg border bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isSelected ? "ring-2 ring-primary border-primary" : "hover:bg-accent/50"
      }`}
    >
      <div className="py-3 px-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-semibold">{group.invoiceNumber}</span>
            <Badge variant="outline" className="text-[10px]">{group.status}</Badge>
            {group.allBlank ? (
              <Badge
                variant="outline"
                className="text-[10px]"
                style={{ background: "hsl(var(--cc-amber-bg))", color: "hsl(var(--cc-amber-fg))", borderColor: "hsl(var(--cc-amber-border))" }}
              >
                All blank — review carefully
              </Badge>
            ) : qualifying > 0 ? (
              <Badge variant="secondary" className="text-[10px]">
                {qualifying} qualifying
              </Badge>
            ) : null}
            {blank > 0 && !group.allBlank && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {blank} blank
              </Badge>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <ul className="space-y-1 text-xs">
          {group.claims.slice(0, 4).map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5"
              data-testid={`inbox-claim-${c.id}`}
            >
              <span className="font-mono text-muted-foreground shrink-0">
                {c.confNumber || `#${c.id}`}
              </span>
              <span className="text-muted-foreground shrink-0">
                {c.date ? formatDate(c.date) : "—"}
              </span>
              <span className="tabular-nums text-muted-foreground shrink-0">
                {formatCurrency(c.claimAmount ?? "0")}
              </span>
              <span className={`flex-1 truncate ${c.isBlank ? "italic text-muted-foreground" : ""}`}>
                {c.isBlank ? "(blank — auto-exclude on classify)" : (c.errorDetails ?? "")}
              </span>
            </li>
          ))}
          {group.claims.length > 4 && (
            <li className="text-[11px] text-muted-foreground italic px-2">
              +{group.claims.length - 4} more claim{group.claims.length - 4 === 1 ? "" : "s"} — open to triage.
            </li>
          )}
        </ul>
      </div>
    </button>
  );
}

// Inline group workspace — stacked layout (restored to original
// design). Top: Legs section, rendering each leg as a thin strip via
// <LegConclusionRow />. Each strip's primary action is "Process" /
// "Continue", which expands the worktree (SopAdvancePlayer) inline
// beneath the strip; per-leg context is captured AS the operator
// walks the tree, not via a standalone field. Quick-conclude
// Non-issue / Non-contestable buttons appear ONLY when no error type
// is set on the leg.
// Bottom: the submission gauntlet — readback → preview → editable
// AI write-up → channel-aware Submit.
//
// Gauntlet → leg jump: when a submit fails with `gate: "legs"`, the
// gauntlet calls `onJumpToLeg(legId)` and we ring + auto-expand the
// matching row. The highlight clears on any subsequent expand
// interaction so an operator who scrolls past the jump target doesn't
// keep seeing the amber ring.
function InlineGroupWorkspace({
  groupId,
  lockReason,
}: {
  groupId: number;
  lockReason?: string | null;
}) {
  const { get, set } = useUrlParams();
  const legParam = Number.parseInt(get("leg"), 10);
  const expandedLegId: number | null =
    Number.isFinite(legParam) && legParam > 0 ? legParam : null;
  const setExpandedLegId = (id: number | null) => {
    set({ leg: id == null ? null : String(id) }, false);
  };

  const [highlightLegId, setHighlightLegId] = useState<number | null>(null);

  const { data: group, isLoading } = useGetInvoiceGroup(groupId);
  if (isLoading || !group) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workspace…
        </CardContent>
      </Card>
    );
  }
  const detail = group as InvoiceGroupDetailResponse;
  const allRides: ClaimResponse[] = detail.rides ?? [];
  const rides = allRides.filter((r) => r.includedInDispute !== false);

  return (
    <div
      className="space-y-4"
      data-testid="inline-group-workspace"
    >
      {/* Legs section (above) — thin strips, one per leg. Each strip
          opens the worktree (SOP) inline. Per-leg context is captured
          inside the worktree as the operator advances, not via a
          standalone field on the strip. */}
      <Card data-testid="legs-panel">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Legs
          </CardTitle>
          <CardDescription>
            Walk each leg through its worktree to conclude it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LegConclusionList
            claims={rides}
            groupId={groupId}
            expandedClaimId={expandedLegId}
            onExpandedChange={(id) => {
              setExpandedLegId(id);
              if (highlightLegId != null) setHighlightLegId(null);
            }}
            highlightClaimId={highlightLegId}
            lockReason={lockReason}
          />
        </CardContent>
      </Card>

      {/* Submission preview (below) — editable AI write-up. */}
      <InvoiceGroupSubmissionGauntlet
        group={detail}
        groupId={groupId}
        lockReason={lockReason}
        onJumpToLeg={(claimId) => {
          setExpandedLegId(claimId);
          setHighlightLegId(claimId);
        }}
      />
    </div>
  );
}
