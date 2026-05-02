import { useState } from "react";
import { Loader2, Tag } from "lucide-react";
import type { ErrorTypeResponse } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Recommended, ToneButton } from "./recommended";
import type { Tone } from "./tone";

export interface BulkAssignErrorTypeActionProps {
  selectedCount: number;
  errorTypes: ErrorTypeResponse[];
  tone: Tone;
  entityNoun: "claim" | "group";
  body: string;
  isPending: boolean;
  onApply: (errorTypeId: string, errorType: ErrorTypeResponse) => Promise<void>;
  /**
   * Optional controlled open state — lets external entry points (e.g.
   * the page's right-rail "Apply error type to N…" action) open the
   * picker. If omitted, the component manages its own open state from
   * the inline "Apply error type to N" button.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function BulkAssignErrorTypeAction({
  selectedCount,
  errorTypes,
  tone,
  entityNoun,
  body,
  isPending,
  onApply,
  open: controlledOpen,
  onOpenChange,
}: BulkAssignErrorTypeActionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [errorTypeId, setErrorTypeId] = useState("");

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const reset = () => {
    setOpen(false);
    setErrorTypeId("");
  };

  const handleApply = async () => {
    if (!errorTypeId || isPending) return;
    const et = errorTypes.find((t) => String(t.id) === errorTypeId);
    if (!et) return;
    try {
      await onApply(errorTypeId, et);
      reset();
    } catch {
      // Parent's onApply is responsible for surfacing the failure (toast,
      // banner, etc). The picker stays open so the operator can retry
      // without re-selecting the type.
    }
  };

  return (
    <Recommended
      tone={tone}
      title={`Apply error type to ${selectedCount}`}
      body={body}
      cta={
        open ? (
          <div className="space-y-2">
            <Select value={errorTypeId} onValueChange={setErrorTypeId}>
              <SelectTrigger className="h-9 text-sm bg-background">
                <SelectValue placeholder="Select error type..." />
              </SelectTrigger>
              <SelectContent>
                {errorTypes.map((et) => (
                  <SelectItem key={et.id} value={String(et.id)}>
                    {et.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <ToneButton
                tone={tone}
                onClick={handleApply}
                disabled={!errorTypeId || isPending}
                testId="button-bulk-assign-apply"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" /> Applying…
                  </>
                ) : (
                  "Apply"
                )}
              </ToneButton>
              <Button
                variant="ghost"
                size="sm"
                className="bg-background/40"
                onClick={reset}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <ToneButton
            tone={tone}
            onClick={() => setOpen(true)}
            testId="button-bulk-assign-open"
          >
            <Tag className="w-4 h-4" /> Apply error type to {selectedCount}
          </ToneButton>
        )
      }
    />
  );
}
