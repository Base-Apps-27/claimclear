// Shared reclassify confirm dialog (Task #526 / #527).
//
// Reclassify is destructive (clears walk state + outcome) so we
// always confirm. Lifted out of sop-advance-player so the V3 wizard
// per-leg cards-row menu (R3) can mount the exact same surface
// without duplicating the markup.

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Layers, Loader2 } from "lucide-react";

void React;

export interface ReclassifyConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legRef: string | null;
  isPending: boolean;
  onConfirm: () => void;
}

export function ReclassifyConfirmDialog({
  open,
  onOpenChange,
  legRef,
  isPending,
  onConfirm,
}: ReclassifyConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="reclassify-confirm-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-amber-600" />
            Reclassify {legRef ?? "this leg"}?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex gap-2.5 p-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 dark:text-amber-100">
              This clears the current SOP walk and verdict. You'll
              choose a different error type and start the walk over.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="reclassify-confirm-cancel"
          >
            Cancel
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={onConfirm}
            disabled={isPending}
            data-testid="reclassify-confirm-go"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Layers className="h-3.5 w-3.5 mr-1.5" />
            )}
            Reclassify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
