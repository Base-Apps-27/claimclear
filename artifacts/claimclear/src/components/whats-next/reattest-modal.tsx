import { useEffect, useMemo, useState } from "react";
import {
  useCompleteGroupReattest,
  useBulkQueueGroupReattest,
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
import { Input } from "@/components/ui/input";
import {
  ShieldCheck,
  Inbox,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Edit3,
  FileText,
} from "lucide-react";
import {
  isOfflineReattestNoteValid,
  canSubmitOfflineReattest,
  buildOfflineReattestPayload,
} from "@/lib/reattest-offline-modal-helpers";
import {
  buildReattestChecklist,
  renderChecklistAsText,
  type ReattestInstructionItem,
} from "./reattest-instruction-template";
import { useToast } from "@/hooks/use-toast";
import { notifyClaimProcessedThisSession } from "@/hooks/use-session-milestones";

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
  /**
   * Admin-only: gates the "I already attested this offline" pick option.
   * Server enforces admin too (POST .../reattest/complete with
   * `recordedOffline=true` is admin-gated in mas-reattest-offline.test.ts);
   * the UI just hides the option for non-admins so they don't see a
   * pick they can't use.
   */
  canRecordOffline?: boolean;
  /**
   * Task #455 — when the inbound-email classifier extracted a
   * `newInvoiceNumber` from a payor reply, the parent passes it (plus
   * the sourceResponseId of the reply that cited it) so the modal can
   * surface a prominent "rename invoice #" step pre-filled with the
   * suggestion. The modal carries the confirmed value through every
   * sub-mode's submit and the backend renames atomically with the
   * re-attest stamp + draft promotion.
   */
  suggestedNewInvoiceNumber?: string | null;
  suggestedNewInvoiceNumberSourceResponseId?: number | null;
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
 *        `POST /invoice-groups/:id/reattest/complete` (group-level
 *        stamp). That endpoint closes the group via Task #543's
 *        Resolved/Approved transition, so the row drops off Responses
 *        Awaiting Review without a separate awaiting-payor-again call.
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
  canRecordOffline = false,
  suggestedNewInvoiceNumber = null,
  suggestedNewInvoiceNumberSourceResponseId = null,
}: Props) {
  const { toast } = useToast();
  const completeReattest = useCompleteGroupReattest();
  // Group-level atomic queue. Replaced the per-leg
  // `useQueueAttestationForClaim` fan-out the modal used to do — that
  // loop tripped on the Task #196 attestation gate when the group's
  // MAS re-attest hadn't been stamped yet (legs sat at not_required,
  // /attest/queue requires source state = pending). The new endpoint
  // also stamps awaiting_payor_again_at in the same transaction, so
  // we no longer need a separate markWaiting call on the queue path.
  const bulkQueueReattest = useBulkQueueGroupReattest();
  // 2026-05-14 — there used to be a `useMarkAwaitingPayorAgain()` hook
  // here that was called after `complete-reattest` on the `now` and
  // `offline` paths to "drop the row off Responses Awaiting Review."
  // Task #543 made `complete-reattest` route through
  // `transitionGroupStatusAndOutcome({newStatus: "Resolved", newOutcome:
  // "Approved"})`, which closes the group and flips its macro phase to
  // `awaiting-payout`/`closed` — at which point the group is no longer
  // on Responses Awaiting Review at all, so the markWaiting follow-up
  // is dead code. Worse, it 409s ("Group can only be flipped back to
  // awaiting-payor-again while it is awaiting review (response-pending)")
  // because its source-state guard now rejects the post-close phase,
  // surfacing as a "Re-attest failed" toast even though the re-attest
  // itself succeeded. Both call sites were removed; the queue path
  // already had no markWaiting call (the bulk-queue endpoint stamps
  // `awaiting_payor_again_at` atomically).

  // Task #455 — invoice-number rename state. Pre-filled with the AI
  // suggestion (if any); the operator can edit, blank, or confirm it.
  // The rename is threaded through every sub-mode's submit handler.
  const [renameTo, setRenameTo] = useState<string>("");
  const trimmedRename = renameTo.trim();
  // What we actually send to the backend: only when the operator left
  // a non-empty value that *differs* from the current invoice number.
  // Equal values are a no-op (the backend treats them the same way) but
  // we drop the field client-side so the audit row isn't noisy.
  const renamePayload = useMemo<{
    renameInvoiceNumberTo?: string;
    renameSourceResponseId?: number;
  } | null>(() => {
    if (!trimmedRename) return null;
    if (trimmedRename === group.invoiceNumber) return null;
    const payload: { renameInvoiceNumberTo: string; renameSourceResponseId?: number } = {
      renameInvoiceNumberTo: trimmedRename,
    };
    // Only forward the sourceResponseId when the operator actually kept
    // the AI suggestion (or one that matches it). If they typed a
    // different number, the original response no longer corresponds.
    if (
      suggestedNewInvoiceNumberSourceResponseId != null &&
      suggestedNewInvoiceNumber &&
      trimmedRename === suggestedNewInvoiceNumber.trim()
    ) {
      payload.renameSourceResponseId = suggestedNewInvoiceNumberSourceResponseId;
    }
    return payload;
  }, [
    trimmedRename,
    group.invoiceNumber,
    suggestedNewInvoiceNumber,
    suggestedNewInvoiceNumberSourceResponseId,
  ]);
  const renameForChecklist = useMemo(
    () =>
      renamePayload
        ? { from: group.invoiceNumber, to: renamePayload.renameInvoiceNumberTo! }
        : null,
    [renamePayload, group.invoiceNumber],
  );

  const checklist = useMemo<ReattestInstructionItem[]>(
    () => buildReattestChecklist(deniedLegs, group.invoiceNumber, renameForChecklist),
    [deniedLegs, group.invoiceNumber, renameForChecklist],
  );
  const renderedChecklistText = useMemo(
    () => renderChecklistAsText(checklist),
    [checklist],
  );

  const [mode, setMode] = useState<"pick" | "now" | "queue" | "offline">("pick");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reattestNote, setReattestNote] = useState("");
  const [queueNote, setQueueNote] = useState("");
  const [confirmQueueOpen, setConfirmQueueOpen] = useState(false);
  // Offline-override path: same destination as the `now`/`queue` modes
  // (re-attest stamp lands, group drops off review), but the operator
  // is *recording* an attestation that already happened in the portal
  // out-of-band. Server requires admin role + a >=10-char trimmed note.
  const [offlineNote, setOfflineNote] = useState("");
  const [offlineConfirmed, setOfflineConfirmed] = useState(false);

  // Reset to the picker every time the modal is reopened so the operator
  // always lands on the question, never on a stale sub-view. Pre-fill the
  // rename input with the AI suggestion when one is available.
  useEffect(() => {
    if (open) {
      setMode("pick");
      setChecked({});
      setReattestNote("");
      setQueueNote("");
      setConfirmQueueOpen(false);
      setOfflineNote("");
      setOfflineConfirmed(false);
      setRenameTo(suggestedNewInvoiceNumber?.trim() ?? "");
    }
  }, [open, suggestedNewInvoiceNumber]);

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
    bulkQueueReattest.isPending;

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
        data: {
          note: reattestNote.trim() || undefined,
          ...(renamePayload ?? {}),
        },
      });
      // Task #780 (A) — feed the session-milestone counter once per
      // approved leg the operator just re-attested. Generation is the
      // moment of completion so a re-attest after a revert counts
      // cleanly; sibling-view replays collapse on the seen-Set.
      const reattestGen = `reattest-now:${Date.now()}`;
      for (const leg of approvedLegs) {
        notifyClaimProcessedThisSession(leg.id, reattestGen);
      }
      // No follow-up markWaiting call: complete-reattest already
      // closes the group (Resolved/Approved → macro phase
      // awaiting-payout/closed), so the row is off Responses Awaiting
      // Review immediately. The previous follow-up 409'd against the
      // post-close phase and surfaced as a misleading "Re-attest
      // failed" toast on top of a successful re-attest.
      onAfterAction(
        renamePayload
          ? `Re-attest recorded — invoice renamed to #${renamePayload.renameInvoiceNumberTo}.`
          : "Re-attest recorded.",
      );
      close();
    } catch (err: unknown) {
      const msg = renameConflictMessage(err) ?? (err instanceof Error ? err.message : "Could not record.");
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
      // Single atomic call: queues every eligible leg and stamps
      // awaiting_payor_again_at on the group in one transaction. A
      // partial failure now rolls back instead of leaving half the
      // group queued and the other half not.
      const result = await bulkQueueReattest.mutateAsync({
        id: group.id,
        data: { note: fullNote, ...(renamePayload ?? {}) },
      });
      const queuedCount = result.queuedLegIds.length;
      // Task #780 (A) — queueing for re-attestation IS the operator's
      // moment of "done with my plate" for these legs. Notify once per
      // queued leg id; dedup is handled inside notifyClaimProcessed.
      const queueGen = `reattest-queue:${Date.now()}`;
      for (const legId of result.queuedLegIds) {
        notifyClaimProcessedThisSession(legId, queueGen);
      }
      onAfterAction(
        renamePayload
          ? `Queued ${queuedCount} leg${queuedCount === 1 ? "" : "s"} for re-attestation — invoice renamed to #${renamePayload.renameInvoiceNumberTo}.`
          : `Queued ${queuedCount} leg${queuedCount === 1 ? "" : "s"} for re-attestation.`,
      );
      close();
    } catch (err: unknown) {
      const msg = renameConflictMessage(err) ?? (err instanceof Error ? err.message : "Could not queue.");
      toast({
        title: "Queue failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const handleRecordOffline = async () => {
    if (
      !canSubmitOfflineReattest({
        note: offlineNote,
        confirmed: offlineConfirmed,
        isPending: busy,
      })
    ) {
      return;
    }
    // Same step-4 commit pattern as the "now" / "queue" paths: drafts
    // get promoted to operator_confirmed atomically before the
    // re-attest stamp lands so a later retry can't double-commit.
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
      await completeReattest.mutateAsync({
        id: group.id,
        data: { ...buildOfflineReattestPayload(offlineNote), ...(renamePayload ?? {}) },
      });
      // Task #780 (A) — same notify pattern as the "now" path; the
      // offline branch records the same closure on the same legs.
      const offlineGen = `reattest-offline:${Date.now()}`;
      for (const leg of approvedLegs) {
        notifyClaimProcessedThisSession(leg.id, offlineGen);
      }
      // No follow-up markWaiting call — see the "now" path comment
      // above. complete-reattest closes the group, so awaiting-payor-
      // again would 409 on its source-state guard.
      onAfterAction(
        renamePayload
          ? `Recorded as already re-attested (offline) — invoice renamed to #${renamePayload.renameInvoiceNumberTo}.`
          : "Recorded as already re-attested (offline).",
      );
      close();
    } catch (err: unknown) {
      const msg = renameConflictMessage(err) ?? (err instanceof Error ? err.message : "Could not record.");
      toast({
        title: "Offline re-attest failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  // Task #455 — render the rename banner ONLY when the inbound-email
  // classifier surfaced a suggestion. With no suggestion the modal
  // looks exactly as it did before this task (no banner, no toggle).
  const renameBanner = suggestedNewInvoiceNumber ? (
    <RenameInvoiceBanner
      currentInvoiceNumber={group.invoiceNumber}
      value={renameTo}
      onChange={setRenameTo}
      suggestion={suggestedNewInvoiceNumber}
      disabled={busy}
    />
  ) : null;

  const headerTitle = (() => {
    if (mode === "now") return "Re-attest now";
    if (mode === "queue") return "Queue for re-attest later";
    if (mode === "offline") return "Already attested? Record it";
    return "Re-attest in the payor portal";
  })();

  const headerDescription = (() => {
    if (mode === "now") {
      return "Walk through each portal step. The 'I'm done' button unlocks once every box is checked.";
    }
    if (mode === "queue") {
      return `Park this for someone with portal access. ${approvedLegs.length} leg${approvedLegs.length === 1 ? "" : "s"} will be added to the Attestation Queue with the walkthrough below.`;
    }
    if (mode === "offline") {
      return "Logs that you already re-attested in the portal out-of-band. Recorded as an admin override on the audit trail.";
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
            {renameBanner}
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
            {canRecordOffline && (
              <PickButton
                icon={<Edit3 className="h-5 w-5" />}
                title="I already attested this offline"
                subtitle="Log that you already completed the re-attestation in the portal. Admin-only override; lands on the audit trail."
                onClick={() => setMode("offline")}
                testId="reattest-pick-offline"
              />
            )}
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
            {renameBanner}
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
            {renameBanner}
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

        {/* ── Mode 4: Offline re-attest override ────────────────── */}
        {mode === "offline" && (
          <div className="space-y-4 pt-2" data-testid="reattest-mode-offline">
            {renameBanner}
            <div className="space-y-1">
              <Label className="text-xs font-medium">
                Why are you recording this offline?
              </Label>
              <Textarea
                value={offlineNote}
                onChange={(e) => setOfflineNote(e.target.value)}
                placeholder="e.g. Re-attested directly in the MAS portal on 4/29 — confirmation #12345."
                rows={4}
                className="text-sm"
                data-testid="reattest-offline-note"
              />
              <div className="flex items-center justify-between text-[11px]">
                <span
                  style={{
                    color: isOfflineReattestNoteValid(offlineNote)
                      ? "var(--cc-muted-fg)"
                      : "var(--cc-amber-fg)",
                  }}
                >
                  {isOfflineReattestNoteValid(offlineNote)
                    ? "Note looks good."
                    : `Need ${Math.max(0, 10 - offlineNote.trim().length)} more characters.`}
                </span>
                <span className="font-mono text-muted-foreground">
                  {offlineNote.trim().length}/10
                </span>
              </div>
            </div>
            <label
              htmlFor="reattest-offline-confirm"
              className="flex items-start gap-2 rounded-md border bg-amber-50 px-3 py-2 text-xs cursor-pointer"
              data-testid="reattest-offline-confirm-label"
            >
              <Checkbox
                id="reattest-offline-confirm"
                checked={offlineConfirmed}
                onCheckedChange={(v) => setOfflineConfirmed(v === true)}
                className="mt-0.5"
                data-testid="reattest-offline-confirm"
              />
              <span className="leading-snug">
                I confirm the re-attestation already happened in the portal
                {renamePayload
                  ? `, including renaming the invoice from #${group.invoiceNumber} to #${renamePayload.renameInvoiceNumberTo}`
                  : ""}
                . This will be recorded as an admin override on the audit
                trail and the group will drop off Responses Awaiting Review.
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={close}
                disabled={busy}
                data-testid="reattest-offline-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleRecordOffline}
                disabled={
                  !canSubmitOfflineReattest({
                    note: offlineNote,
                    confirmed: offlineConfirmed,
                    isPending: busy,
                  })
                }
                data-testid="reattest-offline-submit"
              >
                {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Record as already re-attested
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
 * Task #455 — pull the colliding invoice number out of a 409 response
 * and shape it into a user-facing message. Returns null when the error
 * isn't an invoice_number_conflict so the caller can fall back to the
 * generic message.
 */
function renameConflictMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as Record<string, unknown> & {
    response?: { status?: number; data?: unknown };
  };
  const status = anyErr.response?.status;
  if (status !== 409) return null;
  const data = anyErr.response?.data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.code !== "invoice_number_conflict") return null;
  const errMsg = typeof d.error === "string" ? d.error : null;
  return errMsg ?? "That invoice number is already in use by another group.";
}

/**
 * Task #455 — prominent first-class step inside the Re-attest modal.
 * Renders an editable invoice-# field pre-filled with the AI suggestion
 * so the operator can confirm, edit, or blank it before any sub-mode
 * commits. Only shown when the inbound-email classifier surfaced a
 * suggestion — when there's no suggestion the modal looks exactly as
 * it did before this task.
 */
function RenameInvoiceBanner({
  currentInvoiceNumber,
  value,
  onChange,
  suggestion,
  disabled,
}: {
  currentInvoiceNumber: string;
  value: string;
  onChange: (next: string) => void;
  suggestion: string | null;
  disabled?: boolean;
}) {
  const trimmed = value.trim();
  const willRename = trimmed.length > 0 && trimmed !== currentInvoiceNumber;

  return (
    <div
      className={`rounded-md border-2 px-3 py-3 ${
        willRename
          ? "border-indigo-300 bg-indigo-50/60"
          : suggestion
            ? "border-indigo-200 bg-indigo-50/40"
            : "border-border bg-card"
      }`}
      data-testid="reattest-rename-banner"
    >
      <div className="flex items-start gap-2">
        <FileText className="h-4 w-4 mt-0.5 text-indigo-600" />
        <div className="flex-1 space-y-1.5">
          <Label
            htmlFor="reattest-rename-input"
            className="text-sm font-medium"
          >
            Update invoice #{" "}
            <span className="text-muted-foreground font-normal">
              (current: #{currentInvoiceNumber})
            </span>
          </Label>
          {suggestion && (
            <p
              className="text-xs text-indigo-700"
              data-testid="reattest-rename-suggestion-hint"
            >
              The payor's reply mentioned a new invoice # — pre-filled
              below. Edit or clear if it's wrong.
            </p>
          )}
          <Input
            id="reattest-rename-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`e.g. ${currentInvoiceNumber}-R`}
            disabled={disabled}
            className="text-sm font-mono"
            data-testid="reattest-rename-input"
          />
          {willRename ? (
            <p
              className="text-xs text-indigo-800"
              data-testid="reattest-rename-preview"
            >
              On submit: rename #{currentInvoiceNumber} → #{trimmed}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Leave blank to keep #{currentInvoiceNumber}.
            </p>
          )}
        </div>
      </div>
    </div>
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
