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
 * Round 4 · Q5 — Submit (slim).
 *
 * Final-step screen. The previous version stacked three right-rail panels
 * (Going to / Attachments / Submitting as) which made the page feel as
 * dense as a dispute walk. Here:
 *   - Destination ("→ MAS Trip Inventory · Portal note · 2 disputed / 1 filtered")
 *     pulled inline into the invoice header.
 *   - Submitting-as identity merged into the footer meta line.
 *   - Right rail collapses to ONLY the attachments list, which is the
 *     one piece of scannable, hand-checkable information at this step.
 */
export default function Q5() {
  const finalText = `We are submitting a correction request on invoice ${groupSummary.invoice} covering two affected rides on this billing.

On April 24, ride ${legs[0].conf} was held at the dialysis facility past the scheduled 14:15 pickup; the driver waited curbside from 14:18 and the facility's signed release sheet documents the rider's release at 14:42 — a 27-minute delay attributable to facility intake. On April 25, ride ${legs[2].conf} deviated from the most direct path due to an active municipal closure documented in the attached DOT closure notice; the alternate path added 1.4 miles and the rider arrived on time.

Supporting evidence (release sheet, GPS log, DOT closure notice, route trace) is attached. We respectfully request reversal of the offsets on these two legs.`;

  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V4·Q5"
        title="Submit · destination inline, attachments visible, signing in footer"
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
              <strong>Last check before this leaves your desk.</strong>{" "}
              Confirm the destination, the attachments, and the final note. Submit posts to the MAS portal;
              you can't recall a submission once it's sent.
            </Annotation>
          </div>

          <CardRow>
            <LegCardCompact n={1} conf={legs[0].conf} amount={legs[0].amount} tag="Time at Facility" tone="green" included />
            <LegCardCompact n={2} conf={legs[1].conf} amount={legs[1].amount} tag="Driver No-Show" tone="amber" filtered />
            <LegCardCompact n={3} conf={legs[2].conf} amount={legs[2].amount} tag="GPS Deviation" tone="green" included />
          </CardRow>

          <SubmitBody finalText={finalText} />
          <FooterSubmit />
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
      <span className="cc-meta text-[11px]" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
        <Icons.Send className="w-3 h-3" />
        →
        <strong style={{ color: "var(--cc-fg)" }}>MAS Trip Inventory</strong>
        · 2 disputed / 1 filtered
      </span>
      <div className="cc-segmented" style={{ marginLeft: "auto" }}>
        <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk ✓</button>
        <button><Icons.Sparkles className="w-2.5 h-2.5 inline mr-1" />Preview ✓</button>
        <button><Icons.FileText className="w-2.5 h-2.5 inline mr-1" />Review ✓</button>
        <button className="is-active"><Icons.Send className="w-2.5 h-2.5 inline mr-1" />Submit</button>
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

function LegCardCompact({
  n, conf, amount, tag, tone, included, filtered,
}: {
  n: number; conf: string; amount: string;
  tag: string; tone: "green" | "amber";
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
        display: "flex", flexDirection: "column", gap: "0.3rem",
        opacity: filtered ? 0.7 : 1,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg {n}</span>
        <span className="mono text-[12px] font-semibold">{conf}</span>
        <span className="cc-meta text-[11px] ml-auto">{amount}</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="cc-tag">{tag}</span>
        {included && <span className="cc-pill cc-pill-green">In submission</span>}
        {filtered && <span className="cc-pill cc-pill-amber">Filtered out</span>}
      </div>
    </div>
  );
}

function SubmitBody({ finalText }: { finalText: string }) {
  return (
    <div style={{ flex: 1, padding: "0 1.25rem", overflow: "auto", display: "grid", gridTemplateColumns: "1fr 240px", gap: "0.75rem" }}>
      {/* Final paragraph (locked) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 0 }}>
        <div className="flex items-center gap-2">
          <Icons.FileText className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
          <span className="font-semibold text-sm">Final note · locked</span>
          <span className="cc-meta text-xs ml-auto">{finalText.length} chars</span>
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
            whiteSpace: "pre-wrap",
            flex: 1,
            overflow: "auto",
          }}
        >
          {finalText.split("\n\n").map((para, i) => (
            <p key={i} style={{ margin: 0 }}>{para}</p>
          ))}
        </div>
      </div>

      {/* Attachments — the only right-rail panel that survives */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <div className="flex items-center gap-2">
          <Icons.Paperclip className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
          <span className="font-semibold text-sm">Attachments · 5</span>
        </div>
        <div
          style={{
            padding: "0.5rem 0.625rem",
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-radius)",
            display: "flex", flexDirection: "column", gap: "0.3rem",
            flex: 1,
          }}
        >
          <Attach name="facility-release-sheet.pdf" leg="L1" />
          <Attach name="gps-trace-04812.json" leg="L1" />
          <Attach name="driver-log-04-24.txt" leg="L1" />
          <Attach name="dot-closure-04-25.pdf" leg="L3" />
          <Attach name="route-trace-04814.json" leg="L3" />
          <div className="cc-meta text-[10px]" style={{ marginTop: "auto", paddingTop: "0.35rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <Icons.AlertTriangle className="w-3 h-3" style={{ color: "var(--cc-amber-fg)" }} />
            Leg 2 attachments excluded (filtered)
          </div>
        </div>
      </div>
    </div>
  );
}

function Attach({ name, leg }: { name: string; leg: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icons.Paperclip className="w-3 h-3" style={{ color: "var(--cc-meta-fg, currentColor)" }} />
      <span className="mono text-[11px]" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </span>
      <span className="cc-pill cc-pill-muted" style={{ fontSize: "9px", padding: "0 0.3rem" }}>{leg}</span>
    </div>
  );
}

function FooterSubmit() {
  return (
    <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
      <span className="cc-pill cc-pill-green">Ready to send</span>
      <span className="cc-meta text-[11px]" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", marginLeft: "auto" }}>
        <Icons.Bot className="w-3 h-3" />
        <strong style={{ color: "var(--cc-fg)" }}>Sarah Chen</strong>
        · 11:24 PM ET
      </span>
      <button className="cc-btn"><Icons.ArrowLeft className="w-3 h-3" /> Back to review</button>
      <button className="cc-btn cc-btn-primary">
        <Icons.Send className="w-3.5 h-3.5" /> Submit to MAS portal
      </button>
    </div>
  );
}
