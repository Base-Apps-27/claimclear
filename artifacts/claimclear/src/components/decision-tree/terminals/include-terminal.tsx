// Task #372 — Include terminal (end-of-walk "Ready" surface for legs
// whose outcomeRole collapses to the include bucket: legacy
// `portal_dispute` and the new `dispute`).
//
// What lives here:
//   - The OPTIONAL per-leg unique-context input (moved from the top of
//     the leg detail; the SOP transcript replaced that surface).
//   - The AI-clarification gate, mirroring the group-submission
//     readback in `portal-submissions.ts: preflight-understanding`. The
//     operator's rough note is sent to Claude, the model returns a
//     cleaned restatement, and the operator reviews and either Accepts
//     (which persists via `/per-leg-context`) or Edits (back to typing).
//   - Hand-off CTA. Disabled while operator has unsaved typed text or
//     is mid-readback; an empty input is fine — empty context is a
//     legitimate hand-off ("nothing leg-specific to add").
//   - Channel hint sourced from the error type (carried over).
//
// Migration: a leg whose `perLegContext` is `isLegacyDerivedContext`
// (the pre-#372 "• Q — A" auto-derived bullet list) is treated as
// EMPTY for this editor. The legacy text still surfaces under the SOP
// transcript card on the leg page so it's not lost — but it doesn't
// pre-populate the optional context input here, because it isn't a
// genuine human-authored finding.

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

void React; // JSX runtime: keep React in scope under tsx --test (jsxFactory=React.createElement).
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Send, Sparkles, Edit3, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { OUTCOME_COLORS } from "../types";
import {
  channelHintForErrorType,
  channelHintLabel,
  type ErrorTypeChannelInput,
} from "@/lib/sop-terminal-routing";
import { isLegacyDerivedContext } from "@workspace/leg-state";
import type { TerminalCommonProps } from "./types";

