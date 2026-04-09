import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useClaimsListEvents } from "@/hooks/use-claim-events";
import {
  useListClaims,
  getListClaimsQueryKey,
} from "@workspace/api-client-react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { ChevronRight, FileText } from "lucide-react";
import { WorkflowPlayer } from "@/components/workflow-player";

export default function Queue() {
  useClaimsListEvents();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);

  const newQuery = useListClaims({ status: "New" });
  const needsEvidenceQuery = useListClaims({ status: "Needs Evidence" });
  const portalQueuedQuery = useListClaims({ status: "Portal Queued" });
  const awaitingQuery = useListClaims({ status: "Awaiting Response" });
  const onHoldQuery = useListClaims({ status: "On Hold" });

  const newClaims = newQuery.data?.claims || [];
  const needsClaims = needsEvidenceQuery.data?.claims || [];
  const portalQueuedClaims = portalQueuedQuery.data?.claims || [];
  const awaitingClaims = awaitingQuery.data?.claims || [];
  const onHoldClaims = onHoldQuery.data?.claims || [];

  const actionableClaims = [...newClaims, ...needsClaims];

  const allClaims = [...actionableClaims, ...portalQueuedClaims, ...awaitingClaims, ...onHoldClaims];
  const selectedClaim = selectedClaimId ? allClaims.find(c => c.id === selectedClaimId) || null : null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });

  const renderClaimRow = (claim: ClaimResponse, showWorkflow = false) => (
    <Card
      key={claim.id}
      className={`cursor-pointer transition-colors ${
        selectedClaimId === claim.id ? "ring-2 ring-primary" : "hover:bg-accent/50"
      }`}
      onClick={() => showWorkflow ? setSelectedClaimId(claim.id) : navigate(`/claims/${claim.id}`)}
    >
      <CardContent className="py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-mono font-semibold">{claim.confNumber}</span>
            <span className="text-muted-foreground ml-3 text-sm">{formatDate(claim.date)}</span>
          </div>
          <StatusBadge status={claim.status} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          {claim.errorTypeName && <span className="text-muted-foreground">{claim.errorTypeName}</span>}
          <span className="font-medium">{formatCurrency(claim.claimAmount)}</span>
          {showWorkflow && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Work Queue</h2>
        <p className="text-muted-foreground">Claims requiring attention — select a claim to process</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Tabs defaultValue="actionable">
            <TabsList>
              <TabsTrigger value="actionable">
                Action Required
                {actionableClaims.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{actionableClaims.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="portal-queued">
                Portal Queued
                {portalQueuedClaims.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{portalQueuedClaims.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="awaiting">
                Awaiting
                {awaitingClaims.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{awaitingClaims.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="on-hold">
                On Hold
                {onHoldClaims.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{onHoldClaims.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="actionable" className="mt-4">
              {actionableClaims.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No claims need action right now.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {actionableClaims.map((c) => renderClaimRow(c, true))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="portal-queued" className="mt-4">
              {portalQueuedClaims.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No claims queued for portal submission.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {portalQueuedClaims.map((c) => renderClaimRow(c))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="awaiting" className="mt-4">
              {awaitingClaims.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No claims awaiting response.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {awaitingClaims.map((c) => renderClaimRow(c))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="on-hold" className="mt-4">
              {onHoldClaims.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No claims on hold.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {onHoldClaims.map((c) => renderClaimRow(c, true))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div>
          {selectedClaim ? (
            <div className="sticky top-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Process Claim</h3>
                <Link href={`/claims/${selectedClaim.id}`}>
                  <Button variant="ghost" size="sm">
                    Full Details <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              </div>
              <WorkflowPlayer
                claim={selectedClaim}
                showClaimContext={true}
                showDetailsLink={true}
                onComplete={() => {
                  setSelectedClaimId(null);
                  invalidate();
                }}
              />
            </div>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Select a claim to process</p>
                <p className="text-sm mt-1">
                  Click on a claim from the Action Required tab to start the dispute workflow
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
