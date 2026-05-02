// Small "AI saw extra context" affordance shown above the dispute draft.
// The reviewer reads the write-up; this badge tells them, at a glance,
// that the underlying prompt also fed Claude per-leg findings the
// operator captured during the SOP walk and/or that sibling duplicates
// were rolled under a primary. Clicking opens a popover that lists each
// contributing leg + each rolled-under duplicate so a mis-rolled sibling
// is spotable without leaving the page.

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  computePromptContextCounters,
  summarizePromptContext,
  type PromptContextLegRow,
} from "@/lib/prompt-context-counters";

export interface PromptContextBadgeProps {
  legs: PromptContextLegRow[];
  /** Optional id for the trigger so e2e tests can target the badge on a
   *  specific surface (gauntlet, per-claim email view, etc). */
  testId?: string;
}

export function PromptContextBadge({ legs, testId }: PromptContextBadgeProps) {
  const counters = computePromptContextCounters(legs);
  if (!counters.hasContext) return null;
  const summary = summarizePromptContext(counters);
  if (!summary) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex"
          data-testid={testId ?? "badge-prompt-context"}
          aria-label={`AI prompt context details: ${summary}`}
        >
          <Badge
            variant="outline"
            className="gap-1 text-[10px] py-0 px-1.5 font-normal border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 cursor-pointer dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800"
          >
            <Sparkles className="h-3 w-3" />
            <span>{summary}</span>
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-96 max-w-[90vw] space-y-3 text-xs"
        align="start"
        data-testid="popover-prompt-context"
      >
        <div className="space-y-1">
          <div className="text-sm font-semibold">AI prompt context</div>
          <p className="text-muted-foreground">
            What the AI saw on top of the dispute reason and SOP guidance.
          </p>
        </div>

        {counters.perLegContextLegs.length > 0 && (
          <div className="space-y-1.5">
            <div className="font-semibold text-muted-foreground uppercase tracking-wide">
              Per-leg findings ({counters.perLegContextLegCount} of {counters.visibleLegCount})
            </div>
            <ul
              className="space-y-1.5"
              data-testid="list-prompt-context-per-leg"
            >
              {counters.perLegContextLegs.map((entry) => (
                <li
                  key={entry.claimId}
                  className="rounded border border-muted bg-muted/30 px-2 py-1.5"
                  data-testid={`prompt-context-per-leg-${entry.claimId}`}
                >
                  <div className="font-medium">Conf #{entry.confNumber}</div>
                  <p className="text-muted-foreground whitespace-pre-wrap break-words">
                    {entry.perLegContext}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {counters.siblingDuplicates.length > 0 && (
          <div className="space-y-1.5">
            <div className="font-semibold text-muted-foreground uppercase tracking-wide">
              Sibling duplicates rolled up ({counters.siblingDuplicateCount})
            </div>
            <ul
              className="space-y-1"
              data-testid="list-prompt-context-siblings"
            >
              {counters.siblingDuplicates.map((entry) => (
                <li
                  key={entry.duplicateClaimId}
                  className="flex flex-wrap items-center gap-1"
                  data-testid={`prompt-context-sibling-${entry.duplicateClaimId}`}
                >
                  <span className="font-medium">Conf #{entry.duplicateConfNumber}</span>
                  <span className="text-muted-foreground">→ rolled under primary</span>
                  <span className="font-medium">Conf #{entry.primaryConfNumber}</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-muted-foreground italic">
              The trip-overriding finding lives on the primary; duplicates are not re-stated to the AI.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
