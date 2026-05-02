import { useEffect, useMemo, useState } from "react";
import {
  useCompleteGroupReattest,
  useQueueAttestationForClaim,
  useMarkAwaitingPayorAgain,
} from "@workspace/api-client-react";
import type { ClaimResponse, InvoiceGroupResponse } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ShieldCheck,
  Inbox,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import {
  buildReattestChecklist,
  renderChecklistAsText,
  type ReattestInstructionItem,
} from "./reattest-instruction-template";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: InvoiceGroupResponse;
  /** Approved-verdict legs that still need re-attestation in the portal. */
  approvedLegs: readonly ClaimResponse[];
  /** Denied-verdict legs — drive the per-affected-invoice MAS checklist line. */
  deniedLegs: readonly ClaimResponse[];
  /**
   * Step 4 commit (Task #343). Promotes every per-leg `operator_draft`
   * on the group to `operator_confirmed` in one transaction, *before*
   * either path fires its downstream action.
   */
  promoteDrafts: () => Promise<void>;
  /** Run after either path's submit succeeds. */
  onAfterAction: (message: string) => void;
}

/**
 * The "Re-attest" modal launched from the Step-4 card.
 *
 * Three sub-views, governed by a local `mode` state:
 *
 *   1. **`pick`** — the landing screen. Two large buttons asking the
 *      operator the only real question this modal exists to answer:
 *      "Are you doing it now, or queuing it for someone else?"
 *
 *   2. **`now`** — the interactive checklist. The "I'm done" button is
 *      disabled until every box is ticked. On submit:
 *        `POST /invoice-groups/:id/complete-reattest` (group-level
 *        stamp) followed by `POST /invoice-groups/:id/awaiting-payor-again`
 *        so the row drops off the page.
 *
 *   3. **`queue`** — read-only preview of the same instructions plus an
 *      editable note. The Queue button opens an AlertDialog
 *      double-confirm before fanning out
 *      `POST /claims/:id/attestation/queue` for each approved leg's
 *      claim with the rendered instruction text in the body.
 *
 * Both `now` and `queue` views render a back chevron in the header so
 * the operator can return to `pick` if they tapped the wrong button.
 */
