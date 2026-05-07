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
 * Round 4 · Q1 — In-context "AI Inputs Summary" hero.
 * Stubby horizontal leg cards (one row, ~3 cards fit; 4+ would stack).
 * Minimum-density cards: classification tag + SOP terminal verdict + key
 * meta. PRE-generate state — bottom paragraph slot is an empty placeholder
 * with the Generate CTA. Single paragraph (per code: one note for the
 * whole invoice), not per-leg paragraphs.
 */
export default function Q1() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V4·Q1"
        title="Walk-complete hero · stubby cards · minimum density (PRE-generate)"
        principles={["P1", "P2", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation tone="muted">
              <strong>What the AI will see.</strong>{" "}
              Three legs walked. Two are disputable and will be combined into one dispute note for this
              invoice. The non-contestable leg is filtered — it stays visible here so you know nothing was
              missed, but it doesn't enter the prompt.
            </Annotation>
          </div>

          <CardRow>
            <LegCard
              n={1} conf={legs[0].conf} date={legs[0].date} amount={legs[0].amount}
              tag="Time at Facility" tone="green"
              terminal="Disputable" terminalTone="green"
              evidence="3 files" included
            />
            <LegCard
              n={2} conf={legs[1].conf} date={legs[1].date} amount={legs[1].amount}
              tag="Driver No-Show" tone="amber"
              terminal="Cannot dispute" terminalTone="amber"
              evidence="—" filtered
            />
            <LegCard
              n={3} conf={legs[2].conf} date={legs[2].date} amount={legs[2].amount}
              tag="GPS Deviation" tone="green"
              terminal="Disputable" terminalTone="green"
              evidence="2 files" included
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
      <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-start" }}>
        {children}
      </div>
    </div>
  );
}

function LegCard({
  n, conf, date, amount, tag, tone, terminal, terminalTone, evidence, included, filtered,
}: {
  n: number; conf: string; date: string; amount: string;
  tag: string; tone: "green" | "amber";
  terminal: string; terminalTone: "green" | "amber";
  evidence: string; included?: boolean; filtered?: boolean;
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
        display: "flex", flexDirection: "column", gap: "0.4rem",
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
      <span className="cc-tag" style={{ alignSelf: "flex-start" }}>{tag}</span>
      <div style={{ height: 1, background: "var(--cc-border)", margin: "0.125rem 0" }} />
      <div className="flex items-center gap-1.5">
        <span className="cc-meta text-[10px] uppercase tracking-wider">SOP</span>
        <span className={`cc-pill ${terminalTone === "green" ? "cc-pill-green" : "cc-pill-amber"}`}>{terminal}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="cc-meta text-[10px] uppercase tracking-wider">Evidence</span>
        <span className="text-[11px]">{evidence}</span>
      </div>
      {filtered ? (
        <span className="cc-pill cc-pill-amber" style={{ alignSelf: "flex-start", marginTop: "0.125rem" }}>
          Not in prompt
        </span>
      ) : (
        <span className="cc-pill cc-pill-green" style={{ alignSelf: "flex-start", marginTop: "0.125rem" }}>
          Included in draft
        </span>
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
          minHeight: 220,
          border: "1px dashed var(--cc-border)",
          borderRadius: "var(--cc-radius)",
          background: "var(--cc-bg)",
          padding: "1.25rem",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.625rem",
          textAlign: "center",
        }}
      >
        <Icons.Sparkles className="w-5 h-5" style={{ color: "var(--cc-blue-fg)" }} />
        <div className="font-semibold text-sm">One dispute note will be drafted from the 2 included legs above</div>
        <div className="cc-meta text-xs" style={{ maxWidth: 480 }}>
          The note covers Time at Facility (Leg 1) and GPS Deviation (Leg 3). Driver No-Show (Leg 2) is
          non-contestable and is filtered out before the AI sees the prompt.
        </div>
      </div>
    </div>
  );
}

function FooterPreGen() {
  return (
    <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
      <span className="cc-pill cc-pill-muted">Ready to draft</span>
      <span className="cc-meta text-xs flex-1">Cards above show what the AI will see. Generate creates one paragraph for the whole invoice.</span>
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
