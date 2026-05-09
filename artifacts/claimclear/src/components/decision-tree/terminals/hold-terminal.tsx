// Hold terminal. Byte-equivalent to the pre-refactor block in
// the live SOP player (Guard #3). Resume / clear-sop-hold /
// stale-tree fallback are the operator-critical paths.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, PauseCircle, Play } from "lucide-react";
import { OUTCOME_COLORS, OUTCOME_LABELS } from "../types";
import { toast } from "@/hooks/use-toast";
import { invalidateLegCache } from "@/lib/apply-mutation-result";
import type { TerminalCommonProps } from "./types";

function apiBase(): string {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
}

export function HoldTerminal({
  leg,
  tree,
  disabledReason,
  onAdvanced,
}: TerminalCommonProps) {
  const qc = useQueryClient();
  const disabled = !!disabledReason;
  const colors = OUTCOME_COLORS.hold;
  const label = OUTCOME_LABELS.hold;
  const canResumeFromNode =
    !!leg.sopNodeId && !!tree?.nodes.some((n) => n.id === leg.sopNodeId);

  const clearSopHoldMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${apiBase()}/api/claims/${leg.id}/clear-sop-hold`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateLegCache(qc, leg.id, leg.invoiceGroupId);
      onAdvanced?.({ isTerminal: false, sopOutcome: null });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not clear SOP hold",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card
      className={`${colors.bg} border ${colors.border}`}
      data-testid="sop-terminal-card"
    >
      <CardContent className="p-4 text-center space-y-2">
        <PauseCircle className={`h-9 w-9 mx-auto ${colors.text}`} />
        <div>
          <p className={`text-base font-semibold ${colors.text}`}>{label}</p>
          <p className="text-xs text-muted-foreground mt-1">
            SOP outcome:{" "}
            <code className="font-mono">{leg.sopOutcome}</code>
            {leg.dropReason ? (
              <>
                {" · drop reason: "}
                <code className="font-mono">{leg.dropReason}</code>
              </>
            ) : null}
          </p>
          {canResumeFromNode ? (
            <div className="mt-3 space-y-2">
              <p
                className="text-xs text-muted-foreground"
                data-testid="sop-hold-guidance"
              >
                SOP walk paused at this step. Resume to continue from where
                you left off.
              </p>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={disabled || clearSopHoldMutation.isPending}
                onClick={() => clearSopHoldMutation.mutate()}
                data-testid="sop-hold-resume-btn"
              >
                {clearSopHoldMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Resume — clear hold
              </Button>
              {disabled && disabledReason && (
                <p className="text-xs text-muted-foreground italic">
                  {disabledReason}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <p
                className="text-xs text-amber-700"
                data-testid="sop-hold-stale-guidance"
              >
                Resume is not available; the SOP workflow was updated since
                this hold was placed. Reclassify the leg to restart the SOP
                walk.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
