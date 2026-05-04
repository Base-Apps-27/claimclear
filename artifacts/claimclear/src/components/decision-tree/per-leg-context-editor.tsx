// Per-leg unique-context editor with AI clarification gate. Extracted
// from the retired Include terminal screen — the per-leg context
// capture is now rendered inline during the SOP walk (and on the
// inline "Ready" surface inside SopAdvancePlayer when the leg lands at
// an include outcome) so operators capture context as they go instead
// of being routed to a separate hand-off screen.
//
// What lives here:
//   - The OPTIONAL per-leg context input (textarea).
//   - The AI-clarification gate, mirroring the group-submission
//     readback in `portal-submissions.ts: preflight-understanding`. The
//     operator's rough note is sent to Claude (server-side at
//     `/api/claims/:id/per-leg-context-readback`), the model returns a
//     cleaned restatement, and the operator reviews and either Accepts
//     (which persists via `/api/claims/:id/per-leg-context`) or Edits
//     (back to typing).
//   - Explicit "Clear saved" affordance on previously-saved context
//     (POSTs an empty string so the operator can erase prior context
//     without typing+accepting empty replacement text).
//
// What is GONE relative to the old Include terminal:
//   - The "I'm done — hand off" button, the `canHandoff` gate, and the
//     blocked-hint paragraph. The leg already lands in terminal state
//     via the prior `/sop-advance` POST that produced the include
//     outcome — there is nothing to hand off to. Optional unsaved
//     typed text in the box is just discarded on next mount, same as
//     any other optional draft.
//   - The channel hint (rendered separately by SopAdvancePlayer's
//     inline "Ready" surface).
//
// Migration: a leg whose `perLegContext` is `isLegacyDerivedContext`
// (the pre-#372 "• Q — A" auto-derived bullet list) is treated as
// EMPTY for this editor. The legacy text still surfaces under the SOP
// transcript card on the leg page so it's not lost — but it doesn't
// pre-populate the optional context input here, because it isn't a
// genuine human-authored finding.

import * as React from "react";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

void React; // JSX runtime: keep React in scope under tsx --test.

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Sparkles, Edit3, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { isLegacyDerivedContext } from "@workspace/leg-state";

