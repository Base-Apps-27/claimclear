import { useState, useMemo, useEffect, useRef } from "react";
import {
  PAYOR_DENIAL_REASONS,
  isPayorDenialReasonCode,
  payorDenialReasonLabel,
  type PayorDenialReasonCode,
} from "@workspace/payor-denial-reasons";
import { useRecordPayorDenialReason } from "@workspace/api-client-react";
import type { InvoiceGroupResponse } from "@workspace/api-client-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertTriangle, ChevronDown, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  group: InvoiceGroupResponse;
  /** AI-suggested code from inbound-email classifier (may not be in the vocab). */
  suggestedCode: string | null;
  /** Invalidate the parent group payload after a successful save. */
  onAfterSave: () => void;
}

/**
 * Inline picker for the qualitative "why did the payor reject our
 * dispute?" tag. Lives inside the "What's next?" card on Responses
 * Awaiting Review for verdict mixes that contain at least one
 * Denied leg.
 *
 * Already-recorded reasons render as a small confirmation chip with
 * a "Change" affordance — re-recording is allowed because operators
 * sometimes refine the tag after re-reading the email. Each save
 * goes through `POST /invoice-groups/:id/payor-denial-reason`, which
 * also writes an audit row.
 *
 * `payor_other` requires a free-text note (enforced both client- and
 * API-side); other codes treat the note as optional context.
 */
export function PayorDenialReasonPicker({ group, suggestedCode, onAfterSave }: Props) {
  const { toast } = useToast();
  const recordReason = useRecordPayorDenialReason();
  const [open, setOpen] = useState(false);
  // Counter that bumps on each successful inline save so the shared
  // Button can play its `breath` microinteraction in lieu of a toast —
  // routine metadata edit, not a status change.
  const [savedTick, setSavedTick] = useState(0);
  // Tracks the deferred popover-close timer so we can cancel it on
  // unmount and avoid setState-after-unmount warnings.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  // Pre-select the AI hint only if it matches a real code in the vocab.
  // Falls back to whatever the group already has on file (so re-opening
  // the popover after a save shows the persisted choice).
  const initialCode: PayorDenialReasonCode | null = useMemo(() => {
    const persisted = group.payorDenialReason;
    if (persisted && isPayorDenialReasonCode(persisted)) return persisted;
    if (suggestedCode && isPayorDenialReasonCode(suggestedCode)) return suggestedCode;
    return null;
  }, [group.payorDenialReason, suggestedCode]);

  const [code, setCode] = useState<PayorDenialReasonCode | null>(initialCode);
  const [note, setNote] = useState<string>(group.payorDenialReasonNote ?? "");

  // If the popover re-opens after the parent group payload refreshes,
  // mirror the new persisted state into the local form.
  useEffect(() => {
    if (open) {
      setCode(initialCode);
      setNote(group.payorDenialReasonNote ?? "");
    }
  }, [open, initialCode, group.payorDenialReasonNote]);

  const persistedCode = isPayorDenialReasonCode(group.payorDenialReason ?? "")
    ? (group.payorDenialReason as PayorDenialReasonCode)
    : null;
  const aiSuggested =
    suggestedCode && isPayorDenialReasonCode(suggestedCode)
      ? (suggestedCode as PayorDenialReasonCode)
      : null;

  const requiresNote = code === "payor_other";
  const trimmedNote = note.trim();
  const canSubmit = !!code && (!requiresNote || trimmedNote.length > 0);

  const handleSave = async () => {
    if (!code) return;
    try {
      await recordReason.mutateAsync({
        id: group.id,
        data: {
          reason: code,
          note: trimmedNote ? trimmedNote : null,
        },
      });
      onAfterSave();
      // Quiet breath on the Save button instead of a generic toast —
      // routine inline save, no workflow change. Trigger the breath
      // first, then delay the popover close past the ~250ms animation
      // so the affordance is actually perceivable before the button
      // unmounts. The persisted chip on the trigger gives the lasting
      // confirmation.
      setSavedTick((n) => n + 1);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        setOpen(false);
      }, 280);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save reason.";
      toast({
        title: "Save failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-1.5" data-testid="payor-denial-reason-picker">
      <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
        Why did the payor deny?
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {persistedCode ? (
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-xs text-emerald-900 hover:bg-emerald-100"
              data-testid="payor-denial-reason-recorded"
            >
              <span className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                <span className="truncate font-medium">
                  {payorDenialReasonLabel(persistedCode)}
                </span>
              </span>
              <span className="text-[10px] text-emerald-800/80 shrink-0">Change</span>
            </button>
          ) : (
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 hover:bg-amber-100"
              data-testid="payor-denial-reason-trigger"
            >
              <span className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                <span className="truncate font-medium">
                  Record payor's reason
                </span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3 space-y-3" align="start">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Reason code</Label>
            <Select
              value={code ?? undefined}
              onValueChange={(v) => setCode(v as PayorDenialReasonCode)}
            >
              <SelectTrigger
                className="h-8 text-xs"
                data-testid="payor-denial-reason-select"
              >
                <SelectValue placeholder="Pick a reason…" />
              </SelectTrigger>
              <SelectContent>
                {PAYOR_DENIAL_REASONS.map((r) => (
                  <SelectItem
                    key={r.code}
                    value={r.code}
                    className="text-xs"
                    data-testid={`payor-denial-reason-option-${r.code}`}
                  >
                    <span className="flex items-center gap-1.5">
                      {r.label}
                      {aiSuggested === r.code && (
                        <Sparkles
                          className="h-3 w-3 text-violet-600"
                          aria-label="AI-suggested from inbound email"
                        />
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {aiSuggested && (
              <p className="text-[11px] text-violet-700 flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                AI suggested: {payorDenialReasonLabel(aiSuggested)}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">
              Note {requiresNote ? <span className="text-rose-600">*</span> : <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                requiresNote
                  ? "Required for 'Other' — describe the payor's reason."
                  : "Optional context that didn't fit the code list."
              }
              className="text-xs"
              rows={3}
              data-testid="payor-denial-reason-note"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              data-testid="payor-denial-reason-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!canSubmit || recordReason.isPending}
              breathTrigger={savedTick}
              data-testid="payor-denial-reason-save"
            >
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {persistedCode === "payor_other" && group.payorDenialReasonNote && (
        <p
          className="text-[11px] text-muted-foreground italic px-1"
          data-testid="payor-denial-reason-note-display"
        >
          "{group.payorDenialReasonNote}"
        </p>
      )}
    </div>
  );
}
