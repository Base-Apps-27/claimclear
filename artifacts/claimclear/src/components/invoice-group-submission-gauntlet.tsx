import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useConfirmUnderstandingReadback,
  useStampPreviewGenerated,
  useCreatePortalSubmission,
  useSaveInvoiceGroupDraft,
  useRegenerateInvoiceGroupDraft,
  useMarkInvoiceGroupDraftReviewed,
  useClearLegVerdictDraft,
  usePortalUnderstandingPreflight,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getGetClaimQueryKey,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
  LintResult,
} from "@workspace/api-client-react";
import { LintGateDialog, type LintGateMode } from "@/components/lint-gate-dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Loader2,
  Sparkles,
  Send,
  Mail,
  CheckCircle2,
  RefreshCw,
  Save,
  FileText,
  AlertTriangle,
  MoreVertical,
  RotateCcw,
  Layers,
  ChevronLeft,
  HelpCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { RefNumber } from "@/components/ref-number";
import { useIsQueuePreview } from "@/lib/preview-mode";
import { useToast, successToast } from "@/hooks/use-toast";
import { markLocalAction } from "@/hooks/use-local-action-mark";
import { PromptContextBadge } from "@/components/prompt-context-badge";
import { buildLegResolvedIndex } from "@workspace/leg-state";
import { derivePreviewGateState } from "@/lib/whats-next-derivation";

// Submission gauntlet — readback → preview → submit, extracted from
// invoice-group-detail-v2 so the inline queue workspace renders the same
// staged controls. The component owns its own readback draft + submit
// error state because both are short-lived UI inputs that don't need to
// hoist into the parent.
export interface GauntletFooterState {
  onMarkReviewed: () => void;
  discardEdits: () => void;
  draftDirty: boolean;
  draftBodyEmpty: boolean;
  markReviewedPending: boolean;
  saveDraftPending: boolean;
  draftReviewed: boolean;
}

