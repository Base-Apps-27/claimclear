import "./_queue.css";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Clock,
  ChevronRight,
  ChevronDown,
  Inbox,
  FileText,
  Send,
  ShieldCheck,
  Archive,
  Sparkles,
  MessageSquare,
  Activity,
  Paperclip,
  StickyNote,
  HelpCircle,
  ArrowDown,
  ArrowLeft,
  X,
  CheckCircle2,
  Circle,
  Bot,
  ArrowRight,
} from "lucide-react";

export const Icons = {
  AlertTriangle, Clock, ChevronRight, ChevronDown, Inbox, FileText, Send,
  ShieldCheck, Archive, Sparkles, MessageSquare, Activity, Paperclip,
  StickyNote, HelpCircle, ArrowDown, ArrowLeft, X, CheckCircle2, Circle, Bot, ArrowRight,
};

// ---- Sample data shared across every Queue redesign mockup. -------------
// Static — these mockups never wire up real data. Numbers chosen to match
// the spec's example "30 due tomorrow · 12 ready to submit · 4 awaiting".
export const queueChips = [
  { tone: "red",   label: "8 due today",          active: false },
  { tone: "amber", label: "30 due tomorrow",      active: false },
  { tone: "green", label: "12 ready to submit",   active: false },
  { tone: "blue",  label: "4 awaiting payor reply", active: true  },
];

export type QueueRow = {
  id: number;
  invoice: string;
  payor: string;
  amount: string;
  tier: "red" | "amber" | "green" | "muted";
  errorTag: string;
  legs: number;
  selected?: boolean;
  meta: string;
};

export const queueRows: QueueRow[] = [
  { id: 1, invoice: "INV-2026-0488", payor: "MAS Medicaid", amount: "$2,184.50", tier: "red",   errorTag: "Mileage",     legs: 3, meta: "EOD today" },
  { id: 2, invoice: "INV-2026-0487", payor: "MAS Medicaid", amount: "$1,402.10", tier: "red",   errorTag: "Auth window", legs: 1, meta: "EOD today",  selected: true },
  { id: 3, invoice: "INV-2026-0485", payor: "Logisticare",  amount: "$865.00",   tier: "amber", errorTag: "Duplicate",   legs: 2, meta: "Tomorrow" },
  { id: 4, invoice: "INV-2026-0481", payor: "MAS Medicaid", amount: "$612.40",   tier: "amber", errorTag: "Mileage",     legs: 4, meta: "Tomorrow" },
  { id: 5, invoice: "INV-2026-0479", payor: "Verida",       amount: "$248.10",   tier: "green", errorTag: "Rate code",   legs: 1, meta: "+2d" },
  { id: 6, invoice: "INV-2026-0477", payor: "MAS Medicaid", amount: "$1,021.00", tier: "green", errorTag: "Mileage",     legs: 2, meta: "+3d" },
  { id: 7, invoice: "INV-2026-0473", payor: "Logisticare",  amount: "$184.50",   tier: "muted", errorTag: "Outside hrs", legs: 1, meta: "+5d" },
];

export type Leg = {
  id: number;
  conf: string;
  date: string;
  amount: string;
  state: "active" | "ready" | "dropped" | "needs";
  question?: string;
  verdict?: string;
};

export const groupSummary = {
  invoice: "INV-2026-0487",
  payor: "MAS Medicaid",
  total: "$1,402.10",
  status: "Needs Evidence",
  legCount: 3,
  readyCount: 1,
  evidenceCount: 4,
  notesCount: 2,
  threadCount: 1,
  activityCount: 11,
};

export const legs: Leg[] = [
  {
    id: 101, conf: "C-2026-04812", date: "Apr 24",  amount: "$184.50",
    state: "active",
    question: "Did the GPS log confirm the billed mileage of 14.2 mi for rate code R-12?",
  },
  {
    id: 102, conf: "C-2026-04813", date: "Apr 24",  amount: "$612.40",
    state: "ready", verdict: "Ready to submit",
  },
  {
    id: 103, conf: "C-2026-04814", date: "Apr 25",  amount: "$605.20",
    state: "needs",
  },
];

export const sopBreadcrumbs = [
  "Was the trip authorized?",
  "Was a GPS log captured?",
  "Did the GPS log confirm the billed mileage?",
];

// ------------------------------------------------------------------------
// Light-weight shared building blocks. Intentionally small — the mockups
// each render their own bespoke layout; these helpers cover the bits that
// were genuinely identical across 5 variants (chip rows, legends, etc).
// ------------------------------------------------------------------------

export function FrameLabel({ tag, title, principles }: { tag: string; title: string; principles: string[] }) {
  return (
    <div className="cc-frame-label">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="cc-frame-tag">{tag}</span>
        <span className="font-semibold text-sm">{title}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        {principles.map((p) => (
          <span key={p} className="cc-principle-pill">{p}</span>
        ))}
      </div>
    </div>
  );
}

