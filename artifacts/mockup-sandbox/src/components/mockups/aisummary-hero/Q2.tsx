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
 * Round 4 · Q2 — In-context "AI Inputs Summary" hero.
 * Same stubby horizontal cards as Q1, but denser: each card surfaces the
 * SOP Q→A trail, evidence chips, op-note snippet, and the prompt layer
 * (default vs custom override). Still PRE-generate — bottom paragraph slot
 * empty with Generate CTA. ONE paragraph, not per-leg.
 */
export default function Q2() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V4·Q2"
        title="Walk-complete hero · stubby cards · full inputs visible (PRE-generate)"
        principles={["P1", "P2", "P3", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation tone="muted">
              <strong>Everything the AI will see, on one screen.</strong>{" "}
              Each card unpacks the SOP walk, evidence, and op-note for one leg. Filtered legs are
              dimmed so you can confirm exactly what's in the prompt — and what isn't.
            </Annotation>
          </div>

          <CardRow>
            <LegCardDense
              n={1} conf={legs[0].conf} date={legs[0].date} amount={legs[0].amount}
              tag="Time at Facility" tone="green"
              terminal="Disputable" terminalTone="green"
              sopTrail={["Held at facility?", "Driver waited?", "Release time documented?", "Within tolerance?"]}
              evidence={["Release sheet", "GPS log", "Op note"]}
              opNote="Facility intake confirmed delay; release at 14:42."
              layer="default"
              included
            />
            <LegCardDense
              n={2} conf={legs[1].conf} date={legs[1].date} amount={legs[1].amount}
              tag="Driver No-Show" tone="amber"
              terminal="Cannot dispute" terminalTone="amber"
              sopTrail={["Driver signed missed-pickup log on-site"]}
              evidence={[]}
              opNote=""
              filtered
            />
            <LegCardDense
              n={3} conf={legs[2].conf} date={legs[2].date} amount={legs[2].amount}
              tag="GPS Deviation" tone="green"
              terminal="Disputable" terminalTone="green"
              sopTrail={["Documented detour?", "Closure source verifiable?"]}
              evidence={["DOT closure", "Route trace"]}
              opNote="Active municipal closure; +1.4 mi alt path."
              layer="override"
              included
            />
          </CardRow>

          <ParagraphSlotEmpty />
          <FooterPreGen />
        </div>
      </div>
    </div>
  );
}

function InvoiceHeader() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.75rem", background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
      <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
      <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
      <span className="cc-pill cc-pill-muted" style={{ marginLeft: "0.5rem" }}>3 legs walked · 2 will be disputed · 1 filtered</span>
      <div className="cc-segmented" style={{ marginLeft: "auto" }}>
        <button className="is-active"><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk ✓</button>
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
      <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-start", alignItems: "stretch" }}>
        {children}
      </div>
    </div>
  );
}

