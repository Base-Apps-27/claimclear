import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListErrorTypes,
  useClassifyLeg,
  useExcludeLeg,
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
  ChevronRight,
  Tag,
  Loader2,
  Plus,
  XCircle,
  Inbox,
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
}

export function QueueNeedsReviewPanel({ inboxGroup, onCompleted }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: groupDetail } = useGetInvoiceGroup(inboxGroup.id, {
    query: { queryKey: getGetInvoiceGroupQueryKey(inboxGroup.id), enabled: !!inboxGroup.id },
  });
  const { data: errorTypesData } = useListErrorTypes();
  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];

  const classifyLeg = useClassifyLeg();
  const excludeLeg = useExcludeLeg();
  const createErrorType = useCreateErrorType();

  // Bulk-mode toggle for allBlank groups: when on, a single click marks
  // every needs_classification leg as `non_issue`. Disabled while any
  // mutation is in flight to avoid double-firing on impatient clicks.
  const [bulkPending, setBulkPending] = useState(false);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(inboxGroup.id) });
    // The inbox endpoint is keyed off the back-compat query key.
    queryClient.invalidateQueries({ queryKey: ["needs-classification-inbox"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-groups"] });
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
      const live = liveClaimById.get(c.id);
      if (!live) return true;
      return deriveLegSubStatus(live) === "needs_classification";
    });
  }, [inboxClaims, liveClaimById]);

  // When everything in the inbox payload has been resolved, fire the
  // completion handler so the parent can drop its triage selection.
  useEffect(() => {
    if (
      inboxClaims.length > 0 &&
      remainingNeedsClassification.length === 0 &&
      groupDetail
    ) {
      onCompleted(`All claims for ${inboxGroup.invoiceNumber} resolved — moved to Build Case`);
    }
  }, [remainingNeedsClassification.length, inboxClaims.length, groupDetail, inboxGroup.invoiceNumber, onCompleted]);

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <Inbox className="h-4 w-4" />
              Triage {inboxGroup.invoiceNumber}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {inboxGroup.allBlank ? (
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
          <Link href={`/invoice-groups/${inboxGroup.id}`}>
            <Button variant="ghost" size="sm">
              Full Details <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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
          {remainingNeedsClassification.length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
              Finishing up — group is moving to Build Case…
            </div>
          ) : (
            remainingNeedsClassification.map((c) => (
              <NeedsReviewClaimRow
                key={c.id}
                claim={c}
                errorTypes={errorTypes}
                isPending={
                  classifyLeg.isPending && classifyLeg.variables?.id === c.id ||
                  excludeLeg.isPending && excludeLeg.variables?.id === c.id ||
                  bulkPending
                }
                onClassify={async (errorTypeId) => {
                  const et = errorTypes.find((t) => String(t.id) === errorTypeId);
                  if (!et) return;
                  try {
                    await classifyLeg.mutateAsync({
                      id: c.id,
                      data: { errorTypeId: String(et.id) },
                    });
                    invalidateAll();
                    onCompleted(`Claim ${c.confNumber || `#${c.id}`} classified as "${et.name}"`);
                  } catch (e) {
                    toast({
                      title: "Classify failed",
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
  onClassify,
  onExclude,
  onCreateErrorType,
  createPending,
}: {
  claim: NeedsClassificationInboxClaim;
  errorTypes: ErrorTypeResponse[];
  isPending: boolean;
  onClassify: (errorTypeId: string) => Promise<void>;
  onExclude: (reason: ExcludeLegBodyReason, note: string) => Promise<void>;
  onCreateErrorType: (input: { name: string; category: string; description: string }) => Promise<ErrorTypeResponse>;
  createPending: boolean;
}) {
  const [errorTypeId, setErrorTypeId] = useState("");
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
      className="rounded-md border bg-card p-3 space-y-3"
      data-testid={`needs-review-claim-${claim.id}`}
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
