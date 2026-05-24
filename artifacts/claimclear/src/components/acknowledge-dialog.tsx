// Task #889 — shared dialog for the two responsible-party actions on
// /my-closures: "Mark addressed" and "Reopen". Both actions require a
// ≥10-character note. The dialog handles the textarea, length guard,
// pending state, and error rendering; the parent owns the actual
// mutation so it can pass the right endpoint hook.
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, RotateCcw } from "lucide-react";

export type AcknowledgeMode = "address" | "reopen";

interface Props {
  open: boolean;
  mode: AcknowledgeMode;
  identifier: string;
  isPending?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}

const MIN_NOTE_LEN = 10;
const MAX_NOTE_LEN = 2000;

const COPY: Record<AcknowledgeMode, {
  title: string;
  description: string;
  submitLabel: string;
  Icon: typeof CheckCircle2;
  submitClassName: string;
}> = {
  address: {
    title: "Mark closure addressed",
    description: "Add a short note so the operations team knows what you did. At least 10 characters.",
    submitLabel: "Mark addressed",
    Icon: CheckCircle2,
    submitClassName: "bg-green-600 hover:bg-green-700",
  },
  reopen: {
    title: "Reopen closure",
    description: "You can reopen within 24 hours of your own acknowledgement. Add a short note explaining why.",
    submitLabel: "Reopen",
    Icon: RotateCcw,
    submitClassName: "",
  },
};

export function AcknowledgeDialog({
  open,
  mode,
  identifier,
  isPending = false,
  errorMessage = null,
  onCancel,
  onSubmit,
}: Props) {
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) setNote("");
  }, [open]);

  const copy = COPY[mode];
  const trimmedLen = note.trim().length;
  const tooShort = trimmedLen < MIN_NOTE_LEN;
  const Icon = copy.Icon;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isPending) onCancel(); }}>
      <DialogContent data-testid="acknowledge-dialog">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{identifier}</span> — {copy.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ack-note" className="text-xs font-semibold uppercase tracking-wide">
            Note
          </Label>
          <Textarea
            id="ack-note"
            data-testid="acknowledge-note"
            rows={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_NOTE_LEN}
            placeholder="What did you do? What did you find?"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{tooShort ? `${MIN_NOTE_LEN - trimmedLen} more characters needed` : " "}</span>
            <span>{note.length}/{MAX_NOTE_LEN}</span>
          </div>
        </div>
        {errorMessage && (
          <p className="text-sm text-red-600" role="alert" data-testid="acknowledge-error">
            {errorMessage}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(note.trim())}
            disabled={isPending || tooShort}
            className={copy.submitClassName}
            data-testid="acknowledge-submit"
          >
            {isPending
              ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              : <Icon className="h-4 w-4 mr-1.5" />}
            {copy.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
