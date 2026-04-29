import type { ReactNode } from "react";

export type StatusDotTone = "green" | "amber" | "red" | "blue" | "muted";

const DOT_COLOR: Record<StatusDotTone, string> = {
  green: "hsl(var(--cc-success))",
  amber: "hsl(var(--cc-warning))",
  red: "hsl(var(--destructive))",
  blue: "hsl(var(--primary))",
  muted: "hsl(var(--muted-foreground))",
};

export function StatusDot({ tone }: { tone: StatusDotTone }) {
  return (
    <span
      aria-hidden="true"
      className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0"
      style={{ background: DOT_COLOR[tone] }}
    />
  );
}

export function StatusStrip({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 text-xs flex-wrap rounded-md border border-border bg-card"
      data-testid="status-strip"
    >
      {children}
    </div>
  );
}
