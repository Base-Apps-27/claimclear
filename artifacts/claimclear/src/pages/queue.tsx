import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useInvoiceGroupsListEvents, useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import {
  useListInvoiceGroups,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import type { InvoiceGroupResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { CheckCircle2, ChevronRight, Eye, FileText, AlertTriangle, Inbox } from "lucide-react";
import { WorkflowPlayerGroup } from "@/components/workflow-player-group";
import { QueueNeedsReviewPanel } from "@/components/queue-needs-review-panel";
import { UrgentTodayBadge } from "@/components/urgent-today-badge";
import { usePresence } from "@/hooks/use-presence";
import { HumanPresenceBanner } from "@/components/presence-banners";
import { formatViewerNames } from "@/components/presence-lock";
import { useUrlParams } from "@/lib/use-url-params";

// Workflow tabs only — Needs Review is intentionally NOT a tab here.
// It's triage (a prerequisite to entering the workflow), so it lives in the
// Triage Inbox zone above the workflow grid instead of inline as a stage.
const VALID_TABS = ["actionable", "portal-queued", "awaiting", "on-hold"] as const;
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

  // Two independent selection contexts so triage and workflow can coexist
  // visually without one closing the other.
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [selectedTriageId, setSelectedTriageId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  useInvoiceGroupEvents(selectedWorkflowId ?? undefined);
  const { viewers, otherViewers, othersPresent } = usePresence("invoice_group", selectedWorkflowId ?? undefined);
  const lockReason = othersPresent
    ? `Disabled — ${formatViewerNames(otherViewers)} ${otherViewers.length === 1 ? "is" : "are"} currently working on this group. Wait for them to leave or coordinate directly.`
    : null;
  const workflowPanelRef = useRef<HTMLDivElement>(null);
  const triagePanelRef = useRef<HTMLDivElement>(null);

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
    setSelectedWorkflowId(null);
    setSuccessMessage("");
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
  const needsReviewQuery = useListInvoiceGroups({ status: "Needs Review", limit: 500 });
  const portalQueuedQuery = useListInvoiceGroups({ status: "Portal Queued", limit: 500 });
  const awaitingQuery = useListInvoiceGroups({ status: "Awaiting Response", limit: 500 });
  const onHoldQuery = useListInvoiceGroups({ status: "On Hold", limit: 500 });

  const newGroups = newQuery.data?.groups || [];
  const needsGroups = needsEvidenceQuery.data?.groups || [];
  const needsReviewGroups = needsReviewQuery.data?.groups || [];
  const portalQueuedGroups = portalQueuedQuery.data?.groups || [];
  const awaitingGroups = awaitingQuery.data?.groups || [];
  const onHoldGroups = onHoldQuery.data?.groups || [];

  // Real totals from the API — not the (possibly capped) array length.
  // These drive the badge counts so they're always honest.
  const actionableTotal = (newQuery.data?.total ?? 0) + (needsEvidenceQuery.data?.total ?? 0);
  const needsReviewTotal = needsReviewQuery.data?.total ?? 0;
  const portalQueuedTotal = portalQueuedQuery.data?.total ?? 0;
  const awaitingTotal = awaitingQuery.data?.total ?? 0;
  const onHoldTotal = onHoldQuery.data?.total ?? 0;

  // "Needs Review" is set by two unrelated flows:
  //   1. Import without an error type — group has no errorTypeId, needs the
  //      operator to label it (true classification work).
  //   2. Portal response received (especially info_request) — group is
  //      already classified; operator needs a post-response decision
  //      (re-dispute, accept loss, resolve, etc.) which lives on the
  //      detail page, NOT the classification panel.
  // The QueueNeedsReviewPanel only does (1), so mixing both into one inbox
  // confused operators — they'd see classified items they couldn't act on
  // here. Split them so each section has a single, honest meaning.
  const unclassifiedGroups = needsReviewGroups.filter(g => !g.errorTypeId);
  const postResponseGroups = needsReviewGroups.filter(g => !!g.errorTypeId);

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

  // Banner counts urgent rows across every on-clock tab, not just Action
  // Required. With "On Hold" now in the urgency set, an urgent on-hold group
  // would otherwise be invisible from the top of the page.
  const urgentCount =
    actionableGroups.filter(g => g.isUrgent).length +
    portalQueuedSorted.filter(g => g.isUrgent).length +
    onHoldSorted.filter(g => g.isUrgent).length;

  const allGroups = [
    ...actionableGroups,
    ...needsReviewGroups,
    ...portalQueuedSorted,
    ...awaitingGroups,
    ...onHoldSorted,
  ];
  const selectedWorkflowGroup = selectedWorkflowId ? allGroups.find(g => g.id === selectedWorkflowId) || null : null;
  const selectedTriageGroup = selectedTriageId ? needsReviewGroups.find(g => g.id === selectedTriageId) || null : null;

  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => setSuccessMessage(""), 4000);
    return () => clearTimeout(t);
  }, [successMessage]);

  // If the selected classification group leaves the unclassified list
  // (auto-advanced, classified by someone else, or its status changed),
  // clear the dangling selection. Only the unclassified slice is relevant
  // here — post-response items don't open this panel.
  useEffect(() => {
    if (selectedTriageId && !unclassifiedGroups.some(g => g.id === selectedTriageId)) {
      setSelectedTriageId(null);
    }
  }, [selectedTriageId, unclassifiedGroups]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });

  // Per-row deadline pill that complements UrgentTodayBadge: shows a soft
  // "Xd left" hint for items inside the warning window so Adam can see what's
  // about to become urgent — not just what's urgent right now. Stays silent
  // for items already covered by the red Today badge or far from deadline.
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

  const renderGroupRow = (group: InvoiceGroupResponse, opts: { onSelect: (id: number) => void; selectedId: number | null; showDeadline?: boolean }) => {
    const isSelected = opts.selectedId === group.id;
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
            {group.errorTypeName && (
              <span className="text-muted-foreground truncate min-w-0" title={group.errorTypeName}>
                {group.errorTypeName}
              </span>
            )}
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
        <h2 className="text-2xl font-bold tracking-tight">Work Queue</h2>
        <p className="text-muted-foreground">
          Dispute operator workspace. Start at the <span className="font-medium">Classification Inbox</span> to label new portal responses, then work the <span className="font-medium">Action Required</span> tab — earliest service date first, with red badges for groups that must file today.
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

      {/* Classification Inbox + Post-Response Review.
          Both pull from status="Needs Review" but represent different work:
          unclassified items need an Error Type assigned (handled inline by
          QueueNeedsReviewPanel), while already-classified items came back
          via portal response and need a post-response decision (handled on
          the detail page). Splitting them keeps each section honest about
          what action the operator should take. */}
      <div className="space-y-3" data-testid="triage-inbox">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Inbox className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Classification Inbox</h3>
                {unclassifiedGroups.length > 0 ? (
                  <Badge variant="secondary" data-testid="badge-classification-count">
                    {unclassifiedGroups.length} to classify
                  </Badge>
                ) : (
                  <Badge variant="outline">Empty</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground max-w-md text-right">
                Imported groups with no Error Type yet. Pick a label and they auto-advance to Build Case.
              </p>
            </div>
            {unclassifiedGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">All caught up — nothing to classify.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1" data-testid="queue-list-needs-review">
                {unclassifiedGroups.map(g => renderGroupRow(g, { onSelect: selectTriage, selectedId: selectedTriageId }))}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedTriageGroup && (
          <div ref={triagePanelRef} className="scroll-mt-4">
            <QueueNeedsReviewPanel
              group={selectedTriageGroup}
              onCompleted={(message) => {
                setSuccessMessage(message);
                setSelectedTriageId(null);
                invalidate();
              }}
            />
          </div>
        )}

        {postResponseGroups.length > 0 && (
          <Card data-testid="post-response-review">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Inbox className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">Post-Response Review</h3>
                  <Badge variant="secondary" data-testid="badge-post-response-count">
                    {postResponseGroups.length} awaiting decision
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground max-w-md text-right">
                  Already classified — payer has responded. Open the detail page to re-dispute, accept loss, or resolve.
                </p>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1" data-testid="queue-list-post-response">
                {postResponseGroups.map(g => (
                  <Link
                    key={g.id}
                    href={`/invoice-groups/${g.id}`}
                    data-testid={`post-response-row-${g.invoiceNumber}`}
                    className="block w-full text-left rounded-lg border bg-card transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="py-3 px-6 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0 shrink-0">
                        <div className="whitespace-nowrap flex items-center gap-2">
                          <UrgentTodayBadge isUrgent={g.isUrgent} />
                          <span className="font-mono font-semibold">{g.invoiceNumber}</span>
                          <span className="text-muted-foreground ml-1 text-sm">
                            {g.rideCount} ride{g.rideCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <StatusBadge status={g.status} />
                      </div>
                      <div className="flex items-center gap-4 text-sm min-w-0 flex-1 justify-end">
                        {g.errorTypeName && (
                          <span className="text-muted-foreground truncate min-w-0" title={g.errorTypeName}>
                            {g.errorTypeName}
                          </span>
                        )}
                        <span className="font-medium whitespace-nowrap">{formatCurrency(g.totalAmount)}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {needsReviewGroups.length < needsReviewTotal && (
          <p className="text-xs text-muted-foreground" data-testid="needs-review-overflow-note">
            Showing the first {needsReviewGroups.length} of {needsReviewTotal} Needs Review groups. Process some to reveal the rest.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
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
              <TabsTrigger value="awaiting">
                Awaiting
                {awaitingTotal > 0 && (
                  <Badge variant="secondary" className="ml-2">{awaitingTotal}</Badge>
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

            <TabsContent value="awaiting" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="tab-purpose-awaiting">
                <span className="font-medium text-foreground">Submitted to the payer portal — waiting on a response.</span> No action needed unless a response arrives (it'll re-appear in the Classification Inbox above).
              </p>
              {awaitingGroups.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups awaiting response.</CardContent></Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-awaiting">
                  {awaitingGroups.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId }))}
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

        <div ref={workflowPanelRef} className="scroll-mt-4">
          {selectedWorkflowGroup ? (
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Process Invoice Group</h3>
                <Link href={`/invoice-groups/${selectedWorkflowGroup.id}`}>
                  <Button variant="ghost" size="sm">
                    Full Details <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              </div>
              <HumanPresenceBanner viewers={viewers} resourceLabel="group" />
              <WorkflowPlayerGroup
                group={selectedWorkflowGroup}
                showGroupContext={true}
                showDetailsLink={true}
                presenceLockReason={lockReason}
                onComplete={() => {
                  setSelectedWorkflowId(null);
                  invalidate();
                }}
              />
            </div>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Select an invoice group to process</p>
                <p className="text-sm mt-1">
                  Click on a group from any workflow tab to start the dispute workflow
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
