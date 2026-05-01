import { useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";
import { QueueNeedsReviewPanel } from "@/components/queue-needs-review-panel";
import { QueueReadyToPackageCta } from "@/components/queue-ready-to-package-cta";
import { UrgentTodayBadge } from "@/components/urgent-today-badge";
import { usePresence } from "@/hooks/use-presence";
import { HumanPresenceBanner } from "@/components/presence-banners";
import { formatViewerNames } from "@/components/presence-lock";
import { useUrlParams } from "@/lib/use-url-params";
import { GroupAggregateContextPanel } from "@/components/group-aggregate-context-panel";
import { InvoiceGroupSubmissionGauntlet } from "@/components/invoice-group-submission-gauntlet";
import { InlineClaimWorkflowList } from "@/components/inline-claim-workflow";
import type { ClaimResponse, InvoiceGroupDetailResponse } from "@workspace/api-client-react";

// Workflow tabs only — Needs Review is intentionally NOT a tab here.
// Triage lives in the Classification Inbox above the workflow grid.
// "Awaiting Response" was removed in Task #232: those groups are still
// visible on /responses-awaiting-review when something needs a verdict.
const VALID_TABS = ["actionable", "portal-queued", "on-hold"] as const;
type QueueTab = typeof VALID_TABS[number];
const DEFAULT_TAB: QueueTab = "actionable";

export default function Queue() {
  useInvoiceGroupsListEvents();
  const queryClient = useQueryClient();
  const { get, set } = useUrlParams();

  const tabParam = get("tab");
  const activeTab: QueueTab = (VALID_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as QueueTab)
    : DEFAULT_TAB;

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
  const triagePanelRef = useRef<HTMLDivElement>(null);

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

  const selectTriage = (id: number) => {
    setSelectedTriageId(id);
    window.requestAnimationFrame(() => {
      triagePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
  const newQuery = useListInvoiceGroups({ status: "New", limit: 500 });
  const needsEvidenceQuery = useListInvoiceGroups({ status: "Needs Evidence", limit: 500 });
  const portalQueuedQuery = useListInvoiceGroups({ status: "Portal Queued", limit: 500 });
  const onHoldQuery = useListInvoiceGroups({ status: "On Hold", limit: 500 });

  const newGroups = newQuery.data?.groups || [];
  const needsGroups = needsEvidenceQuery.data?.groups || [];
  const portalQueuedGroups = portalQueuedQuery.data?.groups || [];
  const onHoldGroups = onHoldQuery.data?.groups || [];

  const actionableTotal = (newQuery.data?.total ?? 0) + (needsEvidenceQuery.data?.total ?? 0);
  const portalQueuedTotal = portalQueuedQuery.data?.total ?? 0;
  const onHoldTotal = onHoldQuery.data?.total ?? 0;

  // Classification Inbox: piggybacks on `GET /invoice-groups` via
  // `?include=needs_classification`. We pass a tiny status filter
  // (`Needs Review`) and `limit=0` because we only care about the
  // embedded `needsClassificationInbox` payload — not the list itself.
  // Single round trip, single query key, no fork between counts and
  // payload.
  const inboxQuery = useListInvoiceGroups({
    status: "Needs Review",
    limit: 0,
    include: "needs_classification",
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

  const actionableGroups = sortByUrgency([...newGroups, ...needsGroups]);
  const portalQueuedSorted = sortByUrgency(portalQueuedGroups);
  const onHoldSorted = sortByUrgency(onHoldGroups);

  const urgentCount =
    actionableGroups.filter(g => g.isUrgent).length +
    portalQueuedSorted.filter(g => g.isUrgent).length +
    onHoldSorted.filter(g => g.isUrgent).length;

  const allGroups = [
    ...actionableGroups,
    ...portalQueuedSorted,
    ...onHoldSorted,
  ];
  const selectedWorkflowGroupSummary = selectedWorkflowId
    ? allGroups.find(g => g.id === selectedWorkflowId) || null
    : null;

  // Auto-select when there's exactly one row in the current tab and nothing
  // explicit in the URL. Tab changes blow the URL group, so this re-runs on
  // tab change and lands on the only candidate immediately. We deliberately
  // don't auto-select once the user has cleared a selection within the same
  // tab — that's tracked by URL state, so any click survives a re-render.
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

  // Per-row deadline pill that complements UrgentTodayBadge: shows a soft
  // "Xd left" hint for items inside the warning window so the operator can
  // see what's about to become urgent — not just what's urgent right now.
  const renderDeadlineHint = (group: InvoiceGroupResponse) => {
    if (group.isUrgent) return null;
    const days = group.effectiveDaysLeft;
    if (days == null) return null;
    if (days < 0) {
      return (
        <span
          data-testid={`deadline-hint-${group.invoiceNumber}`}
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap"
          style={{ background: "hsl(var(--destructive))", color: "white" }}
          title="Past deadline — file immediately"
        >
          Overdue
        </span>
      );
    }
    if (days > 7) return null;
    const tone = days <= 2 ? "amber" : "neutral";
    const styles = tone === "amber"
      ? { background: "hsl(var(--cc-amber-bg))", color: "hsl(var(--cc-amber-fg))", borderColor: "hsl(var(--cc-amber-border))" }
      : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", borderColor: "transparent" };
    return (
      <span
        data-testid={`deadline-hint-${group.invoiceNumber}`}
        className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
        style={styles}
        title={`${days} day${days === 1 ? "" : "s"} until the filing deadline (earliest service date drives the clock).`}
      >
        {days}d left
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
    return (
      <button
        key={group.id}
        type="button"
        data-testid={`queue-row-${group.invoiceNumber}`}
        aria-pressed={isSelected}
        onClick={() => opts.onSelect(group.id)}
        className={`w-full text-left rounded-lg border bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isSelected ? "ring-2 ring-primary border-primary" : "hover:bg-accent/50"
        }`}
      >
        <div className="py-3 px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0 shrink-0">
            <div className="whitespace-nowrap flex items-center gap-2">
              <UrgentTodayBadge isUrgent={group.isUrgent} />
              <span className="font-mono font-semibold">{group.invoiceNumber}</span>
              <span className="text-muted-foreground ml-1 text-sm">{group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}</span>
            </div>
            <StatusBadge status={group.status} />
            {opts.showDeadline && renderDeadlineHint(group)}
          </div>
          <div className="flex items-center gap-4 text-sm min-w-0 flex-1 justify-end">
            {meta}
            <span className="font-medium whitespace-nowrap">{formatCurrency(group.totalAmount)}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
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

      {urgentCount > 0 && (
        <div
          className="rounded-lg border px-4 py-3 flex items-center gap-3"
          style={{
            background: "hsl(var(--cc-red-bg))",
            borderColor: "hsl(var(--cc-red-border))",
            color: "hsl(var(--cc-red-fg))",
          }}
          data-testid="queue-urgent-banner"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "hsl(var(--destructive))" }} />
          <div className="text-sm">
            <span className="font-bold">{urgentCount} {urgentCount === 1 ? "group" : "groups"} must file today</span>
            <span className="opacity-80"> · check Action Required, Portal Queued, and On Hold</span>
          </div>
        </div>
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
          someone's actively working through it. */}
      <ClassificationInbox
        open={inboxOpen}
        onToggle={() => setInboxOpen(!inboxOpen)}
        loading={inboxQuery.isLoading}
        groups={inboxGroups}
        total={inboxTotal}
        selectedId={selectedTriageId}
        onSelect={selectTriage}
        triagePanelRef={triagePanelRef}
        triagePanel={
          selectedTriageId ? (() => {
            // Re-find the inbox payload row each render so per-claim
            // mutations show their effect (the row is a derivation of
            // the embedded inbox payload, which the cache invalidate
            // refetches under the same query key).
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
          })() : null
        }
      />

      <div className={`grid grid-cols-1 gap-6 ${selectedWorkflowId ? "lg:grid-cols-3" : ""}`}>
        <div className={`space-y-4 ${selectedWorkflowId ? "lg:col-span-1" : ""}`}>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="actionable">
                Action Required
                {actionableTotal > 0 && (
                  <Badge variant="secondary" className="ml-2">{actionableTotal}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="portal-queued">
                Portal Queued
                {portalQueuedTotal > 0 && (
                  <Badge variant="secondary" className="ml-2">{portalQueuedTotal}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="on-hold">
                On Hold
                {onHoldTotal > 0 && (
                  <Badge variant="secondary" className="ml-2">{onHoldTotal}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="actionable" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-actionable">
                <span className="font-medium text-foreground">New + Needs Evidence.</span> Groups you can act on right now. Sorted earliest service date first; <span className="font-semibold" style={{ color: "hsl(var(--destructive))" }}>red Today</span> = must file before end of day, <span className="font-semibold" style={{ color: "hsl(var(--cc-amber-fg))" }}>amber</span> = within 2 days, neutral = within a week.
              </p>
              {actionableGroups.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups need action right now.</CardContent></Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-actionable">
                  {actionableGroups.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId, showDeadline: true }))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="portal-queued" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-portal-queued">
                <span className="font-medium text-foreground">Drafted, waiting for the next portal submission batch.</span> The clock is still running — urgency badges still apply.
              </p>
              {portalQueuedSorted.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups queued for portal submission.</CardContent></Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-portal-queued">
                  {portalQueuedSorted.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId, showDeadline: true }))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="on-hold" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-on-hold">
                <span className="font-medium text-foreground">Manually parked or blocked.</span> Still on the deadline clock — urgency badges apply. Resume from the workflow when you're unblocked.
              </p>
              {onHoldSorted.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups on hold.</CardContent></Card>
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
// glance, whether anything qualifies before opening triage.
interface ClassificationInboxProps {
  open: boolean;
  onToggle: () => void;
  loading: boolean;
  groups: NeedsClassificationInboxGroup[];
  total: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  triagePanelRef: React.RefObject<HTMLDivElement | null>;
  triagePanel: React.ReactNode;
}

function ClassificationInbox({
  open,
  onToggle,
  loading,
  groups,
  total,
  selectedId,
  onSelect,
  triagePanelRef,
  triagePanel,
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

      {hasWork && open && triagePanel && (
        <div ref={triagePanelRef} className="scroll-mt-4">
          {triagePanel}
        </div>
      )}
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

// Inline group workspace — composes the group-aggregate context, the
// per-claim inline workflow list, and the submission gauntlet. The
// per-leg investigation surface (formerly only on /claims/:id) is now
// embedded directly via <InlineClaimWorkflow />, giving operators the
// full classification → SOP → verdict flow without leaving the queue.
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
    <div className="space-y-4" data-testid="inline-group-workspace">
      <GroupAggregateContextPanel group={detail} groupId={groupId} lockReason={lockReason} />
      <InlineClaimWorkflowList
        claims={rides}
        expandedClaimId={expandedLegId}
        onExpandedChange={(id) => {
          setExpandedLegId(id);
          // Any explicit user toggle clears the highlight so the amber
          // ring doesn't linger on a row the operator has already
          // chosen to engage with (or dismiss).
          if (highlightLegId != null) setHighlightLegId(null);
        }}
        highlightClaimId={highlightLegId}
      />
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
