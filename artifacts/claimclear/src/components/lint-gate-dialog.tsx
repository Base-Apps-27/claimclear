import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, XCircle, Loader2 } from "lucide-react";
import type { LintResult } from "@workspace/api-client-react";

export type LintGateMode = "fail" | "warn";

interface LintGateDialogProps {
  open: boolean;
  mode: LintGateMode;
  results: LintResult[];
  pending?: boolean;
  onClose: () => void;
  // Task #411 Tier 3: a bypass requires a written reason so the audit
  // trail names WHY the operator chose to override the lint warnings,
  // not just THAT they did. Callers must POST the reason in the
  // `bypassReason` body field; the server stores it in the
  // `lint_warnings_bypassed` audit row's metadata.
  onConfirmAnyway?: (bypassReason: string) => void;
}

const MIN_REASON_LENGTH = 10;

export function LintGateDialog({ open, mode, results, pending, onClose, onConfirmAnyway }: LintGateDialogProps) {
  const isFail = mode === "fail";
  const [reason, setReason] = useState("");

  // Reset the typed reason whenever the dialog re-opens so a stale
  // bypass note from a previous attempt doesn't leak into the next
  // submission's audit row.
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= MIN_REASON_LENGTH;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isFail ? (
              <><XCircle className="h-5 w-5 text-red-600" /> Submission blocked</>
            ) : (
              <><AlertTriangle className="h-5 w-5 text-amber-600" /> Quality check has warnings</>
            )}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {isFail
            ? "These problems must be fixed before this submission can be queued for the bot:"
            : "These warnings won't block submission, but please confirm you want to send the draft as-is:"}
        </p>
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {results.map((r) => (
            <li
              key={r.ruleKey}
              className={`text-sm flex items-start gap-2 rounded px-3 py-2 ${
                r.severity === "fail"
                  ? "bg-red-50 text-red-800 border border-red-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
              }`}
              data-testid={`lint-result-${r.ruleKey}`}
            >
              {r.severity === "fail" ? (
                <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              )}
              <span>{r.message}</span>
            </li>
          ))}
        </ul>
        {!isFail && (
          <div className="space-y-1">
            <Label htmlFor="lint-bypass-reason" className="text-sm">
              Why are you submitting despite these warnings?{" "}
              <span className="text-muted-foreground">(required, min {MIN_REASON_LENGTH} chars)</span>
            </Label>
            <Textarea
              id="lint-bypass-reason"
              data-testid="lint-bypass-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Member's vehicle was unsafe, safety condition was acknowledged in the dispatch notes — see attached screenshot."
              rows={3}
              disabled={pending}
            />
            {!reasonValid && trimmed.length > 0 && (
              <p className="text-xs text-amber-700">
                Reason must be at least {MIN_REASON_LENGTH} characters so the audit trail is meaningful.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {isFail ? (
            <Button variant="outline" onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={pending}>Go back & fix</Button>
              <Button
                onClick={() => onConfirmAnyway?.(trimmed)}
                disabled={pending || !reasonValid}
                data-testid="lint-bypass-confirm"
              >
                {pending ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" />Submitting…</>) : "Submit anyway"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
