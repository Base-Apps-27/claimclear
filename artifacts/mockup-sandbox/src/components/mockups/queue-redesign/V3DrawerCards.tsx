import "./_queue.css";
import {
  Paperclip, StickyNote, MessageSquare, Activity, ShieldCheck,
  FileText, Tag, AlertTriangle, Copy, Link2Off, Pin, Plus, Mail,
  ArrowUpRight, Clock, CheckCircle2, X, Sparkles, ChevronRight,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * V3 leg-details drawer — Option D: Inspector Cards.
 *
 * The drawer becomes a single scrollable column of inspector cards.
 * Each card mirrors one wizard counts-strip chip (Evidence, Op note,
 * Comms, Activity, MAS, Context) plus a Classification card up top
 * for the controls. Each card shows count, primary action, and a
 * compact preview. Clicking the card title deep-links the user into
 * that surface (or, in-app, expands the card inline).
 *
 * Explicitly NOT included: SOP walk, transcript, sop-walk-transcript-list
 * (the wizard owns those — drawer is the off-walk inspector).
 */
export default function V3DrawerCards() {
  return (
    <div className="cc-scope" style={{ width: 720, minHeight: 1200, background: "var(--cc-bg)" }}>
      {/* Sheet chrome stand-in (drawer host owns it) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.625rem 1rem", borderBottom: "1px solid var(--cc-border)",
        background: "var(--cc-card)" }}>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
          Leg details · <span className="mono" style={{ fontWeight: 500 }}>C-2026-04812</span>
        </div>
        <button className="cc-btn cc-btn-ghost cc-btn-sm" aria-label="Close drawer"><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* Sticky leg header band */}
      <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--cc-card)",
        borderBottom: "1px solid var(--cc-border)", padding: "0.75rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <span className="cc-pill cc-pill-amber"><AlertTriangle className="w-3 h-3" /> Mileage mismatch</span>
          <span className="cc-meta">Apr 24 · 14.2 mi</span>
          <span className="cc-meta">·</span>
          <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>$184.50</span>
          <span className="cc-meta">·</span>
          <span className="cc-meta">Rate code <span className="mono">R-12</span></span>
          <span className="cc-pill cc-pill-blue" style={{ marginLeft: "auto" }}>Walked · awaiting evidence</span>
        </div>
        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.5rem", alignItems: "center" }}>
          <span className="cc-meta">Pickup → Drop</span>
          <span style={{ fontSize: "0.8125rem" }}>Riverside Apt → Mercy Clinic</span>
          <button className="cc-btn cc-btn-sm" style={{ marginLeft: "auto" }}>
            Open in full view <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Card grid — single column for drawer width, dense */}
      <div style={{ padding: "0.875rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        <ClassificationCard />
        <Card icon={Paperclip} title="Evidence" count={4} action="Attach"
              accent="blue"
              hint="4 files · last added Apr 25">
          <FileRow name="GPS-2026-04-24.csv"    meta="GPS log · 12 KB · Sarah Lin · Apr 24" />
          <FileRow name="trip-manifest.pdf"     meta="Manifest · 188 KB · Sarah Lin · Apr 24" />
          <FileRow name="auth-letter-MAS.pdf"   meta="Auth · 94 KB · M. Patel · Apr 18" />
          <Aside tone="blue">
            <Sparkles className="w-3.5 h-3.5" />
            AI extracted <b>14.2 mi</b> from GPS log — matches the billed mileage.
          </Aside>
        </Card>

        <Card icon={StickyNote} title="Op note" count={2} action="Add note"
              hint="2 notes · 1 pinned">
          <NoteRow who="Sarah Lin" when="Apr 24 · 14:05" pinned
            body="GPS log matches manifest exactly — 14.2 mi. Driver confirmed Member arrived on time." />
          <NoteRow who="M. Patel" when="Apr 25 · 08:31"
            body="Cross-checked auth letter, dates align with rate code R-12. Ready for re-attest." />
        </Card>

        <Card icon={MessageSquare} title="Comms" count={1} action="New email"
              accent="blue"
              hint="1 thread · awaiting payor reply">
          <div style={{ padding: "0.5rem 0.625rem", border: "1px solid var(--cc-border)",
            borderRadius: "calc(var(--cc-radius) - 2px)", background: "var(--cc-card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontWeight: 600, fontSize: "0.8125rem" }}>RE: Mileage variance — C-2026-04812</span>
              <span className="cc-pill cc-pill-blue" style={{ marginLeft: "auto" }}>Awaiting reply</span>
            </div>
            <div className="cc-meta" style={{ marginTop: 2 }}>
              To claims-review@masmedicaid.gov · sent Apr 24 · 14:18 · 2 attachments
            </div>
          </div>
        </Card>

        <Card icon={Activity} title="Activity" count={11} action="View all"
              hint="11 events · newest 8:31 today">
          <ActivityRow when="Apr 25 · 08:31" text="M. Patel added note: Cross-checked auth letter…" />
          <ActivityRow when="Apr 24 · 14:18" text="Sarah Lin sent email to MAS Medicaid" />
          <ActivityRow when="Apr 24 · 14:02" text="Sarah Lin attached GPS log + manifest" />
        </Card>

        <Card icon={ShieldCheck} title="MAS" count={0} action="Reconcile"
              accent="green"
              hint="Clean — last reconciled Apr 26 · 06:00">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0" }}>
            <CheckCircle2 className="w-4 h-4" style={{ color: "var(--cc-green-fg)" }} />
            <span style={{ fontSize: "0.8125rem" }}>0 conflicts · 0 sibling holds against this leg.</span>
          </div>
        </Card>

        <Card icon={FileText} title="Per-leg context" action="Copy ref" hint="Read-only">
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "120px 1fr",
            rowGap: "0.25rem", columnGap: "0.75rem", fontSize: "0.8125rem" }}>
            <dt className="cc-meta">Invoice group</dt><dd style={{ margin: 0 }} className="mono">INV-2026-0487</dd>
            <dt className="cc-meta">Payor</dt><dd style={{ margin: 0 }}>MAS Medicaid</dd>
            <dt className="cc-meta">Rate code</dt><dd style={{ margin: 0 }} className="mono">R-12</dd>
            <dt className="cc-meta">Date of service</dt><dd style={{ margin: 0 }}>Apr 24, 2026</dd>
            <dt className="cc-meta">Auth #</dt><dd style={{ margin: 0 }} className="mono">AUTH-2026-991204</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}

// ─── Card primitives ───────────────────────────────────────────────────

function Card({
  icon: Icon, title, count, action, hint, accent, children,
}: {
  icon: any; title: string; count?: number; action?: string;
  hint?: string; accent?: "blue" | "green"; children?: ReactNode;
}) {
  const accentColor =
    accent === "blue" ? "var(--cc-blue-fg)" :
    accent === "green" ? "var(--cc-green-fg)" : "var(--cc-muted-fg)";
  return (
    <section style={{
      background: "var(--cc-card)", border: "1px solid var(--cc-border)",
      borderRadius: "var(--cc-radius)", overflow: "hidden",
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--cc-border)" }}>
        <Icon className="w-3.5 h-3.5" style={{ color: accentColor }} />
        <button style={{
          background: "transparent", border: 0, padding: 0, cursor: "pointer",
          fontWeight: 600, fontSize: "0.875rem", color: "var(--cc-fg)",
          display: "inline-flex", alignItems: "center", gap: "0.25rem",
        }}>
          {title}
          <ChevronRight className="w-3 h-3" style={{ color: "var(--cc-muted-fg)" }} />
        </button>
        {typeof count === "number" && (
          <span className="cc-tag" style={{
            background: count > 0 ? "var(--cc-blue-bg)" : "var(--cc-muted)",
            color: count > 0 ? "var(--cc-blue-fg)" : "var(--cc-muted-fg)",
          }}>{count}</span>
        )}
        {hint && <span className="cc-meta" style={{ marginLeft: "0.25rem" }}>{hint}</span>}
        {action && (
          <button className="cc-btn cc-btn-sm" style={{ marginLeft: "auto" }}>
            <Plus className="w-3 h-3" /> {action}
          </button>
        )}
      </header>
      <div style={{ padding: "0.625rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        {children}
      </div>
    </section>
  );
}

function ClassificationCard() {
  return (
    <section style={{
      background: "var(--cc-card)",
      border: "1px solid var(--cc-amber-border)",
      borderRadius: "var(--cc-radius)", overflow: "hidden",
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--cc-border)",
        background: "var(--cc-amber-bg)" }}>
        <Tag className="w-3.5 h-3.5" style={{ color: "var(--cc-amber-fg)" }} />
        <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--cc-amber-fg)" }}>Classification</div>
        <span className="cc-pill cc-pill-amber" style={{ marginLeft: "auto" }}>Mileage mismatch</span>
      </header>
      <div style={{ padding: "0.625rem 0.75rem",
        display: "flex", gap: "0.375rem", flexWrap: "wrap", alignItems: "center" }}>
        <span className="cc-meta">Change classification:</span>
        <button className="cc-btn cc-btn-sm"><Tag className="w-3 h-3" /> Reclassify</button>
        <button className="cc-btn cc-btn-sm"><Copy className="w-3 h-3" /> Mark duplicate</button>
        <button className="cc-btn cc-btn-sm"><Link2Off className="w-3 h-3" /> Exclude</button>
      </div>
    </section>
  );
}

function FileRow({ name, meta }: { name: string; meta: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem",
      padding: "0.25rem 0" }}>
      <Paperclip className="w-3 h-3" style={{ color: "var(--cc-muted-fg)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: "0.8125rem", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        <div className="cc-meta">{meta}</div>
      </div>
      <button className="cc-btn cc-btn-ghost cc-btn-sm">View</button>
    </div>
  );
}

function NoteRow({ who, when, body, pinned }:
  { who: string; when: string; body: string; pinned?: boolean }) {
  return (
    <div style={{ padding: "0.375rem 0", borderTop: "1px dashed var(--cc-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.125rem" }}>
        <span style={{ fontWeight: 600, fontSize: "0.75rem" }}>{who}</span>
        <span className="cc-meta">{when}</span>
        {pinned && <Pin className="w-3 h-3" style={{ color: "var(--cc-amber-fg)", marginLeft: "auto" }} />}
      </div>
      <div style={{ fontSize: "0.8125rem", color: "var(--cc-fg)" }}>{body}</div>
    </div>
  );
}

function ActivityRow({ when, text }: { when: string; text: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "14px 1fr", gap: "0.5rem", alignItems: "flex-start" }}>
      <Clock className="w-3 h-3" style={{ color: "var(--cc-muted-fg)", marginTop: 3 }} />
      <div>
        <div style={{ fontSize: "0.8125rem" }}>{text}</div>
        <div className="cc-meta">{when}</div>
      </div>
    </div>
  );
}

function Aside({ tone, children }: { tone: "blue"; children: ReactNode }) {
  return (
    <div style={{
      padding: "0.375rem 0.5rem",
      background: "var(--cc-blue-bg)", border: "1px solid var(--cc-blue-border)",
      borderRadius: "calc(var(--cc-radius) - 2px)",
      display: "flex", gap: "0.375rem", alignItems: "center",
      color: "var(--cc-blue-fg)", fontSize: "0.75rem",
    }}>
      {children}
    </div>
  );
}
