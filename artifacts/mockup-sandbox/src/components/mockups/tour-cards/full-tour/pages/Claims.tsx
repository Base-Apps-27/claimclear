import React from "react";
import { ChevronDown, Filter } from "lucide-react";
import { T } from "../tokens";

const TABS = [
  { key: "all",      label: "All",          count: 184, color: T.NAVY },
  { key: "invest",   label: "Investigating", count: 47, color: T.SKY_FG, active: true },
  { key: "ready",    label: "Ready",         count: 23, color: T.EMERALD_FG },
  { key: "blocked",  label: "Blocked",       count: 8,  color: T.AMBER_FG },
  { key: "submitted", label: "Submitted",    count: 106, color: T.CORAL },
];

const ROWS = [
  { car: "1042", date: "04/12", group: "G-4291", amount: "$148.00", err: "Wrong distance",     status: "Investigating", color: T.SKY_FG, bg: T.SKY_BG, bd: T.SKY_BD },
  { car: "1108", date: "04/12", group: "G-4291", amount: "$162.40", err: "Missing signature",  status: "Investigating", color: T.SKY_FG, bg: T.SKY_BG, bd: T.SKY_BD },
  { car: "0993", date: "04/13", group: "G-4279", amount: "$211.00", err: "Wrong code",         status: "Investigating", color: T.SKY_FG, bg: T.SKY_BG, bd: T.SKY_BD },
  { car: "1042", date: "04/13", group: "G-4291", amount: "$148.00", err: "Wrong distance",     status: "Investigating", color: T.SKY_FG, bg: T.SKY_BG, bd: T.SKY_BD },
  { car: "0987", date: "04/15", group: "G-4287", amount: "$148.40", err: "Wrong distance",     status: "Investigating", color: T.SKY_FG, bg: T.SKY_BG, bd: T.SKY_BD },
  { car: "1108", date: "04/14", group: "G-4291", amount: "$128.40", err: "Missing signature",  status: "Investigating", color: T.SKY_FG, bg: T.SKY_BG, bd: T.SKY_BD },
];

export function Claims() {
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="text-[18px] font-semibold leading-tight" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>
            Claims
          </h1>
          <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
            Showing <span className="font-semibold tabular-nums" style={{ color: T.SLATE_TEXT }}>47</span> of <span className="tabular-nums">532</span> · 485 hidden by filters
          </div>
        </div>
      </div>

      {/* Sub-status tabs */}
      <div data-tour="claims-substatus" className="flex items-center gap-1 flex-shrink-0">
        {TABS.map((t) => {
          const active = t.active;
          return (
            <button key={t.key}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold border"
              style={{
                backgroundColor: active ? t.color : "white",
                color: active ? "white" : t.color,
                borderColor: active ? t.color : t.color + "44",
              }}>
              <span>{t.label}</span>
              <span className="text-[10px] tabular-nums px-1 rounded" style={{
                backgroundColor: active ? "rgba(255,255,255,0.25)" : t.color + "15",
              }}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* Filter bar — SAME default-hiding filters as Invoice Groups */}
      <div data-tour="claims-filters" className="bg-white border rounded-lg p-2 flex items-center gap-1.5 flex-wrap flex-shrink-0" style={{ borderColor: T.HAIRLINE }}>
        <div className="flex items-center gap-1 px-1.5">
          <Filter className="w-3 h-3" style={{ color: T.SLATE_MUTED }} />
          <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.SLATE_MUTED }}>Filters</span>
        </div>
        <button className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-semibold border"
          style={{ backgroundColor: T.CORAL_BG, color: T.CORAL_DARK, borderColor: T.CORAL_BD }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: T.CORAL }} />
          Engagement: Needs engagement
          <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
        <button className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium border bg-white" style={{ color: T.SLATE_MUTED, borderColor: T.HAIRLINE }}>
          Error type: All <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
        <button className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium border bg-white" style={{ color: T.SLATE_MUTED, borderColor: T.HAIRLINE }}>
          Service date: Any <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
        <div className="h-5 w-px mx-1" style={{ backgroundColor: T.HAIRLINE }} />
        <div className="flex items-center gap-2 h-7 px-2.5 rounded-md border" style={{ backgroundColor: T.AMBER_BG, borderColor: T.AMBER_BD }}>
          <div className="relative h-3.5 w-7 rounded-full" style={{ backgroundColor: T.SLATE_300 }}>
            <div className="absolute top-0.5 left-0.5 h-2.5 w-2.5 rounded-full bg-white shadow" />
          </div>
          <span className="text-[11px] font-semibold" style={{ color: T.AMBER_FG }}>Show past-deadline</span>
          <span className="text-[10px] tabular-nums px-1 py-0.5 rounded font-bold" style={{ backgroundColor: "white", color: T.AMBER_FG, border: `1px solid ${T.AMBER_BD}` }}>
            128 hidden
          </span>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col" style={{ borderColor: T.HAIRLINE }}>
        <div className="grid grid-cols-[80px_70px_90px_90px_1fr_140px] gap-3 px-3 py-2 border-b text-[10px] uppercase tracking-wider font-semibold" style={{ borderColor: T.HAIRLINE, backgroundColor: T.SLATE_50, color: T.SLATE_MUTED }}>
          <span>Car #</span><span>Date</span><span>Group</span><span>Amount</span><span>Error</span><span>Status</span>
        </div>
        <div className="overflow-hidden flex-1">
          {ROWS.map((r, i) => (
            <div key={i} className="grid grid-cols-[80px_70px_90px_90px_1fr_140px] gap-3 px-3 py-2 border-b items-center" style={{ borderColor: T.HAIRLINE }}>
              <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.NAVY }}>{r.car}</span>
              <span className="text-[11.5px] tabular-nums" style={{ color: T.SLATE_TEXT }}>{r.date}</span>
              <span className="text-[11.5px] font-semibold tabular-nums" style={{ color: T.NAVY }}>{r.group}</span>
              <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.SLATE_TEXT }}>{r.amount}</span>
              <span className="text-[11px]" style={{ color: T.SLATE_MUTED }}>{r.err}</span>
              <span className="inline-flex items-center gap-1.5 self-start text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded w-fit" style={{ backgroundColor: r.bg, color: r.color, border: `1px solid ${r.bd}` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} /> {r.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
