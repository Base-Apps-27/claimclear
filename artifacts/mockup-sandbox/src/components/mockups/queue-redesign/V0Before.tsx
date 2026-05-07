import { Icons, FrameLabel, queueChips, queueRows } from "./_shared";

/**
 * V0 — "Before" reference.
 * A schematic of what the production Queue page looks like today —
 * triple-nested grids, sticky urgency hero, MAS rail inside the
 * already-narrow right pane, and the submission slot drawn in BOTH
 * positions to make the teleport obvious. Static; no live wiring.
 */
export default function V0Before() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 1100 }}>
      <FrameLabel
        tag="V0"
        title="Before · production today · for reference (don't compare visual fidelity, compare structure)"
        principles={["Diagnosis #1–#8"]}
      />

      {/* Sticky red hero — the ~330-line QueueUrgencyHero */}
      <div style={{ background: "var(--cc-red-bg)", borderBottom: "2px solid var(--cc-red-border)", padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <Icons.AlertTriangle className="w-7 h-7" style={{ color: "var(--cc-red-fg)" }} />
        <div>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--cc-red-fg)", lineHeight: 1 }}>38</div>
          <div style={{ fontSize: "0.8125rem", color: "var(--cc-red-fg)", fontWeight: 600 }}>8 due today · 30 due tomorrow</div>
          <div className="cc-meta text-[11px]">Today's red rows must ship before EOD; tomorrow's amber rows are next on the clock.</div>
          <div className="cc-meta text-[11px] mt-1">Why? 4 awaiting payor reply · 3 stuck in Portal Queued · 1 needs evidence ↗</div>
        </div>
        <span className="cc-tag" style={{ marginLeft: "auto" }}>Diagnosis #5 · ~330 lines, sticky, dominates viewport</span>
      </div>

      <div style={{ background: "var(--cc-card)", borderBottom: "1px solid var(--cc-border)", padding: "0.75rem 1rem" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Icons.Inbox className="w-4 h-4" />
          <span className="font-semibold">Classification Inbox</span>
          <span className="cc-pill cc-pill-amber">3 to classify</span>
          <button className="cc-btn cc-btn-sm ml-auto">Show <Icons.ChevronDown className="w-3 h-3" /></button>
        </div>
      </div>

      {/* 3-column page grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", padding: "1rem", gap: "1rem", background: "var(--cc-bg)" }}>
        {/* Left: list */}
        <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", overflow: "hidden" }}>
          <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--cc-border)", fontSize: "0.75rem", color: "var(--cc-muted-fg)" }}>
            Action Required (12) · Portal Queued (8) · On Hold (3)
          </div>
          {queueRows.slice(0, 5).map((r) => (
            <div key={r.id} style={{ padding: "0.625rem 0.75rem", borderBottom: "1px solid var(--cc-border)", display: "flex", flexDirection: "column", gap: 2, background: r.selected ? "var(--cc-blue-bg)" : undefined }}>
              <div className="flex items-center gap-1.5">
                <span className="mono text-[12px] font-semibold">{r.invoice}</span>
                <span className="cc-pill cc-pill-amber" style={{ marginLeft: "auto" }}>New</span>
                <span className="cc-meta text-[11px]">{r.amount}</span>
              </div>
              <div className="cc-meta text-[11px]">{r.payor} · {r.errorTag} · {r.legs} legs · {r.amount}</div>
            </div>
          ))}
          <div style={{ padding: "0.375rem 0.75rem", borderTop: "1px solid var(--cc-border)", fontSize: "0.625rem", color: "var(--cc-muted-fg)" }}>
            Diagnosis #7: rows duplicate $amount + “New” badge on every line.
          </div>
        </div>

        {/* Right: workspace — note the inner 8/4 grid */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.625rem 0.875rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="font-semibold text-sm">Process Invoice Group</span>
            <span className="cc-meta text-xs">INV-2026-0487 · Needs Evidence</span>
            <a href="#" className="cc-btn cc-btn-ghost cc-btn-sm ml-auto">Full Details <Icons.ChevronRight className="w-3 h-3" /></a>
            <button className="cc-btn cc-btn-ghost cc-btn-sm">Close</button>
          </div>

          {/* Inner grid 8/4 — the second nested split */}
          <div style={{ display: "grid", gridTemplateColumns: "8fr 4fr", gap: "0.625rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {/* Legs panel header */}
              <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.5rem 0.75rem", fontSize: "0.8125rem", fontWeight: 600 }}>Legs</div>
              {/* Leg row expanded — the entire workstation duplicates per leg */}
              <NestedWorkstation />
              <NestedWorkstation collapsed />
              <NestedWorkstation collapsed />

              {/* Submission slot location A — when a leg is expanded the slot
                  ALSO renders inside the expanded leg above. When no leg is
                  expanded it renders here. Drawn twice in this mockup to show
                  the teleport. */}
              <div style={{ position: "relative" }}>
                <div className="cc-card" style={{ background: "var(--cc-amber-bg)", border: "2px dashed var(--cc-amber-border)", borderRadius: "var(--cc-radius)", padding: "0.625rem 0.875rem" }}>
                  <div className="font-semibold text-sm" style={{ color: "var(--cc-amber-fg)" }}>Submission slot · location A</div>
                  <div className="cc-meta text-[11px]">Renders here when no leg is expanded.</div>
                </div>
                <span style={{ position: "absolute", top: -10, right: -8, background: "var(--cc-red-fg)", color: "white", fontSize: "0.625rem", padding: "0.125rem 0.375rem", borderRadius: 4, fontWeight: 700 }}>TELEPORTS</span>
              </div>
            </div>

            {/* Inner rail — MAS + Activity, inside the already narrow pane */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.625rem", fontSize: "0.75rem" }}>
                <div className="font-semibold mb-1">MAS rail</div>
                <span className="cc-pill cc-pill-amber">1 step queued</span>
                <div className="cc-meta text-[10px] mt-2">Diagnosis #1: inner 8/4 grid inside the right pane.</div>
              </div>
              <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.625rem", fontSize: "0.75rem" }}>
                <div className="font-semibold mb-1">Activity history (11)</div>
                <ul style={{ padding: 0, margin: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                  <li className="cc-meta text-[10px]">10:14a · Trip log added</li>
                  <li className="cc-meta text-[10px]">09:56a · SOP advanced</li>
                  <li className="cc-meta text-[10px]">Apr 24 4:48p · In Dispute</li>
                </ul>
                <div className="cc-meta text-[10px] mt-2">Diagnosis #7: shown by default.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NestedWorkstation({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.5rem 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Icons.ChevronRight className="w-3.5 h-3.5" />
        <span className="mono text-[12px]">C-2026-048xx</span>
        <span className="cc-pill cc-pill-amber ml-auto">Needs walk</span>
      </div>
    );
  }
  return (
    <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.625rem", display: "flex", flexDirection: "column", gap: "0.375rem", fontSize: "0.6875rem" }}>
      <div className="flex items-center gap-2">
        <Icons.ChevronDown className="w-3.5 h-3.5" />
        <span className="mono font-semibold">C-2026-04812</span>
        <span className="cc-pill cc-pill-blue ml-auto">In progress</span>
      </div>
      {/* Each section is a separate boxed card — the spec calls out 7 surfaces */}
      <Box label="SOP transcript (open)" />
      <Box label="Investigation walk" />
      <Box label="Evidence (3)" />
      <Box label="Internal notes (1)" />
      <Box label="Communication thread" />
      <Box label="Per-leg verdict picker" />
      {/* Submission slot location B — inside the expanded leg */}
      <div style={{ position: "relative" }}>
        <div className="cc-card" style={{ background: "var(--cc-amber-bg)", border: "2px dashed var(--cc-amber-border)", borderRadius: "calc(var(--cc-radius) - 2px)", padding: "0.375rem 0.5rem" }}>
          <span className="text-[10px] font-semibold" style={{ color: "var(--cc-amber-fg)" }}>Submission slot · location B (when this leg is expanded)</span>
        </div>
        <span style={{ position: "absolute", top: -8, right: -6, background: "var(--cc-red-fg)", color: "white", fontSize: "0.5625rem", padding: "0 0.25rem", borderRadius: 3, fontWeight: 700 }}>TELEPORTS</span>
      </div>
    </div>
  );
}

function Box({ label }: { label: string }) {
  return (
    <div style={{ background: "var(--cc-muted)", padding: "0.25rem 0.5rem", borderRadius: 4, color: "var(--cc-muted-fg)", fontSize: "0.625rem" }}>
      {label}
    </div>
  );
}
