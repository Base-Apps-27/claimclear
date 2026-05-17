import "./_group.css";
import { useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  Upload,
  MessageSquare,
  History,
  ShieldAlert,
  XCircle,
  Tag,
  Link as LinkIcon,
  EyeOff,
  Circle,
  MinusCircle,
} from "lucide-react";

type LegStatus = "ready" | "review" | "hold";
type EvidenceFile = { name: string; size: string; date: string; missing?: boolean; requiredBy?: string };
type SopAnswer = { q: string; a: string; state: "yes" | "no" | "blocked" | "pending"; blockReason?: string };
type Leg = {
  key: string;
  ref: string;
  serviceDate: string;
  amount: string;
  errorType: string;
  status: LegStatus;
  statusLabel: string;
  sopProgress: string;
  evidenceCount: string;
  sop: SopAnswer[];
  evidence: EvidenceFile[];
  evidenceTotal: number;
};

const LEGS: Record<string, Leg> = {
  A: {
    key: "A",
    ref: "TX-558820",
    serviceDate: "Apr 10",
    amount: "$42.00",
    errorType: "Underpayment",
    status: "ready",
    statusLabel: "Ready",
    sopProgress: "SOP 4/4",
    evidenceCount: "3/3",
    evidenceTotal: 3,
    sop: [
      { q: "Submitted on time?", a: "Yes", state: "yes" },
      { q: "Remittance received?", a: "Yes", state: "yes" },
      { q: "Claim authorized?", a: "Yes", state: "yes" },
      { q: "Appeal in 90 days?", a: "Yes — within window", state: "yes" },
    ],
    evidence: [
      { name: "claim.pdf", size: "84 KB", date: "Apr 11" },
      { name: "remittance.pdf", size: "122 KB", date: "Apr 11" },
      { name: "eob.pdf", size: "210 KB", date: "Apr 12" },
    ],
  },
  B: {
    key: "B",
    ref: "TX-558821",
    serviceDate: "Apr 12",
    amount: "$58.00",
    errorType: "Underpayment",
    status: "review",
    statusLabel: "Needs review",
    sopProgress: "SOP 3/4 blk",
    evidenceCount: "2/3",
    evidenceTotal: 3,
    sop: [
      { q: "Submitted on time?", a: "Yes", state: "yes" },
      { q: "Remittance received?", a: "Yes", state: "yes" },
      { q: "Claim authorized?", a: "No", state: "no" },
      { q: "Appeal in 90 days?", a: "blocked — need auth-denial doc", state: "blocked", blockReason: "needs auth_denial.png" },
    ],
    evidence: [
      { name: "claim.pdf", size: "84 KB", date: "Apr 13" },
      { name: "remittance.pdf", size: "122 KB", date: "Apr 13" },
      { name: "auth_denial.png", size: "—", date: "—", missing: true, requiredBy: "SOP Q4" },
    ],
  },
  C: {
    key: "C",
    ref: "TX-558822",
    serviceDate: "Apr 11",
    amount: "$19.00",
    errorType: "Coding",
    status: "hold",
    statusLabel: "On hold",
    sopProgress: "SOP 1/4",
    evidenceCount: "0/2",
    evidenceTotal: 2,
    sop: [
      { q: "Submitted on time?", a: "Yes", state: "yes" },
      { q: "Remittance received?", a: "not yet — awaiting payor", state: "pending" },
      { q: "Claim authorized?", a: "—", state: "pending" },
      { q: "Appeal in 90 days?", a: "—", state: "pending" },
    ],
    evidence: [
      { name: "claim.pdf", size: "—", date: "—", missing: true, requiredBy: "SOP Q1" },
      { name: "remittance.pdf", size: "—", date: "—", missing: true, requiredBy: "SOP Q2" },
    ],
  },
};

const STATUS_PILL: Record<LegStatus, { bg: string; fg: string; border: string }> = {
  ready: { bg: "var(--cc-blue-bg)", fg: "var(--cc-blue-fg)", border: "var(--cc-blue-border)" },
  review: { bg: "var(--cc-amber-bg)", fg: "var(--cc-amber-fg)", border: "var(--cc-amber-border)" },
  hold: { bg: "var(--cc-muted)", fg: "var(--cc-muted-fg)", border: "var(--cc-border)" },
};

