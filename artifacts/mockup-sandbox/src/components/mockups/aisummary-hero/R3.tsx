import { MoreVertical, RotateCcw, Layers, ChevronLeft } from "lucide-react";
import {
  HeaderStrip,
  ClassificationStrip,
  MasterList,
  FrameLabel,
  Annotation,
  groupSummary,
  legs,
  Icons,
} from "../queue-redesign/_shared";

export default function R3() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="REWIND·R3"
        title="Walk-complete cards · per-leg Redo / Reclassify in card overflow"
        principles={["P1", "P3", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation tone="muted">
              <strong>From the cards row.</strong>{" "}
              Each leg card grows a small overflow with two destructive actions: <em>Redo walk</em>
              (keeps classification, restart) and <em>Reclassify…</em>. The card with the menu open
              shows the surface; the other two show the resting state.
            </Annotation>
          </div>

          <CardRow>
            <LegCard n={1} conf={legs[0].conf} date={legs[0].date} amount={legs[0].amount}
              tag="Time at Facility" tone="green" terminal="Disputable" terminalTone="green" />
            <LegCard n={2} conf={legs[1].conf} date={legs[1].date} amount={legs[1].amount}
              tag="Driver No-Show" tone="amber" terminal="Cannot dispute" terminalTone="amber"
              filtered openMenu />
            <LegCard n={3} conf={legs[2].conf} date={legs[2].date} amount={legs[2].amount}
              tag="GPS Deviation" tone="green" terminal="Disputable" terminalTone="green" />
          </CardRow>

          <FooterPreGen />
        </div>
      </div>
    </div>
  );
}

function InvoiceHeader() {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"0.625rem", padding:"0.5rem 0.75rem", background:"var(--cc-card)", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)" }}>
      <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
      <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
      <span className="cc-pill cc-pill-muted" style={{ marginLeft:"0.5rem" }}>3 walked · 2 disputable · 1 filtered</span>
      <div className="cc-segmented" style={{ marginLeft:"auto" }}>
        <button className="is-active">Walk ✓</button>
        <button>Preview</button>
        <button>Review</button>
        <button>Submit</button>
      </div>
    </div>
  );
}

function CardRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "0 1.25rem" }}>
      <div style={{ display:"flex", gap:"0.625rem", justifyContent:"flex-start", alignItems:"flex-start" }}>{children}</div>
    </div>
  );
}

function LegCard({ n, conf, date, amount, tag, tone, terminal, terminalTone, filtered, openMenu }: {
  n: number; conf: string; date: string; amount: string;
  tag: string; tone: "green" | "amber";
  terminal: string; terminalTone: "green" | "amber";
  filtered?: boolean; openMenu?: boolean;
}) {
  const accent = tone === "green" ? "var(--cc-green-fg)" : "var(--cc-amber-fg)";
  return (
    <div style={{ position:"relative", flex:"1 1 0", minWidth:280, maxWidth:320 }}>
      <div style={{
        background:"var(--cc-card)", border:"1px solid var(--cc-border)",
        borderTop:`3px solid ${accent}`, borderRadius:"var(--cc-radius)",
        padding:"0.625rem 0.75rem", display:"flex", flexDirection:"column", gap:"0.4rem",
        opacity: filtered ? 0.7 : 1,
      }}>
        <div className="flex items-center gap-1.5">
          <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg {n}</span>
          <span className="mono text-[12px] font-semibold">{conf}</span>
          <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft:"auto", padding:"0 4px" }} aria-label={`More for leg ${n}`}>
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="cc-meta text-[11px]">{date} · {amount}</div>
        <span className="cc-tag" style={{ alignSelf:"flex-start" }}>{tag}</span>
        <div style={{ height:1, background:"var(--cc-border)", margin:"0.125rem 0" }} />
        <div className="flex items-center gap-1.5">
          <span className="cc-meta text-[10px] uppercase tracking-wider">SOP</span>
          <span className={`cc-pill ${terminalTone === "green" ? "cc-pill-green" : "cc-pill-amber"}`}>{terminal}</span>
        </div>
        {filtered ? (
          <span className="cc-pill cc-pill-amber" style={{ alignSelf:"flex-start", marginTop:"0.125rem" }}>Not in prompt</span>
        ) : (
          <span className="cc-pill cc-pill-green" style={{ alignSelf:"flex-start", marginTop:"0.125rem" }}>Included in draft</span>
        )}
      </div>

      {openMenu && (
        <div style={{
          position:"absolute", top: 36, right: 6, zIndex: 5,
          width: 220, background:"var(--cc-card)",
          border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)",
          boxShadow:"0 6px 20px rgba(15,23,42,0.10)", padding:"0.25rem",
          display:"flex", flexDirection:"column",
        }}>
          <MenuItem icon={<ChevronLeft className="w-3.5 h-3.5" />} label="Open walk" hint="Jump to this leg's player" />
          <MenuItem icon={<RotateCcw className="w-3.5 h-3.5" />} label="Redo walk" hint="Keep classification, clear answers" />
          <div style={{ height:1, background:"var(--cc-border)", margin:"4px 0" }} />
          <MenuItem icon={<Layers className="w-3.5 h-3.5" />} label="Reclassify…" hint="Pick a different error type" tone="amber" />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, hint, tone }: { icon: React.ReactNode; label: string; hint: string; tone?: "amber" }) {
  return (
    <button style={{ display:"flex", alignItems:"flex-start", gap:"0.5rem", padding:"0.4rem 0.5rem", textAlign:"left", borderRadius:6, background:"transparent", border:"none", cursor:"pointer" }}>
      <span style={{ marginTop:2, color: tone === "amber" ? "var(--cc-amber-fg)" : "var(--cc-fg)" }}>{icon}</span>
      <span style={{ display:"flex", flexDirection:"column" }}>
        <span className="text-[12px] font-semibold">{label}</span>
        <span className="cc-meta text-[10px]">{hint}</span>
      </span>
    </button>
  );
}

function FooterPreGen() {
  return (
    <div className="cc-footer-card cc-footer-pinned" style={{ padding:"0.5rem 0.875rem" }}>
      <span className="cc-pill cc-pill-muted">Ready to draft</span>
      <span className="cc-meta text-xs flex-1">Per-leg menu lets operators rewind without leaving the cards row.</span>
      <button className="cc-btn cc-btn-primary"><Icons.Sparkles className="w-3.5 h-3.5" /> Generate dispute note</button>
    </div>
  );
}