interface Props {
  group: InvoiceGroupDetailResponse;
  groupId: number;
  onJumpToLeg?: (claimId: number) => void;
  // Task #685 (R3): opens A's ClassifyDialog scoped to a single leg.
  // The parent owns the dialog (it's already mounted in
  // inline-group-workspace-mini.tsx for the queue surface). When the
  // gauntlet is rendered standalone (no reclassify wiring) the
  // "Reclassify…" item simply isn't shown — same pattern as onJumpToLeg.
  onReclassifyLeg?: (claimId: number) => void;
  bare?: boolean;
  footerStateRef?: React.MutableRefObject<GauntletFooterState | null>;
  onFooterStateChange?: (state: GauntletFooterState) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function InvoiceGroupSubmissionGauntlet({ group, groupId, onJumpToLeg, onReclassifyLeg, bare, footerStateRef, onFooterStateChange, onDirtyChange }: Props) {
  const queuePreview = useIsQueuePreview();
  const qc = useQueryClient();
  const { toast } = useToast();

  const confirmReadbackMutation = useConfirmUnderstandingReadback();
  const preflightMutation = usePortalUnderstandingPreflight();
  const stampPreviewMutation = useStampPreviewGenerated();
  const submitMutation = useCreatePortalSubmission();
  const saveDraftMutation = useSaveInvoiceGroupDraft();
  const regenDraftMutation = useRegenerateInvoiceGroupDraft();
  const markReviewedMutation = useMarkInvoiceGroupDraftReviewed();
  // Task #685 (R3) — same hook A uses for its
  // `mini-clear-verdict-draft` button (per-leg DELETE
  // /claims/{id}/verdict/draft). Per wiring-map.md this is the
  // "keep classification, clear answers" mutation; "Redo walk" in the
  // R3 mockup is exactly that semantic. We do NOT introduce a new
  // hook — we reuse A's wiring at the per-leg scope.
  const clearLegVerdictDraft = useClearLegVerdictDraft();
  const [submitError, setSubmitError] = useState<{ error: string; gate?: string } | null>(null);
  // Task #703 follow-up — surface lint failures inline (same pattern
  // as inline-group-workspace-mini). Pre-fix, a 422 from the lint gate
  // collapsed into a generic "Submission failed" toast with no path
  // to acknowledge soft warnings.
  const [lintGateOpen, setLintGateOpen] = useState(false);
  const [lintGateMode, setLintGateMode] = useState<LintGateMode>("warn");
  const [lintResults, setLintResults] = useState<LintResult[]>([]);
  // Save-confirmation breath replaces the "Draft saved" toast on the
  // Save-draft button (Task #316). The counter increments on every
  // successful save so the Button's `breathTrigger` prop can detect the
  // change and replay the animation cleanly across consecutive saves.
  const [draftSaveBreath, setDraftSaveBreath] = useState(0);

  // Task #745 — split the operator's note from the AI restatement.
  // `notes` mirrors `group.specialCircumstances` (the operator's text);
  // `pendingReadback` / `pendingForText` hold the most recent preflight
  // response that hasn't been Saved yet (after Save they're moved onto
  // the group columns and we clear them here). Drift = the live `notes`
  // textarea no longer matches the text the readback was generated for.
  const [notes, setNotes] = useState("");
  const [isEditingReadback, setIsEditingReadback] = useState(false);
  const [pendingReadback, setPendingReadback] = useState<string | null>(null);
  const [pendingForText, setPendingForText] = useState<string | null>(null);
  useEffect(() => {
    setNotes(group?.specialCircumstances ?? "");
    setIsEditingReadback(false);
    // External changes (cross-tab save, refetch after our own confirm)
    // invalidate any in-flight pending preflight so we don't render a
    // ghost readback that doesn't match the freshly-loaded server state.
    setPendingReadback(null);
    setPendingForText(null);
  }, [group?.specialCircumstances, group?.understandingReadback, group?.understandingReadbackForText]);

  // Editable draft state for the new Review & edit step. We hydrate from
  // the saved draft if present, falling back to the AI baseline so the
  // operator always sees the latest text. Resetting on upstream change
  // ensures cross-tab edits replace the local buffer (matching the
  // per-leg context Textarea pattern).
  const [draftSubject, setDraftSubject] = useState<string>("");
  const [draftBody, setDraftBody] = useState<string>("");
  useEffect(() => {
    setDraftSubject(group?.draftSubject ?? group?.aiBaselineSubject ?? "");
    setDraftBody(
      group?.draftDescriptionHtml ?? group?.aiBaselineDescriptionHtml ?? "",
    );
  }, [
    group?.draftSubject,
    group?.draftDescriptionHtml,
    group?.aiBaselineSubject,
    group?.aiBaselineDescriptionHtml,
  ]);

  const allRides: ClaimResponse[] = group?.rides ?? [];
  const rides = useMemo(
    () => allRides.filter((r) => r.includedInDispute !== false),
    [allRides],
  );
  // Build the resolved-leg index across the FULL leg list (including
  // excluded primaries, not just disputed). A `duplicate` leg is
  // resolved iff its primary is in a terminal sub-status — same rule
  // as the backend's `evaluateDisputedLegsResolved`. Source of truth
  // lives in `lib/leg-resolved`; do not re-inline a "resolved" set.
  const resolvedIndex = useMemo(
    () => buildLegResolvedIndex(allRides),
    [allRides],
  );

  // First unresolved leg id (if any) — drives the gauntlet's
  // "jump to next unprocessed leg" affordance. Sibling-duplicate legs
  // whose primary is terminal are skipped (they're concluded).
  const firstUnresolvedLegId = useMemo(
    () => resolvedIndex.firstUnresolvedLegId(rides),
    [rides, resolvedIndex],
  );

  const unresolvedRides = useMemo(
    () => rides.filter((r) => !resolvedIndex.isLegResolved(r)),
    [rides, resolvedIndex],
  );

  const allResolved = rides.length > 0 && unresolvedRides.length === 0;
  // Buckets used by the Task #265 conclusion-summary checklist row.
  // SOP-resolved = legs that walked the SOP tree (ready) plus those
  // dropped via Non-issue / Non-contestable. Excluded = legs the
  // operator removed from the dispute entirely. A sibling-duplicate
  // leg that resolves via its primary is NOT counted here — it rolls
  // up under the primary's own bucket so we don't double-count.
  const conclusionCounts = useMemo(() => {
    let sop = 0;
    let excluded = 0;
    for (const r of rides) {
      const subStatus = resolvedIndex.subStatusOf(r);
      if (subStatus === "excluded") excluded += 1;
      else if (subStatus === "ready" || subStatus === "dropped") sop += 1;
    }
    return { sop, excluded };
  }, [rides, resolvedIndex]);
  // Task #745 — derived states for the verify-then-save gate.
  // `savedNotes` is the operator's last-saved text; `anchorReadback` and
  // `anchorForText` are the AI restatement + the exact text it was
  // generated for (the drift anchor). The pending* values come from the
  // most recent in-component preflight click and shadow the server
  // values until the operator hits Save.
  const savedNotes = (group?.specialCircumstances ?? "").trim();
  const liveNotes = (notes ?? "").trim();
  const anchorReadback = pendingReadback ?? group?.understandingReadback ?? null;
  const anchorForText = pendingForText ?? group?.understandingReadbackForText ?? null;
  const notesEmpty = liveNotes.length === 0;
  const notesMatchSaved = liveNotes === savedNotes;
  const hasAnchor = anchorReadback != null && anchorReadback.trim().length > 0;
  const notesMatchAnchor = hasAnchor && liveNotes === (anchorForText ?? "").trim();
  // The gate fires only for non-empty notes that don't match the
  // anchor. Empty notes (clear path) and unchanged notes never need a
  // re-check.
  const needsCheck = !notesEmpty && !notesMatchAnchor;
  // Task #745 — `readbackConfirmed` must also require the saved note to
  // match the saved drift anchor. Cross-tab/server drift can leave the
  // group with `specialCircumstances` (old saved note) and a fresh
  // `understandingReadbackForText` (other tab ran preflight against
  // edited text); in that case the readback no longer corresponds to
  // the saved note and we must force the operator back into the
  // "needs re-check" state instead of showing a stale saved view that
  // pairs the old note with a mismatched AI quote.
  const savedAnchorForText = (group?.understandingReadbackForText ?? "").trim();
  const savedNotesMatchSavedAnchor =
    savedNotes.length > 0 && savedNotes === savedAnchorForText;
  const readbackConfirmed =
    !!group?.understandingReadbackAt &&
    (group?.specialCircumstances ?? "").length > 0 &&
    savedNotesMatchSavedAnchor;
  const previewGenerated = !!group?.previewGeneratedAt;
  const isPreSubmit = group?.status === "New" || group?.status === "Needs Evidence";

  // Task #555 — single source of truth for the Generate Submission
  // Preview gate. Mirrors the api-server's preview gate exactly so the
  // disabled-state tooltip can name the blocking reason without the UI
  // and the server drifting.
  const previewGate = useMemo(
    () => derivePreviewGateState(group, allRides),
    [group, allRides],
  );

  // Channel-aware Submit. The errorTypesTable.useDirectEmail flag,
  // joined into the GET handler in Task #265, decides whether the
  // shared /portal-submissions endpoint dispatches into the MAS
  // portal flow or the direct-email flow. Same backend mutation;
  // the UI just relabels the affordance for operator clarity.
  const isDirectEmail = group?.useDirectEmail === true;
  const submitVerb = isDirectEmail ? "Send email" : "Submit to portal";
  const SubmitIcon = isDirectEmail ? Mail : Send;

  const draftReviewed = !!group?.draftReviewedAt;
  const draftDirty =
    (draftSubject || "") !== (group?.draftSubject ?? group?.aiBaselineSubject ?? "") ||
    (draftBody || "") !== (group?.draftDescriptionHtml ?? group?.aiBaselineDescriptionHtml ?? "");
  const draftBodyEmpty = (draftBody || "").trim().length === 0;

  const discardEdits = () => {
    setDraftSubject(group?.draftSubject ?? group?.aiBaselineSubject ?? "");
    setDraftBody(group?.draftDescriptionHtml ?? group?.aiBaselineDescriptionHtml ?? "");
  };

  const markReviewedRef = useRef(onMarkReviewed);
  markReviewedRef.current = onMarkReviewed;
  const discardEditsRef = useRef(discardEdits);
  discardEditsRef.current = discardEdits;

  const footerState: GauntletFooterState = useMemo(() => ({
    onMarkReviewed: () => markReviewedRef.current(),
    discardEdits: () => discardEditsRef.current(),
    draftDirty,
    draftBodyEmpty,
    markReviewedPending: markReviewedMutation.isPending,
    saveDraftPending: saveDraftMutation.isPending,
    draftReviewed,
  }), [draftDirty, draftBodyEmpty, markReviewedMutation.isPending, saveDraftMutation.isPending, draftReviewed]);

  if (footerStateRef) {
    footerStateRef.current = footerState;
  }

  useEffect(() => {
    onFooterStateChange?.(footerState);
  }, [footerState, onFooterStateChange]);

  useEffect(() => {
    onDirtyChange?.(draftDirty);
  }, [draftDirty, onDirtyChange]);

  function invalidateGroup() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  }

