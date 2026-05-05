import React from "react";
import { AlertTriangle, XCircle, TrendingUp } from "lucide-react";
import { T } from "../tokens";

export function Dashboard() {
  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Title row */}
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="text-[18px] font-semibold leading-tight" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>
            Dashboard
          </h1>
          <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
            The money model · last updated 2 minutes ago
          </div>
        </div>
        <div className="flex gap-1.5">
          <button className="h-7 px-2.5 rounded-md border text-[11px] font-medium" style={{ borderColor: T.HAIRLINE, color: T.SLATE_MUTED, backgroundColor: "white" }}>
            This week
          </button>
          <button className="h-7 px-2.5 rounded-md text-[11px] font-medium text-white" style={{ backgroundColor: T.NAVY }}>
            Export
          </button>
        </div>
      </div>

      {/* KPI strip — data-tour="dashboard-kpis" */}
      <div data-tour="dashboard-kpis" className="grid grid-cols-3 gap-2 bg-white border rounded-xl p-3 flex-shrink-0" style={{ borderColor: T.HAIRLINE }}>
        <div className="rounded-lg p-3 border" style={{ backgroundColor: T.ROSE_BG, borderColor: T.ROSE_BD }}>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-3 h-3" style={{ color: T.ROSE_FG }} />
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.ROSE_FG }}>At risk</div>
          </div>
          <div className="text-[20px] font-semibold tabular-nums leading-none" style={{ color: T.ROSE_FG }}>$3,205</div>
          <div className="text-[10.5px] mt-1.5" style={{ color: T.SLATE_MUTED }}>27 groups in flight</div>
        </div>
        <div className="rounded-lg p-3 border" style={{ backgroundColor: T.SLATE_50, borderColor: T.HAIRLINE }}>
          <div className="flex items-center gap-1.5 mb-2">
            <XCircle className="w-3 h-3" style={{ color: T.SLATE_MUTED }} />
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.SLATE_MUTED }}>Already lost</div>
          </div>
          <div className="text-[20px] font-semibold tabular-nums leading-none" style={{ color: T.SLATE_TEXT }}>$1,108</div>
          <div className="text-[10.5px] mt-1.5" style={{ color: T.SLATE_MUTED }}>12 expired or denied</div>
        </div>
        <div className="rounded-lg p-3 border" style={{ backgroundColor: T.EMERALD_BG, borderColor: T.EMERALD_BD }}>
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3 h-3" style={{ color: T.EMERALD_FG }} />
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.EMERALD_FG }}>Reclaimed MTD</div>
          </div>
          <div className="text-[20px] font-semibold tabular-nums leading-none" style={{ color: T.EMERALD_FG }}>$48,210</div>
          <div className="text-[10.5px] mt-1.5" style={{ color: T.SLATE_MUTED }}>211 groups recovered</div>
        </div>
      </div>

      {/* Today's work — data-tour="dashboard-today" */}
      <div data-tour="dashboard-today" className="grid grid-cols-4 gap-2 flex-1 min-h-0">
        {[
          { title: "File today",         color: T.EMERALD_FG, count: 8,  bg: T.EMERALD_BG, bd: T.EMERALD_BD },
          { title: "Stuck after submit", color: T.AMBER_FG,   count: 3,  bg: T.AMBER_BG,   bd: T.AMBER_BD },
          { title: "Respond",            color: T.CORAL,      count: 12, bg: T.CORAL_BG,   bd: T.CORAL_BD },
          { title: "Re-attest",          color: T.NAVY,       count: 5,  bg: "white",      bd: T.HAIRLINE },
        ].map((c) => (
          <div key={c.title} className="bg-white border rounded-lg p-2.5 flex flex-col gap-1.5 min-h-0" style={{ borderColor: T.HAIRLINE }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: c.color }}>
                {c.title}
              </span>
              <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.bd}` }}>
                {c.count}
              </span>
            </div>
            <div className="space-y-1 mt-1 overflow-hidden">
              {Array.from({ length: c.count > 0 ? Math.min(c.count, 4) : 0 }).map((_, i) => (
                <div key={i} className="h-6 rounded flex items-center px-2 gap-1.5" style={{ backgroundColor: T.SLATE_50, border: `1px solid ${T.HAIRLINE}` }}>
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                  <div className="h-1.5 w-16 rounded" style={{ backgroundColor: T.SLATE_300 }} />
                  <div className="ml-auto h-1.5 w-10 rounded" style={{ backgroundColor: T.SLATE_300 }} />
                </div>
              ))}
              {c.count === 0 && (
                <div className="text-[10.5px] py-2 text-center" style={{ color: T.SLATE_400 }}>Clean lane</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
