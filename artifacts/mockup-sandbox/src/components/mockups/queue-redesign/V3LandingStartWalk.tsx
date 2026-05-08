import "./_queue.css";
import { Tag, Copy, Link2Off, ArrowRight, Edit2 } from "lucide-react";
import {
  HeaderStrip, ClassificationStrip, MasterList,
  legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 Landing — "Start walk" hero (middle ground).
 *
 * Shown when an invoice is selected and the active leg has no SOP
 * progress yet. Replaces dropping the operator straight into SOP
 * step 1.
 *
 * Every field below comes from the existing claim/group payload that
 * `ClaimDetailV2` already renders (see claim-detail-v2.tsx ~L868):
 *   - StatusPill / subStatusLabel        → "Not started"
 *   - claim.errorTypeName + "Change"      → classification + re-pick
 *   - claim.claimAmount, claim.date       → meta row (DOS + amount)
 *   - relativeTime(claim.updatedAt)       → "Updated …"
 *   - parentGroup.status                  → group state line
 *   - canReclassify / Mark dup / Exclude  → existing leg actions
 */
export default function V3LandingStartWalk() {
  const leg = legs[0];

  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          {/* Group summary — same one-line bar */}
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

          {/* Hero — middle-ground landing */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            gap: "0.625rem", justifyContent: "center", padding: "0 2rem",
          }}>
            <div style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
              {/* Meta row — fields that already exist on the claim row */}
              <div className="cc-meta text-[11px] mb-2 flex items-center gap-2 flex-wrap">
                <span className="mono">{leg.conf}</span>
                <span>·</span>
                <span>DOS {leg.date}</span>
                <span>·</span>
                <span className="mono">{leg.amount}</span>
                <span>·</span>
                <span>Updated 14m ago</span>
              </div>

              {/* Blue-gradient landing card */}
              <div className="cc-sop-card" style={{ padding: "1.125rem 1.25rem 1rem" }}>
                {/* Status + classification (with Change affordance) */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="cc-pill cc-pill-muted" style={{ fontSize: "0.6875rem" }}>
                    Not started
                  </span>
                  <span className="cc-meta" style={{ fontSize: "0.75rem" }}>·</span>
                  <span style={{ fontSize: "0.75rem", fontWeight: 500 }}>
                    GPS Deviation Status
                  </span>
                  <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ fontSize: "0.6875rem", height: 22, padding: "0 6px" }}>
                    <Edit2 className="w-3 h-3" /> Change
                  </button>
                </div>

                {/* Heading — generic UI copy, no invented data */}
                <h3 className="cc-sop-question" style={{ fontSize: "1rem", marginTop: 12 }}>
                  Ready to walk this leg
                </h3>
                <p className="cc-meta" style={{ fontSize: "0.75rem", marginTop: 4, lineHeight: 1.45 }}>
                  Walking the SOP confirms whether this leg is disputable. You can stop
                  and resume at any time, and your answers are saved as you go.
                </p>

                {/* Group state line — pulled from parentGroup */}
                <div style={{
                  marginTop: 10, paddingTop: 10,
                  borderTop: "1px solid var(--cc-blue-border)",
                  fontSize: "0.6875rem", color: "var(--cc-muted-fg)",
                }}>
                  Group state: <span style={{ color: "var(--cc-fg)", fontWeight: 500 }}>awaiting submission</span>
                  {" · "}
                  <a href="#" className="cc-link">Open INV-2026-0487 in full view</a>
                </div>

                {/* Primary CTA */}
                <div className="cc-sop-actions" style={{ marginTop: 12 }}>
                  <button className="cc-btn cc-btn-primary">
                    Start walk <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Escape hatches — existing leg actions */}
                <div style={{
                  marginTop: 12, paddingTop: 10,
                  borderTop: "1px dashed var(--cc-blue-border)",
                  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                }}>
                  <span className="cc-meta" style={{ fontSize: "0.6875rem" }}>
                    Or, if this leg shouldn't be walked:
                  </span>
                  <button className="cc-btn cc-btn-sm" style={{ fontSize: "0.6875rem" }}>
                    <Tag className="w-3 h-3" /> Reclassify
                  </button>
                  <button className="cc-btn cc-btn-sm" style={{ fontSize: "0.6875rem" }}>
                    <Copy className="w-3 h-3" /> Mark as duplicate
                  </button>
                  <button className="cc-btn cc-btn-sm" style={{ fontSize: "0.6875rem" }}>
                    <Link2Off className="w-3 h-3" /> Exclude
                  </button>
                </div>
              </div>

              {/* Same chips strip — closed by default */}
              <div style={{ marginTop: "0.75rem" }}>
                <div className="cc-counts-strip">
                  <button className="cc-count-pill">
                    <Icons.Paperclip className="w-3 h-3" /> Evidence
                    <span className="cc-count-n">4</span>
                  </button>
                  <button className="cc-count-pill">
                    <Icons.FileText className="w-3 h-3" /> Notes
                    <span className="cc-count-n">2</span>
                  </button>
                  <button className="cc-count-pill">
                    <Icons.MessageSquare className="w-3 h-3" /> Comms
                    <span className="cc-count-n">1</span>
                  </button>
                  <button className="cc-count-pill">
                    <Icons.Activity className="w-3 h-3" /> Activity
                    <span className="cc-count-n">11</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Same sticky footer */}
          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-amber">0 of 3 ready</span>
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
