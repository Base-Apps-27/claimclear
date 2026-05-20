import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListErrorTypes,
  useClassifyLeg,
  useExcludeLeg,
  useIncludeLeg,
  useReclassifyLeg,
  useCreateErrorType,
  useGetInvoiceGroup,
  getListInvoiceGroupsQueryKey,
  getListErrorTypesQueryKey,
  getGetInvoiceGroupQueryKey,
} from "@workspace/api-client-react";
import type {
  ErrorTypeResponse,
  ClaimResponse,
  ExcludeLegBodyReason,
  NeedsClassificationInboxGroup,
  NeedsClassificationInboxClaim,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { RefNumber } from "@/components/ref-number";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDate } from "@/lib/format";
import { deriveLegSubStatus } from "@workspace/leg-state";
import {
  AlertTriangle,
  ArrowUpRight,
  Tag,
  Loader2,
  Plus,
  XCircle,
  Inbox,
  Info,
} from "lucide-react";

// Per-claim Classification Inbox panel.
//
// Replaces the old group-level triage card. The Needs Review group is
// just a container — operators classify or exclude individual claims,
// and the parent group auto-promotes to Needs Evidence as soon as the
// last needs_classification leg is resolved (cascade lives in
// `/claims/:id/classify` and `/claims/:id/exclude`).
//
// Two row modes:
//   - claims with errorDetails: show Error Type picker + classify button
//   - blank claims: show "Mark as no-issue / cannot dispute" exclude
//     buttons (`non_issue` / `cannot_dispute` reasons exposed by the
//     extended LEG_EXCLUSION_REASONS list)
//
// allBlank groups also get a "Mark all as no-issue" bulk shortcut. The
// inbox payload is authoritative for which claims need work; the
// useGetInvoiceGroup fetch is just for the latest claim row data so the
// row can flip to "Classified" without a refetch race.

interface Props {
  inboxGroup: NeedsClassificationInboxGroup;
  onCompleted: (message: string) => void;
  // Task #412: when set, the panel scopes to this single leg only —
  // it shows that leg's row even if it's already classified (so the
  // "Change" affordance from the detail page works), pre-fills the
  // Select with the live errorTypeId, and does not collapse out
  // other legs in the group. This is the entry point used by the
  // leg-row Classify button and the detail-page Classify / Change
  // buttons, where the operator already focused on a specific leg.
  highlightLegId?: number;
  // Pre-selected error type per leg id (used by the "Change"
  // affordance to pre-load the current selection in the picker).
  initialErrorTypeIds?: Record<number, string | null | undefined>;
}

