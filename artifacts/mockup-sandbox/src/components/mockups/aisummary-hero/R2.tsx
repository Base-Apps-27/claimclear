import { ChevronLeft, RotateCcw, Layers, MoreVertical, AlertTriangle } from "lucide-react";
import {
  HeaderStrip,
  ClassificationStrip,
  MasterList,
  FrameLabel,
  Annotation,
  groupSummary,
  Icons,
} from "../queue-redesign/_shared";

export default function R2() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="REWIND·R2"
        title="Terminal verdict reached · Change answer / Restart walk / Reclassify"
        principles={["P1", "P3", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation tone="amber">
              <strong>The "this isn't right" moment.</strong>{" "}
              Walk just landed on <em>Cannot dispute</em>. The verdict screen now leads with two
              targeted escapes — <em>Change my answer</em> (pops one step) and <em>Restart walk</em>
              (keeps the error type, clears all answers) — instead of forcing a full reclassify.
              Reclassify still lives one click deeper for the rare "wrong error type" case.
            </Annotation>
          </div>

          <TerminalCard />
        </div>
      </div>
    </div>
  );
}

function InvoiceHeader() {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"0.625rem", padding:"0.5rem 0.75rem", background:"var(--cc-card)", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)" }}>
      <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
      <span className="cc-meta text-[11px]">Leg 2 · 8847294 · Driver No-Show</span>
      <span className="cc-pill cc-pill-amber" style={{ marginLeft:"0.5rem" }}>Walk complete · Cannot dispute</span>
      <div className="cc-segmented" style={{ marginLeft:"auto" }}>
        <button className="is-active">Walk</button>
        <button>Preview</button>
        <button>Review</button>
        <button>Submit</button>
      </div>
    </div>
  );
}

function TerminalCard() {
  return (
    <div style={{ flex:1, padding:"0 1.25rem" }}>
      <div style={{ background:"var(--cc-card)", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)", padding:"1rem 1.25rem", display:"flex", flexDirection:"column", gap:"0.875rem" }}>

        {/* Verdict header */}
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" style={{ color:"var(--cc-amber-fg)" }} />
          <span className="font-semibold text-sm">SOP terminal · Cannot dispute</span>
          <span className="cc-pill cc-pill-amber" style={{ marginLeft:"0.5rem" }}>3 answers</span>
          <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft:"auto" }} aria-label="More walk actions">
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Verdict body */}
        <div style={{ background:"var(--cc-bg)", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)", padding:"0.75rem 0.875rem", display:"flex", gap:"0.625rem" }}>
          <span style={{ width:6, alignSelf:"stretch", background:"var(--cc-amber-fg)", borderRadius:3, flexShrink:0 }} />
          <div style={{ display:"flex", flexDirection:"column", gap:"0.25rem" }}>
            <div className="font-semibold text-sm">Driver signed missed-pickup log on file.</div>
            <div className="cc-meta text-[12px]">Per the SOP for Driver No-Show, a signed missed-pickup log at the address closes the dispute. This leg will be excluded from the AI write-up and cancelled.</div>
          </div>
        </div>

        {/* Walked answers — clickable to jump back */}
        <div style={{ borderTop:"1px solid var(--cc-border)", paddingTop:"0.75rem" }}>
          <div className="cc-meta text-[10px] uppercase tracking-wider mb-2">Your answers</div>
          <ol style={{ display:"flex", flexDirection:"column", gap:"0.375rem", padding:0, margin:0, listStyle:"none" }}>
            <Step n={1} q="Driver arrived at pickup address?" a="Yes" />
            <Step n={2} q="Driver waited the required window?" a="Yes — 11 min" />
            <Step n={3} q="Missed-pickup log signed at address?" a="Yes" current />
          </ol>
        </div>

        {/* Action row — primary = Change answer, secondary = Restart, overflow = Reclassify */}
        <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", borderTop:"1px solid var(--cc-border)", paddingTop:"0.75rem" }}>
          <button className="cc-btn cc-btn-primary cc-btn-sm" data-testid="walk-change-answer">
            <ChevronLeft className="w-3.5 h-3.5" /> Change my answer
          </button>
          <button className="cc-btn cc-btn-ghost cc-btn-sm" data-testid="walk-restart">
            <RotateCcw className="w-3.5 h-3.5" /> Restart walk
          </button>
          <span className="cc-meta text-[11px]" style={{ marginLeft:"auto" }}>Both keep the classification (Driver No-Show)</span>
        </div>

        {/* Footnote — reclassify path */}
        <div style={{ display:"flex", alignItems:"center", gap:"0.375rem", padding:"0.5rem 0.75rem", background:"var(--cc-bg)", border:"1px dashed var(--cc-border)", borderRadius:"var(--cc-radius)" }}>
          <Layers className="w-3.5 h-3.5" style={{ color:"var(--cc-meta-fg)" }} />
          <span className="cc-meta text-[11px]">Wrong error type to begin with?</span>
          <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft:"auto" }}>Reclassify…</button>
        </div>
      </div>
    </div>
  );
}

function Step({ n, q, a, current }: { n: number; q: string; a: string; current?: boolean }) {
  return (
    <li style={{ display:"flex", alignItems:"center", gap:"0.5rem", padding:"0.375rem 0.5rem", border:`1px solid ${current ? "var(--cc-amber-fg)" : "var(--cc-border)"}`, borderRadius:"var(--cc-radius)", background: current ? "rgba(245,158,11,0.06)" : "var(--cc-card)" }}>
      <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider" style={{ width: 28 }}>Q{n}</span>
      <span className="text-[12px]" style={{ flex:1, minWidth:0 }}>{q}</span>
      <span className="font-semibold text-[12px]">{a}</span>
      {current ? (
        <span className="cc-pill cc-pill-amber">Triggered terminal</span>
      ) : (
        <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ padding:"0 6px" }}>Rewind to here</button>
      )}
    </li>
  );
}
