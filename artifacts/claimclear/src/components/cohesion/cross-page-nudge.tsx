import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { TONE_STYLE, type Tone } from "./tone";
import { Link } from "wouter";

export type CrossPageNudgeProps = {
  text: ReactNode;
  linkLabel: string;
  href: string;
  linkTone?: Tone;
};

export function CrossPageNudge({ text, linkLabel, href, linkTone = "blue" }: CrossPageNudgeProps) {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground" data-testid="cross-page-nudge">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          {text}{" "}
          <Link
            href={href}
            className="font-medium hover:underline"
            style={{ color: TONE_STYLE[linkTone].fg }}
            data-testid="cross-page-nudge-link"
          >
            {linkLabel}
          </Link>
          .
        </span>
      </div>
    </div>
  );
}
