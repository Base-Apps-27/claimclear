import "./_attest.css";
import type { ReactNode, CSSProperties } from "react";

export const Icons = {
  Shield: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  Check: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  CheckCircle: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  ),
  Alert: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  External: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  ),
  Mail: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  ),
  Chevron: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  ArrowRight: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  Cancel: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    </svg>
  ),
  Refresh: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  ),
  Info: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  ),
  Lock: (p: { className?: string; style?: CSSProperties }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
};

/* ─────────────────────────────────────────────────────────────
 * Frame label — orange chip + title bar on top of every variant.
 * Matches the queue-redesign convention.
 * ───────────────────────────────────────────────────────────── */
export function FrameLabel({
  tag, title, principles,
}: { tag: string; title: string; principles?: string[] }) {
  return (
    <div style={{
      background: "white",
      borderBottom: "1px solid var(--cc-border)",
      padding: "10px 16px", display: "flex", alignItems: "center",
      gap: 12, flexWrap: "wrap",
    }}>
      <span style={{
        background: "hsl(12 79% 57%)", color: "white",
        padding: "3px 8px", borderRadius: 4, fontSize: 11,
        fontWeight: 800, letterSpacing: 0.5,
      }}>{tag}</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      {principles && principles.map((p, i) => (
        <span key={i} className="cc-tag">{p}</span>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Realistic fixture data — modeled after one bucket the user
 * would actually see today: invoice #INV-44192, 3 legs total,
 * 1 Denied (#R-7733) requiring MAS cancel, 2 Approved survivors
 * (#R-7731, #R-7732) waiting to be re-attested.
 *
 * That's the canonical "1 cancel + 1 reattest = 2 checkboxes
 * with implicit dependency" shape the user complained about.
 * ───────────────────────────────────────────────────────────── */

export interface Leg {
  id: string;        // confNumber, e.g. R-7731
  outcome: "Approved" | "Partially Approved" | "Denied";
  errorType?: string;
  needsCancel?: boolean;
  cancelDone?: boolean;
}

export interface Bucket {
  invoice: string;     // e.g. INV-44192
  payor: string;       // e.g. CL-9023
  legs: Leg[];
  enteredHours: number;
  payorReply?: { source: "email" | "portal"; subject: string; ago: string };
}

export const SELECTED_BUCKET: Bucket = {
  invoice: "INV-44192",
  payor: "CL-9023",
  enteredHours: 6,
  payorReply: {
    source: "email",
    subject: "Re: dispute on INV-44192 — accepting 2 of 3",
    ago: "5h ago",
  },
  legs: [
    { id: "R-7731", outcome: "Approved" },
    { id: "R-7732", outcome: "Partially Approved" },
    { id: "R-7733", outcome: "Denied", errorType: "GPS deviation", needsCancel: true, cancelDone: false },
  ],
};

export const QUEUE: Array<{
  invoice: string; payor: string; legCount: number; tone: "amber" | "blue";
  pillLabel: string; ago: string; selected?: boolean;
}> = [
  { invoice: "INV-44192", payor: "CL-9023", legCount: 3, tone: "amber", pillLabel: "1 cancel · 1 re-attest", ago: "6h ago", selected: true },
  { invoice: "INV-44188", payor: "CL-9023", legCount: 2, tone: "amber", pillLabel: "1 re-attest owed",        ago: "9h ago" },
  { invoice: "INV-44174", payor: "CL-8841", legCount: 4, tone: "amber", pillLabel: "2 cancels · 1 re-attest", ago: "1d ago" },
  { invoice: "INV-44166", payor: "CL-9100", legCount: 1, tone: "amber", pillLabel: "1 re-attest owed",        ago: "1d ago" },
  { invoice: "INV-44159", payor: "CL-8841", legCount: 5, tone: "blue",  pillLabel: "Parked · waiting on you", ago: "2d ago" },
  { invoice: "INV-44143", payor: "CL-9023", legCount: 2, tone: "amber", pillLabel: "1 re-attest owed",        ago: "2d ago" },
  { invoice: "INV-44120", payor: "CL-9100", legCount: 3, tone: "amber", pillLabel: "1 cancel · 1 re-attest",  ago: "3d ago" },
  { invoice: "INV-44098", payor: "CL-9023", legCount: 1, tone: "amber", pillLabel: "1 re-attest owed",        ago: "4d ago" },
];

/* Reusable primitives (so variants stay consistent visually) */

export function Pill({ tone, children }: {
  tone: "amber" | "blue" | "green" | "red" | "purple" | "muted";
  children: ReactNode;
}) {
  return <span className={`cc-pill cc-pill-${tone}`}>{children}</span>;
}

export function Checkbox({
  checked, disabled, onClick,
}: { checked: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className={`cc-checkbox ${checked ? "cc-checkbox-checked" : ""}`}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : { cursor: "pointer" }}
      aria-checked={checked}
    >
      {checked && <Icons.Check style={{ width: 11, height: 11 }} />}
    </button>
  );
}

export function StepNumber({ n, done, locked }: {
  n: number; done?: boolean; locked?: boolean;
}) {
  if (done) {
    return (
      <span style={{
        width: 24, height: 24, borderRadius: 999, background: "var(--cc-green-bg)",
        color: "var(--cc-green-fg)", display: "inline-flex", alignItems: "center",
        justifyContent: "center", flexShrink: 0,
      }}>
        <Icons.Check style={{ width: 13, height: 13 }} />
      </span>
    );
  }
  return (
    <span style={{
      width: 24, height: 24, borderRadius: 999,
      background: locked ? "var(--cc-muted)" : "var(--cc-blue-bg)",
      color: locked ? "var(--cc-muted-fg)" : "var(--cc-blue-fg)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontFamily: "JetBrains Mono, monospace", fontWeight: 600, fontSize: 12,
      flexShrink: 0, border: "1px solid",
      borderColor: locked ? "var(--cc-border)" : "var(--cc-blue-border)",
    }}>{n}</span>
  );
}
