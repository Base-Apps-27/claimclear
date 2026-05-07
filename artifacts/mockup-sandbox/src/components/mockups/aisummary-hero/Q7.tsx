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
 * Round 4 · Q7 — Close off-ramp.
 *
 * Walk-complete state where SOP returned "Cannot dispute" on every leg
 * AND there is nothing to re-attest (legs already attested, or operator
 * is closing as withdrawn / non-issue). Quick-close with a reason; no
 * portal submission, no re-attest queue, just an audit row + status flip.
 *
 * Same chrome and same cards as the Reattest off-ramp — what changes is
 * the lower panel (close-reason picker) and the footer gauntlet (Close
 * active instead of Reattest).
 */
export default function Q7() {
  const [reason, setReason] = useState("non_issue");
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

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <InvoiceHeader invoice={invoice} payor={payor} />

          <div style={{ padding: "0 1.25rem" }}>
            <Annotation>
              <strong>Nothing to dispute, nothing to re-attest.</strong>{" "}
              Close this invoice with a reason for the audit trail and move to the next one.
              No portal submission; status flips to <em>Closed</em>.
            </Annotation>
          </div>

          <CardRow>
            {noContestLegs.map((l) => (
              <LegCardCloseable key={l.conf} {...l} />
            ))}
          </CardRow>

          <ClosePanel reason={reason} setReason={setReason} note={note} setNote={setNote} />
          <FooterClose reason={reason} />
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
      <div style={{ marginTop: "auto" }} />
      <div className="flex items-center gap-1 flex-wrap">
        <span className="cc-pill cc-pill-amber">No dispute</span>
        <span className="cc-pill cc-pill-muted">Already attested</span>
      </div>
    </div>
  );
}

const REASONS: { value: string; label: string; help: string }[] = [
  { value: "non_issue", label: "Non-issue / payor accepted", help: "Walk surfaced no contestable variance and the payor's calc holds." },
  { value: "withdrawn", label: "Withdrawn — not pursuing", help: "There may be a small variance, but it's not worth a dispute." },
  { value: "tolerance", label: "Within tolerance on every leg", help: "All legs cleared SOP tolerance bands; no offset to reverse." },
  { value: "duplicate", label: "Duplicate of another invoice", help: "Already covered by a sibling invoice; close as duplicate." },
];

function ClosePanel({
  reason, setReason, note, setNote,
}: {
  reason: string; setReason: (v: string) => void;
  note: string; setNote: (v: string) => void;
}) {
  return (
    <div style={{ flex: 1, padding: "0 1.25rem", overflow: "auto", display: "grid", gridTemplateColumns: "1fr 280px", gap: "0.75rem" }}>
      {/* Reason picker + optional note */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: 0 }}>
        <div className="flex items-center gap-2">
          <Icons.Archive className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
          <span className="font-semibold text-sm">Close reason · required</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {REASONS.map((r) => (
            <label
              key={r.value}
              style={{
                display: "flex", alignItems: "flex-start", gap: "0.5rem",
                padding: "0.5rem 0.625rem",
                background: "var(--cc-card)",
                border: reason === r.value ? "1px solid var(--cc-blue-fg)" : "1px solid var(--cc-border)",
                borderLeft: reason === r.value ? "3px solid var(--cc-blue-fg)" : "3px solid transparent",
                borderRadius: "var(--cc-radius)",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="close-reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                style={{ marginTop: "0.2rem" }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                <span className="text-[12px] font-semibold">{r.label}</span>
                <span className="cc-meta text-[11px]">{r.help}</span>
              </div>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2" style={{ marginTop: "0.25rem" }}>
          <Icons.FileText className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
          <span className="font-semibold text-sm">Internal note · optional</span>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Both legs within tolerance after re-walk; no contestable variance."
          style={{
            minHeight: 70,
            padding: "0.625rem 0.75rem",
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
      </div>

      {/* What happens panel */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div className="flex items-center gap-2">
          <Icons.Archive className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
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
          <Bullet>Invoice status flips to <span className="mono text-[11px]">Closed</span></Bullet>
          <Bullet>Audit row written with reason + optional note</Bullet>
          <Bullet>No portal submission · no dispute note generated</Bullet>
          <Bullet>No re-attest queued · legs stay as-attested</Bullet>
          <Bullet>Available later under <em>Closure review</em> if you change your mind</Bullet>
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
            <span className="text-[11px] font-semibold">Closing as</span>
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

function FooterClose({ reason }: { reason: string }) {
  const reasonLabel = REASONS.find((r) => r.value === reason)?.label ?? "—";
  return (
    <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
      <span className="cc-pill cc-pill-muted">
        <Icons.Archive className="w-3 h-3 inline" /> Close path
      </span>
      <span className="cc-meta text-xs flex-1">
        Closing as: <strong>{reasonLabel}</strong>
      </span>
      <div className="cc-gauntlet-row" style={{ margin: 0 }}>
        <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk legs</span>
        <span className="cc-gauntlet-step cc-gauntlet-active">
          <Icons.Archive className="w-3 h-3" /> Close
        </span>
        <span className="cc-gauntlet-step" style={{ opacity: 0.4 }}>Generate · skipped</span>
        <span className="cc-gauntlet-step" style={{ opacity: 0.4 }}>Review · skipped</span>
        <span className="cc-gauntlet-step" style={{ opacity: 0.4 }}>Submit · skipped</span>
      </div>
      <button className="cc-btn">Back to walk</button>
      <button className="cc-btn cc-btn-primary">
        <Icons.Archive className="w-3.5 h-3.5" /> Close invoice
      </button>
    </div>
  );
}
