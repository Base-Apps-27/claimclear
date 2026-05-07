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
 * Round 4 · Q7 — Close off-ramp (slim).
 *
 * Walk-complete with nothing to dispute and nothing to re-attest. The
 * decision is small: pick a reason, optionally add a note, click close.
 * Body collapses to one compact action strip with an inline reason
 * dropdown; optional note is a disclosure.
 */
export default function Q7() {
  const [reason, setReason] = useState("non_issue");
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const invoice = "INV-2026-0481";
  const payor = "MAS Medicaid · $612.40";
  const noContestLegs = [
    {
      n: 1, conf: "C-2026-04790", date: "Apr 23", amount: "$306.20",
      classification: "Mileage", sop: "Cannot dispute · within 0.5mi tolerance",
      reason: "Mapbox-rerouted distance is 14.7mi; payor billed 14.4mi. Already attested.",
    },
    {
      n: 2, conf: "C-2026-04791", date: "Apr 23", amount: "$306.20",
      classification: "Mileage", sop: "Cannot dispute · within 0.5mi tolerance",
      reason: "Mapbox-rerouted distance is 18.1mi; payor billed 17.9mi. Already attested.",
    },
  ];

  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V4·Q7"
        title="Close off-ramp · nothing to dispute, nothing to re-attest"
        principles={["P1", "P3", "P4", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem" }}>
          <InvoiceHeader invoice={invoice} payor={payor} />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation>
              <strong>Nothing to dispute, nothing to re-attest.</strong>{" "}
              Pick a reason for the audit trail and close. Status flips to <em>Closed</em>; no portal post.
            </Annotation>
          </div>

          <CardRow>
            {noContestLegs.map((l) => (
              <LegCardCloseable key={l.conf} {...l} />
            ))}
          </CardRow>

          <ActionStrip
            reason={reason}
            setReason={setReason}
            showNote={showNote}
            toggleNote={() => setShowNote((v) => !v)}
            note={note}
            setNote={setNote}
          />

          <div style={{ flex: 1 }} />
          <FooterClose />
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
      <span className="cc-pill" style={{ marginLeft: "0.5rem", background: "var(--cc-card)", color: "var(--cc-meta-fg, currentColor)", borderColor: "var(--cc-border)" }}>
        <Icons.Archive className="w-3 h-3 inline" /> Closing as non-issue
      </span>
      <div className="cc-segmented" style={{ marginLeft: "auto" }}>
        <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk ✓</button>
        <button>Reattest</button>
        <button className="is-active"><Icons.Archive className="w-2.5 h-2.5 inline mr-1" />Close</button>
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

function LegCardCloseable({
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
      <div className="flex items-center gap-1 flex-wrap" style={{ marginTop: "0.15rem" }}>
        <span className="cc-pill cc-pill-amber">No dispute</span>
        <span className="cc-pill cc-pill-muted">Already attested</span>
      </div>
    </div>
  );
}

const REASONS: { value: string; label: string }[] = [
  { value: "non_issue", label: "Non-issue / payor accepted" },
  { value: "withdrawn", label: "Withdrawn — not pursuing" },
  { value: "tolerance", label: "Within tolerance on every leg" },
  { value: "duplicate", label: "Duplicate of another invoice" },
];

function ActionStrip({
  reason, setReason, showNote, toggleNote, note, setNote,
}: {
  reason: string; setReason: (v: string) => void;
  showNote: boolean; toggleNote: () => void;
  note: string; setNote: (v: string) => void;
}) {
  return (
    <div style={{ padding: "0 1.25rem" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: "0.75rem",
          padding: "0.625rem 0.875rem",
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderLeft: "3px solid var(--cc-amber-fg)",
          borderRadius: "var(--cc-radius)",
        }}
      >
        <Icons.Archive className="w-4 h-4 flex-none" style={{ color: "var(--cc-amber-fg)" }} />
        <label className="text-[12px] font-semibold flex-none">Close as</label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{
            padding: "0.3rem 0.5rem",
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-radius)",
            fontSize: "0.8125rem",
            color: "var(--cc-fg)",
            fontFamily: "inherit",
            minWidth: 220,
          }}
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <div className="cc-meta text-[11px]" style={{ flex: 1, minWidth: 0 }}>
          status → <span className="mono">Closed</span> · audit row written · no portal post · no re-attest queued
        </div>
        <button
          className="cc-btn"
          onClick={toggleNote}
          style={{ fontSize: "11px", padding: "0.25rem 0.55rem", flex: "none" }}
        >
          <Icons.FileText className="w-3 h-3 inline" /> {showNote ? "Hide note" : "Add note"}
        </button>
      </div>

      {showNote && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional internal note · audit-trail only, not sent to MAS."
          style={{
            width: "100%",
            marginTop: "0.5rem",
            minHeight: 60,
            padding: "0.5rem 0.75rem",
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderLeft: "3px solid var(--cc-blue-fg)",
            borderRadius: "var(--cc-radius)",
            fontSize: "0.8125rem",
            lineHeight: 1.5,
            color: "var(--cc-fg)",
            fontFamily: "inherit",
            resize: "none",
            outline: "none",
          }}
        />
      )}
    </div>
  );
}

function FooterClose() {
  return (
    <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
      <span className="cc-pill cc-pill-muted">
        <Icons.Archive className="w-3 h-3 inline" /> Close path
      </span>
      <div className="cc-gauntlet-row" style={{ margin: 0, marginLeft: "auto" }}>
        <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk</span>
        <span className="cc-gauntlet-step cc-gauntlet-active">
          <Icons.Archive className="w-3 h-3" /> Close
        </span>
      </div>
      <button className="cc-btn">Back to walk</button>
      <button className="cc-btn cc-btn-primary">
        <Icons.Archive className="w-3.5 h-3.5" /> Close invoice
      </button>
    </div>
  );
}
