import "./_queue.css";
import { useState } from "react";
import {
  Paperclip, StickyNote, MessageSquare, Activity,
  Tag, AlertTriangle, Copy, Link2Off, Pin, Plus, Mail,
  ArrowUpRight, Clock, X, Sparkles,
} from "lucide-react";

/**
 * V3 leg-details drawer — Mini · Single-section.
 *
 * Premise: the wizard hero already renders the counts-strip chips
 * (Evidence · Notes · Comms · Activity) on the active leg at all
 * times (`v3-walk-counts-strip`). The drawer therefore does NOT
 * need to repeat them or show every section. It scopes itself to
 * the chip the user clicked — common header + that one pane.
 *
 * Re-entry is via the chips themselves (they stay visible behind
 * the drawer); a tiny "Switch section" link inside the drawer
 * provides an in-drawer fallback without duplicating the chip row.
 *
 * Explicitly NOT included: SOP walk, transcript, sop-walk-transcript-list.
 */

type Section = "evidence" | "notes" | "comms" | "activity";

const sectionMeta: Record<Section, { label: string; icon: any; count: number; hint: string }> = {
  evidence: { label: "Evidence", icon: Paperclip,     count: 4,  hint: "4 files attached to this leg" },
  notes:    { label: "Op note",  icon: StickyNote,    count: 2,  hint: "2 notes · 1 pinned" },
  comms:    { label: "Comms",    icon: MessageSquare, count: 1,  hint: "1 thread · awaiting payor reply" },
  activity: { label: "Activity", icon: Activity,      count: 11, hint: "11 events · newest 8:31 today" },
};