function apiBase(): string {
  // Vite injects `import.meta.env` at build time; under the node:test
  // runtime (jsdom-based component tests) it is undefined. Read defensively
  // so the component is mountable in a jsdom test without throwing — empty
  // string is the same value Vite emits for the root-mounted artifact.
  const env = (import.meta as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL?.replace(/\/$/, "") || "";
}

// Editor mode state machine. Pure-helper testable below.
//   "edit"     → operator is typing or hasn't done anything yet.
//   "checking" → POST /per-leg-context-readback in flight.
//   "review"   → AI returned; raw + clarified rendered side-by-side.
//   "saving"   → POST /per-leg-context in flight (Accept clicked).
export type IncludeEditorMode = "edit" | "checking" | "review" | "saving";

// Pure: hand-off button enabled iff the operator has no unsaved typed
// text and is not mid-clarification.
//
// Two valid hand-off paths:
//   (a) Raw input is empty (whitespace-only counts as empty) — the
//       operator has nothing leg-specific to add. ALWAYS allowed,
//       regardless of `lastSavedRaw`. After a previous Accept, the
//       operator can clear the box and hand off; the previously-saved
//       clarified text is still on the server (rendered as the
//       savedClarified summary). To erase the saved context entirely
//       the operator uses the explicit "Clear saved context" button,
//       which posts an empty string to /per-leg-context.
//   (b) Raw input matches `lastSavedRaw` — the operator's typed text
//       is the SAME text whose clarification has just been Accepted,
//       so nothing is being silently dropped.
//
// Anything else — typed text different from `lastSavedRaw` — blocks
// hand-off. The operator must either clear the box, run Check + Accept
// again, or revert to the last-accepted text.
export function canHandoff(args: {
  mode: IncludeEditorMode;
  raw: string;
  lastSavedRaw: string;
}): boolean {
  if (args.mode !== "edit") return false;
  if (args.raw.trim().length === 0) return true;
  return args.raw === args.lastSavedRaw;
}

// Pure: "Check with AI" button enabled iff there's something to check.
export function canRequestReadback(args: {
  mode: IncludeEditorMode;
  raw: string;
}): boolean {
  return args.mode === "edit" && args.raw.trim().length > 0;
}

// Pure: which readback-state testid should render given the mode?
export function readbackStatusTestId(
  mode: IncludeEditorMode,
): "sop-include-readback-checking" | "sop-include-readback-review" | "sop-include-readback-saving" | null {
  if (mode === "checking") return "sop-include-readback-checking";
  if (mode === "review") return "sop-include-readback-review";
  if (mode === "saving") return "sop-include-readback-saving";
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

  // Migration: legacy "• Q — A" perLegContext doesn't seed the editor
  // (the SOP transcript card on the leg page surfaces it). Anything else
  // non-empty is the previously-accepted clarified text and is shown
  // as a "current saved context" summary, not as the raw input.
  const initialClarified = (() => {
    const v = leg.perLegContext ?? "";
    if (isLegacyDerivedContext(v)) return "";
    return v;
  })();

  const [mode, setMode] = useState<IncludeEditorMode>("edit");
  const [raw, setRaw] = useState<string>("");
  const [clarified, setClarified] = useState<string>("");
  const [savedClarified, setSavedClarified] = useState<string>(initialClarified);
  const lastSavedRawRef = useRef<string>("");

  // Re-sync if the persisted context changes from outside (SSE refetch
  // landed a different leg payload). Migration rule applies on every
  // sync, not just first mount — a legacy value pushed in mid-session
  // still must not seed the editor.
  useEffect(() => {
    const incoming = leg.perLegContext ?? "";
    const next = isLegacyDerivedContext(incoming) ? "" : incoming;
    setSavedClarified(next);
  }, [leg.perLegContext]);

  const requestReadback = useMutation({
    mutationFn: async (rawText: string) => {
      const res = await fetch(
        `${apiBase()}/api/claims/${leg.id}/per-leg-context-readback`,
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
        `${apiBase()}/api/claims/${leg.id}/per-leg-context`,
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
      lastSavedRawRef.current = raw;
      setMode("edit");
      // Keep raw in the box so canHandoff(raw === lastSavedRaw) trips
      // true and the operator can hand off immediately. Operator can
      // clear it manually if they prefer.
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

  // Explicit "Clear saved context" path. Optional-field semantics
  // require an affordance to ERASE prior saved per-leg context — not
  // just to hand off without changing it. POSTs an empty string, which
  // the server records as null per /per-leg-context handler.
  const clearSaved = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${apiBase()}/api/claims/${leg.id}/per-leg-context`,
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
      lastSavedRawRef.current = "";
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

  const channelHint = channelHintForErrorType(errorType);
  const channelLabel = channelHintLabel(channelHint);
  const handoffEnabled = !disabled && canHandoff({ mode, raw, lastSavedRaw: lastSavedRawRef.current });

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

        <div className="space-y-1.5">
          <label
            htmlFor={`per-leg-context-${leg.id}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Per-leg unique context (optional — anything the dispute
            write-up should know about this leg specifically)
          </label>

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
              id={`per-leg-context-${leg.id}`}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              disabled={disabled || mode === "checking" || mode === "saving"}
              rows={4}
              placeholder="Type a quick note (you'll see an AI-cleaned restatement before it's saved)…"
              data-testid="sop-include-context-editor"
            />
          )}

          {(mode === "edit") && (
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
              {raw !== lastSavedRawRef.current && raw.trim().length > 0 && (
                <span
                  className="text-[11px] text-muted-foreground italic"
                  data-testid="sop-include-handoff-blocked-hint"
                >
                  Run "Check with AI" and Accept before handing off — or clear the box.
                </span>
              )}
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
            disabled={!handoffEnabled}
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

function ReviewPane({
  raw, clarified, onAccept, onEdit, disabled,
}: {
  raw: string;
  clarified: string;
  onAccept: () => void;
  onEdit: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className="space-y-2"
      data-testid="sop-include-readback-review"
    >
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
