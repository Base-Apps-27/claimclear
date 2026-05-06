import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { TONE_STYLE, type Tone } from "@/components/cohesion";
import { cn } from "@/lib/utils";
import { relativeAge } from "./utils";

export interface QueueRowProps {
  rowKey: string;
  invoiceNumber: string;
  legCount: number;
  legCountTestId?: string;
  isSelected: boolean;
  onSelect: () => void;
  selectedTone?: Tone;
  rowTestId: string;
  /** Second line — payor + status pill. */
  middleLine: ReactNode;
  /** Third line — relative age, or any caller-supplied secondary line. */
  bottomLine?: ReactNode;
  /** Timestamp used for the relative-age default bottom line. */
  enteredAt?: string | null;
  /** Task #490 — soften row removal. The row plays a brief settle
   *  animation (success tint + slide/fade) before unmount. */
  isSettling?: boolean;
  /** Task #490 — brief highlight ring on the row that just became
   *  selected as a result of an auto-advance. */
  isJustSelected?: boolean;
}

export function QueueRow({
  rowKey,
  invoiceNumber,
  legCount,
  legCountTestId,
  isSelected,
  onSelect,
  selectedTone = "blue",
  rowTestId,
  middleLine,
  bottomLine,
  enteredAt = null,
  isSettling = false,
  isJustSelected = false,
}: QueueRowProps) {
  const age = bottomLine === undefined ? relativeAge(enteredAt) : null;
  const accent = TONE_STYLE[selectedTone].fg;
  return (
    <li
      className={cn(
        isSettling && "cc-row-settling",
        isJustSelected && "cc-row-just-selected",
      )}
      data-settling={isSettling ? "true" : undefined}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={isSettling}
        data-testid={rowTestId}
        className={cn(
          "w-full text-left px-4 py-3 transition-colors hover-elevate border-l-2",
          isSelected ? "bg-muted" : "border-l-transparent",
        )}
        style={isSelected ? { borderLeftColor: accent } : undefined}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-semibold">
            {invoiceNumber || "—"}
          </span>
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wide font-bold"
            data-testid={legCountTestId}
          >
            {legCount} {legCount === 1 ? "leg" : "legs"}
          </Badge>
        </div>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-muted-foreground min-w-0">
          {middleLine}
        </div>
        {bottomLine !== undefined ? (
          bottomLine && (
            <div className="mt-1 text-xs text-muted-foreground">
              {bottomLine}
            </div>
          )
        ) : age ? (
          <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5">
            {age.isStale && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: TONE_STYLE.amber.fg }}
                aria-hidden="true"
              />
            )}
            <span>{age.label}</span>
          </div>
        ) : null}
      </button>
    </li>
  );
}
