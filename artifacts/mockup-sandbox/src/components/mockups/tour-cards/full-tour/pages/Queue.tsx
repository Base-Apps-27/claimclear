import React from "react";
import { AlertTriangle, ChevronDown, EyeOff, FileText } from "lucide-react";
import { T } from "../tokens";

const INBOX_ROWS = [
  { id: "G-4310", invoice: "INV-7821", count: 3, sample: "Ride 04/22 · $148.00 · likely wrong distance" },
  { id: "G-4308", invoice: "INV-7819", count: 5, sample: "Ride 04/22 · $211.00 · likely wrong code" },
  { id: "G-4305", invoice: "INV-7815", count: 2, sample: "Ride 04/21 · $128.40 · likely missing signature" },
];

const ACTIONABLE_ROWS = [
  { id: "G-4291", trips: 7, status: "Needs evidence",   amount: "$1,094.20", deadline: "12 days", color: T.AMBER_FG, bg: T.AMBER_BG, bd: T.AMBER_BD },
  { id: "G-4287", trips: 3, status: "Needs evidence",   amount: "$486.40",   deadline: "4 days",  color: T.AMBER_FG, bg: T.AMBER_BG, bd: T.AMBER_BD },
  { id: "G-4282", trips: 5, status: "Generating email", amount: "$742.00",   deadline: "8 days",  color: T.SKY_FG,   bg: T.SKY_BG,   bd: T.SKY_BD },
  { id: "G-4279", trips: 2, status: "New",              amount: "$422.00",   deadline: "6 days",  color: T.CORAL,    bg: T.CORAL_BG, bd: T.CORAL_BD },
];