export function ToneChip({ tone, children, active = false }: { tone: string; children: ReactNode; active?: boolean }) {
  return (
    <button className={`cc-chip cc-chip-${tone}${active ? " cc-chip-active" : ""}`}>
      {children}
    </button>
  );
}

export function HeaderStrip() {
  return (
    <div className="cc-header-strip">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Invoice Queue</h1>
        <span className="cc-meta">Tuesday, May 7</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {queueChips.map((c) => (
          <ToneChip key={c.label} tone={c.tone} active={c.active}>
            {c.label}
          </ToneChip>
        ))}
        <span className="cc-meta ml-2">Past-deadline: <strong>off</strong></span>
      </div>
    </div>
  );
}

export function ClassificationStrip({ count = 0 }: { count?: number }) {
  if (count === 0) {
    return (
      <div className="cc-inbox-strip cc-inbox-empty">
        <Icons.Inbox className="w-3.5 h-3.5" />
        <span>Classification Inbox</span>
        <span className="cc-meta">All caught up</span>
      </div>
    );
  }
  return (
    <div className="cc-inbox-strip">
      <Icons.Inbox className="w-3.5 h-3.5" />
      <span className="font-medium">Classification Inbox</span>
      <span className="cc-pill cc-pill-amber">{count} to classify</span>
      <button className="cc-btn cc-btn-sm ml-auto">Show <Icons.ChevronDown className="w-3 h-3" /></button>
    </div>
  );
}