export function ReattestModal({
  open,
  onOpenChange,
  group,
  approvedLegs,
  deniedLegs,
  promoteDrafts,
  onAfterAction,
}: Props) {
  const { toast } = useToast();
  const completeReattest = useCompleteGroupReattest();
  const queueAttestation = useQueueAttestationForClaim();
  const markWaiting = useMarkAwaitingPayorAgain();

  const checklist = useMemo<ReattestInstructionItem[]>(
    () => buildReattestChecklist(deniedLegs, group.invoiceNumber),
    [deniedLegs, group.invoiceNumber],
  );
  const renderedChecklistText = useMemo(
    () => renderChecklistAsText(checklist),
    [checklist],
  );

  const [mode, setMode] = useState<"pick" | "now" | "queue">("pick");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reattestNote, setReattestNote] = useState("");
  const [queueNote, setQueueNote] = useState("");
  const [confirmQueueOpen, setConfirmQueueOpen] = useState(false);

  // Reset to the picker every time the modal is reopened so the operator
  // always lands on the question, never on a stale sub-view.
  useEffect(() => {
    if (open) {
      setMode("pick");
      setChecked({});
      setReattestNote("");
      setQueueNote("");
      setConfirmQueueOpen(false);
    }
  }, [open]);

  const allChecked =
    checklist.length > 0 && checklist.every((it) => checked[it.id] === true);

  const close = () => onOpenChange(false);

  // Local pending flag covers the promoteDrafts() pre-step too, since
  // it runs ahead of the existing mutation hooks and isn't reflected
  // in any of their `.isPending` flags.
  const [promoting, setPromoting] = useState(false);
  const busy =
    promoting ||
    completeReattest.isPending ||
    queueAttestation.isPending ||
    markWaiting.isPending;

  const handleReattestNow = async () => {
    if (!allChecked) return;
    setPromoting(true);
    try {
      // Step 4 commit: promote every per-leg draft to
      // `operator_confirmed` atomically before stamping the re-attest.
      await promoteDrafts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not commit selections.";
      toast({
        title: "Couldn't save selections",
        description: msg,
        variant: "destructive",
      });
      setPromoting(false);
      return;
    }
    setPromoting(false);
    try {
      await completeReattest.mutateAsync({
        id: group.id,
        data: { note: reattestNote.trim() || undefined },
      });
      // Drop the row off Responses Awaiting Review while the re-attest
      // propagates back to the payor.
      await markWaiting.mutateAsync({ id: group.id, data: {} });
      onAfterAction("Re-attest recorded — group is awaiting payor again.");
      close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not record.";
      toast({
        title: "Re-attest failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const handleQueueForAttestation = async () => {
    if (approvedLegs.length === 0) return;
    const trimmed = queueNote.trim();
    const fullNote = trimmed
      ? `${renderedChecklistText}\n\n— ${trimmed}`
      : renderedChecklistText;
    setPromoting(true);
    try {
      await promoteDrafts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not commit selections.";
      toast({
        title: "Couldn't save selections",
        description: msg,
        variant: "destructive",
      });
      setPromoting(false);
      return;
    }
    setPromoting(false);
    try {
      for (const leg of approvedLegs) {
        await queueAttestation.mutateAsync({
          id: leg.id,
          data: { note: fullNote },
        });
      }
      onAfterAction(
        `Queued ${approvedLegs.length} leg${approvedLegs.length === 1 ? "" : "s"} for re-attestation.`,
      );
      close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not queue.";
      toast({
        title: "Queue failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const headerTitle = (() => {
    if (mode === "now") return "Re-attest now";
    if (mode === "queue") return "Queue for re-attest later";
    return "Re-attest in the payor portal";
  })();

  const headerDescription = (() => {
    if (mode === "now") {
      return "Walk through each portal step. The 'I'm done' button unlocks once every box is checked.";
    }
    if (mode === "queue") {
      return `Park this for someone with portal access. ${approvedLegs.length} leg${approvedLegs.length === 1 ? "" : "s"} will be added to the Attestation Queue with the walkthrough below.`;
    }
    return `The payor approved ${approvedLegs.length === 1 ? "1 leg" : `${approvedLegs.length} legs`}. Pick how you want to handle the re-attestation.`;
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        data-testid="whats-next-reattest-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode !== "pick" && (
              <button
                type="button"
                onClick={() => setMode("pick")}
                disabled={busy}
                className="inline-flex items-center justify-center rounded-md p-1 hover:bg-muted disabled:opacity-50"
                aria-label="Back to options"
                data-testid="reattest-back-to-pick"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <span>{headerTitle}</span>
          </DialogTitle>
          <DialogDescription>{headerDescription}</DialogDescription>
        </DialogHeader>

        {/* ── Mode 1: Pick a path ──────────────────────────────── */}
        {mode === "pick" && (
          <div className="space-y-3 pt-2" data-testid="reattest-mode-pick">
            <PickButton
              icon={<ShieldCheck className="h-5 w-5" />}
              title="I'm re-attesting now"
              subtitle="Walk through the portal steps with a guided checklist."
              onClick={() => setMode("now")}
              testId="reattest-pick-now"
            />
            <PickButton
              icon={<Inbox className="h-5 w-5" />}
              title="Queue for re-attest later"
              subtitle={`Park this for someone with portal access. ${approvedLegs.length} leg${approvedLegs.length === 1 ? "" : "s"} will land on the Attestation Queue.`}
              onClick={() => setMode("queue")}
              disabled={approvedLegs.length === 0}
              testId="reattest-pick-queue"
            />
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={close}
                data-testid="reattest-cancel-pick"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* ── Mode 2: Re-attest now (checklist) ─────────────────── */}
        {mode === "now" && (
          <div className="space-y-4 pt-2" data-testid="reattest-mode-now">
            <ul className="space-y-2" data-testid="reattest-checklist">
              {checklist.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                  data-testid={`reattest-checklist-item-${item.id}`}
                >
                  <Checkbox
                    id={`chk-${item.id}`}
                    checked={!!checked[item.id]}
                    onCheckedChange={(v) =>
                      setChecked((prev) => ({ ...prev, [item.id]: v === true }))
                    }
                    className="mt-0.5"
                    data-testid={`reattest-checklist-checkbox-${item.id}`}
                  />
                  <Label
                    htmlFor={`chk-${item.id}`}
                    className="text-sm font-normal leading-snug cursor-pointer"
                  >
                    {item.text}
                  </Label>
                </li>
              ))}
            </ul>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Note (optional)</Label>
              <Textarea
                value={reattestNote}
                onChange={(e) => setReattestNote(e.target.value)}
                placeholder="Portal reference number, screenshot location, etc."
                className="text-sm"
                rows={2}
                data-testid="reattest-note"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={close}
                disabled={busy}
                data-testid="reattest-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleReattestNow}
                disabled={!allChecked || busy}
                data-testid="reattest-confirm-done"
              >
                {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                I'm done — record it
              </Button>
            </div>
          </div>
        )}

        {/* ── Mode 3: Queue for later (with double confirm) ─────── */}
        {mode === "queue" && (
          <div className="space-y-4 pt-2" data-testid="reattest-mode-queue">
            <div
              className="rounded-md border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap"
              data-testid="reattest-checklist-preview"
            >
              {renderedChecklistText}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Add a note (optional)</Label>
              <Textarea
                value={queueNote}
                onChange={(e) => setQueueNote(e.target.value)}
                placeholder="Anything specific the portal user needs to know — appended to the instructions above."
                className="text-sm"
                rows={3}
                data-testid="reattest-queue-note"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={close}
                disabled={busy}
                data-testid="reattest-queue-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => setConfirmQueueOpen(true)}
                disabled={busy || approvedLegs.length === 0}
                data-testid="reattest-queue-confirm"
              >
                {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Queue for attestation
              </Button>
            </div>
          </div>
        )}

        {/* Double-confirm for the queue path. Critical because once the
            fan-out lands, the rows are on someone else's queue and
            "undo" requires a teammate's coordination. */}
        <AlertDialog
          open={confirmQueueOpen}
          onOpenChange={setConfirmQueueOpen}
        >
          <AlertDialogContent data-testid="reattest-queue-confirm-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Send {approvedLegs.length} leg
                {approvedLegs.length === 1 ? "" : "s"} to the Attestation Queue?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Once queued, the walkthrough above lands on the Attestation
                Queue page for someone with portal access to pick up. You
                can't undo this from here — it has to be cleared from the
                queue.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={busy}
                data-testid="reattest-queue-confirm-cancel"
              >
                Go back
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={async (e) => {
                  e.preventDefault();
                  setConfirmQueueOpen(false);
                  await handleQueueForAttestation();
                }}
                data-testid="reattest-queue-confirm-send"
              >
                {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Yes, send to queue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The two large landing-screen buttons. Visually heavier than a normal
 * shadcn Button so they read as "make a decision" — full-width card with
 * a leading icon disc and a chevron at the trailing edge.
 */
function PickButton({
  icon,
  title,
  subtitle,
  onClick,
  disabled,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 rounded-lg border-2 border-border bg-card px-4 py-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-card"
      data-testid={testId}
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground leading-snug">
          {subtitle}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
    </button>
  );
}