export default function V3DrawerMini({
  initialSection = "evidence",
}: { initialSection?: Section } = {}) {
  // In the live drawer this would come from which chip was clicked.
  const [section, setSection] = useState<Section>(initialSection);
  const m = sectionMeta[section];
  const Icon = m.icon;

  return (
    <div className="cc-scope" style={{ width: 720, minHeight: 720, background: "var(--cc-card)" }}>
      {/* Sheet chrome stand-in (drawer host owns it) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.625rem 1rem", borderBottom: "1px solid var(--cc-border)" }}>
        <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
          Leg details · <span className="mono" style={{ fontWeight: 500 }}>C-2026-04812</span>
        </div>
        <button className="cc-btn cc-btn-ghost cc-btn-sm" aria-label="Close drawer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Common sticky header — same as A and D */}
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

      {/* Scope bar — names the section the chip opened, with quiet switcher */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.5rem 1rem", borderBottom: "1px solid var(--cc-border)",
        background: "var(--cc-bg)",
      }}>
        <Icon className="w-3.5 h-3.5" style={{ color: "var(--cc-fg)" }} />
        <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{m.label}</span>
        <span className="cc-tag" style={{
          background: m.count > 0 ? "var(--cc-blue-bg)" : "var(--cc-muted)",
          color: m.count > 0 ? "var(--cc-blue-fg)" : "var(--cc-muted-fg)",
        }}>{m.count}</span>
        <span className="cc-meta">{m.hint}</span>
        <span className="cc-meta" style={{ marginLeft: "auto" }}>
          Opened from chip · close to switch
        </span>
        {/* Quiet in-drawer switcher (tiny — chips are still live behind the sheet) */}
        <div style={{ display: "flex", gap: "2px", marginLeft: "0.5rem" }}>
          {(Object.keys(sectionMeta) as Section[]).map(k => {
            const I = sectionMeta[k].icon;
            const on = k === section;
            return (
              <button key={k} onClick={() => setSection(k)}
                title={sectionMeta[k].label}
                aria-label={sectionMeta[k].label}
                style={{
                  background: on ? "var(--cc-card)" : "transparent",
                  border: on ? "1px solid var(--cc-border)" : "1px solid transparent",
                  borderRadius: "calc(var(--cc-radius) - 2px)",
                  padding: "3px 5px", cursor: "pointer",
                  color: on ? "var(--cc-fg)" : "var(--cc-muted-fg)",
                }}>
                <I className="w-3 h-3" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Single pane — only this section's content. */}
      <div style={{ padding: "1rem 1.25rem" }}>
        {section === "evidence" && <EvidencePane />}
        {section === "notes"    && <NotesPane />}
        {section === "comms"    && <CommsPane />}
        {section === "activity" && <ActivityPane />}
      </div>
    </div>
  );
}

// ─── Panes (compact — single-section means we can be a touch denser) ──

function EvidencePane() {
  const files = [
    { name: "GPS-2026-04-24.csv",     size: "12 KB",  who: "Sarah Lin", when: "Apr 24 · 14:02", tag: "GPS log" },
    { name: "trip-manifest.pdf",      size: "188 KB", who: "Sarah Lin", when: "Apr 24 · 14:02", tag: "Manifest" },
    { name: "auth-letter-MAS.pdf",    size: "94 KB",  who: "M. Patel",  when: "Apr 18 · 09:11", tag: "Auth" },
    { name: "driver-statement.docx",  size: "21 KB",  who: "M. Patel",  when: "Apr 25 · 08:30", tag: "Statement" },
  ];
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
        <button className="cc-btn cc-btn-sm"><Plus className="w-3 h-3" /> Attach</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        {files.map(f => (
          <div key={f.name} style={{ display: "flex", alignItems: "center", gap: "0.625rem",
            padding: "0.5rem 0.625rem", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
            <Paperclip className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              <div className="cc-meta" style={{ marginTop: 2 }}>{f.tag} · {f.who} · {f.when} · {f.size}</div>
            </div>
            <button className="cc-btn cc-btn-ghost cc-btn-sm">View</button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.625rem",
        background: "var(--cc-blue-bg)", border: "1px solid var(--cc-blue-border)",
        borderRadius: "var(--cc-radius)", display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--cc-blue-fg)" }} />
        <div style={{ fontSize: "0.8125rem", color: "var(--cc-blue-fg)" }}>
          AI extracted <b>14.2 mi</b> from GPS log — matches the billed mileage.
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
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
        <button className="cc-btn cc-btn-sm"><Plus className="w-3 h-3" /> Add note</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {notes.map((n, i) => (
          <div key={i} style={{ padding: "0.625rem 0.75rem", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ fontWeight: 600, fontSize: "0.8125rem" }}>{n.who}</span>
              <span className="cc-meta">{n.when}</span>
              {n.pinned && <span className="cc-pill cc-pill-amber" style={{ marginLeft: "auto" }}>
                <Pin className="w-2.5 h-2.5" /> Pinned
              </span>}
            </div>
            <div style={{ fontSize: "0.8125rem" }}>{n.body}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function CommsPane() {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
        <button className="cc-btn cc-btn-sm"><Mail className="w-3 h-3" /> New email</button>
      </div>
      <div style={{ border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", overflow: "hidden" }}>
        <div style={{ padding: "0.625rem 0.75rem", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-muted)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontWeight: 600, fontSize: "0.8125rem" }}>RE: INV-2026-0487 Mileage variance — leg C-2026-04812</span>
            <span className="cc-pill cc-pill-blue" style={{ marginLeft: "auto" }}>Awaiting reply</span>
          </div>
          <div className="cc-meta" style={{ marginTop: 2 }}>To: claims-review@masmedicaid.gov · Sent Apr 24 · 14:18</div>
        </div>
        <div style={{ padding: "0.75rem", fontSize: "0.8125rem", lineHeight: 1.5 }}>
          Hi MAS team — attaching the GPS log and trip manifest for leg C-2026-04812. Both confirm
          14.2 mi, matching the billed amount under rate code R-12. Please confirm acceptance so we
          can keep the rest of the invoice on schedule. Thanks, Sarah.
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
  );
}