export default function D2Ledger() {
  const [selectedKey, setSelectedKey] = useState("B");
  const selected = LEGS[selectedKey];

  return (
    <div className="cc-scope flex flex-col h-screen overflow-hidden">
      {/* TOP UTILITY BAR */}
      <div className="flex-none px-6 py-2 border-b border-[var(--cc-border)] flex items-center text-sm" style={{ background: "var(--cc-bg)" }}>
        <button className="flex items-center gap-1.5 text-[var(--cc-muted-fg)] hover:text-[var(--cc-fg)] transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Invoice groups
        </button>
        <span className="mx-2 text-[var(--cc-muted-fg)]">/</span>
        <span className="font-medium mono">#INV-2026-1234</span>
      </div>

      {/* COMPACT HEADER */}
      <div className="flex-none px-6 py-4 bg-[var(--cc-card)] border-b border-[var(--cc-border)] shadow-sm z-10">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold mono">#INV-2026-1234</h1>
              <span className="cc-badge" style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)", borderColor: "var(--cc-blue-border)" }}>Ready</span>
              <span className="text-sm font-medium px-2 py-0.5 rounded-md bg-[var(--cc-muted)] text-[var(--cc-fg)] border border-[var(--cc-border)]">Aetna</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-[var(--cc-muted-fg)] mt-2">
              <span className="flex items-center gap-1.5"><FileText className="w-4 h-4" /> billed Apr 10, 2026</span>
              <span className="flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" /> member #88241</span>
              <span className="flex items-center gap-1.5 text-[var(--cc-fg)] font-medium">total $487.00</span>
              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> 14 days in queue</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button className="cc-btn cc-btn-primary group relative overflow-hidden pl-4 pr-3 py-2.5">
              <div className="flex flex-col items-start text-left mr-2">
                <span className="font-semibold text-base leading-none">Open in queue</span>
                <span className="text-[10px] opacity-80 mt-0.5">Walk SOP &amp; build submission</span>
              </div>
              <Play className="w-5 h-5 fill-current opacity-90 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>

        {/* LIFECYCLE DOT-STRIP */}
        <div className="mt-5 flex items-center">
          <div className="flex items-center gap-1 flex-1">
            <StageDot label="Triage" date="Apr 10" status="done" />
            <StageLine status="done" />
            <StageDot label="Evidence" date="Apr 11" status="done" />
            <StageLine status="done" />
            <StageDot label="Ready" date="today" status="current" />
            <StageLine status="pending" />
            <StageDot label="Submitted" status="pending" />
            <StageLine status="pending" />
            <StageDot label="Awaiting" status="pending" />
            <StageLine status="pending" />
            <StageDot label="Resolved" status="pending" />
          </div>
        </div>

        {/* PROSE STATUS */}
        <div className="mt-3 text-sm flex items-start gap-2 bg-[var(--cc-blue-bg)] text-[var(--cc-blue-fg)] p-2.5 rounded-md border border-[var(--cc-blue-border)]">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            <strong className="font-semibold">Ready to dispute.</strong> 2 of 3 legs fully evidenced. Leg B blocked on auth-denial doc.
          </p>
        </div>
      </div>

      {/* SPLIT BODY */}
      <div className="flex-1 flex overflow-hidden bg-[var(--cc-bg)]">

        {/* LEFT COLUMN: LEDGER */}
        <div className="w-[40%] flex flex-col border-r border-[var(--cc-border)] bg-[var(--cc-bg)] z-0">
          <div className="px-4 py-3 border-b border-[var(--cc-border)] bg-[var(--cc-card)] sticky top-0 z-10 flex justify-between items-center">
            <h2 className="font-semibold text-sm">Disputed Legs (3)</h2>
            <span className="text-xs text-[var(--cc-muted-fg)]">+2 hidden</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {Object.values(LEGS).map((leg) => (
              <LegRow
                key={leg.key}
                leg={leg}
                selected={selectedKey === leg.key}
                onClick={() => setSelectedKey(leg.key)}
              />
            ))}

            <div className="mt-4 pt-4 border-t border-dashed border-[var(--cc-border)] flex items-center justify-center">
              <button className="text-xs font-medium text-[var(--cc-muted-fg)] hover:text-[var(--cc-fg)] transition-colors flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5" />
                +2 hidden legs (1 excluded, 1 duplicate of Leg A)
              </button>
            </div>
          </div>

          {/* HISTORY RAIL */}
          <div className="border-t border-[var(--cc-border)] bg-[var(--cc-card)] p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--cc-muted-fg)] mb-2 px-1">Unified History</h3>
            <div className="space-y-1">
              <button className="w-full flex items-center justify-between p-2 hover:bg-[var(--cc-muted)] rounded text-sm transition-colors text-left">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[var(--cc-purple-fg)]" />
                  <span className="font-medium">Communication</span>
                </div>
                <span className="text-xs text-[var(--cc-muted-fg)]">0 new</span>
              </button>
              <button className="w-full flex items-center justify-between p-2 hover:bg-[var(--cc-muted)] rounded text-sm transition-colors text-left">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-[var(--cc-blue-fg)]" />
                  <span className="font-medium">Notes &amp; Audit</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] bg-[var(--cc-blue-bg)] text-[var(--cc-blue-fg)] px-1 rounded border border-[var(--cc-blue-border)]">Leg B</span>
                  <span className="text-xs text-[var(--cc-muted-fg)] ml-1">15 entries</span>
                </div>
              </button>
              <button className="w-full flex items-center justify-between p-2 hover:bg-[var(--cc-muted)] rounded text-sm transition-colors text-left">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-[var(--cc-amber-fg)]" />
                  <span className="font-medium">Overrides</span>
                </div>
                <span className="text-xs text-[var(--cc-muted-fg)]">Hold / Close</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: FOCUS PANEL */}
        <div className="w-[60%] bg-[var(--cc-muted)] overflow-y-auto">
          <FocusPanel leg={selected} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Leg row in the ledger                                              */
