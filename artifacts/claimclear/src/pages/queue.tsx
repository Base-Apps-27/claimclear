import { useRef, useState } from "react";
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
import { ChevronRight, FileText } from "lucide-react";
import { WorkflowPlayerGroup } from "@/components/workflow-player-group";

export default function Queue() {
  useInvoiceGroupsListEvents();
  const queryClient = useQueryClient();
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  useInvoiceGroupEvents(selectedGroupId ?? undefined);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectGroup = (id: number) => {
    setSelectedGroupId(id);
    window.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const newQuery = useListInvoiceGroups({ status: "New" });
  const needsEvidenceQuery = useListInvoiceGroups({ status: "Needs Evidence" });
  const portalQueuedQuery = useListInvoiceGroups({ status: "Portal Queued" });
  const awaitingQuery = useListInvoiceGroups({ status: "Awaiting Response" });
  const onHoldQuery = useListInvoiceGroups({ status: "On Hold" });

  const newGroups = newQuery.data?.groups || [];
  const needsGroups = needsEvidenceQuery.data?.groups || [];
  const portalQueuedGroups = portalQueuedQuery.data?.groups || [];
  const awaitingGroups = awaitingQuery.data?.groups || [];
  const onHoldGroups = onHoldQuery.data?.groups || [];

  const actionableGroups = [...newGroups, ...needsGroups];

  const allGroups = [...actionableGroups, ...portalQueuedGroups, ...awaitingGroups, ...onHoldGroups];
  const selectedGroup = selectedGroupId ? allGroups.find(g => g.id === selectedGroupId) || null : null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });

  const renderGroupRow = (group: InvoiceGroupResponse) => (
    <Card
      key={group.id}
      data-testid={`queue-row-${group.invoiceNumber}`}
      className={`cursor-pointer transition-colors ${
        selectedGroupId === group.id ? "ring-2 ring-primary" : "hover:bg-accent/50"
      }`}
      onClick={() => selectGroup(group.id)}
    >
      <CardContent className="py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-mono font-semibold">{group.invoiceNumber}</span>
            <span className="text-muted-foreground ml-3 text-sm">{group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}</span>
          </div>
          <StatusBadge status={group.status} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          {group.errorTypeName && <span className="text-muted-foreground">{group.errorTypeName}</span>}
          <span className="font-medium">{formatCurrency(group.totalAmount)}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Work Queue</h2>
        <p className="text-muted-foreground">Invoice groups requiring attention — select a group to process</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Tabs defaultValue="actionable">
            <TabsList>
              <TabsTrigger value="actionable">
                Action Required
                {actionableGroups.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{actionableGroups.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="portal-queued">
                Portal Queued
                {portalQueuedGroups.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{portalQueuedGroups.length}</Badge>
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
                {onHoldGroups.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{onHoldGroups.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="actionable" className="mt-4">
              {actionableGroups.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups need action right now.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {actionableGroups.map((g) => renderGroupRow(g))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="portal-queued" className="mt-4">
              {portalQueuedGroups.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups queued for portal submission.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {portalQueuedGroups.map((g) => renderGroupRow(g))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="awaiting" className="mt-4">
              {awaitingGroups.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups awaiting response.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {awaitingGroups.map((g) => renderGroupRow(g))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="on-hold" className="mt-4">
              {onHoldGroups.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No invoice groups on hold.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {onHoldGroups.map((g) => renderGroupRow(g))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div ref={panelRef} className="scroll-mt-4">
          {selectedGroup ? (
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Process Invoice Group</h3>
                <Link href={`/invoice-groups/${selectedGroup.id}`}>
                  <Button variant="ghost" size="sm">
                    Full Details <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              </div>
              <WorkflowPlayerGroup
                group={selectedGroup}
                showGroupContext={true}
                showDetailsLink={true}
                onComplete={() => {
                  setSelectedGroupId(null);
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
                  Click on a group from the Action Required tab to start the dispute workflow
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