export function Queue() {
  return (
    <div className="h-full flex flex-col gap-2.5 overflow-hidden">
      {/* ═══ URGENCY HERO ═══ */}
      <div
        data-tour="queue-urgency-hero"
        className="flex items-center justify-between rounded-lg border px-3 py-2.5 flex-shrink-0"
        style={{
          background: `linear-gradient(95deg, ${T.ROSE_BG} 0%, #FFF1EE 100%)`,
          borderColor: T.ROSE_BD,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-md flex items-center justify-center" style={{ backgroundColor: T.ROSE_FG }}>
            <AlertTriangle className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[22px] font-bold leading-none tabular-nums" style={{ color: T.ROSE_FG }}>4</span>
              <span className="text-[12px] font-semibold" style={{ color: T.ROSE_FG }}>groups must be submitted before EOD</span>
            </div>
            <div className="text-[10.5px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
              Filing deadlines hit today · drop everything else and file these first
            </div>
          </div>
        </div>
        <button className="h-7 px-3 rounded-md text-[11px] font-semibold text-white" style={{ backgroundColor: T.ROSE_FG }}>
          Show urgent only
        </button>
      </div>

      {/* ═══ ENGAGEMENT STRIP ═══ */}
      <div
        data-tour="queue-engagement-strip"
        className="flex items-center justify-between bg-white border rounded-lg px-3 py-2 flex-shrink-0"
        style={{ borderColor: T.HAIRLINE }}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 rounded-md p-0.5" style={{ backgroundColor: T.SLATE_50, border: `1px solid ${T.HAIRLINE}` }}>
            <button className="h-6 px-2.5 rounded text-[11px] font-semibold text-white" style={{ backgroundColor: T.CORAL }}>
              Needs engagement
            </button>
            <button className="h-6 px-2.5 rounded text-[11px] font-medium" style={{ color: T.SLATE_MUTED }}>
              All
            </button>
          </div>
          <span className="text-[10.5px]" style={{ color: T.SLATE_MUTED }}>
            <EyeOff className="inline w-3 h-3 mr-1" />
            <span className="font-semibold tabular-nums" style={{ color: T.AMBER_FG }}>15</span> tabs/groups hidden
          </span>
        </div>
        <button className="h-6 px-2.5 rounded-md border text-[10.5px] font-medium" style={{ borderColor: T.HAIRLINE, color: T.SLATE_MUTED, backgroundColor: "white" }}>
          Show past-deadline
        </button>
      </div>

      {/* ═══ CLASSIFICATION INBOX (expanded) ═══ */}
      <div
        data-tour="queue-classification-inbox"
        className="bg-white border rounded-lg flex-shrink-0"
        style={{ borderColor: T.AMBER_BD, borderWidth: 1.5 }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: T.HAIRLINE, backgroundColor: T.AMBER_BG }}>
          <div className="flex items-center gap-2">
            <ChevronDown className="w-3.5 h-3.5" style={{ color: T.AMBER_FG }} />
            <span className="text-[12px] font-bold" style={{ color: T.AMBER_FG }}>Classification Inbox</span>
            <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ backgroundColor: "white", color: T.AMBER_FG, border: `1px solid ${T.AMBER_BD}` }}>
              3 groups · 10 rides
            </span>
          </div>
          <span className="text-[10px]" style={{ color: T.SLATE_MUTED }}>Needs error type assigned</span>
        </div>
        <div className="divide-y" style={{ borderColor: T.HAIRLINE }}>
          {INBOX_ROWS.map((r) => (
            <div key={r.id} className="px-3 py-1.5 flex items-center justify-between hover:bg-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-3 h-3 flex-shrink-0" style={{ color: T.SLATE_MUTED }} />
                <span className="text-[11.5px] font-semibold tabular-nums" style={{ color: T.NAVY }}>{r.id}</span>
                <span className="text-[10.5px]" style={{ color: T.SLATE_MUTED }}>·</span>
                <span className="text-[10.5px] tabular-nums" style={{ color: T.SLATE_MUTED }}>{r.invoice}</span>
                <span className="text-[10px] truncate" style={{ color: T.SLATE_400 }}>· {r.sample}</span>
              </div>
              <button className="h-5 px-1.5 rounded text-[9.5px] font-bold" style={{ backgroundColor: T.AMBER_FG, color: "white" }}>
                Classify {r.count}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ TAB STRIP ═══ */}
      <div data-tour="queue-tabs" className="flex items-center gap-1 flex-shrink-0 border-b" style={{ borderColor: T.HAIRLINE }}>
        <div data-tour="queue-tab-actionable" className="flex items-center gap-1.5 px-3 py-1.5 border-b-2 -mb-px" style={{ borderColor: T.NAVY }}>
          <span className="text-[12px] font-bold" style={{ color: T.NAVY }}>Actionable</span>
          <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ backgroundColor: T.NAVY, color: "white" }}>47</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 opacity-50">
          <span className="text-[12px] font-medium line-through" style={{ color: T.SLATE_400 }}>Portal Queued</span>
          <span className="text-[9.5px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ backgroundColor: T.SLATE_50, color: T.SLATE_400, border: `1px solid ${T.HAIRLINE}` }}>12 hidden</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 opacity-50">
          <span className="text-[12px] font-medium line-through" style={{ color: T.SLATE_400 }}>On Hold</span>
          <span className="text-[9.5px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ backgroundColor: T.SLATE_50, color: T.SLATE_400, border: `1px solid ${T.HAIRLINE}` }}>3 hidden</span>
        </div>
      </div>

      {/* ═══ ACTIONABLE LIST ═══ */}
      <div className="bg-white border rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col" style={{ borderColor: T.HAIRLINE }}>
        <div className="grid grid-cols-[110px_60px_1fr_110px_90px] gap-3 px-3 py-1.5 border-b text-[9.5px] uppercase tracking-wider font-semibold" style={{ borderColor: T.HAIRLINE, backgroundColor: T.SLATE_50, color: T.SLATE_MUTED }}>
          <span>Group</span><span>Trips</span><span>Status</span><span>Amount</span><span>Deadline</span>
        </div>
        <div className="overflow-hidden flex-1">
          {ACTIONABLE_ROWS.map((r) => (
            <div key={r.id} className="grid grid-cols-[110px_60px_1fr_110px_90px] gap-3 px-3 py-1.5 border-b items-center" style={{ borderColor: T.HAIRLINE }}>
              <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.NAVY }}>{r.id}</span>
              <span className="text-[11.5px] tabular-nums" style={{ color: T.SLATE_TEXT }}>{r.trips}</span>
              <span className="inline-flex items-center gap-1.5 self-start text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded w-fit" style={{ backgroundColor: r.bg, color: r.color, border: `1px solid ${r.bd}` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} /> {r.status}
              </span>
              <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.SLATE_TEXT }}>{r.amount}</span>
              <span className="text-[11px] tabular-nums" style={{ color: T.SLATE_MUTED }}>{r.deadline}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
