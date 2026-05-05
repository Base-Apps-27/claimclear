import React from "react";
import { CheckCircle2, Circle, FileText, Upload, MapPin, PenLine } from "lucide-react";
import { T } from "../tokens";

export function ClaimDetail() {
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-semibold leading-tight tabular-nums" style={{ color: T.NAVY, letterSpacing: "-0.01em" }}>
              Car #1042 · 04/12
            </h1>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: T.SKY_BG, color: T.SKY_FG, border: `1px solid ${T.SKY_BD}` }}>
              Investigating
            </span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
            Group <span className="font-semibold" style={{ color: T.NAVY }}>G-4291</span> · <span className="font-semibold tabular-nums" style={{ color: T.SLATE_TEXT }}>$148.00</span> · Error: <span style={{ color: T.AMBER_FG }} className="font-semibold">Wrong distance</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-3 flex-1 min-h-0">
        {/* SOP Player — anchored */}
        <div data-tour="claim-sop-player" className="bg-white border rounded-lg flex flex-col overflow-hidden" style={{ borderColor: T.HAIRLINE }}>
          <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.HAIRLINE, background: `linear-gradient(95deg, ${T.NAVY} 0%, ${T.NAVY_2} 100%)` }}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white">SOP Player</span>
              <span className="text-[10px] text-white/70">Decision tree · Wrong distance</span>
            </div>
            <span className="text-[10px] tabular-nums text-white/70">Step 3 of 5</span>
          </div>

          <div className="p-3 space-y-2 overflow-hidden flex-1">
            <div className="flex items-start gap-2 p-2 rounded-md" style={{ backgroundColor: T.EMERALD_BG, border: `1px solid ${T.EMERALD_BD}` }}>
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: T.EMERALD_FG }} />
              <div className="flex-1">
                <div className="text-[11px] font-semibold" style={{ color: T.EMERALD_FG }}>1. Did MAS quote the wrong distance?</div>
                <div className="text-[10.5px] mt-0.5" style={{ color: T.EMERALD_FG, opacity: 0.85 }}>Yes · MAS quoted 4.2mi, actual 11.8mi</div>
              </div>
            </div>

            <div className="flex items-start gap-2 p-2 rounded-md" style={{ backgroundColor: T.EMERALD_BG, border: `1px solid ${T.EMERALD_BD}` }}>
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: T.EMERALD_FG }} />
              <div className="flex-1">
                <div className="text-[11px] font-semibold" style={{ color: T.EMERALD_FG }}>2. Do we have GPS for the trip?</div>
                <div className="text-[10.5px] mt-0.5" style={{ color: T.EMERALD_FG, opacity: 0.85 }}>Yes · 247 pings, polyline verified</div>
              </div>
            </div>

            <div className="rounded-md p-2.5" style={{ backgroundColor: T.CORAL_BG, border: `2px solid ${T.CORAL}`, boxShadow: `0 4px 14px -4px ${T.CORAL}55` }}>
              <div className="flex items-start gap-2 mb-2">
                <div className="h-3.5 w-3.5 rounded-full flex items-center justify-center mt-0.5 flex-shrink-0" style={{ backgroundColor: T.CORAL }}>
                  <span className="text-[8px] font-bold text-white">3</span>
                </div>
                <div className="flex-1">
                  <div className="text-[11.5px] font-bold" style={{ color: T.CORAL_DARK }}>Does the GPS path match the dispatched address?</div>
                  <div className="text-[10.5px] mt-1" style={{ color: T.SLATE_MUTED }}>Required to prove the distance MAS should have used.</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <button className="flex-1 h-7 rounded-md text-[11px] font-semibold text-white" style={{ background: `linear-gradient(135deg, ${T.EMERALD_FG} 0%, #036647 100%)` }}>
                  Yes — matches
                </button>
                <button className="flex-1 h-7 rounded-md text-[11px] font-semibold border" style={{ backgroundColor: "white", color: T.SLATE_TEXT, borderColor: T.HAIRLINE }}>
                  No / partial
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 p-2 rounded-md border-dashed border" style={{ borderColor: T.SLATE_300, backgroundColor: T.SLATE_50 }}>
              <Circle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: T.SLATE_400 }} />
              <div className="text-[11px] font-semibold" style={{ color: T.SLATE_400 }}>4. Stage proof for submission</div>
            </div>
            <div className="flex items-start gap-2 p-2 rounded-md border-dashed border" style={{ borderColor: T.SLATE_300, backgroundColor: T.SLATE_50 }}>
              <Circle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: T.SLATE_400 }} />
              <div className="text-[11px] font-semibold" style={{ color: T.SLATE_400 }}>5. Mark ready for group submission</div>
            </div>
          </div>
        </div>

        {/* Evidence panel */}
        <div className="bg-white border rounded-lg flex flex-col overflow-hidden" style={{ borderColor: T.HAIRLINE }}>
          <div className="px-3 py-2 border-b" style={{ borderColor: T.HAIRLINE, backgroundColor: T.SLATE_50 }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: T.SLATE_MUTED }}>Evidence</span>
          </div>
          <div className="p-3 space-y-2 overflow-hidden flex-1">
            <div className="flex items-center gap-2 p-2 rounded-md" style={{ backgroundColor: T.SLATE_50, border: `1px solid ${T.HAIRLINE}` }}>
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: T.EMERALD_FG }} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold truncate" style={{ color: T.SLATE_TEXT }}>GPS polyline</div>
                <div className="text-[10px]" style={{ color: T.SLATE_MUTED }}>247 pings · auto-attached</div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-md" style={{ backgroundColor: T.SLATE_50, border: `1px solid ${T.HAIRLINE}` }}>
              <PenLine className="w-3.5 h-3.5 flex-shrink-0" style={{ color: T.EMERALD_FG }} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold truncate" style={{ color: T.SLATE_TEXT }}>Driver signature</div>
                <div className="text-[10px]" style={{ color: T.SLATE_MUTED }}>Verified · 04/12 17:42</div>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-md" style={{ backgroundColor: T.SLATE_50, border: `1px solid ${T.HAIRLINE}` }}>
              <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: T.EMERALD_FG }} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold truncate" style={{ color: T.SLATE_TEXT }}>Dispatch ticket</div>
                <div className="text-[10px]" style={{ color: T.SLATE_MUTED }}>PDF · 1 page</div>
              </div>
            </div>
            <button className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md text-[11px] font-semibold border-dashed border-2" style={{ borderColor: T.SLATE_300, color: T.SLATE_MUTED }}>
              <Upload className="w-3 h-3" /> Attach more
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
