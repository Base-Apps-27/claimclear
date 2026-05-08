import "./_queue.css";
import { Tag, Copy, Link2Off, ArrowRight, Sparkles, Clock, ListChecks } from "lucide-react";
import {
  HeaderStrip, ClassificationStrip, MasterList,
  legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 Landing — "Start walk" hero.
 *
 * What problem this solves:
 *   When the user picks an invoice in the master list today, the right
 *   pane drops them straight into SOP step 1 — a wall of question +
 *   instructions + Yes/No buttons. There's no breathing room to
 *   orient: which leg, what's the issue, how long, what are my outs.
 *
 * What this shows:
 *   The same shell (header + classification strip + master list +
 *   one-line group summary + segmented leg switcher), but the hero is
 *   a calm blue-gradient card that:
 *     - Restates the leg + classification in plain language
 *     - Tells the operator what they're about to do (steps + ETA)
 *     - Offers a primary "Start walk" CTA
 *     - Surfaces the leg-level escape hatches inline (Reclassify,
 *       Mark as duplicate, Exclude) so the operator doesn't have to
 *       open the drawer just to bail out
 *     - Keeps the chips strip + footer in the same place
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

          {/* Hero — calm landing */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            gap: "0.625rem", justifyContent: "center", padding: "0 2rem",
          }}>
            <div style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
              {/* Tiny meta row above the card */}
              <div className="cc-meta text-[11px] mb-2 flex items-center gap-2">
                <span className="mono">{leg.conf}</span>
                <span>·</span>
                <span>{leg.date}</span>
                <span>·</span>
                <span>{leg.amount}</span>
                <span>·</span>
                <span>14.2 mi · Rate code <span className="mono">R-12</span></span>
              </div>

              {/* The blue-gradient landing card */}
              <div className="cc-sop-card" style={{ padding: "1.25rem 1.25rem 1rem" }}>
                {/* Classification + status pill row */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="cc-pill cc-pill-amber" style={{ fontSize: "0.6875rem" }}>
                    <Icons.AlertTriangle className="w-3 h-3" /> Mileage mismatch
                  </span>
                  <span className="cc-pill cc-pill-muted" style={{ fontSize: "0.6875rem" }}>
                    Leg 1 of 3
                  </span>
                  <span className="cc-meta" style={{ fontSize: "0.6875rem", marginLeft: "auto" }}>
                    Not started
                  </span>
                </div>

                {/* Plain-language restatement */}
                <h3 className="cc-sop-question" style={{ fontSize: "1.0625rem", marginTop: 10 }}>
                  GPS log shows 14.2 mi but the invoice billed under rate code R-12.
                  Walk the SOP to confirm whether this is disputable.
                </h3>

                {/* "What you're about to do" — calms the operator */}
                <div style={{
                  marginTop: 12,
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px",
                    background: "var(--cc-card)",
                    border: "1px solid var(--cc-blue-border)",
                    borderRadius: 8,
                  }}>
                    <ListChecks className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
                    <div style={{ fontSize: "0.75rem", lineHeight: 1.3 }}>
                      <div style={{ fontWeight: 600 }}>~4 steps</div>
                      <div className="cc-meta" style={{ fontSize: "0.6875rem" }}>GPS Deviation Status SOP</div>
                    </div>
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px",
                    background: "var(--cc-card)",
                    border: "1px solid var(--cc-blue-border)",
                    borderRadius: 8,
                  }}>
                    <Clock className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
                    <div style={{ fontSize: "0.75rem", lineHeight: 1.3 }}>
                      <div style={{ fontWeight: 600 }}>~2 minutes</div>
                      <div className="cc-meta" style={{ fontSize: "0.6875rem" }}>Median for legs like this</div>
                    </div>
                  </div>
                </div>

                {/* Primary CTA + AI assist */}
                <div className="cc-sop-actions" style={{ marginTop: 14 }}>
                  <button className="cc-btn cc-btn-primary">
                    Start walk <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button className="cc-btn">
                    <Sparkles className="w-3.5 h-3.5" /> Pre-fill with AI
                  </button>
                </div>

                {/* Escape hatches — leg-level outs without opening the drawer */}
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

              {/* Same chips strip — context surfaces (closed by default) */}
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
