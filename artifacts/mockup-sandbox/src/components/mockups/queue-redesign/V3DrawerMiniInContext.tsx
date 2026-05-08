import "./_queue.css";
import { Pin } from "lucide-react";
import {
  HeaderStrip, ClassificationStrip, MasterList, SopActiveCard,
  legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 Mini drawer — IN CONTEXT (floating popover).
 *
 * The chips on the wizard hero stay live. Clicking one opens a small
 * floating panel anchored just below the chip with a tight header
 * (section name + count + close) and a single content rectangle —
 * no full-height sheet, no scrim, no reclassify/exclude rail.
 *
 * If the user wants the full leg view, the chip strip itself still
 * has "Open in full view" via the page header (not duplicated here).
 *
 * Variants: evidence · notes · comms · activity
 */

type Section = "evidence" | "notes" | "comms" | "activity";

const chipMeta: Record<Section, { label: string; n: number; icon: any; hint: string }> = {
  evidence: { label: "Evidence", n: 4,  icon: Icons.Paperclip,     hint: "4 files attached" },
  notes:    { label: "Notes",    n: 2,  icon: Icons.StickyNote,    hint: "2 notes · 1 pinned" },
  comms:    { label: "Comms",    n: 1,  icon: Icons.MessageSquare, hint: "1 thread · awaiting reply" },
  activity: { label: "Activity", n: 11, icon: Icons.Activity,      hint: "newest 8:31 today" },
};

export default function V3DrawerMiniInContext({
  section = "evidence",
}: { section?: Section }) {
  return (
    <div
      className="cc-scope"
      style={{ width: 1280, minHeight: 900, position: "relative", background: "var(--cc-bg)" }}
    >
      {/* ── Underlying queue page (same shell as V3WalkFirst) ── */}
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden", position: "relative" }}>
          {/* Group summary bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.625rem",
            padding: "0.5rem 0.75rem",
            background: "var(--cc-card)", border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-radius)",
          }}>
            <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
            <div className="cc-segmented" style={{ marginLeft: "auto" }}>
              <button className="is-active">Leg 1 <Icons.Circle className="w-2.5 h-2.5 inline ml-1" /></button>
              <button>Leg 2 <Icons.CheckCircle2 className="w-2.5 h-2.5 inline ml-1" /></button>
              <button>Leg 3 <Icons.HelpCircle className="w-2.5 h-2.5 inline ml-1" /></button>
            </div>
          </div>

          {/* Hero — active SOP step + the persistent chips + floating popover */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            gap: "0.625rem", justifyContent: "center", padding: "0 2rem",
            position: "relative",
          }}>
            <div style={{ maxWidth: 720, margin: "0 auto", width: "100%", position: "relative" }}>
              <div className="cc-meta text-[11px] mb-2">
                <span className="mono">{legs[0].conf}</span> · {legs[0].date} · {legs[0].amount}
              </div>
              <SopActiveCard question={legs[0].question} />

              {/* Persistent chips — wrap in a relatively-positioned holder
                  so the floating popover can anchor under the active chip. */}
              <div style={{ marginTop: "0.75rem", position: "relative" }}>
                <ChipsStrip active={section} />
                <FloatingPanel section={section} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-amber">1 of 3 ready</span>
            <span className="cc-meta text-xs flex-1">Resolve all 3 legs to unlock Generate preview · then Submit.</span>
            <button className="cc-btn cc-btn-primary" disabled>
              <Icons.Send className="w-3.5 h-3.5" /> Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Chips strip — active chip pressed ───────────────────────────────── */

function ChipsStrip({ active }: { active: Section }) {
  const items: Section[] = ["evidence", "notes", "comms", "activity"];
  return (
    <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}
         data-testid="v3-walk-counts-strip">
      {items.map((key) => {
        const m = chipMeta[key];
        const I = m.icon;
        const on = key === active;
        return (
          <span
            key={key}
            data-chip={key}
            className={`cc-pill ${on ? "cc-pill-blue" : "cc-pill-muted"}`}
            style={on ? { boxShadow: "inset 0 0 0 1.5px var(--cc-blue-fg)" } : undefined}
          >
            <I className="w-3 h-3" />
            {m.label}{key !== "comms" ? ` · ${m.n}` : ""}
          </span>
        );
      })}
    </div>
  );
}

/* ── Floating panel — header + content rectangle ─────────────────────── */

function FloatingPanel({ section }: { section: Section }) {
  // Anchor offset under each chip (rough — chips are L→R: ev/notes/comms/act).
  // We pick an x-offset per chip so the panel reads as anchored to the click.
  const anchorX: Record<Section, number> = {
    evidence: 0,
    notes:    96,
    comms:    176,
    activity: 256,
  };
  const m = chipMeta[section];
  const Icon = m.icon;

  return (
    <div
      role="dialog"
      aria-label={`${m.label} — quick view`}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        left: anchorX[section],
        width: 380,
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: "var(--cc-radius)",
        boxShadow: "0 12px 28px rgba(15,23,42,0.18), 0 2px 6px rgba(15,23,42,0.08)",
        zIndex: 5,
        overflow: "hidden",
      }}
    >
      {/* Caret pointing up to the chip */}
      <div style={{
        position: "absolute", top: -6, left: 18,
        width: 12, height: 12, transform: "rotate(45deg)",
        background: "var(--cc-card)",
        borderTop: "1px solid var(--cc-border)",
        borderLeft: "1px solid var(--cc-border)",
      }} />

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.5rem 0.625rem",
        borderBottom: "1px solid var(--cc-border)",
      }}>
        <Icon className="w-3.5 h-3.5" style={{ color: "var(--cc-fg)" }} />
        <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{m.label}</span>
        <span className="cc-tag" style={{
          background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)",
        }}>{m.n}</span>
        <span className="cc-meta" style={{ fontSize: "0.6875rem" }}>{m.hint}</span>
        <button
          aria-label="Close"
          className="cc-btn cc-btn-ghost cc-btn-sm"
          style={{ marginLeft: "auto", padding: "2px 4px" }}
        >
          <Icons.X className="w-3 h-3" />
        </button>
      </div>

      {/* Content rectangle */}
      <div style={{ padding: "0.5rem 0.625rem", maxHeight: 360, overflow: "auto" }}>
        {section === "evidence" && <MiniEvidence />}
        {section === "notes"    && <MiniNotes />}
        {section === "comms"    && <MiniComms />}
        {section === "activity" && <MiniActivity />}
      </div>

      {/* Footer link to full drawer */}
      <div style={{
        display: "flex", justifyContent: "flex-end",
        padding: "0.375rem 0.625rem",
        borderTop: "1px solid var(--cc-border)",
        background: "var(--cc-bg)",
      }}>
        <a className="cc-link" style={{ fontSize: "0.6875rem" }}>
          Open full leg details →
        </a>
      </div>
    </div>
  );
}