function apiBase(): string {
  const env = (import.meta as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL?.replace(/\/$/, "") || "";
}

export type PerLegContextEditorMode = "edit" | "checking" | "review" | "saving";

/**
 * Pure helper: the "Check with AI" button is enabled iff there is
 * non-empty raw text to send and we are in edit mode (avoid duplicate
 * POSTs while a readback / save / review pane is already on screen).
 */
export function canRequestReadback(args: {
  mode: PerLegContextEditorMode;
  raw: string;
}): boolean {
  return args.mode === "edit" && args.raw.trim().length > 0;
}

/**
 * Pure helper: stable test-id for the inline status indicator across
 * the readback → save lifecycle. Edit mode renders no indicator (the
 * textarea + Check button is its own indicator).
 */
export function readbackStatusTestId(
  mode: PerLegContextEditorMode,
):
  | "sop-include-readback-checking"
  | "sop-include-readback-review"
  | "sop-include-readback-saving"
  | null {
  if (mode === "checking") return "sop-include-readback-checking";
  if (mode === "review") return "sop-include-readback-review";
  if (mode === "saving") return "sop-include-readback-saving";
  return null;
}

export interface PerLegContextEditorProps {
  legId: number;
  perLegContext: string | null | undefined;
  /** When true, disable every input + button. Used by the parent to
   *  surface phase-locked state ("invoice past pre-submit" → leg-level
   *  mutations are server-side-rejected). */
  disabled?: boolean;
  /** Optional muted footnote shown below the editor (typically the
   *  same string the parent uses to disable the editor). */
  disabledReason?: string | null;
  /** When true, render the editor body without its wrapping Card —
   *  used when the parent is already a Card and wants the editor
   *  embedded. Defaults to false (renders as its own dashed Card). */
  bare?: boolean;
}

export function PerLegContextEditor({
  legId,
  perLegContext,
  disabled = false,
  disabledReason,
  bare = false,
}: PerLegContextEditorProps) {
  const initialSaved = (() => {
    const v = perLegContext ?? "";
    return isLegacyDerivedContext(v) ? "" : v;
  })();

  const [mode, setMode] = useState<PerLegContextEditorMode>("edit");
  const [raw, setRaw] = useState<string>("");
  const [clarified, setClarified] = useState<string>("");
  const [savedClarified, setSavedClarified] = useState<string>(initialSaved);

  // Re-sync when the parent refetches the leg and `perLegContext`
  // changes underneath us (e.g. a teammate saved context, then the
  // leg's react-query cache is invalidated). Only adopt the incoming
  // value while we're at rest in edit mode — never blow away an
  // in-flight readback / review / save.
  useEffect(() => {
    if (mode !== "edit") return;
    const incoming = perLegContext ?? "";
    const next = isLegacyDerivedContext(incoming) ? "" : incoming;
    setSavedClarified(next);
  }, [perLegContext, mode]);

  const requestReadback = useMutation({
    mutationFn: async (rawText: string) => {
      const res = await fetch(
        `${apiBase()}/api/claims/${legId}/per-leg-context-readback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ context: rawText }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { readback?: string };
      if (!json.readback) throw new Error("Empty AI response");
      return json.readback;
    },
    onSuccess: (readback) => {
      setClarified(readback);
      setMode("review");
    },
    onError: (err: Error) => {
      setMode("edit");
      toast({
        title: "AI clarification failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const acceptClarified = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(
        `${apiBase()}/api/claims/${legId}/per-leg-context`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ context: text }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return text;
    },
    onSuccess: (saved) => {
      setSavedClarified(saved);
      setMode("edit");
      setRaw("");
      setClarified("");
    },
    onError: (err: Error) => {
      setMode("review");
      toast({
        title: "Could not save the clarified note",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const clearSaved = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${apiBase()}/api/claims/${legId}/per-leg-context`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ context: "" }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      setSavedClarified("");
      setRaw("");
      setClarified("");
      setMode("edit");
    },
    onError: (err: Error) => {
      toast({
        title: "Could not clear the saved context",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function handleCheck() {
    if (!canRequestReadback({ mode, raw })) return;
    setMode("checking");
    requestReadback.mutate(raw);
  }

  function handleEdit() {
    setMode("edit");
    setClarified("");
  }

  function handleAccept() {
    if (mode !== "review" || !clarified) return;
    setMode("saving");
    acceptClarified.mutate(clarified);
  }

  const body = (
    <div className="space-y-2" data-testid="per-leg-context-editor">
      <label
        htmlFor={`per-leg-context-${legId}`}
        className="text-xs font-medium text-muted-foreground block"
      >
        Per-leg unique context (optional — anything the dispute write-up
        should know about this specific leg)
      </label>

      {savedClarified && (
        <div
          className="bg-white dark:bg-background rounded-md p-2 border space-y-1"
          data-testid="sop-include-saved-context"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
              Saved per-leg context
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => clearSaved.mutate()}
              disabled={disabled || clearSaved.isPending || mode !== "edit"}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive gap-1"
              data-testid="sop-include-clear-saved-btn"
            >
              {clearSaved.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Clear saved
            </Button>
          </div>
          <p className="text-xs whitespace-pre-line">{savedClarified}</p>
        </div>
      )}

      {mode === "review" ? (
        <ReviewPane
          raw={raw}
          clarified={clarified}
          onAccept={handleAccept}
          onEdit={handleEdit}
          disabled={disabled}
        />
      ) : (
        <Textarea
          id={`per-leg-context-${legId}`}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          disabled={disabled || mode === "checking" || mode === "saving"}
          rows={3}
          placeholder="Type a quick note (you'll see an AI-cleaned restatement before it's saved)…"
          data-testid="sop-include-context-editor"
        />
      )}

      {mode === "edit" && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCheck}
            disabled={disabled || !canRequestReadback({ mode, raw })}
            className="gap-1.5"
            data-testid="sop-include-check-btn"
          >
            <Sparkles className="h-3 w-3" /> Check with AI
          </Button>
        </div>
      )}

      {mode === "checking" && (
        <div
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          data-testid="sop-include-readback-checking"
        >
          <Loader2 className="h-3 w-3 animate-spin" /> Asking the AI to restate your note…
        </div>
      )}

      {mode === "saving" && (
        <div
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          data-testid="sop-include-readback-saving"
        >
          <Loader2 className="h-3 w-3 animate-spin" /> Saving the clarified note…
        </div>
      )}

      {disabled && disabledReason && (
        <p className="text-[11px] text-muted-foreground italic">{disabledReason}</p>
      )}
    </div>
  );

  if (bare) return body;

  return (
    <Card className="border-dashed">
      <CardContent className="p-3">{body}</CardContent>
    </Card>
  );
}

function ReviewPane({
  raw,
  clarified,
  onAccept,
  onEdit,
  disabled,
}: {
  raw: string;
  clarified: string;
  onAccept: () => void;
  onEdit: () => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2" data-testid="sop-include-readback-review">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="bg-white dark:bg-background rounded-md p-2 border space-y-1">
          <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
            Your note
          </p>
          <p
            className="text-xs whitespace-pre-line"
            data-testid="sop-include-readback-raw"
          >
            {raw}
          </p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-md p-2 border border-emerald-200 dark:border-emerald-900 space-y-1">
          <p className="text-[10px] uppercase tracking-wide font-medium text-emerald-700 dark:text-emerald-300">
            AI restatement (will be saved)
          </p>
          <p
            className="text-xs whitespace-pre-line"
            data-testid="sop-include-readback-clarified"
          >
            {clarified}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={onAccept}
          disabled={disabled}
          className="gap-1.5"
          data-testid="sop-include-accept-btn"
        >
          <CheckCircle2 className="h-3 w-3" /> Accept clarified
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onEdit}
          disabled={disabled}
          className="gap-1.5"
          data-testid="sop-include-edit-btn"
        >
          <Edit3 className="h-3 w-3" /> Edit
        </Button>
      </div>
    </div>
  );
}
