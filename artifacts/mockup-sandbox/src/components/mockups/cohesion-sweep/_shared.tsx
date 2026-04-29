import { ReactNode } from "react";
import "../claim-detail-redesign/_group.css";

export type Tone = "blue" | "purple" | "amber" | "green" | "red" | "muted";

const toneVar: Record<Tone, { bg: string; fg: string; border?: string }> = {
  blue:   { bg: "var(--cc-blue-bg)",   fg: "var(--cc-blue-fg)",   border: "var(--cc-blue-border)" },
  purple: { bg: "var(--cc-purple-bg)", fg: "var(--cc-purple-fg)", border: "var(--cc-purple-border)" },
  amber:  { bg: "var(--cc-amber-bg)",  fg: "var(--cc-amber-fg)",  border: "var(--cc-amber-border)" },
  green:  { bg: "var(--cc-green-bg)",  fg: "var(--cc-green-fg)",  border: "var(--cc-green-border)" },
  red:    { bg: "var(--cc-red-bg)",    fg: "var(--cc-red-fg)",    border: "var(--cc-red-border)" },
  muted:  { bg: "var(--cc-muted)",     fg: "var(--cc-muted-fg)",  border: "var(--cc-border)" },
};

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const c = toneVar[tone];
  return (
    <span className="cc-badge" style={{ background: c.bg, color: c.fg, border: "none" }}>{children}</span>
  );
}

export function Section({ title, children, action, className = "", icon, padded = true }: {
  title: ReactNode; children: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode; padded?: boolean;
}) {
  return (
    <div className={`cc-card ${className}`}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)" }}>
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {action}
      </div>
      <div className={padded ? "p-4" : ""}>{children}</div>
    </div>
  );
}

export function ActionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-2 py-2" style={{ borderTop: "1px solid var(--cc-border)" }}>
      <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function RowAction({ icon, label, sub, disabled, muted, onClick }: {
  icon: ReactNode; label: string; sub?: string; disabled?: boolean; muted?: boolean; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full text-left px-2.5 py-1.5 rounded transition-colors flex items-start gap-2 hover:bg-[var(--cc-muted)] disabled:opacity-50 disabled:cursor-not-allowed">
      <div className="mt-0.5" style={{ color: muted ? "var(--cc-muted-fg)" : "var(--cc-fg)" }}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: muted ? "var(--cc-muted-fg)" : "var(--cc-fg)" }}>{label}</div>
        {sub && <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>}
      </div>
    </button>
  );
}

export function PageHeader({ title, sub, search = true, accent = "blue" }: {
  title: string; sub?: string; search?: boolean; accent?: Tone;
}) {
  return (
    <div className="flex items-end justify-between">
      <div className="flex items-center gap-3">
        <div className="w-1 h-8 rounded" style={{ background: toneVar[accent].fg }} />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          {sub && <p className="text-sm" style={{ color: "var(--cc-muted-fg)" }}>{sub}</p>}
        </div>
      </div>
      {search && (
        <div className="flex items-center gap-2">
          <input placeholder="Search…" className="cc-input text-sm" style={{
            background: "var(--cc-card)", border: "1px solid var(--cc-border)",
            borderRadius: 6, padding: "0.4rem 0.65rem", width: 220, fontSize: 13,
          }} />
        </div>
      )}
    </div>
  );
}

export function FilterStrip<T extends string>({ tabs, active, counts, accent = "blue" }: {
  tabs: T[]; active: T; counts: Record<T, number>; accent?: Tone;
}) {
  const tone = toneVar[accent];
  return (
    <div className="cc-card flex items-center p-1 gap-1" style={{ background: "var(--cc-muted)", width: "fit-content" }}>
      {tabs.map(t => {
        const isActive = t === active;
        const n = counts[t];
        return (
          <button key={t} className="px-3 py-1.5 text-xs rounded font-medium transition-colors flex items-center gap-1.5" style={{
            background: isActive ? "var(--cc-bg)" : "transparent",
            color: isActive ? "var(--cc-fg)" : "var(--cc-muted-fg)",
            boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.04)" : "none",
          }}>
            {t}
            {n > 0 && (
              <span className="text-[10px] px-1 rounded font-bold" style={{
                background: isActive ? tone.bg : "transparent",
                color: isActive ? tone.fg : "var(--cc-muted-fg)",
                minWidth: 14, textAlign: "center",
              }}>{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function StatusStrip({ children }: { children: ReactNode }) {
  return (
    <div className="cc-card flex items-center gap-3 px-4 py-2 text-xs flex-wrap" style={{ background: "var(--cc-card)" }}>
      {children}
    </div>
  );
}

export function StatusDot({ tone }: { tone: "green" | "amber" | "red" | "blue" }) {
  const map = { green: "var(--cc-success)", amber: "var(--cc-warning)", red: "var(--cc-destructive)", blue: "var(--cc-primary)" };
  return <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: map[tone] }} />;
}

export function MetricTile({ label, value, sub, tone = "muted" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  const c = toneVar[tone];
  return (
    <div className="cc-card p-4">
      <div className="text-[11px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className="text-2xl font-bold mono" style={{ color: tone === "muted" ? "var(--cc-fg)" : c.fg }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>}
    </div>
  );
}

export function Recommended({ tone = "blue", title, body, cta, sub }: {
  tone?: Tone; title: string; body: string; cta: ReactNode; sub?: string;
}) {
  const c = toneVar[tone];
  return (
    <div className="p-4" style={{ background: c.bg, borderTop: "1px solid var(--cc-border)" }}>
      <div className="text-xs uppercase font-semibold mb-2" style={{ color: c.fg }}>Recommended</div>
      <div className="text-sm font-medium mb-1" style={{ color: c.fg }}>{title}</div>
      <div className="text-xs mb-3" style={{ color: c.fg, opacity: 0.85 }}>{body}</div>
      {cta}
      {sub && <div className="text-xs mt-2" style={{ color: c.fg, opacity: 0.85 }}>{sub}</div>}
    </div>
  );
}

export function PrimaryButton({ tone = "blue", children }: { tone?: Tone; children: ReactNode }) {
  const c = toneVar[tone];
  return (
    <button className="cc-btn w-full justify-center" style={{ background: c.fg, color: "white", border: "none", padding: "0.5rem 0.75rem" }}>
      {children}
    </button>
  );
}
