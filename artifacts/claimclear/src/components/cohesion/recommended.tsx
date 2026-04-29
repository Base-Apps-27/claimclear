import type { ReactNode } from "react";
import { TONE_STYLE, type Tone } from "./tone";

export type RecommendedProps = {
  tone?: Tone;
  title: string;
  body?: ReactNode;
  cta: ReactNode;
  sub?: ReactNode;
};

export function Recommended({ tone = "blue", title, body, cta, sub }: RecommendedProps) {
  const c = TONE_STYLE[tone];
  return (
    <div
      className="p-4 border-t border-border"
      style={{ background: c.bg }}
      data-testid="recommended"
    >
      <div className="text-xs uppercase font-semibold mb-2" style={{ color: c.fg }}>
        Recommended
      </div>
      <div className="text-sm font-medium mb-1" style={{ color: c.fg }}>
        {title}
      </div>
      {body && (
        <div className="text-xs mb-3" style={{ color: c.fg, opacity: 0.85 }}>
          {body}
        </div>
      )}
      {cta}
      {sub && (
        <div className="text-xs mt-2" style={{ color: c.fg, opacity: 0.85 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export type ToneButtonProps = {
  tone?: Tone;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  type?: "button" | "submit";
  testId?: string;
};

export function ToneButton({ tone = "blue", onClick, disabled, children, type = "button", testId }: ToneButtonProps) {
  const c = TONE_STYLE[tone];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="w-full justify-center inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ background: c.fg }}
    >
      {children}
    </button>
  );
}
