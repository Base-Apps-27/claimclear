import { useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Inbox, Loader2 } from "lucide-react";
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
   * either tab fires its downstream action. The modal awaits this on
   * every submit so the group only leaves `response-pending` once Step
   * 4 actually commits — and so a draft-only group never reaches the
   * Attestation Queue with stale verdict state. The hook is idempotent
   * (no fresh drafts → no-op), so it's safe to call on already-confirmed
   * groups too.
   */
  promoteDrafts: () => Promise<void>;
  /** Run after either tab's submit succeeds. */
  onAfterAction: (message: string) => void;
}

/**
 * The "Re-attest" modal launched from the "What's next?" card. Two
 * tabs share the same checklist (single source of truth — see
 * `reattest-instruction-template.tsx`):
 *
 *   1. **Re-attest now** — interactive checklist; the "I'm done"
 *      button is disabled until every box is checked. On submit:
 *      `POST /invoice-groups/:id/complete-reattest` (group-level
 *      stamp) followed by `POST /invoice-groups/:id/awaiting-payor-again`
 *      so the row drops off the page.
 *
 *   2. **Queue for attestation** — read-only preview of the same
 *      instructions plus an editable note. On submit, fans out
 *      `POST /claims/:id/attestation/queue` for each approved leg's
 *      claim with the rendered instruction text in the body so the
 *      Attestation Queue page surfaces the literal walkthrough.
 *
 * The verb in both tab labels is "Re-attest" — never "Restart" — to
 * match the audit-log copy and the vocabulary glossary.
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

  // Per-checkbox state for the "Re-attest now" tab. Recomputed when the
  // checklist itself changes (e.g. legs added between opens).
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const allChecked =
    checklist.length > 0 && checklist.every((it) => checked[it.id] === true);

  // Optional re-attest note (group-level) — surfaced verbatim on the
  // group detail page and the audit row.
  const [reattestNote, setReattestNote] = useState("");

  // Optional queueing note that gets appended to the rendered
  // checklist before being persisted on each claim's attestationNote.
  const [queueNote, setQueueNote] = useState("");

  const reset = () => {
    setChecked({});
    setReattestNote("");
    setQueueNote("");
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

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
      // 0. Step 4 commit: promote every per-leg draft on the group to
      //    `operator_confirmed` atomically before stamping the
      //    re-attest. If this throws (409 because the group already
      //    moved out of `response-pending`, network blip, etc.) we
      //    surface the failure and DO NOT continue — the operator's
      //    selections stay as drafts and the group stays in queue.
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
      // 1. Stamp the group as re-attested. The note carries the
      //    operator's optional commentary (the checklist itself is
      //    captured implicitly — every box was ticked).
      await completeReattest.mutateAsync({
        id: group.id,
        data: { note: reattestNote.trim() || undefined },
      });
      // 2. Drop the row off the Responses Awaiting Review page —
      //    the operator has done their part, ball is back in payor's
      //    court while the re-attest propagates.
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
      // 0. Step 4 commit: promote drafts BEFORE the per-leg
      //    attestation fan-out so every queued leg lands on the
      //    Attestation Queue page with its verdict already confirmed.
      //    Without this, a draft-only leg would queue with a stale
      //    "no verdict" state and the queue page would refuse to
      //    surface it.
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
      // Fan out one queue request per approved leg so each claim
      // shows up on the Attestation Queue page with the full
      // walkthrough text on its row.
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

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        data-testid="whats-next-reattest-modal"
      >
        <DialogHeader>
          <DialogTitle>Re-attest in the payor portal</DialogTitle>
          <DialogDescription>
            The payor approved {approvedLegs.length === 1 ? "1 leg" : `${approvedLegs.length} legs`}.
            Re-attest the corrected info in the portal, or park the work for
            someone with portal access.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="now" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="now" data-testid="reattest-tab-now">
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              Re-attest now
            </TabsTrigger>
            <TabsTrigger value="queue" data-testid="reattest-tab-queue">
              <Inbox className="h-3.5 w-3.5 mr-1.5" />
              Queue for attestation
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Re-attest now ─────────────────────────────── */}
          <TabsContent value="now" className="space-y-4 pt-4">
            <p className="text-xs text-muted-foreground">
              Check each step as you complete it in the payor portal. The
              "I'm done" button unlocks once every box is ticked.
            </p>
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
          </TabsContent>

          {/* ── Tab 2: Queue for attestation ─────────────────────── */}
          <TabsContent value="queue" className="space-y-4 pt-4">
            <p className="text-xs text-muted-foreground">
              Send the same walkthrough to the Attestation Queue so a
              teammate with portal access can pick it up. The literal
              instruction text below is what they'll see on the queue row.
            </p>
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
                onClick={handleQueueForAttestation}
                disabled={busy || approvedLegs.length === 0}
                data-testid="reattest-queue-confirm"
              >
                {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Queue for attestation
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
