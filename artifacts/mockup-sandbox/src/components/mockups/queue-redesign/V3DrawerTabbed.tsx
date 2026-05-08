import "./_queue.css";
import { Fragment, useState } from "react";
import {
  Paperclip, StickyNote, MessageSquare, Activity, ShieldCheck,
  FileText, Tag, AlertTriangle, Copy, Link2Off, Pin, Plus, Mail,
  ArrowUpRight, Clock, CheckCircle2, X, Sparkles, Send,
} from "lucide-react";

/**
 * V3 leg-details drawer — Option A: Tabbed Sidebar.
 *
 * The drawer is body-only (the wizard owns Sheet chrome). A sticky
 * leg-header band carries Ref/date/amount + classification controls.
 * A vertical sidebar of tabs (Evidence · Notes · Comms · Activity ·
 * MAS · Context) replaces the old long scroll. Each tab shows the
 * count from the wizard counts-strip so deep-links land precisely.
 *
 * Explicitly NOT included: SOP walk, transcript, sop-walk-transcript-list
 * (the wizard owns those — drawer is the off-walk inspector).
 */

type TabKey = "evidence" | "notes" | "comms" | "activity" | "mas" | "context";

const tabs: { key: TabKey; label: string; count: number; icon: any }[] = [
  { key: "evidence", label: "Evidence", count: 4, icon: Paperclip },
  { key: "notes",    label: "Op note",  count: 2, icon: StickyNote },
  { key: "comms",    label: "Comms",    count: 1, icon: MessageSquare },
  { key: "activity", label: "Activity", count: 11, icon: Activity },
  { key: "mas",      label: "MAS",      count: 0, icon: ShieldCheck },
  { key: "context",  label: "Context",  count: 0, icon: FileText },
];

export default function V3DrawerTabbed() {
  const [active, setActive] = useState<TabKey>("evidence");

  return (
    <div className="cc-scope" style={{ width: 720, minHeight: 1200, background: "var(--cc-card)" }}>
      {/* Sheet chrome stand-in (not part of the redesign — drawer host owns it) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.625rem 1rem", borderBottom: "1px solid var(--cc-border)" }}>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
          Leg details · <span className="mono" style={{ fontWeight: 500 }}>C-2026-04812</span>
        </div>
        <button className="cc-btn cc-btn-ghost cc-btn-sm" aria-label="Close drawer"><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* Sticky leg header band — meta + classification controls */}
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
        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.625rem", flexWrap: "wrap" }}>
          <button className="cc-btn cc-btn-sm"><Tag className="w-3 h-3" /> Reclassify</button>
          <button className="cc-btn cc-btn-sm"><Copy className="w-3 h-3" /> Mark duplicate</button>
          <button className="cc-btn cc-btn-sm"><Link2Off className="w-3 h-3" /> Exclude</button>
          <button className="cc-btn cc-btn-sm" style={{ marginLeft: "auto" }}>
            Open in full view <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Two-pane body: sidebar tabs + active pane */}
      <div style={{ display: "grid", gridTemplateColumns: "176px 1fr", minHeight: 880 }}>
        <nav style={{ borderRight: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          padding: "0.5rem", display: "flex", flexDirection: "column", gap: "2px" }}
          aria-label="Leg detail sections">
          {tabs.map(t => {
            const Icon = t.icon;
            const on = t.key === active;
            return (
              <button key={t.key} onClick={() => setActive(t.key)}
                style={{
                  display: "flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.5rem 0.625rem", borderRadius: "calc(var(--cc-radius) - 2px)",
                  border: 0, cursor: "pointer", textAlign: "left",
                  background: on ? "var(--cc-card)" : "transparent",
                  color: on ? "var(--cc-fg)" : "var(--cc-muted-fg)",
                  fontWeight: on ? 600 : 500, fontSize: "0.8125rem",
                  boxShadow: on ? "inset 3px 0 0 var(--cc-primary)" : "none",
                }}>
                <Icon className="w-3.5 h-3.5" />
                <span style={{ flex: 1 }}>{t.label}</span>
                <span className="cc-tag" style={{ background: on ? "var(--cc-blue-bg)" : "var(--cc-muted)",
                  color: on ? "var(--cc-blue-fg)" : "var(--cc-muted-fg)" }}>{t.count}</span>
              </button>
            );
          })}
        </nav>

        <div style={{ padding: "1rem 1.25rem", overflow: "auto" }}>
          {active === "evidence" && <EvidencePane />}
          {active === "notes"    && <NotesPane />}
          {active === "comms"    && <CommsPane />}
          {active === "activity" && <ActivityPane />}
          {active === "mas"      && <MasPane />}
          {active === "context"  && <ContextPane />}
        </div>
      </div>
    </div>
  );
}

