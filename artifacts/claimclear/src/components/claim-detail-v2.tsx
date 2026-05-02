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
  useMarkLegDuplicate,
  useUnmarkLegDuplicate,
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
  Loader2, ChevronLeft, RotateCcw, AlertTriangle, RefreshCw, XCircle, FileText, Copy, Link2Off,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { StatusPill } from "@/components/cohesion";
import type { Tone } from "@/components/cohesion/tone";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import { DuplicateTerminal } from "@/components/decision-tree/terminals/duplicate-terminal";
import { deriveLegSubStatus } from "@workspace/leg-state";
import { legSubStatusDisplayLabel } from "@workspace/vocab";
import type { DecisionTree } from "@/components/decision-tree/types";
import {
  buildTripOverridingErrorTypeIds,
  findSiblingDuplicatePrimaryCandidates,
  siblingPromptEligibilityFor,
} from "@/lib/sop-sibling-eligibility";

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
  duplicate: "muted",
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
  const markDuplicateMutation = useMarkLegDuplicate();
  const unmarkDuplicateMutation = useUnmarkLegDuplicate();
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeReason, setExcludeReason] = useState<ExcludeLegBodyReason | "">("");
  const [excludeNote, setExcludeNote] = useState("");
  const excludeValid =
    excludeReason !== "" &&
    (excludeReason !== "other" || excludeNote.trim().length > 0);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicatePrimaryId, setDuplicatePrimaryId] = useState<string>("");
  const [duplicateNote, setDuplicateNote] = useState("");
  const [unmarkDuplicateOpen, setUnmarkDuplicateOpen] = useState(false);

  // Trip-overriding error type lookup for the sibling-duplicate picker.
  // A leg can only be marked as a Sibling Duplicate of a sibling whose
  // assigned errorType has tripOverriding=true (e.g. eligibility lapse).
  // Helper lives in `lib/sop-sibling-eligibility.ts` so the in-SOP
  // sibling-detection prompt and this header dialog stay in lockstep
  // (Guard #4 in the task spec).
  const tripOverridingErrorTypeIds = useMemo(
    () =>
      buildTripOverridingErrorTypeIds(
        (errorTypes ?? []) as Array<ErrorTypeResponse & { tripOverriding?: boolean }>,
      ),
    [errorTypes],
  );

  // Candidate primaries: same group, not self, not itself a duplicate, with a
  // trip-overriding error type. We sort by service date / conf number for
  // stable display in the picker.
  const duplicatePrimaryCandidates = useMemo(
    () =>
      findSiblingDuplicatePrimaryCandidates({
        selfClaimId: claimId,
        rides: parentGroup?.rides ?? null,
        tripOverridingErrorTypeIds,
      }),
    [parentGroup?.rides, claimId, tripOverridingErrorTypeIds],
  );

  const isDuplicate = claim?.duplicateOfClaimId != null;
  const primaryRef = useMemo(() => {
    if (!isDuplicate || !parentGroup?.rides) return null;
    return parentGroup.rides.find((r) => r.id === claim?.duplicateOfClaimId) ?? null;
  }, [isDuplicate, parentGroup?.rides, claim?.duplicateOfClaimId]);

  const groupIsPreSubmit = parentGroup?.macroPhase === "pre-submit";

  // In-SOP sibling-detection prompt: rendered above the first SOP
  // question when the leg has a trip-overriding primary candidate in
  // the same group. Eligibility lives in the same helper as the header
  // dialog so the two sites can never disagree (Guard #4).
  const siblingPromptCandidate = useMemo(() => {
    if (!claim) return null;
    return siblingPromptEligibilityFor({
      selfClaimId: claim.id,
      selfErrorTypeId: claim.errorTypeId ?? null,
      selfDuplicateOfClaimId: claim.duplicateOfClaimId ?? null,
      groupMacroPhase: parentGroup?.macroPhase ?? null,
      rides: parentGroup?.rides ?? null,
      errorTypes: (errorTypes ?? []) as Array<ErrorTypeResponse & { tripOverriding?: boolean }>,
    });
  }, [claim, parentGroup?.macroPhase, parentGroup?.rides, errorTypes]);

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

  function onMarkDuplicate() {
    const primaryId = Number(duplicatePrimaryId);
    if (!Number.isFinite(primaryId) || primaryId <= 0) return;
    markDuplicateMutation.mutate(
      { id: claimId, data: { primaryClaimId: primaryId, note: duplicateNote || null } },
      {
        onSuccess: () => {
          toast({ title: "Leg marked as Sibling Duplicate" });
          setDuplicateOpen(false);
          setDuplicatePrimaryId("");
          setDuplicateNote("");
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Mark as duplicate failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  function onUnmarkDuplicate() {
    unmarkDuplicateMutation.mutate(
      { id: claimId },
      {
        onSuccess: () => {
          toast({ title: "Sibling-duplicate link cleared" });
          setUnmarkDuplicateOpen(false);
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Unmark failed",
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
  // `canShowPlayer` is intentionally OR'd with `isDuplicate` so the legacy
  // disabled-reason ladder below stays quiet for duplicate legs. The
  // duplicate render itself is owned exclusively by the short-circuit
  // branch in JSX (`isDuplicate ? <DuplicateTerminal /> : …`), which mounts
  // the terminal directly without going through `SopAdvancePlayer` — that
  // way `mark as duplicate` works even before an error type / decision
  // tree is assigned.
  const canShowPlayer =
    isDuplicate ||
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
    !isDuplicate && (
      subStatus === "investigating" ||
      subStatus === "ready" ||
      subStatus === "dropped" ||
      subStatus === "blocked"
    );

  // Mark-as-duplicate availability mirrors the server-side validation in
  // POST /claims/:id/duplicate-of: leg state is one of the editable
  // pre-submit states and the parent group is still pre-submit. We hide
  // the affordance entirely when there is no candidate primary so the
  // user doesn't see a useless button.
  const canMarkDuplicate =
    !isDuplicate &&
    groupIsPreSubmit &&
    duplicatePrimaryCandidates.length > 0 &&
    (
      subStatus === "needs_classification" ||
      subStatus === "investigating" ||
      subStatus === "blocked" ||
      subStatus === "ready" ||
      subStatus === "dropped"
    );

  const canUnmarkDuplicate = isDuplicate && groupIsPreSubmit;

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

              {canMarkDuplicate && (
                <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      data-testid="leg-mark-duplicate-trigger"
                    >
                      <Copy className="h-3.5 w-3.5" /> Mark as duplicate
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Mark this leg as a Sibling Duplicate?</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Sibling Duplicates ride along with a primary leg whose
                        trip-overriding error invalidates the whole trip
                        (e.g. eligibility lapse). The primary leg's SOP and
                        verdict cover this leg, so we don't double-bill the
                        same dispute.
                      </p>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Primary leg (same invoice)</label>
                        <Select
                          value={duplicatePrimaryId}
                          onValueChange={setDuplicatePrimaryId}
                        >
                          <SelectTrigger data-testid="leg-mark-duplicate-primary">
                            <SelectValue placeholder="Pick a primary leg…" />
                          </SelectTrigger>
                          <SelectContent>
                            {duplicatePrimaryCandidates.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.confNumber || `CLM-${p.id}`}
                                {p.errorTypeName ? ` · ${p.errorTypeName}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Note (optional)</label>
                        <Textarea
                          value={duplicateNote}
                          onChange={(e) => setDuplicateNote(e.target.value)}
                          placeholder="e.g. Same eligibility lapse covers both legs of this trip."
                          rows={3}
                          data-testid="leg-mark-duplicate-note"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDuplicateOpen(false)}>Cancel</Button>
                      <Button
                        onClick={onMarkDuplicate}
                        disabled={!duplicatePrimaryId || markDuplicateMutation.isPending}
                        data-testid="leg-mark-duplicate-confirm"
                      >
                        {markDuplicateMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 mr-1" />
                        )}
                        Mark as Sibling Duplicate
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {canUnmarkDuplicate && (
                <Dialog open={unmarkDuplicateOpen} onOpenChange={setUnmarkDuplicateOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      data-testid="leg-unmark-duplicate-trigger"
                    >
                      <Link2Off className="h-3.5 w-3.5" /> Unmark duplicate
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Clear the Sibling-Duplicate link?</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2 text-sm">
                      <p>
                        The leg returns to its underlying SOP state. You'll
                        need to walk its decision tree (or exclude it) before
                        the invoice can be packaged.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setUnmarkDuplicateOpen(false)}>Cancel</Button>
                      <Button
                        onClick={onUnmarkDuplicate}
                        disabled={unmarkDuplicateMutation.isPending}
                        data-testid="leg-unmark-duplicate-confirm"
                      >
                        {unmarkDuplicateMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Link2Off className="h-3.5 w-3.5 mr-1" />
                        )}
                        Clear duplicate link
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        </div>

        {/* Sibling-duplicate banner — shown when this leg points at a primary
            in the same group. We render before the SOP card so it's the
            first thing the operator sees and the SOP card stays disabled. */}
        {isDuplicate && (
          <div className="cc-card p-3" data-testid="leg-duplicate-banner">
            <div className="flex items-start gap-2 text-sm">
              <Copy className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: "var(--cc-muted-fg)" }} />
              <div className="space-y-1">
                <div>
                  <strong>Sibling Duplicate</strong> of
                  {primaryRef ? (
                    <>
                      {" "}
                      <Link
                        href={`/claims/${primaryRef.id}`}
                        className="underline mono"
                      >
                        {primaryRef.confNumber || `CLM-${primaryRef.id}`}
                      </Link>
                      {primaryRef.errorTypeName ? (
                        <span style={{ color: "var(--cc-muted-fg)" }}>
                          {" "}· {primaryRef.errorTypeName}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="mono"> CLM-{claim.duplicateOfClaimId}</span>
                  )}
                  .
                </div>
                <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                  This leg's dispute is covered by the primary's SOP and
                  verdict. No independent SOP walk is required.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SOP walk — the entire purpose of this surface */}
        <div className="cc-card p-4" data-testid="leg-sop-card">
          {/* Duplicate legs always show the muted DuplicateTerminal, even
              when no decision tree is configured. Marking-as-duplicate is
              allowed from `needs_classification` (no error type yet, so
              no tree), and we should never present the "configure a
              tree" amber warning to the operator in that state. */}
          {isDuplicate ? (
            <DuplicateTerminal
              leg={{
                id: claim.id,
                sopOutcome: claim.sopOutcome,
                duplicateOfClaimId: claim.duplicateOfClaimId,
              }}
            />
          ) : null}
          {!isDuplicate && !claim.errorTypeId && (
            <div
              className="text-xs flex items-start gap-2 p-3 rounded"
              style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>This leg has no error type yet. Pick one from the queue or use the legacy classifier.</span>
            </div>
          )}
          {!isDuplicate && claim.errorTypeId && !tree && (
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
          {!isDuplicate && tree && canShowPlayer && (
            <SopAdvancePlayer
              leg={{
                id: claim.id,
                errorTypeId: claim.errorTypeId,
                sopNodeId: claim.sopNodeId,
                sopOutcome: claim.sopOutcome,
                dropReason: claim.dropReason,
                invoiceGroupId: claim.invoiceGroupId,
                duplicateOfClaimId: claim.duplicateOfClaimId,
                perLegContext: claim.perLegContext,
              }}
              tree={tree}
              onAdvanced={invalidateLeg}
              errorType={
                errorType
                  ? { useDirectEmail: errorType.useDirectEmail ?? null }
                  : null
              }
              siblingPrompt={
                siblingPromptCandidate
                  ? {
                      primaryClaimId: siblingPromptCandidate.primary.id,
                      primaryConfNumber:
                        siblingPromptCandidate.primary.confNumber ||
                        `CLM-${siblingPromptCandidate.primary.id}`,
                      primaryErrorTypeName:
                        siblingPromptCandidate.primary.errorTypeName ?? null,
                    }
                  : null
              }
            />
          )}
          {!isDuplicate && tree && !canShowPlayer && playerDisabledReason && (
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
