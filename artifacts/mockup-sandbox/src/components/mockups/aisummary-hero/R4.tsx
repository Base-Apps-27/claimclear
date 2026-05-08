import { Search, Layers, ChevronRight } from "lucide-react";
import {
  HeaderStrip,
  ClassificationStrip,
  MasterList,
  FrameLabel,
  Annotation,
  groupSummary,
  Icons,
} from "../queue-redesign/_shared";

export default function R4() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="REWIND·R4"
        title="Pre-walk · needs_classification (no design today — proposed first pass)"
        principles={["P1", "P3", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={1} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation tone="amber">
              <strong>The missing wizard state.</strong>{" "}
              Today V3 jumps straight into the SOP player, but a leg with no <em>errorTypeId</em> has
              nothing to walk. This is the proposed phase-zero hero: pick a classification, then the
              wizard transitions into the regular walk player. Same affordance is reachable later via
              <em> Reclassify</em>; only the framing changes.
            </Annotation>
          </div>

          <ClassifyCard />
        </div>
      </div>
    </div>
  );
}

function InvoiceHeader() {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"0.625rem", padding:"0.5rem 0.75rem", background:"var(--cc-card)", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)" }}>
      <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
      <span className="cc-meta text-[11px]">Leg 1 · 8847291 · $62.40 · Apr 24</span>
      <span className="cc-pill cc-pill-amber" style={{ marginLeft:"0.5rem" }}>Needs classification</span>
      <div className="cc-segmented" style={{ marginLeft:"auto" }}>
        <button className="is-active">Classify</button>
        <button>Walk</button>
        <button>Preview</button>
        <button>Review</button>
        <button>Submit</button>
      </div>
    </div>
  );
}

function ClassifyCard() {
  return (
    <div style={{ flex:1, padding:"0 1.25rem", display:"flex", flexDirection:"column", gap:"0.75rem" }}>
      <div style={{ background:"var(--cc-card)", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)", padding:"1rem 1.25rem", display:"flex", flexDirection:"column", gap:"0.875rem" }}>

        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4" style={{ color:"var(--cc-blue-fg)" }} />
          <span className="font-semibold text-sm">Pick the error type for Leg 1</span>
          <span className="cc-meta text-[11px]" style={{ marginLeft:"0.5rem" }}>Determines which SOP this leg walks</span>
        </div>

        {/* Search */}
        <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", padding:"0.5rem 0.625rem", border:"1px solid var(--cc-border)", borderRadius:"var(--cc-radius)", background:"var(--cc-bg)" }}>
          <Search className="w-3.5 h-3.5" style={{ color:"var(--cc-meta-fg)" }} />
          <input placeholder="Search error types…" style={{ flex:1, background:"transparent", border:"none", outline:"none", fontSize:13 }} />
          <span className="cc-meta text-[11px]">12 types · last used: Time at Facility</span>
        </div>

        {/* Suggestions row */}
        <div style={{ display:"flex", flexDirection:"column", gap:"0.375rem" }}>
          <span className="cc-meta text-[10px] uppercase tracking-wider">Most likely · based on payor & error code</span>
          <Suggestion label="Time at Facility" hint="3 SOP questions · facility delay" recommended />
          <Suggestion label="Driver Late Arrival" hint="4 SOP questions · driver-side cause" />
          <Suggestion label="Documented Detour" hint="3 SOP questions · routing exception" />
        </div>

        {/* Browse all */}
        <div style={{ display:"flex", flexDirection:"column", gap:"0.375rem" }}>
          <span className="cc-meta text-[10px] uppercase tracking-wider">All error types</span>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.375rem" }}>
            {[
              "GPS Deviation","Driver No-Show","Wrong Vehicle Class","Cancelled Late",
              "Wait Time","Wrong Address","Multi-Stop Issue","Hour-Overlap","Other"
            ].map((t) => (
              <button key={t} className="cc-btn cc-btn-ghost" style={{ justifyContent:"space-between", padding:"0.4rem 0.625rem" }}>
                <span className="text-[12px]">{t}</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            ))}
          </div>
        </div>

        {/* Action */}
        <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", borderTop:"1px solid var(--cc-border)", paddingTop:"0.75rem" }}>
          <span className="cc-meta text-[11px]">Selecting an error type stamps it on the leg and starts the SOP walk.</span>
          <button className="cc-btn cc-btn-primary cc-btn-sm" style={{ marginLeft:"auto" }}>
            <Icons.Sparkles className="w-3.5 h-3.5" /> Start walk · Time at Facility
          </button>
        </div>
      </div>
    </div>
  );
}

function Suggestion({ label, hint, recommended }: { label: string; hint: string; recommended?: boolean }) {
  return (
    <button style={{
      display:"flex", alignItems:"center", gap:"0.625rem",
      padding:"0.625rem 0.75rem",
      background:"var(--cc-bg)", border:`1px solid ${recommended ? "var(--cc-blue-fg)" : "var(--cc-border)"}`,
      borderRadius:"var(--cc-radius)", textAlign:"left", cursor:"pointer",
    }}>
      <span className="font-semibold text-[13px]">{label}</span>
      <span className="cc-meta text-[11px]">{hint}</span>
      {recommended && <span className="cc-pill cc-pill-blue" style={{ marginLeft:"auto" }}>Recommended</span>}
    </button>
  );
}
