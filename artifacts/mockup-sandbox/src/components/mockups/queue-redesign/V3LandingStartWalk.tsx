import "./_queue.css";
import { Tag, Copy, Link2Off, ArrowRight } from "lucide-react";
import {
  HeaderStrip, ClassificationStrip, MasterList,
  legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 Landing — "Start walk" hero (minimal).
 *
 * Shown when an invoice is selected and the active leg has no SOP
 * progress yet. Replaces the current behavior of dropping the operator
 * straight into SOP step 1.
 *
 * Only renders fields that exist in the codebase today:
 *   - Conf #, service date, amount         (from claim row)
 *   - Classification label                  (from leg.errorType)
 *   - Reclassify / Mark as duplicate / Exclude  (existing leg actions)
 *   - Counts strip (evidence/notes/comms/activity counts already loaded)
 *
 * No invented metadata (no ~steps, no ~ETA, no AI pre-fill, no
 * plain-language restatement of the issue).
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

          {/* Hero — minimal landing */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            gap: "0.625rem", justifyContent: "center", padding: "0 2rem",
          }}>
            <div style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
              {/* Meta row — only what claim already has */}
              <div className="cc-meta text-[11px] mb-2 flex items-center gap-2">
                <span className="mono">{leg.conf}</span>
                <span>·</span>
                <span>{leg.date}</span>
                <span>·</span>
                <span>{leg.amount}</span>
              </div>

              {/* Blue-gradient landing card */}
              <div className="cc-sop-card" style={{ padding: "1.5rem 1.25rem 1.125rem" }}>
                {/* Classification pill — pulled from leg.errorType */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="cc-pill cc-pill-amber" style={{ fontSize: "0.6875rem" }}>
                    <Icons.AlertTriangle className="w-3 h-3" /> GPS Deviation Status
                  </span>
                </div>

                {/* Primary CTA */}
                <div className="cc-sop-actions" style={{ marginTop: 14 }}>
                  <button className="cc-btn cc-btn-primary">
                    Start walk <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Escape hatches — existing leg actions */}
                <div style={{
                  marginTop: 14, paddingTop: 12,
                  borderTop: "1px dashed var(--cc-blue-border)",
                  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                }}>
                  <span className="cc-meta" style={{ fontSize: "0.6875rem" }}>
                    Or:
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
