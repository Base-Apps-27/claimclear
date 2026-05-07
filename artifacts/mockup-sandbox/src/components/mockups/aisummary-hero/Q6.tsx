import { useState } from "react";
import {
  HeaderStrip,
  ClassificationStrip,
  MasterList,
  FrameLabel,
  Annotation,
  Icons,
} from "../queue-redesign/_shared";

/**
 * Round 4 · Q6 — Reattest off-ramp.
 *
 * Walk-complete state where SOP returned "Cannot dispute" on every leg,
 * BUT survivor legs still owe MAS re-attestation (Task #476 path —
 * `/invoice-groups/:id/reattest/queue` from the
 * mas-action-required phase). Operator does NOT write a dispute note;
 * instead, they queue the legs for the next re-attestation cycle.
 *
 * Same chrome as the dispute path so the operator stays oriented; the
 * lower panel + footer gauntlet are what change.
 */
export default function Q6() {
  const [note, setNote] = useState("");
  const invoice = "INV-2026-0481";
  const payor = "MAS Medicaid · $612.40";
  const noContestLegs = [
    {
      n: 1, conf: "C-2026-04790", date: "Apr 23", amount: "$306.20",
      classification: "Mileage", sop: "Cannot dispute · within 0.5mi tolerance",
      reason: "Mapbox-rerouted distance is 14.7mi; payor billed 14.4mi.",
    },
    {
      n: 2, conf: "C-2026-04791", date: "Apr 23", amount: "$306.20",
      classification: "Mileage", sop: "Cannot dispute · within 0.5mi tolerance",
      reason: "Mapbox-rerouted distance is 18.1mi; payor billed 17.9mi.",
    },
  ];

  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V4·Q6"
        title="Reattest off-ramp · zero disputable legs, survivors owe re-attestation"
        principles={["P1", "P3", "P4", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader invoice={invoice} payor={payor} />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation>
              <strong>Nothing to write up — but these legs still owe MAS re-attestation.</strong>{" "}
              SOP returned <em>Cannot dispute</em> on both legs. There is no portal note to send; the
              operator commits by queueing the legs for the next attestation cycle.
            </Annotation>
          </div>

          <CardRow>
            {noContestLegs.map((l) => (
              <LegCardNoContest key={l.conf} {...l} />
            ))}
          </CardRow>

          <ReattestPanel note={note} setNote={setNote} legCount={noContestLegs.length} />
          <FooterReattest legCount={noContestLegs.length} />
        </div>
      </div>
    </div>
  );
}

function InvoiceHeader({ invoice, payor }: { invoice: string; payor: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.75rem", background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
      <span className="mono text-[12px] font-semibold">{invoice}</span>
      <span className="cc-meta text-[11px]">{payor}</span>
      <span className="cc-pill cc-pill-amber" style={{ marginLeft: "0.5rem" }}>
        <Icons.AlertTriangle className="w-3 h-3 inline" /> No disputable legs · re-attest required
      </span>
      <div className="cc-segmented" style={{ marginLeft: "auto" }}>
        <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk ✓</button>
        <button className="is-active"><Icons.Send className="w-2.5 h-2.5 inline mr-1" />Reattest</button>
        <button>Close</button>
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

function LegCardNoContest({
  n, conf, date, amount, classification, sop, reason,
}: {
  n: number; conf: string; date: string; amount: string;
  classification: string; sop: string; reason: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 0", minWidth: 280, maxWidth: 360,
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderTop: "3px solid var(--cc-amber-fg)",
        borderRadius: "var(--cc-radius)",
        padding: "0.5rem 0.75rem",
        display: "flex", flexDirection: "column", gap: "0.35rem",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg {n}</span>
        <span className="mono text-[12px] font-semibold">{conf}</span>
        <Icons.AlertTriangle className="w-3 h-3 ml-auto" style={{ color: "var(--cc-amber-fg)" }} />
      </div>
      <div className="cc-meta text-[11px]">{date} · {amount}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="cc-tag">{classification}</span>
        <span className="cc-pill cc-pill-amber">{sop}</span>
      </div>
      <div className="text-[11px]" style={{ color: "var(--cc-fg)", lineHeight: 1.45 }}>
        {reason}
      </div>
      <div style={{ marginTop: "auto" }} />
      <div className="flex items-center gap-1 flex-wrap">
        <span className="cc-pill cc-pill-amber">No dispute</span>
        <span className="cc-pill" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", borderColor: "var(--cc-purple-bg)" }}>
          Owes re-attest
        </span>
      </div>
    </div>
  );
}

function ReattestPanel({
  note, setNote, legCount,
}: {
  note: string; setNote: (v: string) => void; legCount: number;
}) {
  return (
    <div style={{ flex: 1, padding: "0 1.25rem", overflow: "auto", display: "grid", gridTemplateColumns: "1fr 280px", gap: "0.75rem" }}>
      {/* Optional operator note */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", minWidth: 0 }}>
        <div className="flex items-center gap-2">
          <Icons.FileText className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
          <span className="font-semibold text-sm">Internal note · optional</span>
          <span className="cc-meta text-xs ml-auto">Stays on the audit trail; not sent to MAS.</span>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Mileage variance under tolerance on both legs — queued for the next attestation cycle."
          style={{
            flex: 1,
            minHeight: 200,
            padding: "0.875rem 1rem",
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderLeft: "3px solid var(--cc-blue-fg)",
            borderRadius: "var(--cc-radius)",
            fontSize: "0.8125rem",
            lineHeight: 1.6,
            color: "var(--cc-fg)",
            fontFamily: "inherit",
            resize: "none",
            outline: "none",
          }}
        />
      </div>

      {/* What happens panel */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div className="flex items-center gap-2">
          <Icons.Send className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
          <span className="font-semibold text-sm">What happens</span>
        </div>
        <div
          style={{
            padding: "0.625rem 0.75rem",
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-radius)",
            display: "flex", flexDirection: "column", gap: "0.5rem",
          }}
        >
          <Bullet>
            <strong>{legCount} legs</strong> flip to <span className="mono text-[11px]">attestation_state = queued</span>
          </Bullet>
          <Bullet>Group stamped <span className="mono text-[11px]">awaiting_payor_again</span> · drops off Responses Awaiting Review</Bullet>
          <Bullet>One umbrella audit row + per-leg audit rows written</Bullet>
          <Bullet>No portal submission · no dispute note generated</Bullet>
        </div>

        <div
          style={{
            marginTop: "auto",
            padding: "0.5rem 0.75rem",
            background: "var(--cc-blue-bg, var(--cc-card))",
            border: "1px solid var(--cc-blue-fg)",
            borderRadius: "var(--cc-radius)",
            display: "flex", flexDirection: "column", gap: "0.25rem",
          }}
        >
          <div className="flex items-center gap-1.5">
            <Icons.Bot className="w-3 h-3" style={{ color: "var(--cc-blue-fg)" }} />
            <span className="text-[11px] font-semibold">Queueing as</span>
          </div>
          <div className="text-[12px]">Sarah Chen · ClaimClear bot</div>
          <div className="cc-meta text-[10px]">May 7, 2026 · 11:24 PM ET</div>
        </div>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px]" style={{ display: "flex", gap: "0.4rem", lineHeight: 1.5 }}>
      <Icons.CheckCircle2 className="w-3 h-3 mt-0.5 flex-none" style={{ color: "var(--cc-green-fg)" }} />
      <span>{children}</span>
    </div>
  );
}

function FooterReattest({ legCount }: { legCount: number }) {
  return (
    <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
      <span className="cc-pill" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", borderColor: "var(--cc-purple-bg)" }}>
        Reattest path
      </span>
      <span className="cc-meta text-xs flex-1">
        Branching from walk-complete: no dispute → queue {legCount} legs for re-attest.
      </span>
      <div className="cc-gauntlet-row" style={{ margin: 0 }}>
        <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk legs</span>
        <span className="cc-gauntlet-step cc-gauntlet-active">
          <Icons.Send className="w-3 h-3" /> Queue re-attest
        </span>
        <span className="cc-gauntlet-step" style={{ opacity: 0.4 }}>Generate · skipped</span>
        <span className="cc-gauntlet-step" style={{ opacity: 0.4 }}>Review · skipped</span>
        <span className="cc-gauntlet-step" style={{ opacity: 0.4 }}>Submit · skipped</span>
      </div>
      <button className="cc-btn">Back to walk</button>
      <button className="cc-btn cc-btn-primary">
        <Icons.Send className="w-3.5 h-3.5" /> Queue {legCount} legs for re-attest
      </button>
    </div>
  );
}
