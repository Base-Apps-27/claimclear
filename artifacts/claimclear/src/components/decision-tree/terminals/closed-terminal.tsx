// Closed terminal — cannot_dispute / non_issue / internal. Read-only;
// reclassify affordance lives on the parent surface.

import { Card, CardContent } from "@/components/ui/card";
import { Ban, FileX, XCircle } from "lucide-react";
import { OUTCOME_COLORS, OUTCOME_LABELS, type OutcomeType } from "../types";
import type { TerminalCommonProps } from "./types";

const ICONS = {
  cannot_dispute: XCircle,
  non_issue: FileX,
  internal: Ban,
} as const;

type ClosedKey = keyof typeof ICONS;

const INTERNAL_LABEL = "Resolve Internally";
const INTERNAL_COLORS = OUTCOME_COLORS.internal;

function resolveColors(key: ClosedKey) {
  if (key === "internal") return INTERNAL_COLORS;
  return OUTCOME_COLORS[key as OutcomeType];
}

function resolveLabel(key: ClosedKey) {
  if (key === "internal") return INTERNAL_LABEL;
  return OUTCOME_LABELS[key as OutcomeType];
}

export function ClosedTerminal({ leg }: TerminalCommonProps) {
  const key = (leg.sopOutcome as ClosedKey) ?? "cannot_dispute";
  const colors = resolveColors(key);
  const label = resolveLabel(key);
  const Icon = ICONS[key] ?? ICONS.cannot_dispute;

  return (
    <Card
      className={`${colors.bg} border ${colors.border}`}
      data-testid="sop-terminal-card"
    >
      <CardContent className="p-4 text-center space-y-2">
        <Icon className={`h-9 w-9 mx-auto ${colors.text}`} />
        <div className="space-y-1">
          <p className={`text-base font-semibold ${colors.text}`}>{label}</p>
          {leg.dropReason ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="sop-terminal-closure-category"
            >
              Closure category:{" "}
              <code className="font-mono">{leg.dropReason}</code>
            </p>
          ) : null}
          <p
            className="text-xs text-muted-foreground italic"
            data-testid="sop-terminal-guidance"
          >
            Outcome set by SOP — Reclassify if wrong.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