  function onCheckUnderstanding() {
    // Empty-note path doesn't call preflight at all — Save is the
    // explicit "clear notes" action.
    if (!liveNotes) return;
    preflightMutation.mutate(
      { data: { invoiceGroupId: groupId, specialCircumstances: notes } },
      {
        onSuccess: (data) => {
          setPendingReadback(data.readback ?? null);
          // Server echoes back the exact text it generated for; use it
          // as the drift anchor so trim/whitespace differences don't
          // leak between the textarea and the comparison.
          setPendingForText(
            data.understandingReadbackForText ?? notes,
          );
        },
        onError: (e: unknown) =>
          toast({
            title: "AI check failed",
            description: String((e as Error).message),
            variant: "destructive",
          }),
      },
    );
  }

  function onConfirmReadback() {
    // Drift gate (mirrors the server contract): if the operator typed
    // something but hasn't re-checked since, force them through the
    // preflight before allowing Save. The button is disabled in that
    // state too, but a defensive guard keeps the keyboard-driven path
    // honest.
    if (needsCheck) return;
    const payload = notesEmpty
      ? { readback: "", specialCircumstances: "" }
      : {
          readback: anchorReadback ?? "",
          specialCircumstances: notes,
        };
    confirmReadbackMutation.mutate(
      { id: groupId, data: payload },
      {
        onSuccess: () => {
          successToast({
            title: "__VERB__",
            description: notesEmpty
              ? "Understanding notes cleared"
              : "Understanding notes saved",
          });
          setIsEditingReadback(false);
          setPendingReadback(null);
          setPendingForText(null);
          invalidateGroup();
        },
        onError: (e: unknown) => {
          let msg = (e as Error).message;
          let code: string | undefined;
          if (e != null && typeof e === "object" && "response" in e) {
            const axiosErr = e as { response?: { data?: { error?: string; code?: string } } };
            const data = axiosErr.response?.data;
            if (data?.error) msg = data.error;
            if (data?.code) code = data.code;
          }
          // 409 with code=stale_readback / missing_readback → blow away
          // the local pending state so the operator is forced through
          // the preflight again. The button-state recomputes via the
          // anchor null-check.
          if (code === "stale_readback" || code === "missing_readback") {
            setPendingReadback(null);
            setPendingForText(null);
          }
          toast({ title: "Save failed", description: msg, variant: "destructive" });
        },
      },
    );
  }

  function onCancelReadbackEdit() {
    setNotes(group?.specialCircumstances ?? "");
    setPendingReadback(null);
    setPendingForText(null);
    setIsEditingReadback(false);
  }