/* ── Compact section bodies ──────────────────────────────────────────── */

function MiniEvidence() {
  const files = [
    { name: "GPS-2026-04-24.csv",  meta: "GPS log · 12 KB · Apr 24" },
    { name: "trip-manifest.pdf",   meta: "Manifest · 188 KB · Apr 24" },
    { name: "auth-letter-MAS.pdf", meta: "Auth · 94 KB · Apr 18" },
    { name: "driver-statement.docx", meta: "Statement · 21 KB · Apr 25" },
  ];
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {files.map(f => (
        <li key={f.name} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "4px 6px", borderRadius: 6,
        }}>
          <Icons.Paperclip className="w-3 h-3" style={{ color: "var(--cc-muted-fg)", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono" style={{ fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
            <div className="cc-meta" style={{ fontSize: "0.6875rem" }}>{f.meta}</div>
          </div>
          <a className="cc-link" style={{ fontSize: "0.6875rem" }}>View</a>
        </li>
      ))}
    </ul>
  );
}

function MiniNotes() {
  const notes = [
    { who: "Sarah Lin", when: "Apr 24", body: "GPS log matches manifest exactly — 14.2 mi.", pinned: true },
    { who: "M. Patel",  when: "Apr 25", body: "Auth letter dates align with rate code R-12." },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {notes.map((n, i) => (
        <div key={i} style={{
          padding: "6px 8px", border: "1px solid var(--cc-border)",
          borderRadius: 6, background: "var(--cc-card)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>{n.who}</span>
            <span className="cc-meta" style={{ fontSize: "0.6875rem" }}>{n.when}</span>
            {n.pinned && <span className="cc-pill cc-pill-amber" style={{ marginLeft: "auto", fontSize: "0.6875rem" }}>
              <Pin className="w-2.5 h-2.5" /> Pinned
            </span>}
          </div>
          <div style={{ fontSize: "0.75rem", lineHeight: 1.4 }}>{n.body}</div>
        </div>
      ))}
    </div>
  );
}

function MiniComms() {
  return (
    <div style={{ border: "1px solid var(--cc-border)", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-muted)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, flex: 1, minWidth: 0,
                         overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            RE: Mileage variance — leg C-2026-04812
          </span>
          <span className="cc-pill cc-pill-blue" style={{ fontSize: "0.625rem" }}>Awaiting reply</span>
        </div>
        <div className="cc-meta" style={{ fontSize: "0.6875rem", marginTop: 2 }}>
          To: claims-review@masmedicaid.gov · Apr 24 · 14:18
        </div>
      </div>
      <div style={{ padding: 8, fontSize: "0.75rem", lineHeight: 1.45 }}>
        Hi MAS team — attaching the GPS log and trip manifest for leg C-2026-04812.
        Both confirm 14.2 mi under rate code R-12. Please confirm acceptance.
      </div>
    </div>
  );
}

function MiniActivity() {
  const items = [
    { when: "Apr 25 · 08:31", text: "M. Patel added a note" },
    { when: "Apr 24 · 14:18", text: "Sarah Lin emailed MAS Medicaid" },
    { when: "Apr 24 · 14:05", text: "Sarah Lin added a note" },
    { when: "Apr 24 · 14:02", text: "Attached GPS log + trip manifest" },
    { when: "Apr 24 · 13:58", text: "System: walked SOP — mileage mismatch" },
  ];
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((e, i) => (
        <li key={i} style={{ display: "grid", gridTemplateColumns: "12px 1fr", gap: 6, alignItems: "flex-start" }}>
          <Icons.Clock className="w-3 h-3" style={{ color: "var(--cc-muted-fg)", marginTop: 2 }} />
          <div>
            <div style={{ fontSize: "0.75rem" }}>{e.text}</div>
            <div className="cc-meta" style={{ fontSize: "0.6875rem" }}>{e.when}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
