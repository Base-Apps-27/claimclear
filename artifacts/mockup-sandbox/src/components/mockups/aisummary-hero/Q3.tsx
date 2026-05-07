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
 * Round 4 · Q3 — In-context "AI Inputs Summary" hero, POST-generate.
 * Stubby horizontal cards on top (medium density: SOP terminal + evidence
 * count + layer indicator). ONE generated paragraph below in a single text
 * box — per the actual code path, the AI writes one note covering all
 * included legs together, NOT one paragraph per leg. The filtered leg
 * appears as a dimmed card with "not in prompt" so the operator can
 * visually confirm it never reached the model.
 */
export default function Q3() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V4·Q3"
        title="Walk-complete hero · cards + single generated paragraph (POST-generate)"
        principles={["P1", "P3", "P4", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation>
              <strong>Inputs above, the one drafted paragraph below.</strong>{" "}
              Cards show what fed the AI; the text box shows the single dispute note it wrote covering
              both included legs together. Leg 2 is filtered — confirm by sight that no claim from it
              shows up in the paragraph.
            </Annotation>
          </div>

          <CardRow>
            <LegCardMid
              n={1} conf={legs[0].conf} date={legs[0].date} amount={legs[0].amount}
              tag="Time at Facility" tone="green"
              terminal="Disputable" terminalTone="green"
              evidenceCount={3} layer="default" included
            />
            <LegCardMid
              n={2} conf={legs[1].conf} date={legs[1].date} amount={legs[1].amount}
              tag="Driver No-Show" tone="amber"
              terminal="Cannot dispute" terminalTone="amber"
              evidenceCount={0} filtered
            />
            <LegCardMid
              n={3} conf={legs[2].conf} date={legs[2].date} amount={legs[2].amount}
              tag="GPS Deviation" tone="green"
              terminal="Disputable" terminalTone="green"
              evidenceCount={2} layer="override" included
            />
          </CardRow>

          <SingleParagraphPanel />
          <FooterPostGen />
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
      <span className="cc-pill cc-pill-green" style={{ marginLeft: "0.5rem" }}>
        <Icons.Sparkles className="w-3 h-3 inline" /> 1 dispute note · drafted in 2.4s
      </span>
      <div className="cc-segmented" style={{ marginLeft: "auto" }}>
        <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk ✓</button>
        <button className="is-active"><Icons.FileText className="w-2.5 h-2.5 inline mr-1" />Preview</button>
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

function LegCardMid({
  n, conf, date, amount, tag, tone, terminal, terminalTone, evidenceCount, layer, included, filtered,
}: {
  n: number; conf: string; date: string; amount: string;
  tag: string; tone: "green" | "amber";
  terminal: string; terminalTone: "green" | "amber";
  evidenceCount: number; layer?: "default" | "override";
  included?: boolean; filtered?: boolean;
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
        <span className="text-[11px]">
          {evidenceCount > 0 ? (
            <><Icons.Paperclip className="w-2.5 h-2.5 inline" /> {evidenceCount} files</>
          ) : "—"}
        </span>
      </div>
      <div style={{ marginTop: "auto" }} />
      {filtered ? (
        <span className="cc-pill cc-pill-amber" style={{ alignSelf: "flex-start" }}>
          Not in prompt · not in paragraph
        </span>
      ) : (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="cc-pill cc-pill-green">Included in draft</span>
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

function SingleParagraphPanel() {
  return (
    <div style={{ flex: 1, padding: "0 1.25rem", overflow: "auto" }}>
      <div className="flex items-center gap-2" style={{ marginBottom: "0.375rem" }}>
        <Icons.Sparkles className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
        <span className="font-semibold text-sm">Dispute note · one paragraph for invoice {groupSummary.invoice}</span>
        <span className="cc-meta text-xs ml-auto">covers Leg 1 + Leg 3 · 1 leg filtered</span>
      </div>
      <div
        style={{
          padding: "0.875rem 1rem",
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderLeft: "3px solid var(--cc-blue-fg)",
          borderRadius: "var(--cc-radius)",
          fontSize: "0.8125rem",
          lineHeight: 1.6,
          color: "var(--cc-fg)",
          display: "flex", flexDirection: "column", gap: "0.625rem",
        }}
      >
        <p style={{ margin: 0 }}>
          We are submitting a correction request on invoice <strong>{groupSummary.invoice}</strong> covering
          two affected rides on this billing.
        </p>
        <p style={{ margin: 0 }}>
          On April 24, ride <strong>{legs[0].conf}</strong> was held at the dialysis facility past the
          scheduled 14:15 pickup; the driver waited curbside from 14:18 and the facility's signed release
          sheet documents the rider's release at 14:42 — a 27-minute delay attributable to facility intake.
          On April 25, ride <strong>{legs[2].conf}</strong> deviated from the most direct path due to an
          active municipal closure documented in the attached DOT closure notice; the alternate path added
          1.4 miles and the rider arrived on time.
        </p>
        <p style={{ margin: 0 }}>
          Supporting evidence (release sheet, GPS log, DOT closure notice, route trace) is attached. We
          respectfully request reversal of the offsets on these two legs.
        </p>
      </div>
      <div className="cc-meta text-[11px]" style={{ marginTop: "0.375rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <Icons.CheckCircle2 className="w-3 h-3" style={{ color: "var(--cc-green-fg)" }} />
        Cross-check: paragraph mentions {legs[0].conf} and {legs[2].conf}. {legs[1].conf} is absent
        (filtered, as expected).
      </div>
    </div>
  );
}

function FooterPostGen() {
  return (
    <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
      <span className="cc-pill cc-pill-green">Note ready</span>
      <span className="cc-meta text-xs flex-1">Read the paragraph above. Review lets you edit; Submit sends as-is.</span>
      <div className="cc-gauntlet-row" style={{ margin: 0 }}>
        <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk legs</span>
        <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Generate</span>
        <span className="cc-gauntlet-step cc-gauntlet-active">Review &amp; edit</span>
        <span className="cc-gauntlet-step"><Icons.Send className="w-3 h-3" /> Submit</span>
      </div>
      <button className="cc-btn">Skip review</button>
      <button className="cc-btn cc-btn-primary"><Icons.FileText className="w-3.5 h-3.5" /> Review &amp; edit</button>
    </div>
  );
}