export function MasterList({ rows = queueRows, dense = false }: { rows?: QueueRow[]; dense?: boolean }) {
  return (
    <div className={`cc-master-list${dense ? " cc-master-list-dense" : ""}`}>
      {rows.map((r) => (
        <button key={r.id} className={`cc-master-row${r.selected ? " cc-master-row-selected" : ""}`}>
          <span className={`cc-tier-bar cc-tier-${r.tier}`} />
          <div className="flex flex-col items-start min-w-0 flex-1">
            <div className="flex items-center gap-1.5 w-full">
              <span className="mono text-[12px] font-semibold truncate">{r.invoice}</span>
              <span className="cc-meta ml-auto text-[11px]">{r.meta}</span>
            </div>
            <div className="flex items-center gap-1.5 w-full">
              <span className="cc-meta text-[11px] truncate">{r.payor}</span>
              <span className="cc-tag">{r.errorTag}</span>
              <span className="cc-meta text-[11px] ml-auto tabular-nums">{r.amount}</span>
            </div>
            {!dense && (
              <div className="cc-meta text-[10px] mt-0.5">{r.legs} leg{r.legs > 1 ? "s" : ""}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

export function CountsStrip({
  evidence = 0, notes = 0, thread = 0, activity = 0,
}: { evidence?: number; notes?: number; thread?: number; activity?: number }) {
  const pills = [
    { icon: <Icons.Paperclip className="w-3 h-3" />, label: "Evidence", n: evidence },
    { icon: <Icons.StickyNote className="w-3 h-3" />, label: "Notes", n: notes },
    { icon: <Icons.MessageSquare className="w-3 h-3" />, label: "Thread", n: thread },
    { icon: <Icons.Activity className="w-3 h-3" />, label: "Activity", n: activity },
  ];
  return (
    <div className="cc-counts-strip">
      {pills.map((p) => (
        <button key={p.label} className="cc-count-pill" disabled={p.n === 0}>
          {p.icon}
          <span>{p.label}</span>
          <span className="cc-count-n">{p.n}</span>
        </button>
      ))}
    </div>
  );
}

export function SopActiveCard({
  question = legs[0].question!,
  breadcrumbs = sopBreadcrumbs,
}: { question?: string; breadcrumbs?: string[] }) {
  return (
    <div className="cc-sop-card">
      <div className="cc-sop-breadcrumbs">
        {breadcrumbs.slice(0, -1).map((b, i) => (
          <span key={i} className="cc-sop-bc-done">
            <Icons.CheckCircle2 className="w-3 h-3" /> {b}
          </span>
        ))}
        <span className="cc-sop-bc-active">
          <Icons.HelpCircle className="w-3 h-3" /> Step {breadcrumbs.length}
        </span>
      </div>
      <h3 className="cc-sop-question">{question}</h3>
      <p className="cc-meta text-xs mt-1">
        Source of truth: GPS export from dispatch · Help: <a href="#" className="cc-link">SOP §4.2 — Mileage verification</a>
      </p>
      <div className="cc-sop-actions">
        <button className="cc-btn cc-btn-primary">Yes — proceed to ready</button>
        <button className="cc-btn">No — drop as non-issue</button>
        <button className="cc-btn cc-btn-ghost">Need more info</button>
      </div>
    </div>
  );
}

export function SubmissionFooter({
  variant = "gauntlet",
  pinned = true,
}: { variant?: "gauntlet" | "reattest" | "closeout"; pinned?: boolean }) {
  if (variant === "reattest") {
    return (
      <div className={`cc-footer-card cc-footer-blue${pinned ? " cc-footer-pinned" : ""}`} data-testid="footer-reattest">
        <div className="cc-footer-icon"><Icons.ShieldCheck className="w-4 h-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Ready to re-attest</div>
          <div className="cc-meta text-xs">2 legs need re-attestation in the portal · 1 non-contestable leg will be cancelled.</div>
        </div>
        <button className="cc-btn cc-btn-primary"><Icons.ShieldCheck className="w-3.5 h-3.5" /> Re-attest</button>
      </div>
    );
  }
  if (variant === "closeout") {
    return (
      <div className={`cc-footer-card cc-footer-amber${pinned ? " cc-footer-pinned" : ""}`} data-testid="footer-closeout">
        <div className="cc-footer-icon"><Icons.Archive className="w-4 h-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Nothing left to dispute</div>
          <div className="cc-meta text-xs">All legs closed as non-contestable. Mark the invoice closed so it stops sitting in your queue.</div>
        </div>
        <button className="cc-btn"><Icons.Archive className="w-3.5 h-3.5" /> Mark as closed</button>
      </div>
    );
  }
  return (
    <div className={`cc-footer-card${pinned ? " cc-footer-pinned" : ""}`} data-testid="footer-gauntlet">
      <div className="flex items-start gap-3 w-full">
        <div className="cc-footer-icon cc-footer-icon-blue"><Icons.Send className="w-4 h-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Submission gauntlet</span>
            <span className="cc-pill cc-pill-amber">1 of 3 legs ready</span>
          </div>
          <ol className="cc-gauntlet-row">
            <li className="cc-gauntlet-step cc-gauntlet-done">
              <Icons.CheckCircle2 className="w-3 h-3" /> Notes saved
            </li>
            <li className="cc-gauntlet-step cc-gauntlet-active">
              <Icons.Sparkles className="w-3 h-3" /> Generate preview
            </li>
            <li className="cc-gauntlet-step">
              <Icons.Circle className="w-3 h-3" /> Review &amp; edit
            </li>
            <li className="cc-gauntlet-step">
              <Icons.Send className="w-3 h-3" /> Submit to portal
            </li>
          </ol>
        </div>
        <div className="flex flex-col gap-1.5">
          <button className="cc-btn cc-btn-primary"><Icons.Sparkles className="w-3.5 h-3.5" /> Generate preview</button>
          <span className="cc-meta text-[11px] text-right">Locked: 2 legs still owe action</span>
        </div>
      </div>
    </div>
  );
}

export function GroupHeaderCard({
  trailing,
}: { trailing?: ReactNode }) {
  const g = groupSummary;
  return (
    <div className="cc-group-header">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="mono font-semibold">{g.invoice}</span>
        <span className="cc-pill cc-pill-amber">{g.status}</span>
        <span className="cc-meta text-xs">{g.payor} · {g.legCount} legs · {g.total}</span>
      </div>
      <div className="flex items-center gap-1 ml-auto">
        {trailing}
        <a href="#" className="cc-btn cc-btn-ghost cc-btn-sm">Full Details <Icons.ChevronRight className="w-3 h-3" /></a>
        <button className="cc-btn cc-btn-ghost cc-btn-sm" aria-label="More">⋯</button>
      </div>
    </div>
  );
}

export function LegRow({
  leg,
  expanded = false,
  onClick,
  showHint = false,
}: { leg: Leg; expanded?: boolean; onClick?: () => void; showHint?: boolean }) {
  const verdict =
    leg.state === "ready" ? <span className="cc-pill cc-pill-green">Ready</span> :
    leg.state === "dropped" ? <span className="cc-pill cc-pill-muted">Non-issue</span> :
    leg.state === "needs"  ? <span className="cc-pill cc-pill-muted">Needs walk</span> :
    <span className="cc-pill cc-pill-blue">In progress</span>;
  return (
    <div className={`cc-leg-row${expanded ? " cc-leg-row-expanded" : ""}`}>
      <button className="cc-leg-row-head" onClick={onClick}>
        <span className="cc-leg-chev">
          {expanded ? <Icons.ChevronDown className="w-3.5 h-3.5" /> : <Icons.ChevronRight className="w-3.5 h-3.5" />}
        </span>
        <span className="mono text-[12px] font-medium">{leg.conf}</span>
        <span className="cc-meta text-[11px]">{leg.date}</span>
        <span className="cc-meta text-[11px] tabular-nums">{leg.amount}</span>
        <span className="ml-auto">{verdict}</span>
      </button>
      {expanded && (
        <div className="cc-leg-row-body">
          <SopActiveCard question={leg.question} />
          <CountsStrip evidence={3} notes={1} thread={0} activity={4} />
          {showHint && (
            <div className="cc-leg-hint">
              <Icons.ArrowDown className="w-3 h-3" />
              This leg gates the invoice — answer above to unlock the submission footer below.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Annotation({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "amber" | "muted" }) {
  return <div className={`cc-annotation cc-annotation-${tone}`}>{children}</div>;
}