export function QueueNeedsReviewPanel({
  inboxGroup,
  onCompleted,
  highlightLegId,
  initialErrorTypeIds,
}: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: groupDetail } = useGetInvoiceGroup(inboxGroup.id, {
    query: { queryKey: getGetInvoiceGroupQueryKey(inboxGroup.id), enabled: !!inboxGroup.id },
  });
  const { data: errorTypesData } = useListErrorTypes();
  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];

  const classifyLeg = useClassifyLeg();
  const excludeLeg = useExcludeLeg();
  // Task #795 — single-leg Classify entry points (Queue row, claim-detail
  // Classify / Change, leg-conclusion row, gauntlet reclassify) can be
  // opened on legs that are excluded or already classified. POSTing
  // /classify in either state returns 409, so we route through the
  // correct pre-step (/include or /reclassify) before classifying.
  const includeLeg = useIncludeLeg();
  const reclassifyLeg = useReclassifyLeg();
  const createErrorType = useCreateErrorType();

  // Bulk-mode toggle for allBlank groups: when on, a single click marks
  // every needs_classification leg as `non_issue`. Disabled while any
  // mutation is in flight to avoid double-firing on impatient clicks.
  // Shared with the Task #796 bulk reclassify control so a no-issue
  // sweep and a reclassify sweep can't run simultaneously.
  const [bulkPending, setBulkPending] = useState(false);
  // Task #796 — bulk reclassify control (bulk mode only). The picker
  // lets the operator apply one error type to every visible leg in a
  // single pass, with per-leg pre-step routing.
  const [bulkErrorTypeId, setBulkErrorTypeId] = useState<string>("");

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(inboxGroup.id) });
    // The inbox endpoint is keyed off the back-compat query key.
    queryClient.invalidateQueries({ queryKey: ["needs-classification-inbox"] });
  }

  // Prefer live claim rows from the group detail (sub-status reflects
  // any in-flight classification immediately) and fall back to the
  // inbox payload until the detail fetch lands.
  const liveClaimById = useMemo(() => {
    const map = new Map<number, ClaimResponse>();
    for (const c of groupDetail?.rides ?? []) map.set(c.id, c);
    return map;
  }, [groupDetail]);

  const inboxClaims = inboxGroup.claims;
  const remainingNeedsClassification = useMemo(() => {
    return inboxClaims.filter((c) => {
      // Single-leg mode (Task #412): when an entry point opened the
      // panel scoped to one leg, always render that leg's row — even
      // if it's already classified (so the "Change" affordance works).
      // In the inbox cohort mode, the panel collapses out classified
      // rows so the operator sees only what's left.
      if (highlightLegId === c.id) return true;
      const live = liveClaimById.get(c.id);
      if (!live) return true;
      return deriveLegSubStatus(live) === "needs_classification";
    });
  }, [inboxClaims, liveClaimById, highlightLegId]);

  // Task #796 — bulk-mode visible legs. The inbox payload only carries
  // `needs_classification` legs, but operators legitimately want to
  // retag legs that are already classified or excluded from the same
  // panel (instead of one row at a time from the detail page). For
  // bulk/inbox-cohort mode we additionally surface every reclassify-
  // eligible leg from the live group fetch. Single-leg mode still
  // renders only the highlighted row.
  const RECLASSIFY_ELIGIBLE_STATES = useMemo(
    () =>
      new Set([
        "needs_classification",
        "investigating",
        "ready",
        "dropped",
        "blocked",
        "excluded",
      ]),
    [],
  );
  const bulkVisibleClaims = useMemo<NeedsClassificationInboxClaim[]>(() => {
    if (highlightLegId !== undefined) return [];
    const seen = new Set<number>();
    const rows: NeedsClassificationInboxClaim[] = [];
    // Inbox payload first so needs_classification rows lead.
    for (const c of inboxClaims) {
      rows.push(c);
      seen.add(c.id);
    }
    for (const r of groupDetail?.rides ?? []) {
      if (seen.has(r.id)) continue;
      const sub = deriveLegSubStatus(r);
      if (!RECLASSIFY_ELIGIBLE_STATES.has(sub)) continue;
      rows.push({
        id: r.id,
        confNumber: r.confNumber ?? null,
        date: r.date ?? null,
        claimAmount: r.claimAmount ?? null,
        errorDetails: r.errorDetails ?? null,
        isBlank: !(
          typeof r.errorDetails === "string" && r.errorDetails.trim().length > 0
        ),
      } as NeedsClassificationInboxClaim);
      seen.add(r.id);
    }
    return rows;
  }, [highlightLegId, inboxClaims, groupDetail, RECLASSIFY_ELIGIBLE_STATES]);

  const displayedClaims =
    highlightLegId !== undefined ? remainingNeedsClassification : bulkVisibleClaims;

  // When everything in the inbox payload has been resolved, fire the
  // completion handler so the parent can drop its triage selection.
  // Skipped in single-leg mode: a classify there closes the modal via
  // the per-row callback, and the "auto-advance to Build Case" copy
  // doesn't fit a one-off entry point.
  useEffect(() => {
    if (highlightLegId !== undefined) return;
    if (
      inboxClaims.length > 0 &&
      remainingNeedsClassification.length === 0 &&
      groupDetail
    ) {
      onCompleted(`All claims for ${inboxGroup.invoiceNumber} resolved — moved to Build Case`);
    }
  }, [remainingNeedsClassification.length, inboxClaims.length, groupDetail, inboxGroup.invoiceNumber, onCompleted, highlightLegId]);

  async function handleBulkExcludeAll() {
    if (bulkPending) return;
    setBulkPending(true);
    // Task #411 audit, Tier 4: report a per-row breakdown instead of
    // a generic "Marked N legs as no-issue" toast. Each leg is run
    // sequentially so the audit trail stays readable AND so a
    // mid-loop failure leaves the rest of the list cleanly classified
    // as "skipped" with the actual error reason. The summary toast
    // names succeeded confs and skipped confs (with truncation) so
    // the operator can spot which legs need a follow-up.
    const succeeded: { id: string; ref: string }[] = [];
    const skipped: { id: string; ref: string; reason: string }[] = [];
    for (const c of remainingNeedsClassification) {
      const idStr = String(c.id);
      const ref = c.confNumber ? String(c.confNumber) : idStr;
      try {
        await excludeLeg.mutateAsync({
          id: c.id,
          data: { reason: "non_issue", note: "Bulk no-issue from Classification Inbox (all-blank group)" },
        });
        succeeded.push({ id: idStr, ref });
      } catch (e) {
        skipped.push({
          id: idStr,
          ref,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    invalidateAll();
    setBulkPending(false);

    if (skipped.length === 0) {
      onCompleted(`Marked ${succeeded.length} leg${succeeded.length === 1 ? "" : "s"} as no-issue`);
      return;
    }
    // Truncated list of skipped refs so the toast stays readable.
    const skippedPreview = skipped.slice(0, 5).map(s => s.ref).join(", ");
    const skippedSuffix = skipped.length > 5 ? `, +${skipped.length - 5} more` : "";
    toast({
      title: `Bulk no-issue partial: ${succeeded.length} succeeded, ${skipped.length} skipped`,
      description: `Skipped: ${skippedPreview}${skippedSuffix}. First reason: ${skipped[0].reason}`,
      variant: skipped.length === remainingNeedsClassification.length ? "destructive" : "default",
    });
  }

  // Task #796 — bulk reclassify pass. Mirrors handleBulkExcludeAll: runs
  // legs sequentially so the audit trail reads in order, captures
  // succeeded/skipped per leg, and surfaces a single summary toast on
  // partial failure. Per-leg routing matches the single-leg path —
  // excluded → /include first, classified (investigating/ready/dropped/
  // blocked) → /reclassify first, needs_classification → /classify
  // directly — so retagging works regardless of where each leg started.
  async function handleBulkReclassifyAll() {
    if (bulkPending) return;
    const et = errorTypes.find((t) => String(t.id) === bulkErrorTypeId);
    if (!et) return;
    setBulkPending(true);
    const succeeded: { id: string; ref: string }[] = [];
    const skipped: { id: string; ref: string; reason: string }[] = [];
    for (const c of bulkVisibleClaims) {
      const idStr = String(c.id);
      const ref = c.confNumber ? String(c.confNumber) : idStr;
      const live = liveClaimById.get(c.id);
      const sub = live ? deriveLegSubStatus(live) : "needs_classification";
      try {
        if (sub === "excluded") {
          await includeLeg.mutateAsync({ id: c.id, data: {} });
        } else if (
          sub === "investigating" ||
          sub === "ready" ||
          sub === "dropped" ||
          sub === "blocked"
        ) {
          await reclassifyLeg.mutateAsync({ id: c.id });
        }
        await classifyLeg.mutateAsync({
          id: c.id,
          data: { errorTypeId: String(et.id) },
        });
        succeeded.push({ id: idStr, ref });
      } catch (e) {
        skipped.push({
          id: idStr,
          ref,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    invalidateAll();
    setBulkPending(false);
    setBulkErrorTypeId("");

    if (skipped.length === 0) {
      onCompleted(
        `Reclassified ${succeeded.length} leg${succeeded.length === 1 ? "" : "s"} as "${et.name}"`,
      );
      return;
    }
    const skippedPreview = skipped.slice(0, 5).map((s) => s.ref).join(", ");
    const skippedSuffix = skipped.length > 5 ? `, +${skipped.length - 5} more` : "";
    toast({
      title: `Bulk reclassify partial: ${succeeded.length} succeeded, ${skipped.length} skipped`,
      description: `Skipped: ${skippedPreview}${skippedSuffix}. First reason: ${skipped[0].reason}`,
      variant: skipped.length === bulkVisibleClaims.length ? "destructive" : "default",
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <Inbox className="h-4 w-4" />
              {highlightLegId !== undefined ? (
                <>Classify leg in <RefNumber value={inboxGroup.invoiceNumber} variant="inline" /></>
              ) : (
                <>Triage <RefNumber value={inboxGroup.invoiceNumber} variant="inline" /></>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {highlightLegId !== undefined ? (
                <>Pick the Error Type that fits this leg.</>
              ) : inboxGroup.allBlank ? (
                <>
                  <strong>All blank descriptions.</strong> Confirm there's
                  nothing to dispute on the portal, then mark each leg
                  (or all of them) as no-issue or cannot dispute.
                </>
              ) : (
                <>
                  Classify each claim with an error description, or
                  exclude blank ones. The group auto-advances to Build
                  Case once the last needs-classification leg is resolved.
                </>
              )}
            </p>
          </div>
          {/* Compact ↗ drilldown — the inline workspace IS the detail
              workspace; the only reason to leave is to see the canonical
              full page. */}
          <Link href={`/invoice-groups/${inboxGroup.id}`}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              aria-label="Open invoice group in full view"
              title="Open invoice group in full view"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Task #412: persistent instruction banner. Shows on every
            open of the modal — both inbox-cohort and single-leg use —
            because the operator needs to verify the correct error
            type against the source of truth (dispatch / MAS portal)
            before clicking Classify. Info-tinted callout, not a
            dismissible toast, so it can't be missed. */}
        <div
          className="rounded-md border p-3 text-xs flex items-start gap-2"
          style={{
            background: "hsl(var(--cc-blue-bg))",
            borderColor: "hsl(var(--cc-blue-border))",
            color: "hsl(var(--cc-blue-fg))",
          }}
          data-testid="classify-instruction-banner"
          role="note"
        >
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            Please check your dispatch platform or the MAS portal in
            order to define what the correct error type is.
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <Label className="text-xs text-muted-foreground">Status</Label>
            <p className="font-medium">{inboxGroup.status}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Qualifying</Label>
            <p className="font-semibold">{inboxGroup.qualifyingSiblingCount}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Needs classification</Label>
            <p className="font-semibold">{remainingNeedsClassification.length}</p>
          </div>
        </div>

        {/* Task #796 — bulk-mode help note. Explains that the bulk
            controls below operate across every reclassify-eligible
            leg in the group (needs-classification, classified, and
            excluded), and that legs whose group has reached MAS /
            payout / closed phases will surface as skipped failures
            since the server-side guards forbid retagging them. */}
        {highlightLegId === undefined && bulkVisibleClaims.length > 0 && (
          <div
            className="rounded-md border bg-muted/40 p-3 text-xs flex items-start gap-2"
            data-testid="needs-review-bulk-help"
            role="note"
          >
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              Bulk actions sweep every leg shown below — including legs
              that are already classified (they'll be reclassified) or
              excluded (they'll be re-included and reclassified). Legs
              in groups past pre-submit (MAS / payout / closed) or already
              on a submission will be reported as skipped.
            </span>
          </div>
        )}

        {/* Task #796 — bulk reclassify control. Bulk mode only. Lets
            the operator pick one error type and apply it to every
            visible leg in a single pass. Per-leg routing (/include or
            /reclassify before /classify) matches the single-leg path,
            and a single summary toast surfaces partial failures. */}
        {highlightLegId === undefined && bulkVisibleClaims.length > 0 && (
          <div
            className="rounded-md border p-3 space-y-2"
            style={{
              background: "hsl(var(--cc-blue-bg))",
              borderColor: "hsl(var(--cc-blue-border))",
              color: "hsl(var(--cc-blue-fg))",
            }}
            data-testid="needs-review-bulk-reclassify"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Tag className="h-4 w-4" />
              Bulk reclassify
            </div>
            <p className="text-xs">
              Apply one error type to every leg listed below. Each leg
              is routed through the right pre-step first; failures are
              summarised in a single toast.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={bulkErrorTypeId} onValueChange={setBulkErrorTypeId}>
                <SelectTrigger
                  className="bg-white sm:flex-1"
                  data-testid="select-bulk-reclassify-error-type"
                >
                  <SelectValue placeholder="Choose error type for all legs…" />
                </SelectTrigger>
                <SelectContent>
                  {errorTypes.map((et) => (
                    <SelectItem key={et.id} value={String(et.id)}>
                      <div>
                        <span>{et.name}</span>
                        {et.category && (
                          <span className="text-muted-foreground ml-2 text-xs">({et.category})</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleBulkReclassifyAll}
                disabled={!bulkErrorTypeId || bulkPending}
                data-testid="button-bulk-reclassify"
                className="bg-white text-foreground hover:bg-white/90"
                variant="outline"
              >
                {bulkPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Applying…</>
                ) : (
                  <><Tag className="h-3.5 w-3.5 mr-1" /> Apply to all {bulkVisibleClaims.length} leg{bulkVisibleClaims.length === 1 ? "" : "s"}</>
                )}
              </Button>
            </div>
          </div>
        )}

        {inboxGroup.allBlank && remainingNeedsClassification.length > 0 && (
          <div
            className="rounded-md border p-3 space-y-2"
            style={{
              background: "hsl(var(--cc-amber-bg))",
              borderColor: "hsl(var(--cc-amber-border))",
              color: "hsl(var(--cc-amber-fg))",
            }}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              All-blank shortcut
            </div>
            <p className="text-xs">
              Every claim in this group came in without an error description.
              If you've confirmed nothing on the portal warrants a dispute,
              you can mark the whole group as no-issue in one click.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkExcludeAll}
              disabled={bulkPending}
              data-testid="needs-review-bulk-no-issue"
              className="bg-white"
            >
              {bulkPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Marking…</>
              ) : (
                <><XCircle className="h-3.5 w-3.5 mr-1" /> Mark all {remainingNeedsClassification.length} as no-issue</>
              )}
            </Button>
          </div>
        )}

        <Separator />

        <div className="space-y-3" data-testid="needs-review-claims-list">
          {displayedClaims.length === 0 ? (
            highlightLegId === undefined && remainingNeedsClassification.length === 0 && inboxClaims.length === 0 ? (
              <div className="rounded-md border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                Nothing to retag in this group.
              </div>
            ) : (
              <div className="rounded-md border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                Finishing up — group is moving to Build Case…
              </div>
            )
          ) : (
            displayedClaims.map((c) => (
              <NeedsReviewClaimRow
                key={c.id}
                claim={c}
                errorTypes={errorTypes}
                isHighlighted={highlightLegId === c.id}
                initialErrorTypeId={
                  initialErrorTypeIds?.[c.id] ??
                  liveClaimById.get(c.id)?.errorTypeId ??
                  null
                }
                isPending={
                  classifyLeg.isPending && classifyLeg.variables?.id === c.id ||
                  excludeLeg.isPending && excludeLeg.variables?.id === c.id ||
                  bulkPending
                }
                onClassify={async (errorTypeId) => {
                  const et = errorTypes.find((t) => String(t.id) === errorTypeId);
                  if (!et) return;
                  // Task #795 — single-leg entry points may be opened
                  // on a leg that is excluded or already classified.
                  // /classify only accepts `needs_classification`, so
                  // we route through /include or /reclassify first
                  // when needed. The inbox-cohort path (no
                  // highlightLegId) already filters to
                  // needs_classification rows, but we still inspect
                  // the live sub-status as a defensive guard in case
                  // a row flipped state mid-render.
                  const live = liveClaimById.get(c.id);
                  const liveSubStatus = live
                    ? deriveLegSubStatus(live)
                    : "needs_classification";
                  let preStepRan = false;
                  try {
                    if (liveSubStatus === "excluded") {
                      await includeLeg.mutateAsync({ id: c.id, data: {} });
                      preStepRan = true;
                    } else if (
                      liveSubStatus === "investigating" ||
                      liveSubStatus === "ready" ||
                      liveSubStatus === "dropped" ||
                      liveSubStatus === "blocked"
                    ) {
                      await reclassifyLeg.mutateAsync({ id: c.id });
                      preStepRan = true;
                    }
                  } catch (e) {
                    // Surface the pre-step server error verbatim so
                    // phase / submission / MAS guards stay legible to
                    // the operator (e.g. "Cannot re-include a leg
                    // after the group leaves pre-submit").
                    toast({
                      title:
                        liveSubStatus === "excluded"
                          ? "Re-include failed"
                          : "Reclassify failed",
                      description: e instanceof Error ? e.message : String(e),
                      variant: "destructive",
                    });
                    return;
                  }
                  try {
                    await classifyLeg.mutateAsync({
                      id: c.id,
                      data: { errorTypeId: String(et.id) },
                    });
                    invalidateAll();
                    onCompleted(
                      preStepRan
                        ? `Claim ${c.confNumber || `#${c.id}`} reclassified as "${et.name}"`
                        : `Claim ${c.confNumber || `#${c.id}`} classified as "${et.name}"`,
                    );
                  } catch (e) {
                    toast({
                      title: preStepRan ? "Reclassify failed" : "Classify failed",
                      description: e instanceof Error ? e.message : String(e),
                      variant: "destructive",
                    });
                  }
                }}
                onExclude={async (reason, note) => {
                  try {
                    await excludeLeg.mutateAsync({
                      id: c.id,
                      data: { reason, note: note || undefined },
                    });
                    invalidateAll();
                    onCompleted(`Claim ${c.confNumber || `#${c.id}`} marked ${reason.replace("_", " ")}`);
                  } catch (e) {
                    toast({
                      title: "Exclude failed",
                      description: e instanceof Error ? e.message : String(e),
                      variant: "destructive",
                    });
                  }
                }}
                onCreateErrorType={async (input) => {
                  const created = await createErrorType.mutateAsync({ data: input });
                  queryClient.invalidateQueries({ queryKey: getListErrorTypesQueryKey() });
                  return created;
                }}
                createPending={createErrorType.isPending}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NeedsReviewClaimRow({
  claim,
  errorTypes,
  isPending,
  isHighlighted = false,
  initialErrorTypeId = null,
  onClassify,
  onExclude,
  onCreateErrorType,
  createPending,
}: {
  claim: NeedsClassificationInboxClaim;
  errorTypes: ErrorTypeResponse[];
  isPending: boolean;
  isHighlighted?: boolean;
  initialErrorTypeId?: string | null;
  onClassify: (errorTypeId: string) => Promise<void>;
  onExclude: (reason: ExcludeLegBodyReason, note: string) => Promise<void>;
  onCreateErrorType: (input: { name: string; category: string; description: string }) => Promise<ErrorTypeResponse>;
  createPending: boolean;
}) {
  // Pre-fill from the live errorTypeId if the entry point opened the
  // panel on a leg that's already classified ("Change" affordance from
  // claim-detail-v2). Falls back to empty for the standard inbox flow.
  const [errorTypeId, setErrorTypeId] = useState<string>(
    initialErrorTypeId ? String(initialErrorTypeId) : "",
  );
  const [excludeReason, setExcludeReason] = useState<ExcludeLegBodyReason | "">("");
  const [excludeNote, setExcludeNote] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ name: "", category: "", description: "" });

  const isBlank = claim.isBlank;
  const excludeValid =
    excludeReason !== "" && (excludeReason !== "other" || excludeNote.trim().length > 0);

  const handleCreateAndSelect = async () => {
    if (!draft.name.trim()) return;
    const created = await onCreateErrorType(draft);
    setErrorTypeId(String(created.id));
    setShowCreate(false);
    setDraft({ name: "", category: "", description: "" });
  };

  return (
    <div
      className={`rounded-md border bg-card p-3 space-y-3 ${
        isHighlighted ? "ring-2 ring-primary border-primary" : ""
      }`}
      data-testid={`needs-review-claim-${claim.id}`}
      data-highlighted={isHighlighted ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="font-mono font-semibold">
            {claim.confNumber || `#${claim.id}`}
          </span>
          <span className="text-muted-foreground text-xs">
            {claim.date ? formatDate(claim.date) : "—"}
          </span>
          <span className="tabular-nums text-xs">
            {formatCurrency(claim.claimAmount ?? "0")}
          </span>
          {isBlank && (
            <Badge
              variant="outline"
              className="text-[10px]"
              style={{
                background: "hsl(var(--cc-amber-bg))",
                color: "hsl(var(--cc-amber-fg))",
                borderColor: "hsl(var(--cc-amber-border))",
              }}
            >
              Blank
            </Badge>
          )}
        </div>
      </div>

      {claim.errorDetails && (
        <div className="rounded bg-muted/40 p-2 text-xs">
          <span className="font-medium">Error details:</span> {claim.errorDetails}
        </div>
      )}
      {!claim.errorDetails && (
        <div className="rounded bg-muted/30 p-2 text-xs italic text-muted-foreground">
          No error description on file — verify on the portal before classifying.
        </div>
      )}

      {!isBlank && (
        <div className="space-y-2">
          {!showCreate ? (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={errorTypeId} onValueChange={setErrorTypeId}>
                  <SelectTrigger
                    className="bg-white sm:flex-1"
                    data-testid={`select-claim-error-type-${claim.id}`}
                  >
                    <SelectValue placeholder="Choose error type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {errorTypes.map((et) => (
                      <SelectItem key={et.id} value={String(et.id)}>
                        <div>
                          <span>{et.name}</span>
                          {et.category && (
                            <span className="text-muted-foreground ml-2 text-xs">({et.category})</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={() => onClassify(errorTypeId)}
                  disabled={!errorTypeId || isPending}
                  data-testid={`button-classify-claim-${claim.id}`}
                >
                  {isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving…</>
                  ) : (
                    <><Tag className="h-3.5 w-3.5 mr-1" /> Classify</>
                  )}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setShowCreate(true)}
                data-testid={`button-new-error-type-${claim.id}`}
              >
                <Plus className="h-3 w-3 mr-1" /> Create new error type
              </Button>
            </>
          ) : (
            <div className="space-y-2 rounded-md border bg-muted/20 p-2">
              <div>
                <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Duplicate Charge"
                  className="mt-1 bg-white h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <Input
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  placeholder="e.g. Billing"
                  className="mt-1 bg-white h-8"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleCreateAndSelect}
                  disabled={!draft.name.trim() || createPending}
                  className="flex-1"
                >
                  {createPending ? "Creating…" : "Create & select"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Separator />

      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <Select
            value={excludeReason}
            onValueChange={(v) => setExcludeReason(v as ExcludeLegBodyReason)}
          >
            <SelectTrigger
              className="bg-white sm:flex-1"
              data-testid={`select-exclude-reason-${claim.id}`}
            >
              <SelectValue placeholder={isBlank ? "Mark as…" : "Or exclude with reason…"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="non_issue">No issue (nothing to dispute)</SelectItem>
              <SelectItem value="cannot_dispute">Cannot dispute</SelectItem>
              <SelectItem value="clean_leg">Clean leg</SelectItem>
              <SelectItem value="out_of_scope">Out of scope</SelectItem>
              <SelectItem value="duplicate">Duplicate</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => excludeReason && onExclude(excludeReason, excludeNote)}
            disabled={!excludeValid || isPending}
            data-testid={`button-exclude-claim-${claim.id}`}
          >
            {isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving…</>
            ) : (
              <><XCircle className="h-3.5 w-3.5 mr-1" /> Exclude</>
            )}
          </Button>
        </div>
        {excludeReason === "other" && (
          <Textarea
            value={excludeNote}
            onChange={(e) => setExcludeNote(e.target.value)}
            placeholder="Note required for ‘other’"
            rows={2}
            className="text-xs"
            data-testid={`exclude-note-${claim.id}`}
          />
        )}
      </div>
    </div>
  );
}
