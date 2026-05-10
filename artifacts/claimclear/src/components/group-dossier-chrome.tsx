import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Layers,
  PauseCircle,
  PlayCircle,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  useHoldInvoiceGroup,
  useRemoveInvoiceGroupHold,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import { TONE_STYLE } from "@/components/cohesion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CloseAsNonIssueDialog } from "@/components/close-as-non-issue-dialog";
import { ClosureIntakeDialog } from "@/components/closure/closure-intake-dialog";
import { useToast, successToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";

interface Detail {
  status?: string | null;
  closureReason?: string | null;
  disputeEmailSentAt?: string | null;
  previewGeneratedAt?: string | null;
  draftReviewedAt?: string | null;
}

export function GroupDossierChrome({
  groupId,
  detail,
  fromManual,
}: {
  groupId: number;
  detail: Detail | null | undefined;
  fromManual: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const holdMutation = useHoldInvoiceGroup();
  const removeHoldMutation = useRemoveInvoiceGroupHold();

  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [closeNonIssueOpen, setCloseNonIssueOpen] = useState(false);

  const status = detail?.status ?? "";
  const onHold = status === "On Hold";
  const isClosed =
    status === "Resolved" || status === "Denied" || !!detail?.closureReason;

  function invalidateGroup() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
    });
    qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  }

  function onPlaceHold() {
    const reason = holdReason.trim();
    if (!reason) return;
    holdMutation.mutate(
      { id: groupId, data: { reason } },
      {
        onSuccess: () => {
          invalidateGroup();
          successToast({ title: "__VERB__", description: "Group placed on hold." });
          setHoldOpen(false);
          setHoldReason("");
        },
        onError: (err: unknown) =>
          toast({
            title: "Failed to place on hold",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          }),
      },
    );
  }

  function onClearHold() {
    removeHoldMutation.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          invalidateGroup();
          successToast({ title: "__VERB__", description: "Hold cleared." });
        },
        onError: (err: unknown) =>
          toast({
            title: "Failed to clear hold",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <>
      {fromManual && (
        <div
          className="rounded-md border px-4 py-3 flex items-start gap-3 mx-auto max-w-6xl mt-6"
          style={{
            background: TONE_STYLE.purple.bg,
            borderColor: TONE_STYLE.purple.border,
            color: TONE_STYLE.purple.fg,
          }}
          data-testid="banner-from-manual"
        >
          <Sparkles className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            Invoice saved. Pick an error type for each leg below to start triage,
            then walk the SOP and queue the dispute.
          </div>
        </div>
      )}

      <div
        className="cc-scope mx-auto max-w-6xl px-6 pt-6 space-y-3"
        style={{ background: "var(--cc-bg)", color: "var(--cc-fg)" }}
      >
        <div
          className="cc-card p-4"
          data-testid="group-detail-submission-summary-readonly"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div
                className="text-xs uppercase tracking-wide font-semibold mb-1"
                style={{ color: "var(--cc-muted-fg)" }}
              >
                Submission summary
              </div>
              <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                Read-only snapshot of where this group is in the submission
                pipeline. All operator actions live in the queue.
              </div>
            </div>
            <span
              className="text-[11px] px-2 py-0.5 rounded font-medium"
              style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}
              data-testid="group-detail-submission-summary-status"
            >
              {status || "—"}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 text-xs">
            <SummaryStat
              label="Preview generated"
              value={detail?.previewGeneratedAt ?? null}
              testId="group-detail-summary-preview-at"
            />
            <SummaryStat
              label="Draft reviewed"
              value={detail?.draftReviewedAt ?? null}
              testId="group-detail-summary-reviewed-at"
            />
            <SummaryStat
              label="Last submitted"
              value={detail?.disputeEmailSentAt ?? null}
              testId="group-detail-summary-submitted-at"
            />
          </div>
        </div>

        <Link
          href={`/queue?group=${groupId}`}
          data-testid="group-detail-cta-process-in-queue"
          className="cc-card p-4 flex items-center justify-between gap-3 hover:opacity-90 transition-opacity"
          style={{ border: "1px solid var(--cc-border)", color: "var(--cc-fg)" }}
        >
          <div className="flex items-start gap-3">
            <FileText className="w-4 h-4 mt-0.5" style={{ color: "var(--cc-purple-fg)" }} />
            <div>
              <div className="text-sm font-medium">Process this invoice in the queue</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>
                Open this group in the queue to triage legs, generate the dispute
                preview, review the draft, and send.
              </div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 flex-shrink-0" />
        </Link>

        <div className="cc-card p-3" data-testid="group-detail-overrides-card">
          <div
            className="text-[11px] uppercase tracking-wide font-semibold mb-2"
            style={{ color: "var(--cc-muted-fg)" }}
          >
            Overrides
          </div>
          <div className="flex flex-wrap gap-2">
            {onHold ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onClearHold}
                disabled={removeHoldMutation.isPending}
                data-testid="group-detail-action-release-group-hold"
              >
                <PlayCircle className="w-3.5 h-3.5 mr-1.5" />
                Release hold
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setHoldOpen(true)}
                disabled={isClosed || holdMutation.isPending}
                data-testid="group-detail-action-place-group-hold"
              >
                <PauseCircle className="w-3.5 h-3.5 mr-1.5" />
                Place on hold
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setWithdrawOpen(true)}
              data-testid="group-detail-action-withdraw-group"
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" />
              Withdraw
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCloseNonIssueOpen(true)}
              data-testid="group-detail-action-close-as-non-issue"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Close as non-issue
            </Button>
            <Button
              size="sm"
              variant="outline"
              asChild
              data-testid="group-detail-action-reclassify-group"
            >
              <a href="#group-detail-section-legs">
                <Layers className="w-3.5 h-3.5 mr-1.5" />
                Reclassify legs
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              asChild
              data-testid="group-detail-action-mark-duplicate"
            >
              <a href="#group-detail-section-legs">
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                Mark duplicates
              </a>
            </Button>
          </div>
        </div>
      </div>

      <div id="group-detail-section-legs" data-testid="group-detail-section-legs" aria-hidden="true" />
      <div id="group-detail-section-evidence" data-testid="group-detail-section-evidence" aria-hidden="true" />
      <div id="group-detail-section-activity" data-testid="group-detail-section-activity" aria-hidden="true" />

      <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
        <DialogContent className="max-w-md" data-testid="group-detail-hold-dialog">
          <DialogHeader>
            <DialogTitle>Place group on hold</DialogTitle>
            <DialogDescription>
              The group will be removed from operator queues until the hold is
              cleared. The reason is recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="group-hold-reason" className="text-xs">Reason</Label>
            <Textarea
              id="group-hold-reason"
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              placeholder="Why is this group going on hold?"
              rows={3}
              data-testid="group-detail-hold-reason-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldOpen(false)} disabled={holdMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={onPlaceHold}
              disabled={!holdReason.trim() || holdMutation.isPending}
              data-testid="group-detail-hold-confirm-button"
            >
              {holdMutation.isPending ? "Placing…" : "Place on hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {withdrawOpen ? (
        <ClosureIntakeDialog
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          target={{ kind: "group", id: groupId }}
          reason="cannot_dispute"
          onSuccess={invalidateGroup}
        />
      ) : null}

      <CloseAsNonIssueDialog
        open={closeNonIssueOpen}
        onOpenChange={setCloseNonIssueOpen}
        groupId={groupId}
        onSuccess={invalidateGroup}
      />
    </>
  );
}

function SummaryStat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  testId: string;
}) {
  const done = !!value;
  return (
    <div data-testid={testId}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--cc-muted-fg)" }}>
        {label}
      </div>
      <div className="text-xs mt-0.5 flex items-center gap-1.5">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide"
          style={
            done
              ? { background: "var(--cc-success-bg, rgba(34,197,94,0.15))", color: "var(--cc-success, #16a34a)" }
              : { background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }
          }
          data-testid={`${testId}-state`}
        >
          {done ? "Yes" : "No"}
        </span>
        {done ? (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" style={{ color: "var(--cc-muted-fg)" }} />
            {formatDateTime(value!)}
          </span>
        ) : (
          <span style={{ color: "var(--cc-muted-fg)" }}>not yet</span>
        )}
      </div>
    </div>
  );
}
