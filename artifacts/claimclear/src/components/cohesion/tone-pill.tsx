import type { ReactNode } from "react";
import { TONE_STYLE, type Tone } from "./tone";

// Presentational tone-pill primitive. Renders arbitrary children with a
// `Tone` background — used by the unified `<StateBadge>` (which adds
// vocab-sourced label + tooltip + drift safety on top) and by the
// handful of decorative chip sites that are NOT one of the six state
// domains (counters, "DONE" stamps, MAS-action prompts, etc).
//
// This file is the renamed-and-reduced successor of the previous
// `cohesion/status-pill.tsx`, which had three jobs: render a tone pill,
// render a status-keyed pill (`StatusPillForStatus`), and render a
// row-aware status pill (`StatusPillForRow`). Tasks #554 collapses the
// last two into `<StateBadge variant="status" …>` and deletes the
// parallel renderer; this file keeps only the dumb presentation
// primitive.

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

export type TonePillProps = {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
  /**
   * One-shot decoration used when the pill has just transitioned to a
   * "done" state from the operator's own action. See Task #315 / #324.
   */
  justTransitioned?: boolean;
};

export function TonePill({
  tone = "muted",
  children,
  className = "",
  justTransitioned = false,
  "data-testid": dataTestId,
}: TonePillProps) {
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
