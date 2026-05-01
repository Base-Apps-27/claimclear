import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetClaim,
  getGetClaimQueryKey,
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useListErrorTypes,
  useSetLegContext,
  usePlaceLegOnHold,
  useClearLegHold,
  useReclassifyLeg,
  useListClaimEvidence,
  getListClaimEvidenceQueryKey,
} from "@workspace/api-client-react";
import type {
  ErrorTypeResponse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, ArrowLeft, PauseCircle, Play, RefreshCw, Save, FileText, Gavel, AlertTriangle, Paperclip } from "lucide-react";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { HoldReasonSelect, isHoldReasonValid } from "@/components/hold-reason-select";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import { MasReattestHistory } from "@/components/mas-reattest-history";
import { deriveLegSubStatus, type LegHoldReason } from "@workspace/leg-state";
import type { DecisionTree } from "@/components/decision-tree/types";

// v2 per-leg investigation surface mounted when PER_INVOICE_TRANSITION_ENABLED is on.

interface Props {
  claimId: number;
}

export function ClaimDetailV2({ claimId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: claim, isLoading } = useGetClaim(claimId, {
    query: { queryKey: getGetClaimQueryKey(claimId), enabled: !!claimId },
  });

  const parentGroupId = claim?.invoiceGroupId ?? null;
  const { data: parentGroup } = useGetInvoiceGroup(parentGroupId ?? 0, {
    query: {
      queryKey: getGetInvoiceGroupQueryKey(parentGroupId ?? 0),
      enabled: parentGroupId !== null && parentGroupId > 0,
    },
  });

  const { data: errorTypes } = useListErrorTypes();
  const errorType: ErrorTypeResponse | undefined = useMemo(() => {
    if (!claim?.errorTypeId || !errorTypes) return undefined;
    return errorTypes.find((t) => String(t.id) === String(claim.errorTypeId));
  }, [claim?.errorTypeId, errorTypes]);

  const tree: DecisionTree | null = useMemo(() => {
    const raw = errorType?.decisionTree as DecisionTree | undefined | null;
    if (!raw || !raw.nodes || !raw.rootId) return null;
    return raw;
  }, [errorType]);

  const subStatus = useMemo(() => (claim ? deriveLegSubStatus(claim) : "needs_classification"), [claim]);

  const [legContext, setLegContext] = useState<string>("");
  useEffect(() => {
    setLegContext(claim?.perLegContext ?? "");
  }, [claim?.perLegContext]);

  // Parent group dictates whether per-leg context is editable.
  // Pre-submit = group still in New / Needs Evidence (no submission yet).
  const groupIsPreSubmit = !parentGroup
    || parentGroup.status === "New"
    || parentGroup.status === "Needs Evidence";

  const { data: collectedEvidence } = useListClaimEvidence(claimId, {
    query: { queryKey: getListClaimEvidenceQueryKey(claimId), enabled: !!claimId },
  });
  const evidenceItems = useMemo(() => {
    const raw = collectedEvidence?.evidence;
    return Array.isArray(raw) ? raw : [];
  }, [collectedEvidence]);

  const setLegContextMutation = useSetLegContext();
  const placeHoldMutation = usePlaceLegOnHold();
  const clearHoldMutation = useClearLegHold();
  const reclassifyMutation = useReclassifyLeg();

  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState<LegHoldReason | "">("");
  const [holdNote, setHoldNote] = useState("");
  const holdValid = isHoldReasonValid(holdReason, holdNote);

  // Reclassify discards SOP walk + drop reason; require explicit confirm.
  const [reclassifyOpen, setReclassifyOpen] = useState(false);

  function invalidateLeg() {
    qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
    qc.invalidateQueries({ queryKey: ["claims"] });
    if (parentGroupId) {
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(parentGroupId) });
      qc.invalidateQueries({ queryKey: ["invoice-groups"] });
    }
  }

  function onSaveLegContext() {
    setLegContextMutation.mutate(
      { id: claimId, data: { context: legContext } },
      {
        onSuccess: () => {
          toast({ title: "Per-leg context saved" });
          invalidateLeg();
        },
        onError: (e: unknown) => toast({ title: "Save failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  function onPlaceHold() {
    if (!holdValid || !holdReason) return;
    placeHoldMutation.mutate(
      { id: claimId, data: { reason: holdReason, note: holdNote || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Leg placed on hold" });
          setHoldOpen(false);
          setHoldReason("");
          setHoldNote("");
          invalidateLeg();
        },
        onError: (e: unknown) => toast({ title: "Hold failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  function onClearHold() {
    clearHoldMutation.mutate(
      { id: claimId },
      {
        onSuccess: () => {
          toast({ title: "Hold cleared" });
          invalidateLeg();
        },
        onError: (e: unknown) => toast({ title: "Clear hold failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  function onReclassify() {
    reclassifyMutation.mutate(
      { id: claimId },
      {
        onSuccess: () => {
          toast({ title: "Leg reclassified — pick an error type to start over" });
          setReclassifyOpen(false);
          invalidateLeg();
        },
        onError: (e: unknown) => toast({ title: "Reclassify failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  if (isLoading || !claim) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading leg…
      </div>
    );
  }

  // Render the SOP player whenever the operator could meaningfully see SOP
  // state for this leg. That includes any leg with a persisted sop_outcome
  // (terminal — including sop_outcome="hold", which derives to "blocked"
  // but is still a terminal SOP state we want surfaced as the terminal
  // panel rather than a generic "leg on hold" message), plus mid-walk
  // sub-statuses where the operator can answer the next question.
  const hasSopOutcome = !!claim.sopOutcome;
  const canShowPlayer =
    hasSopOutcome ||
    subStatus === "investigating" ||
    subStatus === "ready" ||
    subStatus === "dropped";
  const playerDisabledReason = canShowPlayer
    ? null
    : subStatus === "blocked"
      ? "Leg is on hold — clear the hold to advance the SOP."
      : subStatus === "excluded"
        ? "Leg is excluded from the dispute."
        : subStatus === "needs_classification"
          ? "Pick an error type before walking the SOP."
          : null;

  return (
    <div className="space-y-4 max-w-5xl mx-auto p-4" data-testid="claim-detail-v2">
      {parentGroup && (
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/invoice-groups/${parentGroup.id}`}>
            <Button variant="ghost" size="sm" className="gap-1.5" data-testid="leg-back-to-group">
              <ArrowLeft className="h-3.5 w-3.5" />
              {parentGroup.invoiceNumber || `Invoice #${parentGroup.id}`}
            </Button>
          </Link>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {parentGroup.rideCount ?? "?"} legs · {formatCurrency(parentGroup.totalAmount ?? "0")}
          </span>
          <Badge variant="outline" className="ml-auto">{parentGroup.status}</Badge>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                Leg #{claim.id} · {claim.confNumber || "—"}
                <LegSubStatusPill subStatus={subStatus} />
              </CardTitle>
              <CardDescription className="mt-1">
                {claim.date ? `Service ${formatDate(claim.date)}` : "Service date unknown"}
                {" · "}
                {formatCurrency(claim.claimAmount ?? "0")}
                {" · "}
                {claim.errorTypeName || <span className="italic">No error type</span>}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {subStatus === "blocked" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onClearHold}
                  disabled={clearHoldMutation.isPending}
                  data-testid="leg-clear-hold"
                >
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Clear hold
                </Button>
              )}
              {subStatus !== "blocked" && subStatus !== "excluded" && (
                <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" data-testid="leg-hold-trigger">
                      <PauseCircle className="h-3.5 w-3.5 mr-1" />
                      Hold
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Place leg on hold</DialogTitle>
                    </DialogHeader>
                    <HoldReasonSelect
                      reason={holdReason}
                      note={holdNote}
                      onReasonChange={setHoldReason}
                      onNoteChange={setHoldNote}
                    />
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setHoldOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={onPlaceHold}
                        disabled={!holdValid || placeHoldMutation.isPending}
                        data-testid="leg-hold-confirm"
                      >
                        {placeHoldMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <PauseCircle className="h-3.5 w-3.5 mr-1" />
                        )}
                        Place on hold
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
              {(subStatus === "investigating" ||
                subStatus === "ready" ||
                subStatus === "dropped" ||
                subStatus === "blocked") && (
                <Dialog open={reclassifyOpen} onOpenChange={setReclassifyOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="leg-reclassify"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Reclassify
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        Reclassify this leg?
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2 text-sm">
                      <p>
                        This will <strong>discard the SOP walk and any drop reason</strong> on
                        this leg, returning it to <em>needs classification</em>. Any saved
                        per-leg context is preserved.
                      </p>
                      <p className="text-muted-foreground">
                        Use this when the wrong error type was assigned at the start.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setReclassifyOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={onReclassify}
                        disabled={reclassifyMutation.isPending}
                        data-testid="leg-reclassify-confirm"
                      >
                        {reclassifyMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        )}
                        Reset SOP and reclassify
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!claim.errorTypeId && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              This leg has no error type yet. Use the legacy classifier on the
              full claim page to assign one.
            </div>
          )}

          {claim.errorTypeId && !tree && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              The assigned error type has no decision tree configured. Configure
              one in <Link href="/error-types" className="underline">Error Types</Link> to
              walk the SOP from this surface.
            </div>
          )}

          {tree && canShowPlayer && (
            <div>
              <h3 className="text-sm font-semibold mb-2">SOP walk</h3>
              <SopAdvancePlayer
                leg={{
                  id: claim.id,
                  errorTypeId: claim.errorTypeId,
                  sopNodeId: claim.sopNodeId,
                  sopOutcome: claim.sopOutcome,
                  dropReason: claim.dropReason,
                  invoiceGroupId: claim.invoiceGroupId,
                }}
                tree={tree}
                onAdvanced={invalidateLeg}
              />
            </div>
          )}

          {tree && !canShowPlayer && playerDisabledReason && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {playerDisabledReason}
            </div>
          )}

          <Separator />

          <div className="space-y-2" data-testid="leg-verdict-section">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Gavel className="h-3.5 w-3.5" /> Latest claim verdict
            </h3>
            {claim.outcome && claim.outcome !== "Pending" ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" data-testid="leg-verdict-outcome">
                    {claim.outcome}
                  </Badge>
                  {claim.closureReason && (
                    <span className="text-xs text-muted-foreground">
                      · {claim.closureReason}
                    </span>
                  )}
                </div>
                {claim.approvedAmount && (
                  <p className="text-xs text-muted-foreground">
                    Approved amount: {formatCurrency(claim.approvedAmount)}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic" data-testid="leg-verdict-empty">
                No verdict recorded yet — verdict lands after the parent group's
                payor response is captured.
              </p>
            )}
          </div>

          <div className="space-y-2" data-testid="leg-mas-section">
            <h3 className="text-sm font-semibold">MAS action</h3>
            {claim.masActionRequired && claim.masActionRequired !== "none" ? (
              <p className="text-xs text-muted-foreground">
                Required:{" "}
                <code className="font-mono">{claim.masActionRequired}</code>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic" data-testid="leg-mas-empty">
                No MAS action required.
              </p>
            )}
            <MasReattestHistory claim={claim} group={parentGroup} />
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Per-leg context
              </h3>
              <Button
                size="sm"
                variant="outline"
                onClick={onSaveLegContext}
                disabled={
                  !groupIsPreSubmit ||
                  setLegContextMutation.isPending ||
                  legContext === (claim.perLegContext ?? "")
                }
                data-testid="leg-context-save"
              >
                {setLegContextMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1" />
                )}
                Save
              </Button>
            </div>
            <Textarea
              value={legContext}
              onChange={(e) => setLegContext(e.target.value)}
              placeholder="Narrative for this leg that the dispute write-up assembly will pick up. Empty clears the field."
              rows={5}
              readOnly={!groupIsPreSubmit}
              disabled={!groupIsPreSubmit}
              data-testid="leg-context-input"
            />
            <p className="text-xs text-muted-foreground">
              {groupIsPreSubmit
                ? "Pre-submit only. Once the parent group leaves pre-submit this field becomes read-only."
                : "Read-only — the parent group has already moved past pre-submit."}
            </p>
          </div>

          <Separator />

          <div className="space-y-2" data-testid="leg-evidence-section">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5" /> Evidence
              <Badge variant="secondary" className="ml-1 text-xs">
                {evidenceItems.length}
              </Badge>
            </h3>
            {evidenceItems.length === 0 ? (
              <p className="text-sm text-muted-foreground italic" data-testid="leg-evidence-empty">
                No evidence attached to this leg yet.
              </p>
            ) : (
              <ul className="rounded-md border divide-y bg-muted/20 text-sm">
                {evidenceItems.map((ev) => {
                  const item = ev as {
                    id?: number;
                    label?: string | null;
                    fileName?: string | null;
                    sourceType?: string | null;
                    createdAt?: string | null;
                  };
                  return (
                    <li
                      key={item.id ?? Math.random()}
                      className="px-3 py-2 flex items-center gap-2"
                      data-testid={`leg-evidence-item-${item.id ?? "x"}`}
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate flex-1">
                        {item.label || item.fileName || "Untitled evidence"}
                      </span>
                      {item.sourceType && (
                        <Badge variant="outline" className="text-[10px]">
                          {item.sourceType}
                        </Badge>
                      )}
                      {item.createdAt && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(item.createdAt)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Attach or remove evidence from the legacy claim page (read-only here).
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground italic text-center">
        v2 per-leg investigation surface · disable PER_INVOICE_TRANSITION_ENABLED to return to the legacy claim page.
      </p>
    </div>
  );
}