  function onGeneratePreview() {
    stampPreviewMutation.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          successToast({ title: "__VERB__", description: "Submission preview generated" });
          invalidateGroup();
        },
        onError: (e: unknown) => toast({ title: "Preview generation failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  function onSaveDraft() {
    if (!draftDirty) return;
    saveDraftMutation.mutate(
      {
        id: groupId,
        data: { subject: draftSubject, descriptionHtml: draftBody },
      },
      {
        onSuccess: () => {
          // Quiet in-place "breath" on the Save-draft button instead of a toast.
          setDraftSaveBreath((n) => n + 1);
          invalidateGroup();
        },
        onError: (e: unknown) =>
          toast({
            title: "Save failed",
            description: String((e as Error).message),
            variant: "destructive",
          }),
      },
    );
  }

  function onRegenerateDraft() {
    regenDraftMutation.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          successToast({ title: "__VERB__", description: "Draft regenerated from preview" });
          invalidateGroup();
        },
        onError: (e: unknown) =>
          toast({
            title: "Regenerate failed",
            description: String((e as Error).message),
            variant: "destructive",
          }),
      },
    );
  }

  function onMarkReviewed() {
    // The backend marks-reviewed endpoint requires a non-empty draft body
    // and no unsaved local edits, so flush any pending edits first.
    const finalize = () =>
      markReviewedMutation.mutate(
        { id: groupId },
        {
          onSuccess: () => {
            successToast({ title: "__VERB__", description: "Draft marked as reviewed" });
            invalidateGroup();
          },
          onError: (e: unknown) =>
            toast({
              title: "Mark reviewed failed",
              description: String((e as Error).message),
              variant: "destructive",
            }),
        },
      );
    if (draftDirty) {
      saveDraftMutation.mutate(
        {
          id: groupId,
          data: { subject: draftSubject, descriptionHtml: draftBody },
        },
        { onSuccess: finalize, onError: finalize },
      );
    } else {
      finalize();
    }
  }

  function submitToPortalOnce(extra?: { ack: boolean; bypassReason: string }) {
    submitMutation.mutate(
      {
        data: {
          invoiceGroupId: groupId,
          actorType: "operator",
          // Task #745 — submit MUST only carry the persisted, AI-checked
          // values. Never thread the unsaved local `notes` textarea here:
          // doing so would let an operator type a non-empty note, skip
          // the AI readback gate, and still get that note into the
          // dispute prompt via `resolveCustomContextNote`. The Save
          // button is the only path that promotes local text to
          // `group.specialCircumstances`, and Save itself is gated by
          // the verify-then-save flow.
          specialCircumstances: group?.specialCircumstances ?? null,
          understandingReadback: group?.understandingReadback ?? null,
          // Pass the operator-reviewed text so /portal-submissions uses
          // it as the dispute body. Falls back to the AI baseline so the
          // backend still has something if the draft path was skipped.
          subject:
            group?.draftSubject ?? group?.aiBaselineSubject ?? draftSubject,
          descriptionHtml:
            group?.draftDescriptionHtml ??
            group?.aiBaselineDescriptionHtml ??
            draftBody,
          ...(extra ?? {}),
        },
      },
      {
        onSuccess: () => {
          // Task #495 — leave a local mark so the parent
          // invoice-group-detail-v2 page's "just shipped" microinteraction
          // fires for the operator who pressed Submit even when SSE author
          // tags are missing or replay-suppressed.
          setLintGateOpen(false);
          markLocalAction(`group:${groupId}`);
          successToast({
            title: "__VERB__",
            description: isDirectEmail ? "Email sent" : "Submitted to portal",
          });
          invalidateGroup();
        },
        onError: (e: unknown) => {
          let errorMsg = e instanceof Error ? e.message : String(e);
          let gate: string | undefined;
          let status: number | undefined;
          let failures: LintResult[] | undefined;
          if (e != null && typeof e === "object" && "response" in e) {
            const axiosErr = e as {
              response?: {
                status?: number;
                data?: { error?: string; gate?: string; failures?: LintResult[] };
              };
            };
            status = axiosErr.response?.status;
            const resp = axiosErr.response?.data;
            if (resp?.error) errorMsg = resp.error;
            if (resp?.gate) gate = resp.gate;
            if (Array.isArray(resp?.failures)) failures = resp.failures;
          }
          // Task #703 — open LintGateDialog on the lint-gate 422 so the
          // operator sees the actual rule names and, for warnings, can
          // type a bypass reason rather than staring at "Submission failed".
          if (status === 422 && failures && failures.length > 0) {
            const hasHardFail = failures.some((r) => r.severity === "fail");
            setLintResults(failures);
            setLintGateMode(hasHardFail ? "fail" : "warn");
            setLintGateOpen(true);
            return;
          }
          if (gate) {
            setSubmitError({ error: errorMsg, gate });
          } else {
            setSubmitError({ error: errorMsg });
          }
          toast({
            title: "Submission failed",
            description: errorMsg,
            variant: "destructive",
          });
        },
      },
    );
  }

  function onSubmitToPortal() {
    setSubmitError(null);
    submitToPortalOnce();
  }

  // Task #678 follow-up — claim-ID strip. Operators have to map MAS's
  // A/B leg labels onto our claim IDs to know which leg they're
  // reviewing; surface every disputed leg's claim ID at the top of
  // the gauntlet so the mental check is one glance, not a hunt
  // through the side rail.
  // Task #683 — AI summary hero (Q1–Q7 graduation). Visual-only,
  // read-only summary that sits above the existing readback step.
  // Every value is bound to a real payload field; no new mutations,
  // no synthetic confidence/timing copy. The existing edit step
  // below (`Review & edit`) remains the only writable surface.
  const submitted = !isPreSubmit;
  const heroStages = [
    { key: "walk", label: "Walk legs", done: allResolved, active: !allResolved },
    {
      key: "preview",
      label: "Generate",
      done: previewGenerated,
      active: allResolved && !previewGenerated,
    },
    {
      key: "review",
      label: "Review & edit",
      done: draftReviewed,
      active: previewGenerated && !draftReviewed && !submitted,
    },
    {
      key: "submit",
      label: submitVerb,
      done: submitted,
      active: draftReviewed && !submitted,
    },
  ];
  const hasSavedDraftEdit =
    (group?.draftSubject ?? null) !== null ||
    (group?.draftDescriptionHtml ?? null) !== null;
  const editTracker: { label: string; tone: "muted" | "amber" | "blue" } =
    draftDirty
      ? { label: "Note edited · unsaved", tone: "amber" }
      : hasSavedDraftEdit
        ? { label: "Note edited", tone: "blue" }
        : { label: "Note as drafted", tone: "muted" };
  const baselinePresent =
    !!(group?.aiBaselineSubject || group?.aiBaselineDescriptionHtml);
  const heldGroup = !!group?.holdReason;
  // Attachments rail — read-only chips for the group's
  // `evidenceFiles` (bot-worker payload). The submission drawer owns
  // the upload UI; here we only mirror what the AI prompt + outbound
  // dispute will see.
  const evidenceFiles = group?.evidenceFiles ?? [];
  // Off-ramp indicators (visual-only — no mutations are wired here):
  // - Re-attest: visible whenever `reattestRequired`. Stamped state
  //   uses `reattestCompletedAt`.
  // - Close: visible whenever `closureReason` is set; the existing
  //   group-detail page owns the actual closure flow.
  const reattestRequired = !!group?.reattestRequired;
  const reattestCompletedAt = group?.reattestCompletedAt ?? null;
  const reattestDone = !!reattestCompletedAt;
  const closureReason = group?.closureReason ?? null;

  const body = (
    <>
        <section
          className="rounded-lg border border-border bg-card p-3 space-y-3"
          data-testid="gauntlet-hero"
          aria-label="Submission summary"
        >
          {/* Header strip: invoice + status + segmented stage indicator */}
          <div className="flex items-center gap-2 flex-wrap">
            <RefNumber value={group?.invoiceNumber ?? null} variant="chip" data-testid="gauntlet-hero-invoice" />
            <span className="text-xs text-muted-foreground">
              {group?.payorEmail ?? "—"}
              {group?.totalAmount != null && (
                <> · <span className="font-medium text-foreground">{formatCurrency(group.totalAmount)}</span></>
              )}
            </span>
            {group?.status && (
              <Badge variant="secondary" className="text-[10px]" data-testid="gauntlet-hero-status">
                {group.status}
              </Badge>
            )}
            {heldGroup && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-800 dark:text-amber-300" data-testid="gauntlet-hero-hold">
                <AlertTriangle className="w-3 h-3 mr-1 inline" />
                On hold{group?.holdReason ? ` · ${group.holdReason}` : ""}
              </Badge>
            )}
            {reattestRequired && (
              <Badge
                variant="outline"
                className={
                  "text-[10px] " +
                  (reattestDone
                    ? "border-green-300 text-green-800 dark:text-green-300"
                    : "border-blue-300 text-blue-800 dark:text-blue-300")
                }
                data-testid="gauntlet-hero-offramp-reattest"
                data-state={reattestDone ? "done" : "required"}
                title={
                  reattestCompletedAt
                    ? `Re-attested ${formatDateTime(reattestCompletedAt)}`
                    : "Group requires re-attestation in MAS portal"
                }
              >
                {reattestDone ? "Re-attested" : "Re-attest required"}
              </Badge>
            )}
            {closureReason && (
              <Badge
                variant="outline"
                className="text-[10px] border-muted-foreground/40 text-muted-foreground"
                data-testid="gauntlet-hero-offramp-close"
                data-state="closed"
                title={`Closed · ${closureReason}`}
              >
                Closed · {closureReason}
              </Badge>
            )}
            {/* Stepper consolidation (queue-preview): the PinnedFooter
                already renders a MiniPhase stepper for the same five
                stages, so we hide this hero-level duplicate when the
                operator is on /queue-preview. Production /queue keeps
                both renders for back-compat with #687 muscle memory. */}
            {!queuePreview && <div
              className="ml-auto flex items-center gap-1 rounded border border-border bg-muted/40 p-0.5"
              role="list"
              data-testid="gauntlet-hero-stages"
            >
              {heroStages.map((s) => (
                <span
                  key={s.key}
                  role="listitem"
                  data-testid={`gauntlet-hero-stage-${s.key}`}
                  data-state={s.done ? "done" : s.active ? "active" : "todo"}
                  className={
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium " +
                    (s.done
                      ? "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300"
                      : s.active
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                        : "text-muted-foreground")
                  }
                >
                  {s.done ? <CheckCircle2 className="w-3 h-3" /> : null}
                  {s.label}
                </span>
              ))}
            </div>}
          </div>

          {/* Attachments rail — read-only chips for the group's
              evidenceFiles. Bot-worker payload + AI prompt input;
              uploads/edits live elsewhere. */}
          {evidenceFiles.length > 0 && (
            <div
              className="flex items-center gap-1.5 flex-wrap"
              data-testid="gauntlet-hero-attachments"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Attachments ({evidenceFiles.length})
              </span>
              {evidenceFiles.map((f, i) => {
                const label =
                  f.name ?? f.url.split("/").pop() ?? `file-${i + 1}`;
                return (
                  <span
                    key={`${f.url}-${i}`}
                    className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium"
                    data-testid={`gauntlet-hero-attachment-${i}`}
                    title={f.url}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Card row — one card per DISPUTED leg. Excluded legs
              (`includedInDispute === false`) are filtered out so the
              card count matches the resolved-N-of-M counter and the
              "what feeds the AI prompt" mental model. */}
          {rides.length > 0 && (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
              data-testid="gauntlet-hero-cards"
            >
              {rides.map((r, i) => {
                const sub = resolvedIndex.subStatusOf(r);
                const resolved = resolvedIndex.isLegResolved(r);
                // Task #685 (R4) — leg in needs_classification has no
                // walked verdict to "redo" and no error type to keep;
                // the card surfaces an amber framing + "Needs
                // classification" label and the overflow collapses to
                // just "Reclassify…" so the operator can't fire a
                // useless clear-draft against a never-walked leg.
                const isNeedsClassification = sub === "needs_classification";
                const subTone = isNeedsClassification
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : sub === "ready"
                    ? "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300"
                    : sub === "dropped" || sub === "excluded"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                      : "bg-muted text-muted-foreground";
                const subLabel = isNeedsClassification ? "needs classification" : sub;
                // R3: "Redo walk" item is only meaningful once the leg
                // has actually been walked (has an error type and at
                // least one recorded answer). Gate by errorTypeId so a
                // brand-new unwalked leg doesn't offer a no-op.
                const canRedoWalk = !isNeedsClassification && r.errorTypeId != null;
                const isRedoPending =
                  clearLegVerdictDraft.isPending &&
                  clearLegVerdictDraft.variables?.id === r.id;
                return (
                  <div
                    key={r.id}
                    className={
                      "rounded-md border bg-background p-2 flex flex-col gap-1.5 " +
                      (isNeedsClassification
                        ? "border-amber-300 dark:border-amber-800 border-t-2 border-t-amber-500 dark:border-t-amber-400"
                        : "border-border")
                    }
                    data-testid={`gauntlet-hero-card-${r.id}`}
                    data-resolved={resolved ? "true" : "false"}
                    data-sub-status={sub}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Leg {i + 1}
                      </span>
                      <RefNumber value={r.confNumber} variant="inline" />
                      {resolved && (
                        <CheckCircle2 className="w-3 h-3 ml-auto text-green-700 dark:text-green-400" />
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={
                              "h-6 w-6 p-0 " + (resolved ? "" : "ml-auto")
                            }
                            aria-label={`More for leg ${i + 1}`}
                            data-testid={`gauntlet-hero-card-${r.id}-overflow-trigger`}
                          >
                            {isRedoPending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <MoreVertical className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-56"
                          data-testid={`gauntlet-hero-card-${r.id}-overflow-menu`}
                        >
                          {onJumpToLeg && (
                            <DropdownMenuItem
                              onSelect={() => onJumpToLeg(r.id)}
                              data-testid={`gauntlet-hero-card-${r.id}-open-walk`}
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                              <div className="flex flex-col">
                                <span className="text-xs font-semibold">Open walk</span>
                                <span className="text-[10px] text-muted-foreground">
                                  Jump to this leg's player
                                </span>
                              </div>
                            </DropdownMenuItem>
                          )}
                          {canRedoWalk && (
                            <DropdownMenuItem
                              onSelect={() => {
                                clearLegVerdictDraft.mutate(
                                  { id: r.id },
                                  {
                                    onSuccess: () => {
                                      qc.invalidateQueries({
                                        queryKey: getGetClaimQueryKey(r.id),
                                      });
                                      qc.invalidateQueries({
                                        queryKey: getGetInvoiceGroupQueryKey(groupId),
                                      });
                                      successToast({
                                        title: "Walk reset",
                                        description:
                                          "Classification kept; recorded answers cleared.",
                                      });
                                      if (onJumpToLeg) onJumpToLeg(r.id);
                                    },
                                    onError: (e: unknown) =>
                                      toast({
                                        title: "Redo walk failed",
                                        description:
                                          e instanceof Error ? e.message : String(e),
                                        variant: "destructive",
                                      }),
                                  },
                                );
                              }}
                              disabled={clearLegVerdictDraft.isPending}
                              data-testid={`gauntlet-hero-card-${r.id}-redo-walk`}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <div className="flex flex-col">
                                <span className="text-xs font-semibold">Redo walk</span>
                                <span className="text-[10px] text-muted-foreground">
                                  Keep classification, clear answers
                                </span>
                              </div>
                            </DropdownMenuItem>
                          )}
                          {onReclassifyLeg && (canRedoWalk || isNeedsClassification) && (
                            <DropdownMenuSeparator />
                          )}
                          {onReclassifyLeg && (
                            <DropdownMenuItem
                              onSelect={() => onReclassifyLeg(r.id)}
                              data-testid={`gauntlet-hero-card-${r.id}-reclassify`}
                            >
                              <Layers className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                              <div className="flex flex-col">
                                <span className="text-xs font-semibold">
                                  {isNeedsClassification ? "Classify…" : "Reclassify…"}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  Pick a different error type
                                </span>
                              </div>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.date ? formatDateTime(r.date) : "—"}
                      {r.claimAmount != null && <> · {formatCurrency(r.claimAmount)}</>}
                    </div>
                    {isNeedsClassification ? (
                      <div
                        className="flex items-center gap-1 text-[11px] text-amber-800 dark:text-amber-300"
                        data-testid={`gauntlet-hero-card-${r.id}-needs-classification`}
                      >
                        <HelpCircle className="w-3 h-3" />
                        <span>Pick an error type to unlock the SOP walk.</span>
                      </div>
                    ) : (
                      r.errorTypeName && (
                        <div className="text-[11px] text-foreground truncate" title={r.errorTypeName}>
                          {r.errorTypeName}
                        </div>
                      )
                    )}
                    <div className="flex items-center gap-1 mt-auto">
                      <span className={"inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium " + subTone}>
                        {subLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Resolved counter + edit tracker */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span data-testid="gauntlet-hero-resolved-counter" className="text-muted-foreground">
              Resolved{" "}
              <span className="font-semibold text-foreground">
                {rides.length - unresolvedRides.length}
              </span>{" "}
              of <span className="font-semibold text-foreground">{rides.length}</span>
            </span>
            <span aria-hidden className="text-muted-foreground">·</span>
            <span
              data-testid="gauntlet-hero-edit-tracker"
              data-tone={editTracker.tone}
              className={
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium " +
                (editTracker.tone === "amber"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : editTracker.tone === "blue"
                    ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                    : "bg-muted text-muted-foreground")
              }
            >
              <FileText className="w-3 h-3" />
              {editTracker.label}
            </span>
            {group?.draftEditedAt && (
              <span className="text-[11px] text-muted-foreground">
                Last edit {formatDateTime(group.draftEditedAt)}
              </span>
            )}
          </div>

          {/* AI baseline preview — read-only, subject only. The full
              HTML body is rendered (and editable) in the existing
              "Review & edit" step below; we deliberately do NOT
              re-render `aiBaselineDescriptionHtml` here to avoid an
              `dangerouslySetInnerHTML` sink in operator UI. */}
          {baselinePresent && (
            <div
              className="rounded-md border border-border bg-muted/30 p-2 space-y-1"
              data-testid="gauntlet-hero-baseline-preview"
            >
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  AI baseline
                </span>
              </div>
              {group?.aiBaselineSubject ? (
                <p className="text-xs font-semibold">{group.aiBaselineSubject}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Body drafted — review below.
                </p>
              )}
            </div>
          )}
        </section>

        <div
          className="rounded-md border border-blue-200 bg-blue-50/60 dark:bg-blue-950/30 px-3 py-2 flex items-center gap-2 flex-wrap"
          data-testid="gauntlet-claim-id-strip"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-900 dark:text-blue-200">
            Reviewing
          </span>
          {rides.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">
              No disputed legs
            </span>
          ) : (
            rides.map((r, i) => {
              const chip = (
                <span
                  className="inline-flex items-center gap-1 rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-blue-950/60 px-1.5 py-0.5 font-mono text-[12px] font-bold text-[#1B2A4A] dark:text-blue-200"
                  data-testid={`gauntlet-claim-id-chip-${r.id}`}
                >
                  <span className="text-[10px] font-sans font-medium uppercase tracking-wide text-muted-foreground">
                    Leg {i + 1}
                  </span>
                  <span aria-hidden className="text-muted-foreground">·</span>
                  <span>#{r.id}</span>
                </span>
              );
              if (onJumpToLeg) {
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onJumpToLeg(r.id)}
                    className="rounded hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={`Jump to leg #${r.id}`}
                    data-testid={`gauntlet-claim-id-jump-${r.id}`}
                  >
                    {chip}
                  </button>
                );
              }
              return <span key={r.id}>{chip}</span>;
            })
          )}
        </div>

        <div className="space-y-2" data-testid="readback-block">
          {readbackConfirmed && !isEditingReadback ? (
            // Saved + in-sync display: the operator's notes are
            // committed AND the AI restatement that was generated for
            // them is on file. Edit reopens the textarea + clears any
            // pending preflight so the gate runs fresh on the next save.
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold">Understanding notes</h3>
                  <Badge variant="secondary" className="text-[10px]">
                    Saved {group.understandingReadbackAt ? formatDateTime(group.understandingReadbackAt) : ""}
                  </Badge>
                  <PromptContextBadge legs={rides} testId="badge-prompt-context-readback" />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditingReadback(true)}
                  disabled={!isPreSubmit}
                  data-testid="readback-edit"
                >
                  Edit
                </Button>
              </div>
              <blockquote
                className="rounded-md border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-xs whitespace-pre-wrap"
                data-testid="readback-saved-display"
              >
                {group.specialCircumstances}
              </blockquote>
              {group.understandingReadback ? (
                <details className="text-xs text-muted-foreground" data-testid="readback-saved-ai-quote-wrap">
                  <summary className="cursor-pointer select-none">What the AI heard</summary>
                  <blockquote
                    className="mt-1 rounded-md border-l-2 border-blue-300/60 bg-blue-50/40 dark:bg-blue-950/30 px-3 py-2 whitespace-pre-wrap"
                    data-testid="readback-saved-ai-quote"
                  >
                    {group.understandingReadback}
                  </blockquote>
                </details>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Included as additional context in the AI write-up.
              </p>
            </>
          ) : (
            // Editable state — three sub-states driven by the drift gate:
            //  1. Empty notes → Save acts as "clear" (no AI check).
            //  2. Typed but not checked, or drifted from the anchor →
            //     show "Check AI understanding"; Save is disabled.
            //  3. Checked + in sync → show the readback blockquote and
            //     enable Save.
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold">Understanding notes</h3>
                  <Badge variant="outline" className="text-[10px] font-normal">Optional</Badge>
                  <PromptContextBadge legs={rides} testId="badge-prompt-context-readback" />
                </div>
                <div className="flex items-center gap-2">
                  {isEditingReadback && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onCancelReadbackEdit}
                      disabled={confirmReadbackMutation.isPending}
                      data-testid="readback-cancel"
                    >
                      Cancel
                    </Button>
                  )}
                  {needsCheck ? (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={onCheckUnderstanding}
                      disabled={
                        !isPreSubmit ||
                        preflightMutation.isPending ||
                        notesEmpty
                      }
                      data-testid="readback-check"
                    >
                      {preflightMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                      )}
                      Check AI understanding
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onConfirmReadback}
                      disabled={
                        !isPreSubmit ||
                        confirmReadbackMutation.isPending ||
                        // Only suppress Save when there's literally nothing
                        // to persist: text matches the already-saved note
                        // AND the saved confirmation is still valid (no
                        // server/cross-tab drift, no pending re-check).
                        // Migrated rows arrive with savedNotes ===
                        // liveNotes but no valid confirmation, so they
                        // must be allowed to Save after running Check.
                        (notesMatchSaved && readbackConfirmed)
                      }
                      data-testid="readback-confirm"
                    >
                      {confirmReadbackMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : null}
                      {notesEmpty ? "Save (clear)" : "Save \u0026 include in submission"}
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Anything the AI write-up should know about the case overall. Leave blank to skip — the AI will use the per-leg findings and the dispute reason on their own.
              </p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                disabled={!isPreSubmit}
                placeholder="Optional — leave blank if there's nothing extra to add."
                data-testid="readback-input"
              />
              {!notesEmpty && hasAnchor && notesMatchAnchor ? (
                <div data-testid="readback-preview-wrap" className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    AI understanding
                  </p>
                  <blockquote
                    className="rounded-md border-l-2 border-blue-300/60 bg-blue-50/40 dark:bg-blue-950/30 px-3 py-2 text-xs whitespace-pre-wrap"
                    data-testid="readback-preview"
                  >
                    {anchorReadback}
                  </blockquote>
                  <p className="text-[11px] text-muted-foreground">
                    Save to include this note in the submission. Edit the text above to re-check.
                  </p>
                </div>
              ) : null}
              {!notesEmpty && needsCheck ? (
                <p
                  className="text-[11px] text-amber-700 dark:text-amber-400"
                  data-testid="readback-needs-check-hint"
                >
                  {hasAnchor
                    ? "Notes changed since the last AI check — re-check before saving."
                    : "Run an AI check before saving — this field carries extra weight in the write-up."}
                </p>
              ) : null}
            </>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Generate preview</h3>
            {(() => {
              const previewDisabledReason = previewGate.ok ? null : previewGate.reason;
              const button = (
                <Button
                  size="sm"
                  onClick={onGeneratePreview}
                  disabled={previewDisabledReason !== null || stampPreviewMutation.isPending}
                  data-testid="generate-preview"
                >
                  {stampPreviewMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  {previewGenerated ? "Regenerate preview" : "Generate preview"}
                </Button>
              );
              if (previewDisabledReason) {
                return (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} data-testid="generate-preview-disabled-wrapper">
                          {button}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        data-testid="generate-preview-disabled-tooltip"
                      >
                        {previewDisabledReason}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              }
              return button;
            })()}
          </div>
          <ul className="space-y-1 text-xs">
            <li
              className={allResolved ? "text-green-700" : "text-muted-foreground"}
              data-testid="gate-row-legs"
            >
              {allResolved ? "✓" : "○"}{" "}
              {allResolved
                ? `All legs reached a conclusion — ${conclusionCounts.sop} SOP, ${conclusionCounts.excluded} excluded`
                : "All legs reached a conclusion"}
            </li>
            {/* Readback row removed — readback is optional and no
                 longer a preview gate. The saved-state display in the
                 Understanding notes section above is the surface of
                 record. */}
            {previewGenerated && (
              <li className="text-green-700">
                ✓ Preview generated {group.previewGeneratedAt ? formatDateTime(group.previewGeneratedAt) : ""}
              </li>
            )}
            {previewGenerated && (
              <li className={draftReviewed ? "text-green-700" : "text-muted-foreground"}>
                {draftReviewed ? "✓" : "○"} Draft reviewed by operator
              </li>
            )}
          </ul>
        </div>

        {isPreSubmit && previewGenerated && (
          <>
            <Separator />
            {/* Review & edit — Task #265 Panel B. The operator edits the
                AI write-up directly (subject + body), saves, then marks
                reviewed. Submit is gated on the reviewed timestamp so an
                edited but unreviewed draft cannot accidentally ship. */}
            <div className="space-y-3" data-testid="draft-review-step">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                  Review &amp; edit dispute write-up
                  {draftReviewed && (
                    <Badge variant="secondary" className="text-[10px]">
                      Reviewed{" "}
                      {group.draftReviewedAt
                        ? formatDateTime(group.draftReviewedAt)
                        : ""}
                    </Badge>
                  )}
                  {/* Mirror the badge above the draft so reviewers know
                       which legs/duplicates shaped the AI write-up
                       without scrolling back up to the readback section
                       (Task #311). */}
                  <PromptContextBadge legs={rides} testId="badge-prompt-context-draft" />
                </h3>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onRegenerateDraft}
                    disabled={regenDraftMutation.isPending}
                    data-testid="draft-regenerate"
                  >
                    {regenDraftMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    )}
                    Regenerate from preview
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onSaveDraft}
                    disabled={!draftDirty || saveDraftMutation.isPending}
                    breathTrigger={draftSaveBreath}
                    data-testid="draft-save"
                  >
                    {saveDraftMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    Save draft
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="draft-subject"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Subject
                </label>
                <Input
                  id="draft-subject"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                  placeholder="Dispute subject line"
                  data-testid="draft-subject-input"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="draft-body"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Description
                </label>
                <Textarea
                  id="draft-body"
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  rows={10}
                  placeholder="HTML/plain-text body the dispute will send. Edit freely; Save then Mark reviewed to unlock Submit."
                  data-testid="draft-body-input"
                />
                {draftDirty && (
                  <p
                    className="text-xs text-amber-700"
                    data-testid="draft-dirty-hint"
                  >
                    Unsaved edits — Save draft to persist (Mark reviewed
                    saves automatically).
                  </p>
                )}
                {draftBodyEmpty && (
                  <p
                    className="text-xs text-muted-foreground italic"
                    data-testid="draft-empty-hint"
                  >
                    Generate or regenerate the draft from the preview to
                    populate this field.
                  </p>
                )}
              </div>

              <LintGateDialog
                open={lintGateOpen}
                mode={lintGateMode}
                results={lintResults}
                pending={submitMutation.isPending}
                onClose={() => setLintGateOpen(false)}
                onConfirmAnyway={(bypassReason) =>
                  submitToPortalOnce({ ack: true, bypassReason })
                }
              />

              {submitError && (
                <div
                  className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 space-y-2"
                  data-testid="submit-error"
                >
                  <div>
                    {submitError.error}
                    {submitError.gate && (
                      <span className="ml-1 text-xs text-red-700">(gate: {submitError.gate})</span>
                    )}
                  </div>
                  {submitError.gate === "legs" && firstUnresolvedLegId != null && onJumpToLeg && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onJumpToLeg(firstUnresolvedLegId)}
                      data-testid="gauntlet-jump-to-leg"
                    >
                      Jump to leg #{firstUnresolvedLegId}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
    </>
  );

  if (bare) {
    return <div className="space-y-4">{body}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Submission preview
        </CardTitle>
        <CardDescription>
          Optionally add any extra context for the AI, then generate the dispute
          submission preview.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}
