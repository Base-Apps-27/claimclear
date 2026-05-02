import { useEffect, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { CheckCircle2, RotateCcw, ExternalLink, Loader2, X } from "lucide-react";
import { TONE_STYLE, type Tone } from "@/components/cohesion/tone";
import {
  useUpdateClaimClosureReview,
  useUpdateInvoiceGroupClosureReview,
  getListWithdrawalsQueryKey,
} from "@workspace/api-client-react";
import type { WithdrawalRow } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate } from "@/lib/format";
// Pulled from @workspace/vocab so this drawer reads the same as
// every other surface that mentions a closure reason.
import { closureReasonLabel } from "@workspace/vocab";

const REASON_TONE: Record<string, Tone> = {
  cannot_dispute: "amber",
  non_issue: "blue",
  denied_by_payor: "red",
};

interface Props {
  row: WithdrawalRow | null;
  onClose: () => void;
}

export function WithdrawalReviewDrawer({ row, onClose }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [communicatedTo, setCommunicatedTo] = useState("");
  // Bumps on a successful notes-only save so the "Save notes" button
  // breathes instead of firing a generic toast. Status-changing
  // saves (Mark addressed / Reopen) keep their loud toasts below.
  const [notesSaveTick, setNotesSaveTick] = useState(0);

  useEffect(() => {
    if (row) {
      setNotes(row.closureReviewNotes ?? "");
      setCommunicatedTo(row.closureCommunicatedTo ?? "");
    }
  }, [row]);

  const updateClaim = useUpdateClaimClosureReview();
  const updateGroup = useUpdateInvoiceGroupClosureReview();

  if (!row) {
    return (
      <Sheet open={false} onOpenChange={onClose}>
        <SheetContent />
      </Sheet>
    );
  }

  const tone = REASON_TONE[row.closureReason] ?? "muted";
  const accentColor = TONE_STYLE[tone].fg;
  const accentBg = TONE_STYLE[tone].bg;
  const isPending = updateClaim.isPending || updateGroup.isPending;
  const isAddressed = row.addressed;

  const persist = async (overrides: { addressed?: boolean } = {}) => {
    const data = {
      closureReviewNotes: notes,
      closureCommunicatedTo: communicatedTo,
      ...(overrides.addressed !== undefined ? { addressed: overrides.addressed } : {}),
    };
    try {
      if (row.kind === "claim") {
        await updateClaim.mutateAsync({ id: row.id, data });
      } else {
        await updateGroup.mutateAsync({ id: row.id, data });
      }
      queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
      if (overrides.addressed === true) {
        toast({ title: "Marked addressed" });
      } else if (overrides.addressed === false) {
        toast({ title: "Reopened for review" });
      } else {
        // Routine notes-only save — quiet breath on the button, no toast.
        setNotesSaveTick((n) => n + 1);
      }
      if (overrides.addressed !== undefined) onClose();
    } catch {
      toast({
        title: "Save failed",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const detailHref = row.kind === "claim" ? `/claims/${row.id}` : `/invoice-groups/${row.id}`;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col overflow-hidden gap-0"
        data-testid="withdrawals-review-drawer"
      >
        <div className="h-[3px] flex-shrink-0" style={{ background: accentColor }} aria-hidden="true" />

        <div className="px-6 py-4 border-b flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge
                style={{ background: accentBg, color: accentColor, borderColor: accentColor }}
                className="border text-[10px] uppercase tracking-wide font-bold"
              >
                {closureReasonLabel(row.closureReason)}
              </Badge>
              <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                {row.kind === "claim" ? "Claim" : "Invoice Group"}
              </span>
              {isAddressed && (
                <Badge className="bg-green-100 text-green-800 border border-green-300 text-[10px] uppercase tracking-wide font-bold">
                  Addressed
                </Badge>
              )}
            </div>
            <h2 className="text-lg font-bold tracking-tight truncate" title={row.identifier}>
              {row.identifier}
            </h2>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {row.amount && <span className="font-medium tabular-nums">{formatCurrency(row.amount)}</span>}
              {row.closedAt && <><span>·</span><span>Closed {formatDate(row.closedAt)}</span></>}
              {row.errorTypeName && <><span>·</span><span>{row.errorTypeName}</span></>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {row.errorDetails && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Error description
              </h3>
              <p className="text-sm whitespace-pre-wrap">{row.errorDetails}</p>
            </section>
          )}

          {(row.closureCategory || row.closureRootCause) && (
            <section className="grid grid-cols-2 gap-4">
              {row.closureCategory && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Category</h3>
                  <p className="text-sm">{row.closureCategory}</p>
                </div>
              )}
              {row.closureRootCause && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Root cause</h3>
                  <p className="text-sm">{row.closureRootCause}</p>
                </div>
              )}
            </section>
          )}

          {row.closureNarrative && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Closure narrative
              </h3>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground italic">
                {row.closureNarrative}
              </p>
            </section>
          )}

          {row.closureAccountabilityTags && row.closureAccountabilityTags.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Accountability
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {row.closureAccountabilityTags.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-1.5">
            <Label htmlFor="wd-communicated-to" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Communicated to
            </Label>
            <Input
              id="wd-communicated-to"
              data-testid="input-communicated-to"
              placeholder="Who was told? (e.g. driver, dispatcher, member services)"
              value={communicatedTo}
              onChange={(e) => setCommunicatedTo(e.target.value)}
              maxLength={500}
            />
          </section>

          <section className="space-y-1.5">
            <Label htmlFor="wd-review-notes" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Review notes / lessons learned
            </Label>
            <Textarea
              id="wd-review-notes"
              data-testid="input-review-notes"
              placeholder="What did we learn? What will we do differently next time?"
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
            <p className="text-[10px] text-muted-foreground text-right">{notes.length}/2000</p>
          </section>

          {(row.closureAddressedAt || row.closureAddressedBy) && (
            <section className="rounded-md bg-green-50 border border-green-200 p-3 text-xs text-green-900">
              <div className="font-semibold mb-0.5">Addressed</div>
              <div>
                {row.closureAddressedBy ?? "—"}
                {row.closureAddressedAt && <> · {formatDate(row.closureAddressedAt)}</>}
              </div>
            </section>
          )}
        </div>

        <div className="border-t px-6 py-3 flex items-center justify-between gap-2 flex-wrap">
          <Link
            href={detailHref}
            className="text-xs font-medium inline-flex items-center gap-1 hover:underline"
            style={{ color: accentColor }}
            data-testid="link-open-detail"
          >
            Open {row.kind === "claim" ? "claim" : "group"} detail <ExternalLink className="h-3 w-3" />
          </Link>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => persist()}
              disabled={isPending}
              breathTrigger={notesSaveTick}
              data-testid="button-save-notes"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Save notes
            </Button>
            {isAddressed ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => persist({ addressed: false })}
                disabled={isPending}
                data-testid="button-reopen"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Reopen
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => persist({ addressed: true })}
                disabled={isPending}
                className="bg-green-600 hover:bg-green-700"
                data-testid="button-mark-addressed"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Mark addressed
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
