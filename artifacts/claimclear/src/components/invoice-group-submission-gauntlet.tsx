import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useConfirmUnderstandingReadback,
  useStampPreviewGenerated,
  useCreatePortalSubmission,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Sparkles, AlertTriangle, Send } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";

const RESOLVED_SUB_STATUSES: ReadonlySet<LegSubStatus> = new Set(["ready", "dropped", "excluded"]);

// Submission gauntlet — readback → preview → submit, extracted from
// invoice-group-detail-v2 so the inline queue workspace renders the same
// staged controls. The component owns its own readback draft + submit
// error state because both are short-lived UI inputs that don't need to
// hoist into the parent.
interface Props {
  group: InvoiceGroupDetailResponse;
  groupId: number;
  // Optional lock — when present, every mutating control (readback,
  // generate preview, submit) is disabled with the lock as the
  // disabled-reason hint. Used by the Queue inline workspace to honour
  // presence-based locks.
  lockReason?: string | null;
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

export function InvoiceGroupSubmissionGauntlet({ group, groupId, lockReason, onJumpToLeg, bare }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const confirmReadbackMutation = useConfirmUnderstandingReadback();
  const stampPreviewMutation = useStampPreviewGenerated();
  const submitMutation = useCreatePortalSubmission();
  const [submitError, setSubmitError] = useState<{ error: string; gate?: string } | null>(null);

  const [readback, setReadback] = useState("");
  useEffect(() => {
    setReadback(group?.understandingReadback ?? "");
  }, [group?.understandingReadback]);

  const allRides: ClaimResponse[] = group?.rides ?? [];
  const rides = useMemo(
    () => allRides.filter((r) => r.includedInDispute !== false),
    [allRides],
  );
  const legSubStatuses = useMemo(() => rides.map((r) => deriveLegSubStatus(r)), [rides]);

  // First unresolved leg id (if any) — drives the gauntlet's
  // "jump to next unprocessed leg" affordance.
  const firstUnresolvedLegId = useMemo(() => {
    for (const r of rides) {
      if (!RESOLVED_SUB_STATUSES.has(deriveLegSubStatus(r))) return r.id;
    }
    return null;
  }, [rides]);

  const allResolved = legSubStatuses.length > 0 && legSubStatuses.every((s) => RESOLVED_SUB_STATUSES.has(s));
  const readbackConfirmed = !!group?.understandingReadbackAt;
  const previewGenerated = !!group?.previewGeneratedAt;
  const isPreSubmit = group?.status === "New" || group?.status === "Needs Evidence";

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
          toast({ title: "Understanding readback confirmed" });
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
          toast({ title: "Submission preview generated" });
          invalidateGroup();
        },
        onError: (e: unknown) => toast({ title: "Preview generation failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  function onSubmitToPortal() {
    setSubmitError(null);
    submitMutation.mutate(
      {
        data: {
          invoiceGroupId: groupId,
          actorType: "operator",
          understandingReadback: group?.understandingReadback ?? readback,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Submitted to portal" });
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
        {!isPreSubmit && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            This group is past pre-submit ({group.status}); preview generation
            is no longer available from this surface.
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Understanding readback</h3>
            <div className="flex items-center gap-2">
              {readbackConfirmed && (
                <Badge variant="secondary" className="text-[10px]">
                  Confirmed {group.understandingReadbackAt ? formatDateTime(group.understandingReadbackAt) : ""}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onConfirmReadback}
                disabled={
                  !isPreSubmit ||
                  !!lockReason ||
                  !allResolved ||
                  confirmReadbackMutation.isPending ||
                  !readback.trim() ||
                  readback === (group.understandingReadback ?? "")
                }
                title={lockReason ?? undefined}
                data-testid="readback-confirm"
              >
                {confirmReadbackMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : null}
                Confirm readback
              </Button>
            </div>
          </div>
          <Textarea
            value={readback}
            onChange={(e) => setReadback(e.target.value)}
            rows={3}
            disabled={!isPreSubmit || !allResolved || !!lockReason}
            placeholder="Write what you understand the case to be. Confirming records the timestamp + author and unlocks preview generation."
            data-testid="readback-input"
          />
          {lockReason && (
            <p className="text-xs text-muted-foreground italic" data-testid="gauntlet-lock-reason">
              {lockReason}
            </p>
          )}
          {isPreSubmit && !allResolved && (
            <p className="text-xs text-muted-foreground italic" data-testid="readback-locked-reason">
              Readback unlocks once every disputed leg is resolved (ready, dropped, or excluded).
            </p>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Generate preview</h3>
            {(() => {
              const previewDisabledReason: string | null = lockReason
                ? lockReason
                : !isPreSubmit
                ? `Disabled because the group is past pre-submit (${group.status}).`
                : rides.length === 0
                  ? "Disabled because this group has no legs included in the dispute."
                  : !allResolved
                    ? (() => {
                        const unresolved = legSubStatuses.filter(
                          (s) => !RESOLVED_SUB_STATUSES.has(s),
                        );
                        const counts = unresolved.reduce<Record<string, number>>(
                          (acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }),
                          {},
                        );
                        const summary = Object.entries(counts)
                          .map(([s, n]) => `${n} ${s.replace("_", " ")}`)
                          .join(", ");
                        return `Disabled because ${unresolved.length} leg${unresolved.length === 1 ? "" : "s"} still owe action (${summary}).`;
                      })()
                    : !readbackConfirmed
                      ? "Disabled because the understanding readback hasn't been confirmed yet."
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
            <li className={allResolved ? "text-green-700" : "text-muted-foreground"}>
              {allResolved ? "✓" : "○"} Every leg resolved (ready, dropped, or excluded)
            </li>
            <li className={readbackConfirmed ? "text-green-700" : "text-muted-foreground"}>
              {readbackConfirmed ? "✓" : "○"} Understanding readback confirmed
            </li>
            {previewGenerated && (
              <li className="text-green-700">
                ✓ Preview generated {group.previewGeneratedAt ? formatDateTime(group.previewGeneratedAt) : ""}
              </li>
            )}
          </ul>
        </div>

        {isPreSubmit && previewGenerated && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Submit to portal</h3>
                {(() => {
                  const missingGates: string[] = [];
                  if (!allResolved) missingGates.push("legs");
                  if (!readbackConfirmed) missingGates.push("readback");
                  const submitDisabledReason: string | null = lockReason
                    ? lockReason
                    : missingGates.length > 0
                      ? `Cannot submit — missing gate${missingGates.length > 1 ? "s" : ""}: ${missingGates.join(", ")}.`
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
                        <Send className="h-3.5 w-3.5 mr-1" />
                      )}
                      Submit to Portal
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
                Generate Preview calls <code>/portal-submissions/generate-preview</code> (renders preview),
                then <code>/api/invoice-groups/:id/preview-generated</code> (stamps acceptance).
                Submit is the separate step that triggers the portal transition.
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
          Confirm the AI's read of the case, then generate the dispute
          submission preview.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}