/* ------------------------------------------------------------------ */

function LegRow({ leg, selected, onClick }: { leg: Leg; selected: boolean; onClick: () => void }) {
  const pill = STATUS_PILL[leg.status];
  const dim = leg.status === "hold" ? "text-[var(--cc-muted-fg)] opacity-80" : "";
  const sopIcon =
    leg.status === "review" ? <AlertTriangle className="w-3 h-3" /> :
    leg.status === "ready"  ? <CheckCircle2 className="w-3 h-3 text-[var(--cc-success)]" /> :
                              <MinusCircle className="w-3 h-3" />;
  const sopColor = leg.status === "review" ? "text-[var(--cc-amber-fg)] font-medium" : "";

  return (
    <button
      className={`w-full text-left rounded-lg border p-3 transition-all relative overflow-hidden group ${
        selected
          ? "bg-[var(--cc-card)] border-[var(--cc-primary)] shadow-sm ring-1 ring-[var(--cc-primary)]"
          : "bg-[var(--cc-card)] border-[var(--cc-border)] hover:border-[var(--cc-primary)]"
      }`}
      onClick={onClick}
    >
      {selected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--cc-primary)]" />}
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-sm font-semibold ${dim}`}>{leg.ref}</span>
          <span className={`text-xs bg-[var(--cc-muted)] px-1.5 py-0.5 rounded text-[var(--cc-muted-fg)] ${leg.status === "hold" ? "opacity-70" : ""}`}>{leg.serviceDate}</span>
        </div>
        <span className={`font-medium text-sm ${dim}`}>{leg.amount}</span>
      </div>
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full border"
          style={{ background: pill.bg, color: pill.fg, borderColor: pill.border }}
        >
          {leg.statusLabel}
        </span>
        <div className={`flex items-center gap-3 text-xs text-[var(--cc-muted-fg)] ${leg.status === "hold" ? "opacity-70" : ""}`}>
          <span>{leg.errorType}</span>
          <span className={`flex items-center gap-1 ${sopColor}`}>{sopIcon}{leg.sopProgress}</span>
          <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{leg.evidenceCount}</span>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Focus panel — renders for ANY selected leg                          */
/* ------------------------------------------------------------------ */

function FocusPanel({ leg }: { leg: Leg }) {
  const validEvidence = leg.evidence.filter((e) => !e.missing).length;
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* FOCUS HEADER & ACTIONS */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold mono">
            {leg.ref}
            <span className="text-[var(--cc-muted-fg)] font-sans font-normal text-lg ml-2">Leg {leg.key}</span>
          </h2>
          <div className="flex items-center gap-2 mt-1 text-sm text-[var(--cc-muted-fg)]">
            <span>{leg.errorType}</span>
            <span>•</span>
            <span>Service: {leg.serviceDate}</span>
            <span>•</span>
            <span className="font-medium text-[var(--cc-fg)]">{leg.amount}</span>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap justify-end max-w-md">
          <button className="cc-btn cc-btn-sm cc-btn-ghost text-[var(--cc-muted-fg)]"><Tag className="w-3.5 h-3.5" /> Reclassify</button>
          <button className="cc-btn cc-btn-sm cc-btn-ghost text-[var(--cc-muted-fg)]"><XCircle className="w-3.5 h-3.5" /> Exclude</button>
          <button className="cc-btn cc-btn-sm cc-btn-ghost text-[var(--cc-muted-fg)]"><LinkIcon className="w-3.5 h-3.5" /> Mark dup</button>
          <button className="cc-btn cc-btn-sm cc-btn-ghost text-[var(--cc-muted-fg)]"><CheckCircle2 className="w-3.5 h-3.5" /> Offline</button>
        </div>
      </div>

      {/* SOP TRANSCRIPT */}
      <div className="cc-card overflow-hidden">
        <div className="px-4 py-3 bg-[var(--cc-card)] border-b border-[var(--cc-border)] flex justify-between items-center">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileText className="w-4 h-4" />
            SOP Transcript
          </h3>
          <button className="text-xs font-medium text-[var(--cc-primary)] hover:underline flex items-center gap-1">
            Walk in Queue <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        <div>
          {leg.sop.map((row, i) => (
            <SopRow key={i} index={i + 1} row={row} />
          ))}
        </div>
      </div>

      {/* EVIDENCE FILES */}
      <div className="cc-card overflow-hidden">
        <div className="px-4 py-3 bg-[var(--cc-card)] border-b border-[var(--cc-border)] flex justify-between items-center">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Evidence Files
            <span className="text-[var(--cc-muted-fg)] font-normal text-xs ml-1">
              ({validEvidence}/{leg.evidenceTotal})
            </span>
          </h3>
        </div>
        <div className="p-4 space-y-3 bg-[var(--cc-card)]">
          {leg.evidence.map((file, i) => (
            <EvidenceFileRow key={i} file={file} />
          ))}

          {/* DROP ZONE */}
          <div className="mt-4 border-2 border-dashed border-[var(--cc-border)] rounded-lg p-6 flex flex-col items-center justify-center text-center bg-[var(--cc-muted)]/50 hover:bg-[var(--cc-muted)] transition-colors cursor-pointer">
            <Upload className="w-6 h-6 text-[var(--cc-muted-fg)] mb-2" />
            <p className="text-sm font-medium text-[var(--cc-fg)]">Drag &amp; drop files here</p>
            <p className="text-xs text-[var(--cc-muted-fg)] mt-1">or click to browse</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SopRow({ index, row }: { index: number; row: SopAnswer }) {
  const isBlocked = row.state === "blocked";
  const isPending = row.state === "pending";
  const icon =
    row.state === "yes"     ? <CheckCircle2 className="w-4 h-4 text-[var(--cc-success)]" /> :
    row.state === "no"      ? <CheckCircle2 className="w-4 h-4 text-[var(--cc-success)]" /> :
    row.state === "blocked" ? <AlertTriangle className="w-4 h-4 text-[var(--cc-amber-fg)]" /> :
                              <Circle className="w-4 h-4 text-[var(--cc-muted-fg)]" />;
  const wrap =
    isBlocked ? "bg-[var(--cc-amber-bg)] border-[var(--cc-amber-border)]" :
    isPending ? "bg-[var(--cc-card)] opacity-70" :
                "bg-[var(--cc-card)]";
  return (
    <div className={`flex px-4 py-3 border-b border-[var(--cc-border)] border-dashed last:border-0 ${wrap}`}>
      <div className="w-6 shrink-0 pt-0.5">{icon}</div>
      <div className="flex-1 text-sm">
        <p className={`mb-0.5 ${isBlocked ? "text-[var(--cc-amber-fg)] opacity-80 font-medium" : "text-[var(--cc-muted-fg)]"}`}>
          Q{index}: {row.q}
        </p>
        <p className={isBlocked ? "font-bold text-[var(--cc-amber-fg)]" : "font-medium"}>
          {row.a}
        </p>
      </div>
    </div>
  );
}

function EvidenceFileRow({ file }: { file: EvidenceFile }) {
  if (file.missing) {
    return (
      <div className="flex items-center justify-between p-3 rounded-md border border-[var(--cc-red-border)] bg-[var(--cc-red-bg)] relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/50 rounded text-[var(--cc-red-fg)]"><AlertTriangle className="w-4 h-4" /></div>
          <div>
            <p className="text-sm font-bold text-[var(--cc-red-fg)]">{file.name}</p>
            <p className="text-xs text-[var(--cc-red-fg)] opacity-80">
              MISSING{file.requiredBy ? ` • required by ${file.requiredBy}` : ""}
            </p>
          </div>
        </div>
        <button className="cc-btn cc-btn-sm bg-white hover:bg-white text-[var(--cc-red-fg)] border-[var(--cc-red-border)]">
          <Upload className="w-3 h-3" /> Upload
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between p-3 rounded-md border border-[var(--cc-border)] bg-[var(--cc-bg)] group">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-[var(--cc-blue-bg)] rounded text-[var(--cc-blue-fg)]"><FileText className="w-4 h-4" /></div>
        <div>
          <p className="text-sm font-medium">{file.name}</p>
          <p className="text-xs text-[var(--cc-muted-fg)]">{file.size} • {file.date}</p>
        </div>
      </div>
      <CheckCircle2 className="w-5 h-5 text-[var(--cc-success)]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Lifecycle strip                                                    */
/* ------------------------------------------------------------------ */

function StageDot({ label, date, status }: { label: string; date?: string; status: "done" | "current" | "pending" }) {
  const isDone = status === "done";
  const isCurrent = status === "current";
  return (
    <div className="flex flex-col items-center relative z-10 w-16">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center border-2 mb-1.5 transition-colors
        ${isDone ? "bg-[var(--cc-primary)] border-[var(--cc-primary)] text-white" :
          isCurrent ? "bg-white border-[var(--cc-primary)] ring-4 ring-[var(--cc-blue-bg)]" :
          "bg-white border-[var(--cc-border)]"}
      `}>
        {isDone && <CheckCircle2 className="w-3 h-3" />}
        {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-[var(--cc-primary)]" />}
      </div>
      <span className={`text-[11px] font-semibold tracking-wide uppercase ${isDone || isCurrent ? "text-[var(--cc-fg)]" : "text-[var(--cc-muted-fg)]"}`}>{label}</span>
      {date && <span className="text-[10px] text-[var(--cc-muted-fg)] whitespace-nowrap absolute -bottom-4">{date}</span>}
    </div>
  );
}

function StageLine({ status }: { status: "done" | "pending" }) {
  return (
    <div className={`h-0.5 flex-1 mb-5 rounded-full ${status === "done" ? "bg-[var(--cc-primary)]" : "bg-[var(--cc-border)]"}`} />
  );
}
