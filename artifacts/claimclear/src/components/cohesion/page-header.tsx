import type { ReactNode } from "react";
import { TONE_STYLE, type Tone } from "./tone";

export type PageHeaderProps = {
  title: string;
  sub?: ReactNode;
  accent?: Tone;
  actions?: ReactNode;
};

export function PageHeader({ title, sub, accent = "blue", actions }: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <div
          className="w-1 h-9 rounded"
          style={{ background: TONE_STYLE[accent].fg }}
          aria-hidden="true"
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="page-header-title">
            {title}
          </h1>
          {sub && (
            <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
