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

// Single source of truth for the hold-reason picker. The reason vocabulary
// lives in @workspace/db (mirrors the DB CHECK constraint); this component
// exposes it to the UI plus the "other → require note" enforcement so
// every caller gets the same validation semantics.

const REASON_LABELS: Record<LegHoldReason, string> = {
  evidence_pending: "Awaiting evidence",
  awaiting_external_party: "Awaiting external party (e.g. payor, hospital)",
  awaiting_member_response: "Awaiting member response",
  awaiting_internal_review: "Awaiting internal review (e.g. supervisor, MAS)",
  other: "Other (specify below)",
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
