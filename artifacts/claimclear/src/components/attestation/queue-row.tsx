import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { TONE_STYLE, TonePill, type Tone } from "@/components/cohesion";
import { cn } from "@/lib/utils";
import { relativeAge } from "./utils";
import { absoluteTooltip } from "@/lib/time";

export interface QueueRowProps {
  rowKey: string;
  invoiceNumber: string;
  legCount: number;
  legCountTestId?: string;
  isSelected: boolean;
  onSelect: () => void;
  selectedTone?: Tone;
  rowTestId: string;
  /** Second line — payor + status pill. (Legacy slot, used by Completed tab.) */
  middleLine?: ReactNode;
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
  /* ── Variant B redesign (Task #650) ──
   *
   * When `pendingCount` is provided the row renders the Variant B
   * three-line layout (invoice + dots/tags · pending pill · service
   * date · age) and the `middleLine`/`bottomLine` slots are ignored.
   * The Completed tab keeps using the legacy slots so its layout is
   * unchanged.
   */
  pendingCount?: number;
  pendingCountTestId?: string;
  serviceDateLabel?: string | null;
  serviceDateTestId?: string;
  isHot?: boolean;
  hotDotTestId?: string;
  isFresh?: boolean;
  freshDotTestId?: string;
  isNextUp?: boolean;
}

export function QueueRow({
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
  pendingCount,
  pendingCountTestId,
  serviceDateLabel = null,
  serviceDateTestId,
  isHot = false,
  hotDotTestId,
  isFresh = false,
  freshDotTestId,
  isNextUp = false,
}: QueueRowProps) {
  const variantB = pendingCount !== undefined;
  const age = relativeAge(enteredAt);
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
        {variantB ? (
          <>
            {/* Line 1 — invoice, leg count, hot/fresh dots, next-up tag */}
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
              {isHot && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: TONE_STYLE.red.fg }}
                  title="Contains a denied or non-contestable leg — file ASAP"
                  aria-label="Contains a denied or non-contestable leg"
                  data-testid={hotDotTestId}
                />
              )}
              {isFresh && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: TONE_STYLE.blue.fg }}
                  title="Just landed"
                  aria-label="Just landed"
                  data-testid={freshDotTestId}
                />
              )}
              {isNextUp && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide font-bold"
                  data-testid="queue-row-next-up-tag"
                >
                  Next up
                </Badge>
              )}
            </div>
            {/* Line 2 — pending pill (or Done) */}
            <div className="mt-1.5">
              <span data-testid={pendingCountTestId}>
                {pendingCount > 0 ? (
                  <TonePill
                    tone="amber"
                    className="text-[10px] uppercase tracking-wide font-bold"
                  >
                    {pendingCount} pending
                  </TonePill>
                ) : (
                  <TonePill
                    tone="green"
                    className="text-[10px] uppercase tracking-wide font-bold"
                  >
                    Done
                  </TonePill>
                )}
              </span>
            </div>
            {/* Line 3 — service date · age */}
            {(serviceDateLabel || age) && (
              <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5">
                {age?.isStale && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: TONE_STYLE.amber.fg }}
                    aria-hidden="true"
                  />
                )}
                {serviceDateLabel && (
                  <span data-testid={serviceDateTestId}>
                    Service {serviceDateLabel}
                  </span>
                )}
                {serviceDateLabel && age && <span aria-hidden="true">·</span>}
                {age && (
                  <span title={absoluteTooltip(age.iso)}>{age.label}</span>
                )}
              </div>
            )}
          </>
        ) : (
          <>
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
                <span title={absoluteTooltip(age.iso)}>{age.label}</span>
              </div>
            ) : null}
          </>
        )}
      </button>
    </li>
  );
}
