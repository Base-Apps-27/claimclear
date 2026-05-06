import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useConfirmUnderstandingReadback,
  useStampPreviewGenerated,
  useCreatePortalSubmission,
  useSaveInvoiceGroupDraft,
  useRegenerateInvoiceGroupDraft,
  useMarkInvoiceGroupDraftReviewed,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
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
} from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useToast, successToast } from "@/hooks/use-toast";
import { markLocalAction } from "@/hooks/use-local-action-mark";
import { PromptContextBadge } from "@/components/prompt-context-badge";
import { buildLegResolvedIndex } from "@workspace/leg-state";

// Submission gauntlet — readback → preview → submit, extracted from
// invoice-group-detail-v2 so the inline queue workspace renders the same
// staged controls. The component owns its own readback draft + submit
// error state because both are short-lived UI inputs that don't need to
// hoist into the parent.
interface Props {
  group: InvoiceGroupDetailResponse;
  groupId: number;
  // Optional callback: when the operator clicks "Jump to next
  // unprocessed leg" on a gate-failed submit, the gauntlet computes the
  // next leg id that still owes action and hands it to the parent. The
  // parent is responsible for expanding/scrolling that row in the
  // surrounding leg list. When omitted (e.g. the read-only group detail
  // page), the jump button is hidden.
  onJumpToLeg?: (claimId: number) => void;
  /**
   * When true, render only the inner submission body — no Card chrome and no
   * header. The caller is expected to wrap in their own card. Used by the
   * densified invoice-group detail surface so the cc-card from the page
   * provides the chrome.
   */
  bare?: boolean;
}

