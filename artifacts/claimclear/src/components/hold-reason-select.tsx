import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LEG_HOLD_REASONS, type LegHoldReason } from "@workspace/leg-state";
import { holdReasonLabel as glossaryHoldReasonLabel } from "@workspace/vocab";

// Hold-reason picker. Labels live in @workspace/vocab (the operator
// glossary); this component owns the picker UX and the
// "other → require note" enforcement.

const REASON_LABELS: Record<LegHoldReason, string> = {
  evidence_pending: glossaryHoldReasonLabel("evidence_pending"),
  awaiting_external_party: glossaryHoldReasonLabel("awaiting_external_party"),
  awaiting_member_response: glossaryHoldReasonLabel("awaiting_member_response"),
  awaiting_internal_review: glossaryHoldReasonLabel("awaiting_internal_review"),
  other: glossaryHoldReasonLabel("other"),
};

interface HoldReasonSelectProps {
  reason: LegHoldReason | "";
  note: string;
  onReasonChange: (reason: LegHoldReason | "") => void;
  onNoteChange: (note: string) => void;
  /** Hide the surrounding labels — for compact contexts. */
  compact?: boolean;
  disabled?: boolean;
}

export function HoldReasonSelect({
  reason,
  note,
  onReasonChange,
  onNoteChange,
  compact = false,
  disabled = false,
}: HoldReasonSelectProps) {
  const requiresNote = reason === "other";
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {!compact && <Label>Hold reason</Label>}
        <Select
          value={reason}
          onValueChange={(v) => onReasonChange(v as LegHoldReason)}
          disabled={disabled}
        >
          <SelectTrigger data-testid="hold-reason-select">
            <SelectValue placeholder="Select a hold reason" />
          </SelectTrigger>
          <SelectContent>
            {LEG_HOLD_REASONS.map((r) => (
              <SelectItem key={r} value={r} data-testid={`hold-reason-${r}`}>
                {REASON_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        {!compact && (
          <Label>
            Note{requiresNote ? <span className="text-destructive"> *</span> : null}
          </Label>
        )}
        <Textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder={requiresNote ? "Required when reason is Other" : "Optional context"}
          rows={3}
          disabled={disabled}
          data-testid="hold-note-input"
        />
        {requiresNote && note.trim().length === 0 && (
          <p className="text-xs text-destructive">Required when reason is Other.</p>
        )}
      </div>
    </div>
  );
}

export function isHoldReasonValid(reason: LegHoldReason | "", note: string): boolean {
  if (!reason) return false;
  if (reason === "other" && note.trim().length === 0) return false;
  return true;
}

export function holdReasonLabel(r: LegHoldReason): string {
  return REASON_LABELS[r];
}
