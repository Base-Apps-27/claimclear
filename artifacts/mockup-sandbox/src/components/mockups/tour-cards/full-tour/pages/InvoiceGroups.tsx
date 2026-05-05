import React from "react";
import { ChevronDown, AlertTriangle, Filter } from "lucide-react";
import { T } from "../tokens";

const ROWS = [
  { id: "G-4291", trips: 7, status: "Awaiting response", color: T.SKY_FG, bg: T.SKY_BG, bd: T.SKY_BD, deadline: "12 days", owner: "JM" },
  { id: "G-4287", trips: 3, status: "Needs evidence",    color: T.AMBER_FG, bg: T.AMBER_BG, bd: T.AMBER_BD, deadline: "4 days",  owner: "—" },
  { id: "G-4282", trips: 5, status: "Ready to submit",   color: T.EMERALD_FG, bg: T.EMERALD_BG, bd: T.EMERALD_BD, deadline: "8 days",  owner: "AN" },
  { id: "G-4279", trips: 2, status: "Investigating",     color: T.SKY_FG, bg: T.SKY_BG, bd: T.SKY_BD, deadline: "6 days",  owner: "JM" },
  { id: "G-4271", trips: 4, status: "Needs evidence",    color: T.AMBER_FG, bg: T.AMBER_BG, bd: T.AMBER_BD, deadline: "2 days",  owner: "AN" },
  { id: "G-4268", trips: 1, status: "Ready to submit",   color: T.EMERALD_FG, bg: T.EMERALD_BG, bd: T.EMERALD_BD, deadline: "9 days",  owner: "—" },
  { id: "G-4260", trips: 6, status: "Awaiting response", color: T.SKY_FG, bg: T.SKY_BG, bd: T.SKY_BD, deadline: "14 days", owner: "JM" },
];

export function InvoiceGroups() {
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="text-[18px] font-semibold leading-tight" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>
            Invoice Groups
          </h1>
          <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
            Showing <span className="font-semibold tabular-nums" style={{ color: T.SLATE_TEXT }}>52</span> of <span className="tabular-nums">218</span> · 166 hidden by filters
          </div>
        </div>
        <div className="flex gap-1.5">
          <button className="h-7 px-2.5 rounded-md border text-[11px] font-medium" style={{ borderColor: T.HAIRLINE, color: T.SLATE_MUTED, backgroundColor: "white" }}>
            Columns
          </button>
          <button className="h-7 px-2.5 rounded-md text-[11px] font-medium text-white" style={{ backgroundColor: T.NAVY }}>
            Bulk assign
          </button>
        </div>
      </div>

      {/* ⭐ FILTER BAR — anchored as data-tour="invoice-groups-filters" */}
      <div
        data-tour="invoice-groups-filters"
        className="bg-white border rounded-lg p-2 flex items-center gap-1.5 flex-wrap flex-shrink-0"
        style={{ borderColor: T.HAIRLINE }}
      >
        <div className="flex items-center gap-1 px-1.5">
          <Filter className="w-3 h-3" style={{ color: T.SLATE_MUTED }} />
          <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.SLATE_MUTED }}>Filters</span>
        </div>

        {/* Engagement filter — DEFAULT ON, hides resolved/awaiting rows */}
        <button
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-semibold border"
          style={{
            backgroundColor: T.CORAL_BG,
            color: T.CORAL_DARK,
            borderColor: T.CORAL_BD,
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: T.CORAL }} />
          <span>Engagement: Needs engagement</span>
          <ChevronDown className="w-3 h-3 opacity-70" />
        </button>

        <button className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium border bg-white" style={{ color: T.SLATE_MUTED, borderColor: T.HAIRLINE }}>
          Status: All <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
        <button className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium border bg-white" style={{ color: T.SLATE_MUTED, borderColor: T.HAIRLINE }}>
          Outcome: All <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
        <button className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium border bg-white" style={{ color: T.SLATE_MUTED, borderColor: T.HAIRLINE }}>
          Deadline: Any <ChevronDown className="w-3 h-3 opacity-70" />
        </button>

        <div className="h-5 w-px mx-1" style={{ backgroundColor: T.HAIRLINE }} />

        {/* Past-deadline toggle — DEFAULT OFF, hides expired groups */}
        <div className="flex items-center gap-2 h-7 px-2.5 rounded-md border" style={{ backgroundColor: T.AMBER_BG, borderColor: T.AMBER_BD }}>
          <div className="relative h-3.5 w-7 rounded-full" style={{ backgroundColor: T.SLATE_300 }}>
            <div className="absolute top-0.5 left-0.5 h-2.5 w-2.5 rounded-full bg-white shadow" />
          </div>
          <span className="text-[11px] font-semibold" style={{ color: T.AMBER_FG }}>Show past-deadline</span>
          <span className="text-[10px] tabular-nums px-1 py-0.5 rounded font-bold" style={{ backgroundColor: "white", color: T.AMBER_FG, border: `1px solid ${T.AMBER_BD}` }}>
            47 hidden
          </span>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col" style={{ borderColor: T.HAIRLINE }}>
        <div className="grid grid-cols-[110px_70px_1fr_110px_70px] gap-3 px-3 py-2 border-b text-[10px] uppercase tracking-wider font-semibold" style={{ borderColor: T.HAIRLINE, backgroundColor: T.SLATE_50, color: T.SLATE_MUTED }}>
          <span>Group</span><span>Trips</span><span>Status</span><span>Deadline</span><span>Owner</span>
        </div>
        <div className="overflow-hidden flex-1">
          {ROWS.map((r) => (
            <div key={r.id} className="grid grid-cols-[110px_70px_1fr_110px_70px] gap-3 px-3 py-2 border-b items-center" style={{ borderColor: T.HAIRLINE }}>
              <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.NAVY }}>{r.id}</span>
              <span className="text-[12px] tabular-nums" style={{ color: T.SLATE_TEXT }}>{r.trips}</span>
              <span className="inline-flex items-center gap-1.5 self-start text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded w-fit" style={{ backgroundColor: r.bg, color: r.color, border: `1px solid ${r.bd}` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} /> {r.status}
              </span>
              <span className="text-[11px] tabular-nums" style={{ color: T.SLATE_MUTED }}>{r.deadline}</span>
              <span className="text-[11px] font-semibold tabular-nums" style={{ color: r.owner === "—" ? T.SLATE_400 : T.NAVY }}>{r.owner}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
