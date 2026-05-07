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

/**
 * Round 3 · Q3 — In-context "AI Inputs Summary" hero, POST-generate state.
 * Same compact rows, but the generated paragraph for each contestable leg
 * appears inline directly beneath its row — input and output paired without
 * leaving the hero. Filtered leg shows no paragraph (visual proof that the AI
 * never saw it). Footer gauntlet has advanced; primary CTA is now "Review &
 * edit" instead of Generate. Lets the operator catch a paragraph that drifted
 * from its evidence without scrolling to a separate Preview screen.
 */
export default function Q3() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V3·Q3"
        title="Walk-complete hero · inputs paired with generated paragraphs (POST-generate)"
        principles={["P1", "P3", "P4", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.75rem", background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
            <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
            <span className="cc-pill cc-pill-green" style={{ marginLeft: "0.5rem" }}>
              <Icons.Sparkles className="w-3 h-3 inline" /> Preview generated · 2.4s
            </span>
            <div className="cc-segmented" style={{ marginLeft: "auto" }}>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk ✓</button>
              <button className="is-active"><Icons.FileText className="w-2.5 h-2.5 inline mr-1" />Preview</button>
              <button>Review</button>
              <button>Submit</button>
            </div>
          </div>

          <Annotation>
            <strong>Inputs and draft, paired.</strong>{" "}
            Each leg row shows what the AI saw plus the paragraph it produced from that input. Leg 2 was
            filtered — no input went in, no paragraph came out. Read once, then advance to Review (where
            you can edit) or skip straight to Submit.
          </Annotation>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.625rem", padding: "0 1.25rem", overflow: "auto" }}>
            <div style={{ maxWidth: 880, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              <div className="flex items-center gap-2" style={{ marginBottom: "0.125rem" }}>
                <Icons.Sparkles className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
                <span className="font-semibold text-sm">2 dispute paragraphs · drafted from {groupSummary.invoice}</span>
                <span className="cc-meta text-xs ml-auto">1 filtered · 1 custom override</span>
              </div>

              <PairedRow
                n={1}
                conf={legs[0].conf}
                date={legs[0].date}
                amount={legs[0].amount}
                tag="Time at Facility"
                tone="green"
                inputSummary="SOP terminal: Disputable — 4 of 4 yes · 3 evidence files · op note: facility intake confirmed delay."
                layer="default"
                paragraph={`On April 24, ride ${legs[0].conf} was held at the dialysis facility past the scheduled 14:15 pickup. The driver waited curbside from 14:18; the facility's signed release sheet documents the rider's release at 14:42 — a delay of 27 minutes attributable to facility intake. We respectfully request reversal of the offset on this leg.`}
              />

              <PairedRow
                n={2}
                conf={legs[1].conf}
                date={legs[1].date}
                amount={legs[1].amount}
                tag="Driver No-Show"
                tone="amber"
                inputSummary="SOP terminal: Cannot Dispute — driver signed missed-pickup log on-site."
                filtered
              />

              <PairedRow
                n={3}
                conf={legs[2].conf}
                date={legs[2].date}
                amount={legs[2].amount}
                tag="GPS Deviation"
                tone="green"
                inputSummary="SOP terminal: Disputable — documented construction detour · 2 evidence files · DOT closure attached."
                layer="override"
                paragraph={`Ride ${legs[2].conf} on April 25 deviated from the most direct path due to an active municipal closure. The attached DOT closure notice covers the entire ride window; the alternate path added 1.4 miles. The rider arrived on time. Per the custom GPS-Deviation guidance, no inference is drawn about driver intent.`}
              />
            </div>
          </div>

          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-green">Preview ready</span>
            <span className="cc-meta text-xs flex-1">Read the paragraphs above. Review lets you edit; Submit sends as-is.</span>
            <div className="cc-gauntlet-row" style={{ margin: 0 }}>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk legs</span>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Preview</span>
              <span className="cc-gauntlet-step cc-gauntlet-active">Review &amp; edit</span>
              <span className="cc-gauntlet-step"><Icons.Send className="w-3 h-3" /> Submit</span>
            </div>
            <button className="cc-btn">Skip review</button>
            <button className="cc-btn cc-btn-primary"><Icons.FileText className="w-3.5 h-3.5" /> Review &amp; edit</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PairedRow({
  n, conf, date, amount, tag, tone, inputSummary, paragraph, layer, filtered,
}: {
  n: number; conf: string; date: string; amount: string; tag: string;
  tone: "green" | "amber"; inputSummary: string; paragraph?: string;
  layer?: "default" | "override"; filtered?: boolean;
}) {
  const accent = tone === "green" ? "var(--cc-green-fg)" : "var(--cc-amber-fg)";
  return (
    <div
      className="cc-card"
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "var(--cc-radius)",
        overflow: "hidden",
        opacity: filtered ? 0.78 : 1,
      }}
    >
      <div className="flex items-center gap-2" style={{ padding: "0.5rem 0.75rem", borderBottom: filtered ? "none" : "1px solid var(--cc-border)" }}>
        <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg {n}</span>
        <span className="mono text-[12px] font-semibold">{conf}</span>
        <span className="cc-meta text-[11px]">{date} · {amount}</span>
        <span className="cc-tag" style={{ marginLeft: "0.25rem" }}>{tag}</span>
        {filtered ? (
          <span className="cc-pill cc-pill-amber ml-auto">
            <Icons.AlertTriangle className="w-2.5 h-2.5 inline" /> Not in prompt · no paragraph generated
          </span>
        ) : (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="cc-pill cc-pill-green">
              <Icons.CheckCircle2 className="w-2.5 h-2.5 inline" /> Drafted
            </span>
            {layer === "override" ? (
              <span className="cc-pill" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", borderColor: "var(--cc-purple-bg)" }}>
                Custom phrasing
              </span>
            ) : (
              <span className="cc-pill cc-pill-muted">Default phrasing</span>
            )}
          </span>
        )}
      </div>
      <div style={{ padding: "0.5rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        <div className="cc-meta text-[11px]">
          <strong style={{ color: "var(--cc-fg)" }}>Inputs:</strong> {inputSummary}
        </div>
        {paragraph && (
          <div
            style={{
              fontSize: "0.8125rem",
              lineHeight: 1.55,
              padding: "0.5rem 0.625rem",
              background: "var(--cc-bg)",
              border: "1px solid var(--cc-border)",
              borderRadius: "calc(var(--cc-radius) - 2px)",
              color: "var(--cc-fg)",
            }}
          >
            <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold" style={{ marginBottom: "0.25rem", color: "var(--cc-blue-fg)" }}>
              <Icons.ArrowRight className="w-3 h-3 inline" /> Generated paragraph
            </div>
            {paragraph}
          </div>
        )}
      </div>
    </div>
  );
}
