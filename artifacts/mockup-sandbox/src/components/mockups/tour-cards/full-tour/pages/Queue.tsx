import React from "react";
import { T } from "../tokens";

const LANES = [
  { key: "triage",      title: "Triage",       phase: T.AMBER_FG,   bg: T.AMBER_BG,   bd: T.AMBER_BD,   count: 9 },
  { key: "investigate", title: "Investigate",  phase: T.SKY_FG,     bg: T.SKY_BG,     bd: T.SKY_BD,     count: 14 },
  { key: "gather",      title: "Gather proof", phase: T.EMERALD_FG, bg: T.EMERALD_BG, bd: T.EMERALD_BD, count: 11 },
  { key: "submit",      title: "Submit",       phase: T.CORAL,      bg: T.CORAL_BG,   bd: T.CORAL_BD,   count: 6 },
];

export function Queue() {
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="text-[18px] font-semibold leading-tight" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>
            Queue
          </h1>
          <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
            40 open · sorted by oldest first
          </div>
        </div>
        <div className="flex gap-1.5">
          <button className="h-7 px-2.5 rounded-md border text-[11px] font-medium" style={{ borderColor: T.HAIRLINE, color: T.SLATE_MUTED, backgroundColor: "white" }}>
            Filters
          </button>
          <button className="h-7 px-2.5 rounded-md text-[11px] font-medium text-white" style={{ backgroundColor: T.NAVY }}>
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 flex-1 min-h-0">
        {LANES.map((lane) => (
          <div
            key={lane.key}
            data-tour={`queue-lane-${lane.key}`}
            className="bg-white border rounded-lg flex flex-col min-h-0"
            style={{ borderColor: T.HAIRLINE }}
          >
            <div className="flex items-center justify-between px-2.5 py-2 border-b" style={{ borderColor: T.HAIRLINE, backgroundColor: lane.bg }}>
              <span className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: lane.phase }}>{lane.title}</span>
              <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-white" style={{ color: lane.phase, border: `1px solid ${lane.bd}` }}>
                {lane.count}
              </span>
            </div>
            <div className="p-2 space-y-1.5 overflow-hidden flex-1">
              {Array.from({ length: Math.min(lane.count, 6) }).map((_, i) => (
                <div key={i} className="rounded p-2" style={{ backgroundColor: T.SLATE_50, border: `1px solid ${T.HAIRLINE}` }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="h-1.5 w-12 rounded" style={{ backgroundColor: T.SLATE_300 }} />
                    <div className="h-1.5 w-8 rounded tabular-nums" style={{ backgroundColor: lane.phase, opacity: 0.6 }} />
                  </div>
                  <div className="h-1.5 w-20 rounded mb-1" style={{ backgroundColor: T.SLATE_300 }} />
                  <div className="flex items-center gap-1">
                    <div className="h-3.5 px-1 rounded text-[8px] font-bold flex items-center" style={{ backgroundColor: lane.bg, color: lane.phase, border: `1px solid ${lane.bd}` }}>
                      MAS
                    </div>
                    <div className="h-1.5 flex-1 rounded" style={{ backgroundColor: T.SLATE_300 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
