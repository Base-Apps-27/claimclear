import type { ReactNode } from "react";
import { TONE_STYLE, toneForStatus, type Tone } from "./tone";
import { WrapTooltip } from "@/components/info-tooltip";
import {
  CLAIM_STATUS,
  OUTCOME,
  claimStatusLabel,
  outcomeLabel,
} from "@workspace/vocab";

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
};

export function StatusPill({ tone = "muted", children, className = "" }: StatusPillProps) {
  const c = TONE_STYLE[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}
      style={{ background: c.bg, color: c.fg }}
    >
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
