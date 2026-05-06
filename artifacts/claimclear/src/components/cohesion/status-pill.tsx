import type { ReactNode } from "react";
import { TONE_STYLE, toneForStatus, type Tone } from "./tone";
import { WrapTooltip } from "@/components/info-tooltip";
import {
  CLAIM_STATUS,
  OUTCOME,
  claimStatusLabel,
  outcomeLabel,
} from "@workspace/vocab";

// Inline SVG check used by the one-shot completion microinteraction
// (Task #315). Stroke-dash draw-in is driven by `.cc-check-tick` in
// `index.css`, which also handles `prefers-reduced-motion`.
function AnimatedCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M5 12.5l4 4 10-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="cc-check-tick"
      />
    </svg>
  );
}

// Tooltips and labels are sourced from @workspace/vocab — the glossary
// is the single source of truth. Tone (color) lives next to the JSX in
// `./tone.ts` because it's purely presentation.

const statusDescriptions: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const entry of Object.values(CLAIM_STATUS)) out[entry.enumValue] = entry.description;
  for (const entry of Object.values(OUTCOME)) out[entry.enumValue] = entry.description;
  return out;
})();

export type StatusPillProps = {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
  /**
   * One-shot decoration used when the pill has just transitioned to a
   * "done" state from the operator's own action. Renders an animated
   * check that draws in over ~420ms plus a soft background fade. The
   * caller is responsible for clearing the prop after the animation so
   * it cannot replay on re-render. See Task #315.
   */
  justTransitioned?: boolean;
};

export function StatusPill({
  tone = "muted",
  children,
  className = "",
  justTransitioned = false,
  "data-testid": dataTestId,
}: StatusPillProps) {
  const c = TONE_STYLE[tone];
  const transitionClass = justTransitioned ? " cc-pill-just-transitioned" : "";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap${transitionClass} ${className}`}
      style={{ background: c.bg, color: c.fg }}
      data-just-transitioned={justTransitioned ? "true" : undefined}
      data-testid={dataTestId}
    >
      {justTransitioned ? <AnimatedCheck /> : null}
      {children}
    </span>
  );
}

export type StatusPillForStatusProps = {
  status: string;
  className?: string;
};

export function StatusPillForStatus({ status, className }: StatusPillForStatusProps) {
  const tone = toneForStatus(status);
  const description = statusDescriptions[status];
  const label = CLAIM_STATUS[status as keyof typeof CLAIM_STATUS]
    ? claimStatusLabel(status)
    : outcomeLabel(status) || status;
  const pill = <StatusPill tone={tone} className={className}>{label}</StatusPill>;
  if (!description) return pill;
  return (
    <WrapTooltip content={description}>
      <span className="cursor-help">{pill}</span>
    </WrapTooltip>
  );
}
