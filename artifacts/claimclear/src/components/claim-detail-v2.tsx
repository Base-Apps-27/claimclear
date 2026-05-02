import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetClaim,
  getGetClaimQueryKey,
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useListErrorTypes,
  useReclassifyLeg,
  useExcludeLeg,
} from "@workspace/api-client-react";
import type {
  ErrorTypeResponse,
  ExcludeLegBodyReason,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, ChevronLeft, RotateCcw, AlertTriangle, RefreshCw, XCircle, FileText,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { StatusPill } from "@/components/cohesion";
import type { Tone } from "@/components/cohesion/tone";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import { deriveLegSubStatus } from "@workspace/leg-state";
import { legSubStatusDisplayLabel } from "@workspace/vocab";
import type { DecisionTree } from "@/components/decision-tree/types";

// Per-leg processing surface — intentionally minimal. The Process button on
// the queue should drop the user straight into the SOP worktree walk and
// nothing else; everything contextual (parent invoice, group status, payor
// verdict, evidence, notes, audit, mentions) lives on the parent invoice
// group page. Per-leg context that the AI write-up needs is auto-derived
// from the SOP breadcrumb inside SopAdvancePlayer, so no standalone field
// is required here.

interface Props {
  claimId: number;
}

const SUB_STATUS_TO_TONE: Record<string, Tone> = {
  needs_classification: "amber",
  investigating: "amber",
  ready: "blue",
  dropped: "muted",
  blocked: "amber",
  excluded: "muted",
};

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

  const subStatus = useMemo(
    () => (claim ? deriveLegSubStatus(claim) : "needs_classification"),
    [claim],
  );
  const subStatusTone: Tone = SUB_STATUS_TO_TONE[subStatus] ?? SUB_STATUS_TO_TONE.needs_classification;
  const subStatusLabel = legSubStatusDisplayLabel(subStatus, claim ?? undefined);

  const reclassifyMutation = useReclassifyLeg();
  const excludeMutation = useExcludeLeg();
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeReason, setExcludeReason] = useState<ExcludeLegBodyReason | "">("");
  const [excludeNote, setExcludeNote] = useState("");
  const excludeValid =
    excludeReason !== "" &&
    (excludeReason !== "other" || excludeNote.trim().length > 0);

  function invalidateLeg() {
    qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
    qc.invalidateQueries({ queryKey: ["claims"] });
    if (parentGroupId) {
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(parentGroupId) });
      qc.invalidateQueries({ queryKey: ["invoice-groups"] });
    }
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
        onError: (e: unknown) => toast({
          title: "Reclassify failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  function onExclude() {
    if (!excludeValid || !excludeReason) return;
    excludeMutation.mutate(
      { id: claimId, data: { reason: excludeReason, note: excludeNote || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Leg excluded from dispute" });
          setExcludeOpen(false);
          setExcludeReason("");
          setExcludeNote("");
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Exclude failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
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

  const canReclassify =
    subStatus === "investigating" ||
    subStatus === "ready" ||
    subStatus === "dropped" ||
    subStatus === "blocked";

  return (
    <div className="cc-scope min-h-screen p-6" data-testid="claim-detail-v2">
      <div className="max-w-[820px] mx-auto space-y-4">

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
          <Link href="/queue" className="hover:underline">Claims</Link>
          {parentGroup && (
            <>
              <span>/</span>
              <Link
                href={`/invoice-groups/${parentGroup.id}`}
                className="hover:underline inline-flex items-center gap-1"
                data-testid="leg-back-to-group"
              >
                <ChevronLeft className="w-3 h-3" /> Invoice #{parentGroup.invoiceNumber || parentGroup.id}
              </Link>
            </>
          )}
          <span>/</span>
          <span style={{ color: "var(--cc-fg)" }}>Leg #{claim.id}</span>
        </div>

        {/* Minimal header — identification only */}
        <div className="cc-card p-3" data-testid="leg-header">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h1 className="text-base font-bold mono">
                {claim.confNumber || `CLM-${claim.id}`}
              </h1>
              <StatusPill tone={subStatusTone}>{subStatusLabel}</StatusPill>
              {claim.errorTypeName ? (
                <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                  · {claim.errorTypeName}
                </span>
              ) : null}
              <span className="text-xs font-medium mono" style={{ color: "var(--cc-fg)" }}>
                · {formatCurrency(claim.claimAmount ?? "0")}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {canReclassify && (
                <Dialog open={reclassifyOpen} onOpenChange={setReclassifyOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      data-testid="leg-reclassify"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reclassify
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
                        this leg, returning it to <em>needs classification</em>.
                      </p>
                      <p className="text-muted-foreground">
                        Use this when the wrong error type was assigned at the start.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setReclassifyOpen(false)}>Cancel</Button>
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

              {subStatus === "needs_classification" && (
                <Dialog open={excludeOpen} onOpenChange={setExcludeOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" data-testid="leg-exclude-trigger" className="h-8 gap-1">
                      <XCircle className="h-3.5 w-3.5" /> Exclude
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Exclude this leg from the dispute?</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        The leg will stay visible on the invoice but won't appear in dispute work queues.
                      </p>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Reason</label>
                        <Select
                          value={excludeReason}
                          onValueChange={(v) => setExcludeReason(v as ExcludeLegBodyReason)}
                        >
                          <SelectTrigger data-testid="leg-exclude-reason">
                            <SelectValue placeholder="Select a reason…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="clean_leg">Clean leg</SelectItem>
                            <SelectItem value="out_of_scope">Out of scope</SelectItem>
                            <SelectItem value="duplicate">Duplicate</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {excludeReason === "other" && (
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">Note (required)</label>
                          <Textarea
                            value={excludeNote}
                            onChange={(e) => setExcludeNote(e.target.value)}
                            placeholder="Explain why this leg is excluded…"
                            rows={3}
                            data-testid="leg-exclude-note"
                          />
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setExcludeOpen(false)}>Cancel</Button>
                      <Button
                        onClick={onExclude}
                        disabled={!excludeValid || excludeMutation.isPending}
                        data-testid="leg-exclude-confirm"
                      >
                        {excludeMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 mr-1" />
                        )}
                        Exclude
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        </div>

        {/* SOP walk — the entire purpose of this surface */}
        <div className="cc-card p-4" data-testid="leg-sop-card">
          {!claim.errorTypeId && (
            <div
              className="text-xs flex items-start gap-2 p-3 rounded"
              style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>This leg has no error type yet. Pick one from the queue or use the legacy classifier.</span>
            </div>
          )}
          {claim.errorTypeId && !tree && (
            <div
              className="text-xs flex items-start gap-2 p-3 rounded"
              style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                The assigned error type has no decision tree configured.
                {" "}
                <Link href="/error-types" className="underline">Configure one</Link> to walk the SOP here.
              </span>
            </div>
          )}
          {tree && canShowPlayer && (
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
          )}
          {tree && !canShowPlayer && playerDisabledReason && (
            <div
              className="text-xs flex items-start gap-1.5 px-2.5 py-1.5 rounded"
              style={{ color: "var(--cc-muted-fg)", background: "var(--cc-muted)" }}
            >
              <FileText className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{playerDisabledReason}</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
