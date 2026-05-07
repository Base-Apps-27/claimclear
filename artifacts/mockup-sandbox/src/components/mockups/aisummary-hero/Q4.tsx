import { useState } from "react";
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
 * Round 4 · Q4 — Review & Edit frame.
 * Same stubby cards on top (read-only inputs recap). Below: the single
 * generated paragraph is now an editable textarea — operator can tweak
 * wording without re-running the model. Footer advances: Walk ✓,
 * Generate ✓, Review & edit (active), Submit (next). Edit-tracker line
 * shows what's been touched.
 */
export default function Q4() {
  const initial = `We are submitting a correction request on invoice ${groupSummary.invoice} covering two affected rides on this billing.

On April 24, ride ${legs[0].conf} was held at the dialysis facility past the scheduled 14:15 pickup; the driver waited curbside from 14:18 and the facility's signed release sheet documents the rider's release at 14:42 — a 27-minute delay attributable to facility intake. On April 25, ride ${legs[2].conf} deviated from the most direct path due to an active municipal closure documented in the attached DOT closure notice; the alternate path added 1.4 miles and the rider arrived on time.

Supporting evidence (release sheet, GPS log, DOT closure notice, route trace) is attached. We respectfully request reversal of the offsets on these two legs.`;
  const [text, setText] = useState(initial);
  const edited = text !== initial;
  const charCount = text.length;

  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V4·Q4"
        title="Review &amp; edit · paragraph editable, inputs locked above"
        principles={["P1", "P3", "P4", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader edited={edited} />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation>
              <strong>Edit the paragraph; the inputs above are locked.</strong>{" "}
              Make small wording tweaks here without re-running the model. To change the underlying inputs
              (re-walk a leg, swap evidence, edit op-notes) go back to Walk.
            </Annotation>
          </div>

          <CardRow>
            <LegCardLocked
              n={1} conf={legs[0].conf} date={legs[0].date} amount={legs[0].amount}
              tag="Time at Facility" tone="green"
              terminal="Disputable" terminalTone="green"
              evidenceCount={3} layer="default" included
            />
            <LegCardLocked
              n={2} conf={legs[1].conf} date={legs[1].date} amount={legs[1].amount}
              tag="Driver No-Show" tone="amber"
              terminal="Cannot dispute" terminalTone="amber"
              evidenceCount={0} filtered
            />
            <LegCardLocked
              n={3} conf={legs[2].conf} date={legs[2].date} amount={legs[2].amount}
              tag="GPS Deviation" tone="green"
              terminal="Disputable" terminalTone="green"
              evidenceCount={2} layer="override" included
            />
          </CardRow>

          <EditableParagraphPanel value={text} onChange={setText} edited={edited} charCount={charCount} />
          <FooterReview edited={edited} />
        </div>
      </div>
    </div>
  );
}

function InvoiceHeader({ edited }: { edited: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.75rem", background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
      <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
      <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
      {edited ? (
        <span className="cc-pill" style={{ marginLeft: "0.5rem", background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", borderColor: "var(--cc-purple-bg)" }}>
          <Icons.FileText className="w-3 h-3 inline" /> Note edited · unsaved
        </span>
      ) : (
        <span className="cc-pill cc-pill-green" style={{ marginLeft: "0.5rem" }}>
          <Icons.CheckCircle2 className="w-3 h-3 inline" /> Note as-drafted
        </span>
      )}
      <div className="cc-segmented" style={{ marginLeft: "auto" }}>
        <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk ✓</button>
        <button><Icons.Sparkles className="w-2.5 h-2.5 inline mr-1" />Preview ✓</button>
        <button className="is-active"><Icons.FileText className="w-2.5 h-2.5 inline mr-1" />Review</button>
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

function LegCardLocked({
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
        padding: "0.5rem 0.75rem",
        display: "flex", flexDirection: "column", gap: "0.35rem",
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
        <span className="cc-pill cc-pill-amber" style={{ alignSelf: "flex-start" }}>Not in paragraph</span>
      ) : (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="cc-pill cc-pill-green">In draft</span>
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

function EditableParagraphPanel({
  value, onChange, edited, charCount,
}: {
  value: string; onChange: (v: string) => void; edited: boolean; charCount: number;
}) {
  return (
    <div style={{ flex: 1, padding: "0 1.25rem", overflow: "auto", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center gap-2" style={{ marginBottom: "0.375rem" }}>
        <Icons.FileText className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
        <span className="font-semibold text-sm">Dispute note · editable</span>
        <span className="cc-meta text-xs ml-auto">
          {charCount} chars {edited ? "· edited" : "· as-drafted"}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck
        style={{
          flex: 1,
          minHeight: 220,
          padding: "0.875rem 1rem",
          background: "var(--cc-card)",
          border: edited ? "1px solid var(--cc-purple-fg)" : "1px solid var(--cc-border)",
          borderLeft: edited ? "3px solid var(--cc-purple-fg)" : "3px solid var(--cc-blue-fg)",
          borderRadius: "var(--cc-radius)",
          fontSize: "0.8125rem",
          lineHeight: 1.6,
          color: "var(--cc-fg)",
          fontFamily: "inherit",
          resize: "none",
          outline: "none",
        }}
      />
      <div className="cc-meta text-[11px]" style={{ marginTop: "0.375rem", display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <Icons.CheckCircle2 className="w-3 h-3" style={{ color: "var(--cc-green-fg)" }} />
          Mentions {legs[0].conf} and {legs[2].conf}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <Icons.AlertTriangle className="w-3 h-3" style={{ color: "var(--cc-amber-fg)" }} />
          Does not mention {legs[1].conf} (filtered)
        </span>
        <span style={{ marginLeft: "auto" }}>
          <button className="cc-btn" style={{ fontSize: "11px", padding: "0.2rem 0.5rem" }}>
            <Icons.Sparkles className="w-3 h-3 inline" /> Re-generate
          </button>
        </span>
      </div>
    </div>
  );
}

function FooterReview({ edited }: { edited: boolean }) {
  return (
    <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
      {edited ? (
        <span className="cc-pill" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", borderColor: "var(--cc-purple-bg)" }}>
          Unsaved edits
        </span>
      ) : (
        <span className="cc-pill cc-pill-green">Note ready</span>
      )}
      <span className="cc-meta text-xs flex-1">Edits stay on this draft only — they do not change the prompt or the underlying inputs.</span>
      <div className="cc-gauntlet-row" style={{ margin: 0 }}>
        <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk legs</span>
        <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Generate</span>
        <span className="cc-gauntlet-step cc-gauntlet-active">Review &amp; edit</span>
        <span className="cc-gauntlet-step"><Icons.Send className="w-3 h-3" /> Submit</span>
      </div>
      <button className="cc-btn">Discard edits</button>
      <button className="cc-btn cc-btn-primary">
        <Icons.Send className="w-3.5 h-3.5" /> Continue to submit
      </button>
    </div>
  );
}
