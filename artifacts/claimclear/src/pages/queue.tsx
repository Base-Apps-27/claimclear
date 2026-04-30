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

  const newQuery = useListInvoiceGroups({ status: "New" });
  const needsEvidenceQuery = useListInvoiceGroups({ status: "Needs Evidence" });
  const needsReviewQuery = useListInvoiceGroups({ status: "Needs Review", limit: 100 });
  const portalQueuedQuery = useListInvoiceGroups({ status: "Portal Queued" });
  const awaitingQuery = useListInvoiceGroups({ status: "Awaiting Response" });
  const onHoldQuery = useListInvoiceGroups({ status: "On Hold" });

  const newGroups = newQuery.data?.groups || [];
  const needsGroups = needsEvidenceQuery.data?.groups || [];
  const needsReviewGroups = needsReviewQuery.data?.groups || [];
  const portalQueuedGroups = portalQueuedQuery.data?.groups || [];
  const awaitingGroups = awaitingQuery.data?.groups || [];
  const onHoldGroups = onHoldQuery.data?.groups || [];

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

  // If a triage group leaves the Needs Review list (because it auto-advanced
  // or someone else classified it), clear the dangling selection.
  useEffect(() => {
    if (selectedTriageId && !needsReviewGroups.some(g => g.id === selectedTriageId)) {
      setSelectedTriageId(null);
    }
  }, [selectedTriageId, needsReviewGroups]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });

  const renderGroupRow = (group: InvoiceGroupResponse, opts: { onSelect: (id: number) => void; selectedId: number | null }) => {
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

  const triageCount = needsReviewGroups.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Work Queue</h2>
        <p className="text-muted-foreground">Invoice groups requiring attention — select a group to process</p>
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

      {/* Triage Inbox — the gate before the workflow.
          Items here haven't been classified yet, so they don't belong in any
          workflow tab. This zone is always visible above the workflow tabs so
          new portal responses don't disappear behind a tab Adam might forget
          to check. */}
      <div className="space-y-3" data-testid="triage-inbox">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Inbox className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Triage Inbox</h3>
                {triageCount > 0 ? (
                  <Badge variant="secondary">{triageCount} to classify</Badge>
                ) : (
                  <Badge variant="outline">Empty</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Portal responses waiting to be classified before they enter a workflow stage.
              </p>
            </div>
            {triageCount === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">All caught up — no responses to review.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1" data-testid="queue-list-needs-review">
                {needsReviewGroups.map(g => renderGroupRow(g, { onSelect: selectTriage, selectedId: selectedTriageId }))}
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="actionable">
                Action Required
                {actionableGroups.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{actionableGroups.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="portal-queued">
                Portal Queued
                {portalQueuedSorted.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{portalQueuedSorted.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="awaiting">
                Awaiting
                {awaitingGroups.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{awaitingGroups.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="on-hold">
                On Hold
                {onHoldSorted.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{onHoldSorted.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="actionable" className="mt-4">
              {actionableGroups.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups need action right now.</CardContent></Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-actionable">
                  {actionableGroups.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId }))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="portal-queued" className="mt-4">
              {portalQueuedSorted.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups queued for portal submission.</CardContent></Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-portal-queued">
                  {portalQueuedSorted.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId }))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="awaiting" className="mt-4">
              {awaitingGroups.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups awaiting response.</CardContent></Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-awaiting">
                  {awaitingGroups.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId }))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="on-hold" className="mt-4">
              {onHoldSorted.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups on hold.</CardContent></Card>
              ) : (
                <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" data-testid="queue-list-on-hold">
                  {onHoldSorted.map((g) => renderGroupRow(g, { onSelect: selectWorkflow, selectedId: selectedWorkflowId }))}
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