export function InvoiceGroupSubmissionGauntlet({ group, groupId, onJumpToLeg, bare }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const confirmReadbackMutation = useConfirmUnderstandingReadback();
  const stampPreviewMutation = useStampPreviewGenerated();
  const submitMutation = useCreatePortalSubmission();
  const saveDraftMutation = useSaveInvoiceGroupDraft();
  const regenDraftMutation = useRegenerateInvoiceGroupDraft();
  const markReviewedMutation = useMarkInvoiceGroupDraftReviewed();
  const [submitError, setSubmitError] = useState<{ error: string; gate?: string } | null>(null);
  // Save-confirmation breath replaces the "Draft saved" toast on the
  // Save-draft button (Task #316). The counter increments on every
  // successful save so the Button's `breathTrigger` prop can detect the
  // change and replay the animation cleanly across consecutive saves.
  const [draftSaveBreath, setDraftSaveBreath] = useState(0);

  const [readback, setReadback] = useState("");
  useEffect(() => {
    setReadback(group?.understandingReadback ?? "");
  }, [group?.understandingReadback]);

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
  const readbackConfirmed = !!group?.understandingReadbackAt;
  const previewGenerated = !!group?.previewGeneratedAt;
  const isPreSubmit = group?.status === "New" || group?.status === "Needs Evidence";

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

  function invalidateGroup() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: ["invoice-groups"] });
  }

  function onConfirmReadback() {
    if (!readback.trim()) return;
    confirmReadbackMutation.mutate(
      { id: groupId, data: { readback } },
      {
        onSuccess: () => {
          successToast({ title: "__VERB__", description: "Understanding readback confirmed" });
          invalidateGroup();
        },
        onError: (e: unknown) => toast({ title: "Readback failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
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

  function onSubmitToPortal() {
    setSubmitError(null);
    submitMutation.mutate(
      {
        data: {
          invoiceGroupId: groupId,
          actorType: "operator",
          understandingReadback: group?.understandingReadback ?? readback,
          // Pass the operator-reviewed text so /portal-submissions uses
          // it as the dispute body. Falls back to the AI baseline so the
          // backend still has something if the draft path was skipped.
          subject:
            group?.draftSubject ?? group?.aiBaselineSubject ?? draftSubject,
          descriptionHtml:
            group?.draftDescriptionHtml ??
            group?.aiBaselineDescriptionHtml ??
            draftBody,
        },
      },
      {
        onSuccess: () => {
          // Task #495 — leave a local mark so the parent
          // invoice-group-detail-v2 page's "just shipped" microinteraction
          // fires for the operator who pressed Submit even when SSE author
          // tags are missing or replay-suppressed.
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
          if (e != null && typeof e === "object" && "response" in e) {
            const axiosErr = e as { response?: { data?: { error?: string; gate?: string } } };
            const resp = axiosErr.response?.data;
            if (resp?.error) errorMsg = resp.error;
            if (resp?.gate) gate = resp.gate;
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

  const body = (
    <>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">Understanding notes</h3>
              <Badge variant="outline" className="text-[10px] font-normal">Optional</Badge>
              {/* Surface what the AI prompt sees on top of the dispute
                   reason: per-leg findings + sibling-duplicate rollups
                   (Task #311). Hidden when neither counter is non-zero. */}
              <PromptContextBadge legs={rides} testId="badge-prompt-context-readback" />
            </div>
            <div className="flex items-center gap-2">
              {readbackConfirmed && (
                <Badge variant="secondary" className="text-[10px]">
                  Saved {group.understandingReadbackAt ? formatDateTime(group.understandingReadbackAt) : ""}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onConfirmReadback}
                disabled={
                  !isPreSubmit ||
                  !allResolved ||
                  confirmReadbackMutation.isPending ||
                  !readback.trim() ||
                  readback === (group.understandingReadback ?? "")
                }
                data-testid="readback-confirm"
              >
                {confirmReadbackMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : null}
                Save notes
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Anything the AI write-up should know about the case overall. Leave blank to skip — the AI will use the per-leg findings and the dispute reason on their own.
          </p>
          <Textarea
            value={readback}
            onChange={(e) => setReadback(e.target.value)}
            rows={3}
            disabled={!isPreSubmit || !allResolved}
            placeholder="Optional — leave blank if there's nothing extra to add."
            data-testid="readback-input"
          />
          {isPreSubmit && !allResolved && (
            <p className="text-xs text-muted-foreground italic" data-testid="readback-locked-reason">
              These notes unlock once every disputed leg is resolved (ready, dropped, or excluded).
            </p>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Generate preview</h3>
            {(() => {
              const previewDisabledReason: string | null = !isPreSubmit
                ? `Disabled because the group is past pre-submit (${group.status}).`
                : rides.length === 0
                  ? "Disabled because this group has no legs included in the dispute."
                  : !allResolved
                    ? (() => {
                        // Bucket unresolved legs by their derived
                        // sub-status. A `duplicate` leg that resolves
                        // via a terminal primary has already been
                        // filtered out by `unresolvedRides`, so it
                        // won't show up here as "owing action" — only
                        // duplicates whose primary is still mid-walk
                        // (or missing) remain.
                        const counts = unresolvedRides.reduce<Record<string, number>>(
                          (acc, r) => {
                            const s = resolvedIndex.subStatusOf(r);
                            return { ...acc, [s]: (acc[s] ?? 0) + 1 };
                          },
                          {},
                        );
                        const summary = Object.entries(counts)
                          .map(([s, n]) => `${n} ${s.replace("_", " ")}`)
                          .join(", ");
                        return `Disabled because ${unresolvedRides.length} leg${unresolvedRides.length === 1 ? "" : "s"} still owe action (${summary}).`;
                      })()
                    : null;
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
            {readbackConfirmed && (
              <li className="text-green-700">
                ✓ Understanding notes saved (optional)
              </li>
            )}
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
                  <Button
                    size="sm"
                    onClick={onMarkReviewed}
                    disabled={
                      draftBodyEmpty ||
                      markReviewedMutation.isPending ||
                      saveDraftMutation.isPending ||
                      draftReviewed
                    }
                    data-testid="draft-mark-reviewed"
                  >
                    {markReviewedMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    {draftReviewed ? "Reviewed" : "Mark reviewed"}
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

              <Separator />
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <SubmitIcon className="h-4 w-4" />
                  {submitVerb}
                </h3>
                {(() => {
                  const missingGates: string[] = [];
                  if (!allResolved) missingGates.push("legs");
                  if (!draftReviewed) missingGates.push("review");
                  const submitDisabledReason: string | null =
                    missingGates.length > 0
                      ? `Cannot ${isDirectEmail ? "send" : "submit"} — missing gate${missingGates.length > 1 ? "s" : ""}: ${missingGates.join(", ")}.`
                      : null;
                  const button = (
                    <Button
                      size="sm"
                      onClick={onSubmitToPortal}
                      disabled={submitDisabledReason !== null || submitMutation.isPending}
                      data-testid="submit-to-portal"
                    >
                      {submitMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <SubmitIcon className="h-3.5 w-3.5 mr-1" />
                      )}
                      {submitVerb}
                    </Button>
                  );
                  if (submitDisabledReason) {
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} data-testid="submit-to-portal-disabled-wrapper">
                              {button}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            data-testid="submit-to-portal-disabled-tooltip"
                          >
                            {submitDisabledReason}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  }
                  return button;
                })()}
              </div>
              <p className="text-xs text-muted-foreground">
                {isDirectEmail
                  ? "Sends the reviewed write-up as a direct email to the configured recipient."
                  : "Routes the reviewed write-up to the MAS portal as a dispute submission."}
              </p>
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