function LegCardDense({
  n, conf, date, amount, tag, tone, terminal, terminalTone, sopTrail, evidence, opNote, layer, included, filtered,
}: {
  n: number; conf: string; date: string; amount: string;
  tag: string; tone: "green" | "amber";
  terminal: string; terminalTone: "green" | "amber";
  sopTrail: string[]; evidence: string[]; opNote: string;
  layer?: "default" | "override"; included?: boolean; filtered?: boolean;
}) {
  const accent = tone === "green" ? "var(--cc-green-fg)" : "var(--cc-amber-fg)";
  return (
    <div
      style={{
        flex: "1 1 0", minWidth: 280, maxWidth: 320,
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderTop: `3px solid ${accent}`,
        borderRadius: "var(--cc-radius)",
        padding: "0.625rem 0.75rem",
        display: "flex", flexDirection: "column", gap: "0.45rem",
        opacity: filtered ? 0.7 : 1,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg {n}</span>
        <span className="mono text-[12px] font-semibold">{conf}</span>
        {included && <Icons.CheckCircle2 className="w-3 h-3 ml-auto" style={{ color: "var(--cc-green-fg)" }} />}
        {filtered && <Icons.AlertTriangle className="w-3 h-3 ml-auto" style={{ color: "var(--cc-amber-fg)" }} />}
      </div>
      <div className="cc-meta text-[11px]">{date} · {amount}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="cc-tag">{tag}</span>
        <span className={`cc-pill ${terminalTone === "green" ? "cc-pill-green" : "cc-pill-amber"}`}>{terminal}</span>
      </div>

      <div style={{ height: 1, background: "var(--cc-border)" }} />

      <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold">SOP walk</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.2rem" }}>
        {sopTrail.map((q, i) => (
          <li key={i} className="text-[11px] flex items-start gap-1">
            <Icons.CheckCircle2 className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" style={{ color: filtered ? "var(--cc-amber-fg)" : "var(--cc-green-fg)" }} />
            <span>{q}</span>
          </li>
        ))}
      </ul>

      {evidence.length > 0 && (
        <>
          <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold">Evidence</div>
          <div className="flex items-center gap-1 flex-wrap">
            {evidence.map((e, i) => (
              <span key={i} className="cc-pill cc-pill-muted" style={{ fontSize: "10px" }}>
                <Icons.Paperclip className="w-2.5 h-2.5 inline" /> {e}
              </span>
            ))}
          </div>
        </>
      )}

      {opNote && (
        <>
          <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold">Op note</div>
          <div className="text-[11px]" style={{ fontStyle: "italic", lineHeight: 1.4 }}>
            "{opNote}"
          </div>
        </>
      )}

      <div style={{ marginTop: "auto" }} />
      {filtered ? (
        <span className="cc-pill cc-pill-amber" style={{ alignSelf: "flex-start" }}>Not in prompt</span>
      ) : (
        <div className="flex items-center gap-1">
          <span className="cc-pill cc-pill-green" style={{ alignSelf: "flex-start" }}>Included</span>
          {layer === "override" ? (
            <span className="cc-pill" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", borderColor: "var(--cc-purple-bg)" }}>
              Custom L2
            </span>
          ) : (
            <span className="cc-pill cc-pill-muted">Default L1</span>
          )}
        </div>
      )}
    </div>
  );
}

function ParagraphSlotEmpty() {
  return (
    <div style={{ flex: 1, padding: "0 1.25rem", overflow: "auto" }}>
      <div className="flex items-center gap-2" style={{ marginBottom: "0.375rem" }}>
        <Icons.FileText className="w-4 h-4" style={{ color: "var(--cc-fg-muted, var(--cc-meta-fg))" }} />
        <span className="font-semibold text-sm">Dispute note · one paragraph for this invoice</span>
        <span className="cc-meta text-xs ml-auto">Not generated yet</span>
      </div>
      <div
        style={{
          minHeight: 160,
          border: "1px dashed var(--cc-border)",
          borderRadius: "var(--cc-radius)",
          background: "var(--cc-bg)",
          padding: "1rem 1.25rem",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.5rem",
          textAlign: "center",
        }}
      >
        <Icons.Sparkles className="w-5 h-5" style={{ color: "var(--cc-blue-fg)" }} />
        <div className="font-semibold text-sm">Generate one note covering Leg 1 + Leg 3</div>
        <div className="cc-meta text-xs" style={{ maxWidth: 520 }}>
          Leg 1 uses default phrasing. Leg 3 uses the GPS-Deviation custom override. Leg 2 is filtered
          (no input from it will appear in the paragraph).
        </div>
      </div>
    </div>
  );
}

function FooterPreGen() {
  return (
    <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
      <span className="cc-pill cc-pill-muted">Ready to draft</span>
      <span className="cc-meta text-xs flex-1">All inputs verified. Generate writes one paragraph for the invoice.</span>
      <div className="cc-gauntlet-row" style={{ margin: 0 }}>
        <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk legs</span>
        <span className="cc-gauntlet-step cc-gauntlet-active"><Icons.Sparkles className="w-3 h-3" /> Generate</span>
        <span className="cc-gauntlet-step">Review</span>
        <span className="cc-gauntlet-step"><Icons.Send className="w-3 h-3" /> Submit</span>
      </div>
      <button className="cc-btn cc-btn-primary"><Icons.Sparkles className="w-3.5 h-3.5" /> Generate dispute note</button>
    </div>
  );
}
