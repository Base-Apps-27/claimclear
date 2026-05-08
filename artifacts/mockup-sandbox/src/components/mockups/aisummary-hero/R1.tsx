import { ChevronLeft, MoreVertical, RotateCcw, Layers, X } from "lucide-react";
import {
  HeaderStrip,
  ClassificationStrip,
  MasterList,
  FrameLabel,
  Annotation,
  groupSummary,
  Icons,
} from "../queue-redesign/_shared";

export default function R1() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="REWIND·R1"
        title="Mid-walk · Back button + breadcrumb (player-level rewind)"
        principles={["P1", "P3", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation tone="blue">
              <strong>Where the affordances live.</strong>{" "}
              The walk player gains a left-side <em>Back</em> button (pops one answer), a breadcrumb of
              answered steps that operators can hover to preview, and a small overflow menu in the
              header for the heavier <em>Restart walk</em> and <em>Reclassify</em> escapes.
            </Annotation>
          </div>

          <PlayerCard />
        </div>
      </div>
    </div>
  );
}

function InvoiceHeader() {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"0.625rem", padding:"0.5rem 0.75rem", background:"var(--cc-card)", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)" }}>
      <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
      <span className="cc-meta text-[11px]">Leg 1 · 8847291 · Time at Facility</span>
      <span className="cc-pill cc-pill-blue" style={{ marginLeft:"0.5rem" }}>Walk in progress · step 4 of ~5</span>
      <div className="cc-segmented" style={{ marginLeft:"auto" }}>
        <button className="is-active">Walk</button>
        <button>Preview</button>
        <button>Review</button>
        <button>Submit</button>
      </div>
    </div>
  );
}

function PlayerCard() {
  return (
    <div style={{ flex:1, padding:"0 1.25rem" }}>
      <div style={{ background:"var(--cc-card)", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)", padding:"1rem 1.25rem", display:"flex", flexDirection:"column", gap:"0.875rem" }}>

        {/* Header row: title + overflow menu (where Restart/Reclassify live) */}
        <div className="flex items-center gap-2">
          <Icons.Sparkles className="w-4 h-4" style={{ color:"var(--cc-blue-fg)" }} />
          <span className="font-semibold text-sm">SOP walk · Time at Facility</span>
          <span className="cc-meta text-[11px]" style={{ marginLeft:"0.5rem" }}>4 answers recorded</span>
          <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft:"auto" }} aria-label="More walk actions">
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Hovering overflow menu (rendered open for the mockup) */}
        <div style={{ alignSelf:"flex-end", marginTop:-8, marginRight:4, width:240, background:"var(--cc-card)", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)", boxShadow:"0 6px 20px rgba(15,23,42,0.10)", padding:"0.25rem", display:"flex", flexDirection:"column" }}>
          <MenuItem icon={<RotateCcw className="w-3.5 h-3.5" />} label="Restart walk" hint="Keep classification, clear all answers" />
          <MenuItem icon={<Layers className="w-3.5 h-3.5" />} label="Reclassify…" hint="Change the error type entirely" tone="amber" />
        </div>

        {/* Breadcrumb of prior answers */}
        <div className="flex items-center gap-1.5" style={{ flexWrap:"wrap", marginTop:-8 }}>
          <span className="cc-meta text-[10px] uppercase tracking-wider mr-1">Walked</span>
          <Crumb n={1} q="Rider on dialysis or appointment time?" a="Yes — appointment" />
          <Sep />
          <Crumb n={2} q="Did facility document release time?" a="Yes — 14:42" />
          <Sep />
          <Crumb n={3} q="Is documented time after pickup?" a="Yes" />
          <Sep />
          <Crumb n={4} q="Gap > 15 min?" a="Yes — 27 min" current />
        </div>

        {/* Current question */}
        <div style={{ borderTop:"1px solid var(--cc-border)", paddingTop:"0.875rem" }}>
          <div className="cc-meta text-[10px] uppercase tracking-wider mb-1">Question 5</div>
          <div className="font-semibold text-base mb-3">Did the rider's documented release fall outside the contract window?</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.5rem" }}>
            <Choice label="Yes — outside the window" />
            <Choice label="No — inside the window" />
          </div>
        </div>

        {/* Action strip: Back is the new affordance */}
        <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", borderTop:"1px solid var(--cc-border)", paddingTop:"0.75rem" }}>
          <button className="cc-btn cc-btn-ghost cc-btn-sm" data-testid="walk-back">
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
          <span className="cc-meta text-[11px]">Pops the last answer · returns to question 4</span>
          <span className="cc-meta text-[11px]" style={{ marginLeft:"auto" }}>
            <kbd style={{ fontFamily:"inherit", border:"1px solid var(--cc-border)", borderRadius:4, padding:"0 4px", fontSize:10 }}>←</kbd> shortcut
          </span>
        </div>
      </div>
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

function Crumb({ n, q, a, current }: { n: number; q: string; a: string; current?: boolean }) {
  return (
    <button
      title={q}
      style={{
        display:"inline-flex", alignItems:"center", gap:4,
        padding:"2px 8px", borderRadius:999,
        border:`1px solid ${current ? "var(--cc-blue-fg)" : "var(--cc-border)"}`,
        background: current ? "var(--cc-blue-bg, #eff6ff)" : "var(--cc-bg)",
        color: current ? "var(--cc-blue-fg)" : "var(--cc-fg)",
        fontSize: 11, cursor: "pointer",
      }}
    >
      <span className="cc-meta text-[10px]">Q{n}</span>
      <span className="font-semibold">{a}</span>
      {current && <X className="w-2.5 h-2.5" style={{ marginLeft:2, opacity:0.6 }} />}
    </button>
  );
}

function Sep() {
  return <span className="cc-meta text-[10px]" style={{ opacity:0.4 }}>›</span>;
}

function Choice({ label }: { label: string }) {
  return (
    <button style={{ textAlign:"left", padding:"0.625rem 0.75rem", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)", background:"var(--cc-bg)", cursor:"pointer", fontSize:13 }}>
      {label}
    </button>
  );
}