// ─── Panes ─────────────────────────────────────────────────────────────

function PaneHeader({ title, hint, action }:
  { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "0.625rem", marginBottom: "0.75rem" }}>
      <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>{title}</h3>
      {hint && <span className="cc-meta">{hint}</span>}
      <div style={{ marginLeft: "auto" }}>{action}</div>
    </div>
  );
}

function EvidencePane() {
  const files = [
    { name: "GPS-2026-04-24.csv",     size: "12 KB", who: "Sarah Lin", when: "Apr 24 · 14:02", tag: "GPS log" },
    { name: "trip-manifest.pdf",      size: "188 KB", who: "Sarah Lin", when: "Apr 24 · 14:02", tag: "Manifest" },
    { name: "auth-letter-MAS.pdf",    size: "94 KB",  who: "M. Patel",  when: "Apr 18 · 09:11", tag: "Auth" },
    { name: "driver-statement.docx",  size: "21 KB",  who: "M. Patel",  when: "Apr 25 · 08:30", tag: "Statement" },
  ];
  return (
    <>
      <PaneHeader title="Evidence" hint="4 files attached to this leg"
        action={<button className="cc-btn cc-btn-sm"><Plus className="w-3 h-3" /> Attach</button>} />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        {files.map(f => (
          <div key={f.name} style={{ display: "flex", alignItems: "center", gap: "0.625rem",
            padding: "0.5rem 0.625rem", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)",
            background: "var(--cc-card)" }}>
            <Paperclip className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              <div className="cc-meta" style={{ marginTop: 2 }}>{f.tag} · {f.who} · {f.when} · {f.size}</div>
            </div>
            <button className="cc-btn cc-btn-ghost cc-btn-sm">View</button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "0.875rem", padding: "0.625rem 0.75rem",
        background: "var(--cc-blue-bg)", border: "1px solid var(--cc-blue-border)",
        borderRadius: "var(--cc-radius)", display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <Sparkles className="w-4 h-4" style={{ color: "var(--cc-blue-fg)", flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: "0.8125rem", color: "var(--cc-blue-fg)" }}>
          AI extracted <b>14.2 mi</b> from <span className="mono">GPS-2026-04-24.csv</span>. The
          billed mileage is <b>14.2 mi</b>. <a className="cc-link" href="#">View extraction →</a>
        </div>
      </div>
    </>
  );
}

function NotesPane() {
  const notes = [
    { who: "Sarah Lin", when: "Apr 24 · 14:05", pinned: true,
      body: "GPS log matches manifest exactly — 14.2 mi. Driver confirmed Member arrived at clinic on time." },
    { who: "M. Patel", when: "Apr 25 · 08:31",
      body: "Cross-checked auth letter, dates align with rate code R-12. Ready for re-attest if needed." },
  ];
  return (
    <>
      <PaneHeader title="Op note" hint="2 notes on this leg"
        action={<button className="cc-btn cc-btn-sm"><Plus className="w-3 h-3" /> Add note</button>} />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {notes.map((n, i) => (
          <div key={i} style={{ padding: "0.625rem 0.75rem", border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-radius)", background: "var(--cc-card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ fontWeight: 600, fontSize: "0.8125rem" }}>{n.who}</span>
              <span className="cc-meta">{n.when}</span>
              {n.pinned && <span className="cc-pill cc-pill-amber" style={{ marginLeft: "auto" }}>
                <Pin className="w-2.5 h-2.5" /> Pinned
              </span>}
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--cc-fg)" }}>{n.body}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function CommsPane() {
  return (
    <>
      <PaneHeader title="Comms" hint="1 thread with payor"
        action={<button className="cc-btn cc-btn-sm"><Mail className="w-3 h-3" /> New email</button>} />
      <div style={{ border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)",
        background: "var(--cc-card)", overflow: "hidden" }}>
        <div style={{ padding: "0.625rem 0.75rem", borderBottom: "1px solid var(--cc-border)",
          background: "var(--cc-muted)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontWeight: 600, fontSize: "0.8125rem" }}>RE: INV-2026-0487 Mileage variance — leg C-2026-04812</span>
            <span className="cc-pill cc-pill-blue" style={{ marginLeft: "auto" }}>Awaiting reply</span>
          </div>
          <div className="cc-meta" style={{ marginTop: 2 }}>To: claims-review@masmedicaid.gov · Sent Apr 24 · 14:18</div>
        </div>
        <div style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "var(--cc-fg)", lineHeight: 1.5 }}>
          Hi MAS team — attaching the GPS log and trip manifest for leg C-2026-04812. Both confirm
          14.2 mi, matching the billed amount under rate code R-12. Please confirm acceptance so we
          can keep the rest of the invoice on schedule. Thanks, Sarah.
        </div>
        <div style={{ padding: "0.5rem 0.75rem", borderTop: "1px solid var(--cc-border)",
          display: "flex", gap: "0.375rem", alignItems: "center" }}>
          <Paperclip className="w-3 h-3" style={{ color: "var(--cc-muted-fg)" }} />
          <span className="cc-meta">2 attachments · GPS-2026-04-24.csv, trip-manifest.pdf</span>
          <button className="cc-btn cc-btn-sm" style={{ marginLeft: "auto" }}>Open thread</button>
        </div>
      </div>
    </>
  );
}

function ActivityPane() {
  const items = [
    { when: "Apr 25 · 08:31", who: "M. Patel",  text: "Added note: Cross-checked auth letter…" },
    { when: "Apr 24 · 14:18", who: "Sarah Lin", text: "Sent email to MAS Medicaid claims-review" },
    { when: "Apr 24 · 14:05", who: "Sarah Lin", text: "Added note: GPS log matches manifest…" },
    { when: "Apr 24 · 14:02", who: "Sarah Lin", text: "Attached evidence: GPS-2026-04-24.csv + trip-manifest.pdf" },
    { when: "Apr 24 · 13:58", who: "System",    text: "Walked SOP → Mileage mismatch path · awaiting evidence" },
    { when: "Apr 18 · 09:11", who: "M. Patel",  text: "Attached evidence: auth-letter-MAS.pdf" },
  ];
  return (
    <>
      <PaneHeader title="Activity" hint="11 events · newest first" />
      <ol style={{ listStyle: "none", padding: 0, margin: 0,
        display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {items.map((e, i) => (
          <li key={i} style={{ display: "grid", gridTemplateColumns: "16px 1fr",
            gap: "0.625rem", alignItems: "flex-start" }}>
            <Clock className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)", marginTop: 2 }} />
            <div>
              <div style={{ fontSize: "0.8125rem" }}>{e.text}</div>
              <div className="cc-meta">{e.who} · {e.when}</div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function MasPane() {
  return (
    <>
      <PaneHeader title="MAS" hint="No MAS conflicts on this leg" />
      <div style={{ padding: "1rem", border: "1px dashed var(--cc-border)",
        borderRadius: "var(--cc-radius)", textAlign: "center" }}>
        <CheckCircle2 className="w-5 h-5" style={{ color: "var(--cc-green-fg)", margin: "0 auto 0.375rem" }} />
        <div style={{ fontSize: "0.8125rem", fontWeight: 600 }}>Clean against MAS feed</div>
        <div className="cc-meta" style={{ marginTop: 2 }}>
          Last reconciled Apr 26 · 06:00 · 0 conflicts · 0 sibling holds
        </div>
      </div>
    </>
  );
}

function ContextPane() {
  const rows = [
    ["Confirmation #",     "C-2026-04812"],
    ["Invoice group",      "INV-2026-0487"],
    ["Payor",              "MAS Medicaid"],
    ["Rate code",          "R-12"],
    ["Date of service",    "Apr 24, 2026"],
    ["Member",             "[REDACTED]"],
    ["Pickup → Drop",      "Riverside Apt → Mercy Clinic"],
    ["Billed mileage",     "14.2 mi"],
    ["Billed amount",      "$184.50"],
    ["Auth #",             "AUTH-2026-991204"],
  ];
  return (
    <>
      <PaneHeader title="Per-leg context" hint="Read-only" />
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "140px 1fr",
        rowGap: "0.375rem", columnGap: "0.875rem", fontSize: "0.8125rem" }}>
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="cc-meta" style={{ paddingTop: 1 }}>{k}</dt>
            <dd style={{ margin: 0 }}><span className="mono">{v}</span></dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}
