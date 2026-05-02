// Include terminal — "Ready" surface for include-role legs (legacy
// `portal_dispute` and `dispute` both collapse here via `outcomeRole`).
// Per-leg-context editor (save-on-blur), channel hint from error_type,
// and a hand-off CTA that bubbles via `onAdvanced`.

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { OUTCOME_COLORS } from "../types";
import {
  channelHintForErrorType,
  channelHintLabel,
  type ErrorTypeChannelInput,
} from "@/lib/sop-terminal-routing";
import type { TerminalCommonProps } from "./types";

function apiBase(): string {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
}

// Pure: should `handleBlur` fire the save mutation?
export function shouldSaveContextDraft(args: {
  draft: string;
  lastSaved: string;
  disabled: boolean;
  saving: boolean;
}): boolean {
  if (args.disabled) return false;
  if (args.saving) return false;
  return args.draft !== args.lastSaved;
}

// Pure: which SaveStatus testid should render given the editor state?
export function saveStatusTestId(args: {
  saving: boolean;
  saved: boolean;
  dirty: boolean;
}): "sop-include-context-saving" | "sop-include-context-saved" | "sop-include-context-dirty" | null {
  if (args.saving) return "sop-include-context-saving";
  if (args.saved) return "sop-include-context-saved";
  if (args.dirty) return "sop-include-context-dirty";
  return null;
}

export interface IncludeTerminalProps extends TerminalCommonProps {
  /** Source for the channel hint; falls back to "not configured". */
  errorType?: ErrorTypeChannelInput | null;
}

export function IncludeTerminal({
  leg,
  disabledReason,
  onAdvanced,
  errorType,
}: IncludeTerminalProps) {
  const disabled = !!disabledReason;
  const colors = OUTCOME_COLORS.portal_dispute; // green family for "Ready"

  const [draft, setDraft] = useState(leg.perLegContext ?? "");
  const lastSavedRef = useRef<string>(leg.perLegContext ?? "");
  const [showSaved, setShowSaved] = useState(false);

  // Re-sync when the persisted context changes from outside.
  useEffect(() => {
    const incoming = leg.perLegContext ?? "";
    if (incoming !== lastSavedRef.current) {
      setDraft(incoming);
      lastSavedRef.current = incoming;
    }
  }, [leg.perLegContext]);

  const saveContext = useMutation({
    mutationFn: async (context: string) => {
      const res = await fetch(
        `${apiBase()}/api/claims/${leg.id}/per-leg-context`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ context }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return context;
    },
    onSuccess: (saved) => {
      lastSavedRef.current = saved;
      setShowSaved(true);
      window.setTimeout(() => setShowSaved(false), 2000);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not save the per-leg note",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function handleBlur() {
    const ok = shouldSaveContextDraft({
      draft,
      lastSaved: lastSavedRef.current,
      disabled,
      saving: saveContext.isPending,
    });
    if (!ok) return;
    saveContext.mutate(draft);
  }

  const channelHint = channelHintForErrorType(errorType);
  const channelLabel = channelHintLabel(channelHint);

  return (
    <Card
      className={`${colors.bg} border ${colors.border}`}
      data-testid="sop-terminal-card"
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className={`h-5 w-5 ${colors.text}`} />
          <p
            className={`text-base font-semibold ${colors.text}`}
            data-testid="sop-include-ready-label"
          >
            Ready
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`per-leg-context-${leg.id}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Per-leg note (handed to the dispute write-up)
            </label>
            <SaveStatus
              saving={saveContext.isPending}
              saved={showSaved}
              dirty={draft !== lastSavedRef.current}
            />
          </div>
          <Textarea
            id={`per-leg-context-${leg.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            disabled={disabled || saveContext.isPending}
            rows={5}
            placeholder="Add specifics that the dispute write-up should cite (the SOP breadcrumb is prefilled — keep, edit, or replace)."
            data-testid="sop-include-context-editor"
          />
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p
            className="text-xs text-muted-foreground"
            data-testid="sop-include-channel-hint"
          >
            {channelLabel}
          </p>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={disabled || saveContext.isPending}
            onClick={() =>
              onAdvanced?.({
                isTerminal: true,
                sopOutcome: leg.sopOutcome ?? null,
              })
            }
            data-testid="sop-include-handoff-btn"
          >
            <Send className="h-3.5 w-3.5" /> I'm done — hand off
          </Button>
        </div>

        {disabled && disabledReason && (
          <p className="text-xs text-muted-foreground italic">{disabledReason}</p>
        )}
      </CardContent>
    </Card>
  );
}

function SaveStatus({
  saving,
  saved,
  dirty,
}: {
  saving: boolean;
  saved: boolean;
  dirty: boolean;
}) {
  if (saving) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
        data-testid="sop-include-context-saving"
      >
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (saved) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-green-700"
        data-testid="sop-include-context-saved"
      >
        <CheckCircle2 className="h-3 w-3" /> Saved
      </span>
    );
  }
  if (dirty) {
    return (
      <span
        className="text-[11px] text-muted-foreground italic"
        data-testid="sop-include-context-dirty"
      >
        Unsaved changes
      </span>
    );
  }
  return null;
}
