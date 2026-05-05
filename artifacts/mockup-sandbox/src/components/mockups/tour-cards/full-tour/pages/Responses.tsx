import React from "react";
import { CheckCircle2, XCircle, ArrowRight, Mail } from "lucide-react";
import { T } from "../tokens";

export function Responses() {
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="text-[18px] font-semibold leading-tight" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>
            Responses Awaiting Review
          </h1>
          <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
            23 responses · oldest 2 days old
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[200px_1fr_220px] gap-2 flex-1 min-h-0">
        {/* Left list */}
        <div className="bg-white border rounded-lg overflow-hidden flex flex-col" style={{ borderColor: T.HAIRLINE }}>
          <div className="px-2.5 py-1.5 border-b text-[10px] uppercase tracking-wider font-semibold" style={{ borderColor: T.HAIRLINE, color: T.SLATE_MUTED, backgroundColor: T.SLATE_50 }}>
            Thread
          </div>
          <div className="overflow-hidden flex-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="px-2.5 py-2 border-b flex items-start gap-2" style={{
                borderColor: T.HAIRLINE,
                backgroundColor: i === 1 ? "rgba(31,111,235,0.08)" : "white",
              }}>
                <Mail className="w-3 h-3 mt-0.5" style={{ color: i === 1 ? T.BRAND_BLUE : T.SLATE_MUTED }} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="h-1.5 w-24 rounded" style={{ backgroundColor: T.SLATE_300 }} />
                  <div className="h-1.5 w-16 rounded" style={{ backgroundColor: T.SLATE_300, opacity: 0.6 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Middle: AI read */}
        <div className="bg-white border rounded-lg flex flex-col overflow-hidden" style={{ borderColor: T.HAIRLINE }}>
          <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: T.HAIRLINE }}>
            <div>
              <div className="text-[12px] font-semibold" style={{ color: T.SLATE_TEXT }}>Group #G-4291 · MAS response</div>
              <div className="text-[10px]" style={{ color: T.SLATE_MUTED }}>Received 4h ago · $284 at stake</div>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ backgroundColor: T.EMERALD_BG, color: T.EMERALD_FG, border: `1px solid ${T.EMERALD_BD}` }}>
              AI: approve
            </div>
          </div>
          <div className="p-3 space-y-2 overflow-hidden flex-1">
            <div className="rounded p-2.5" style={{ backgroundColor: T.SLATE_50, border: `1px solid ${T.HAIRLINE}` }}>
              <div className="text-[10px] uppercase font-semibold mb-1.5 tracking-wider" style={{ color: T.SLATE_MUTED }}>MAS reply</div>
              <div className="space-y-1">
                <div className="h-1.5 w-full rounded" style={{ backgroundColor: T.SLATE_300 }} />
                <div className="h-1.5 w-full rounded" style={{ backgroundColor: T.SLATE_300 }} />
                <div className="h-1.5 w-3/4 rounded" style={{ backgroundColor: T.SLATE_300 }} />
              </div>
            </div>
            <div className="rounded p-2.5" style={{ backgroundColor: T.EMERALD_BG, border: `1px solid ${T.EMERALD_BD}` }}>
              <div className="text-[10px] uppercase font-semibold mb-1.5 tracking-wider" style={{ color: T.EMERALD_FG }}>AI summary</div>
              <div className="space-y-1">
                <div className="h-1.5 w-full rounded" style={{ backgroundColor: T.EMERALD_FG, opacity: 0.4 }} />
                <div className="h-1.5 w-5/6 rounded" style={{ backgroundColor: T.EMERALD_FG, opacity: 0.4 }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right: verdict */}
        <div className="bg-white border rounded-lg p-3 flex flex-col gap-2" style={{ borderColor: T.HAIRLINE }}>
          <div className="text-[10px] uppercase font-semibold tracking-wider mb-1" style={{ color: T.SLATE_MUTED }}>Decide now</div>
          <button className="flex items-center justify-center gap-1.5 h-9 rounded-md text-[12px] font-semibold text-white" style={{ backgroundColor: T.EMERALD_FG }}>
            <CheckCircle2 className="w-3.5 h-3.5" /> Re-attest
          </button>
          <button className="flex items-center justify-center gap-1.5 h-9 rounded-md text-[12px] font-semibold" style={{ backgroundColor: "white", color: T.NAVY, border: `1px solid ${T.HAIRLINE}` }}>
            <ArrowRight className="w-3.5 h-3.5" /> Queue at station
          </button>
          <button className="flex items-center justify-center gap-1.5 h-8 rounded-md text-[11px] font-medium" style={{ backgroundColor: "white", color: T.ROSE_FG, border: `1px solid ${T.ROSE_BD}` }}>
            <XCircle className="w-3 h-3" /> Mark lost
          </button>
        </div>
      </div>
    </div>
  );
}
