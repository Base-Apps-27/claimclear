import React from "react";
import { CheckCircle2, Circle, ArrowRight, Sparkles } from "lucide-react";
import { T } from "../tokens";

const LEGS = [
  { car: "1042", date: "04/12", amount: "$148.00", err: "Wrong distance" },
  { car: "1108", date: "04/12", amount: "$162.40", err: "Missing signature" },
  { car: "1042", date: "04/13", amount: "$148.00", err: "Wrong distance" },
  { car: "0993", date: "04/13", amount: "$211.00", err: "Wrong code" },
  { car: "1042", date: "04/14", amount: "$148.00", err: "Wrong distance" },
  { car: "1108", date: "04/14", amount: "$128.40", err: "Missing signature" },
  { car: "0987", date: "04/15", amount: "$148.40", err: "Wrong distance" },
];

export function GroupDetail() {
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-semibold leading-tight tabular-nums" style={{ color: T.NAVY, letterSpacing: "-0.01em" }}>
              Group #G-4291
            </h1>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: T.SKY_BG, color: T.SKY_FG, border: `1px solid ${T.SKY_BD}` }}>
              Investigating
            </span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
            7 trips · <span className="font-semibold tabular-nums" style={{ color: T.AMBER_FG }}>$1,094.20</span> at risk · deadline in <span className="font-semibold" style={{ color: T.AMBER_FG }}>12 days</span>
          </div>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="grid grid-cols-[1fr_300px] gap-3 flex-1 min-h-0">
        {/* Legs list */}
        <div className="bg-white border rounded-lg flex flex-col overflow-hidden" style={{ borderColor: T.HAIRLINE }}>
          <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.HAIRLINE, backgroundColor: T.SLATE_50 }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: T.SLATE_MUTED }}>Legs in this group</span>
            <span className="text-[10px] tabular-nums font-bold" style={{ color: T.SLATE_MUTED }}>7 included</span>
          </div>
          <div className="grid grid-cols-[80px_70px_90px_1fr] gap-3 px-3 py-1.5 border-b text-[9.5px] uppercase tracking-wider font-semibold" style={{ borderColor: T.HAIRLINE, color: T.SLATE_MUTED }}>
            <span>Car #</span><span>Date</span><span>Amount</span><span>Error</span>
          </div>
          <div className="overflow-hidden flex-1">
            {LEGS.map((l, i) => (
              <div key={i} className="grid grid-cols-[80px_70px_90px_1fr] gap-3 px-3 py-2 border-b items-center" style={{ borderColor: T.HAIRLINE }}>
                <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.NAVY }}>{l.car}</span>
                <span className="text-[11.5px] tabular-nums" style={{ color: T.SLATE_TEXT }}>{l.date}</span>
                <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.SLATE_TEXT }}>{l.amount}</span>
                <span className="text-[11px]" style={{ color: T.SLATE_MUTED }}>{l.err}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Submission Gauntlet — anchor */}
        <div data-tour="group-gauntlet" className="bg-white border rounded-lg flex flex-col overflow-hidden" style={{ borderColor: T.HAIRLINE }}>
          <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.HAIRLINE, background: `linear-gradient(95deg, ${T.NAVY} 0%, ${T.NAVY_2} 100%)` }}>
            <span className="text-[11px] font-bold uppercase tracking-wider text-white">Submission Gauntlet</span>
            <span className="text-[10px] tabular-nums text-white/70">2 of 4</span>
          </div>

          <div className="p-3 space-y-2 overflow-hidden flex-1">
            {/* Step 1 — done */}
            <div className="flex items-start gap-2 p-2 rounded-md" style={{ backgroundColor: T.EMERALD_BG, border: `1px solid ${T.EMERALD_BD}` }}>
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: T.EMERALD_FG }} />
              <div>
                <div className="text-[11px] font-semibold" style={{ color: T.EMERALD_FG }}>1. Classify</div>
                <div className="text-[10px]" style={{ color: T.EMERALD_FG, opacity: 0.85 }}>All 7 legs assigned an error type</div>
              </div>
            </div>

            {/* Step 2 — done */}
            <div className="flex items-start gap-2 p-2 rounded-md" style={{ backgroundColor: T.EMERALD_BG, border: `1px solid ${T.EMERALD_BD}` }}>
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: T.EMERALD_FG }} />
              <div>
                <div className="text-[11px] font-semibold" style={{ color: T.EMERALD_FG }}>2. Gather evidence</div>
                <div className="text-[10px]" style={{ color: T.EMERALD_FG, opacity: 0.85 }}>GPS, signatures, notes attached</div>
              </div>
            </div>

            {/* Step 3 — current */}
            <div className="rounded-md p-2.5" style={{ backgroundColor: T.CORAL_BG, border: `2px solid ${T.CORAL}`, boxShadow: `0 4px 14px -4px ${T.CORAL}55` }}>
              <div className="flex items-start gap-2">
                <div className="h-3.5 w-3.5 rounded-full flex items-center justify-center mt-0.5 flex-shrink-0" style={{ backgroundColor: T.CORAL }}>
                  <span className="text-[8px] font-bold text-white">3</span>
                </div>
                <div className="flex-1">
                  <div className="text-[11.5px] font-bold" style={{ color: T.CORAL_DARK }}>Generate dispute</div>
                  <div className="text-[10px] mt-0.5" style={{ color: T.SLATE_MUTED }}>Preview of MAS message ready</div>
                </div>
              </div>
              <button className="mt-2 w-full flex items-center justify-center gap-1.5 h-7 rounded-md text-[11px] font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${T.CORAL} 0%, ${T.CORAL_DARK} 100%)`, boxShadow: `0 3px 10px -2px ${T.CORAL}80` }}>
                Generate <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* Step 4 — pending */}
            <div className="flex items-start gap-2 p-2 rounded-md border-dashed border" style={{ borderColor: T.SLATE_300, backgroundColor: T.SLATE_50 }}>
              <Circle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: T.SLATE_400 }} />
              <div>
                <div className="text-[11px] font-semibold" style={{ color: T.SLATE_400 }}>4. Send to MAS</div>
                <div className="text-[10px]" style={{ color: T.SLATE_400 }}>Portal · auto-routed</div>
              </div>
            </div>

            {/* What's Next AI hint */}
            <div className="rounded-md p-2 mt-1" style={{ backgroundColor: "rgba(31,111,235,0.06)", border: `1px solid rgba(31,111,235,0.2)` }}>
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles className="w-3 h-3" style={{ color: T.BRAND_BLUE }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.BRAND_BLUE }}>What's next</span>
              </div>
              <div className="text-[10px] leading-snug" style={{ color: T.SLATE_TEXT }}>
                Generate now — all evidence is in. AI confidence: 92%.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
