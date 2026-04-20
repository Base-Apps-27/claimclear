import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, XCircle, Loader2 } from "lucide-react";
import type { LintResult } from "@workspace/api-client-react";

export type LintGateMode = "fail" | "warn";

interface LintGateDialogProps {
  open: boolean;
  mode: LintGateMode;
  results: LintResult[];
  pending?: boolean;
  onClose: () => void;
  onConfirmAnyway?: () => void;
}

export function LintGateDialog({ open, mode, results, pending, onClose, onConfirmAnyway }: LintGateDialogProps) {
  const isFail = mode === "fail";
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
        <DialogFooter>
          {isFail ? (
            <Button variant="outline" onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={pending}>Go back & fix</Button>
              <Button onClick={onConfirmAnyway} disabled={pending}>
                {pending ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" />Submitting…</>) : "Submit anyway"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
