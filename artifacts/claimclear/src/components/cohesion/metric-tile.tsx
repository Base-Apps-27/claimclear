import type { ReactNode } from "react";
import { TONE_STYLE, type Tone } from "./tone";
import { cn } from "@/lib/utils";

export type MetricTileProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  className?: string;
};

export function MetricTile({ label, value, sub, tone = "muted", className }: MetricTileProps) {
  const c = TONE_STYLE[tone];
  return (
    <div className={cn("rounded-md border border-border bg-card p-4", className)}>
      <div className="text-[11px] uppercase tracking-wide font-semibold mb-1.5 text-muted-foreground">
        {label}
      </div>
      <div
        className="text-2xl font-bold tabular-nums"
        style={{ color: tone === "muted" ? "hsl(var(--foreground))" : c.fg }}
      >
        {value}
      </div>
      {sub && <div className="text-xs mt-1 text-muted-foreground">{sub}</div>}
    </div>
  );
}
