import React from "react";
import { ArrowRight, TrendingUp, AlertTriangle, XCircle, Search, Bell, Settings } from "lucide-react";

const NAVY = "#1B2A4A";
const BRAND_BLUE = "#1F6FEB";
const CORAL = "#E0654A";
const AMBER_BG = "#FEF6E0";
const AMBER_FG = "#B45309";
const SKY_FG = "#0369A1";
const EMERALD_BG = "#ECFDF5";
const EMERALD_FG = "#047857";
const EMERALD_BD = "#A7F3D0";
const ROSE_BG = "#FEF2F2";
const ROSE_FG = "#B91C1C";
const ROSE_BD = "#FECACA";
const SLATE_50 = "#F8FAFC";
const SLATE_TEXT = "#0F172A";
const SLATE_MUTED = "#475569";
const HAIRLINE = "#E2E8F0";

const PHASES = [
  { n: 1, label: "Upload",     color: AMBER_FG },
  { n: 2, label: "Understand", color: SKY_FG },
  { n: 3, label: "Gather",     color: EMERALD_FG },
  { n: 4, label: "Submit",     color: CORAL },
  { n: 5, label: "Respond",    color: NAVY },
];

function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6.5L12 3L20 6.5V12C20 16.5 16.5 20 12 21C7.5 20 4 16.5 4 12V6.5Z"
        stroke="white" strokeWidth="1.6" strokeLinejoin="round" fill="rgba(255,255,255,0.08)" />
      <path d="M8.5 12L11 14.5L15.5 9.5" stroke={CORAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PageAnchoredStep() {
  return (
    <div className="min-h-screen w-full font-sans" style={{ backgroundColor: "#F4F6F9", color: SLATE_TEXT }}>
      {/* ============== Live app behind (NOT dimmed — operator needs to see anchor) ============== */}

      {/* Top header */}
      <div className="h-12 bg-white border-b flex items-center justify-between px-5" style={{ borderColor: HAIRLINE }}>
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 rounded-md flex items-center justify-center" style={{ backgroundColor: NAVY }}>
            <Mark size={14} />
          </div>
          <span className="text-[13px] font-semibold tracking-tight" style={{ color: NAVY }}>ClaimClear</span>
          <span className="text-slate-300">/</span>
          <span className="text-[12.5px]" style={{ color: SLATE_MUTED }}>Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 h-8 w-64 rounded-md border px-3" style={{ borderColor: HAIRLINE, backgroundColor: SLATE_50 }}>
            <Search className="w-3.5 h-3.5" style={{ color: SLATE_MUTED }} />
            <span className="text-[12px]" style={{ color: "#94A3B8" }}>Search claims, invoices, riders…</span>
          </div>
          <Bell className="w-4 h-4" style={{ color: SLATE_MUTED }} />
          <Settings className="w-4 h-4" style={{ color: SLATE_MUTED }} />
          <div className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white" style={{ backgroundColor: BRAND_BLUE }}>JM</div>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className="w-56 border-r bg-white py-4 px-3 flex flex-col gap-1 min-h-[600px]" style={{ borderColor: HAIRLINE }}>
          <div className="text-[10px] uppercase tracking-widest font-semibold mb-1 px-2" style={{ color: "#94A3B8" }}>Today</div>
          {[
            { label: "Dashboard",   active: true,  badge: null },
            { label: "Queue",       active: false, badge: { v: "184", color: SKY_FG, bg: "#E0F2FE" } },
            { label: "Responses",   active: false, badge: { v: "23",  color: CORAL,  bg: "#FDECE6" } },
            { label: "Attestation", active: false, badge: { v: "7",   color: AMBER_FG, bg: AMBER_BG } },
          ].map((item) => (
            <div key={item.label}
              className="flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-medium"
              style={{
                backgroundColor: item.active ? "rgba(31,111,235,0.08)" : "transparent",
                color: item.active ? BRAND_BLUE : SLATE_TEXT,
              }}>
              <span>{item.label}</span>
              {item.badge && (
                <span className="text-[10.5px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ backgroundColor: item.badge.bg, color: item.badge.color }}>
                  {item.badge.v}
                </span>
              )}
            </div>
          ))}
          <div className="text-[10px] uppercase tracking-widest font-semibold mb-1 mt-3 px-2" style={{ color: "#94A3B8" }}>Browse</div>
          {["Invoices", "Groups", "Trips", "Submissions"].map((l) => (
            <div key={l} className="px-2.5 py-1.5 text-[13px]" style={{ color: SLATE_MUTED }}>{l}</div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 p-6 relative">
          {/* Page title */}
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h1 className="text-[22px] font-semibold leading-tight" style={{ color: SLATE_TEXT, letterSpacing: "-0.01em" }}>
                Dashboard
              </h1>
              <div className="text-[12.5px] mt-0.5" style={{ color: SLATE_MUTED }}>
                The money model · last updated 2 minutes ago
              </div>
            </div>
            <div className="flex gap-2">
              <button className="h-8 px-3 rounded-md border text-[12px] font-medium" style={{ borderColor: HAIRLINE, color: SLATE_MUTED, backgroundColor: "white" }}>
                This week
              </button>
              <button className="h-8 px-3 rounded-md text-[12px] font-medium text-white" style={{ backgroundColor: NAVY }}>
                Export
              </button>
            </div>
          </div>

          {/* ============== KPI strip — THE TOUR TARGET ============== */}
          <div className="relative">
            {/* Coral halo around the target */}
            <div
              className="absolute -inset-2 rounded-2xl pointer-events-none"
              style={{
                boxShadow: `0 0 0 2px ${CORAL}, 0 0 0 8px rgba(224,101,74,0.15), 0 16px 40px -12px rgba(224,101,74,0.35)`,
              }}
            />
            {/* "Tour anchor" tag */}
            <div
              className="absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-widest font-bold text-white"
              style={{ backgroundColor: CORAL }}
            >
              Step 9 · You are here
            </div>

            <div className="relative z-[1] grid grid-cols-3 gap-3 bg-white border rounded-xl p-4" style={{ borderColor: HAIRLINE }}>
              {/* At risk */}
              <div className="rounded-lg p-4 border" style={{ backgroundColor: ROSE_BG, borderColor: ROSE_BD }}>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-3.5 h-3.5" style={{ color: ROSE_FG }} />
                  <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: ROSE_FG }}>At risk</div>
                </div>
                <div className="text-[26px] font-semibold tabular-nums leading-none" style={{ color: ROSE_FG }}>$3,205</div>
                <div className="text-[11.5px] mt-2" style={{ color: SLATE_MUTED }}>27 groups in flight</div>
              </div>
              {/* Already lost */}
              <div className="rounded-lg p-4 border" style={{ backgroundColor: SLATE_50, borderColor: HAIRLINE }}>
                <div className="flex items-center gap-2 mb-3">
                  <XCircle className="w-3.5 h-3.5" style={{ color: SLATE_MUTED }} />
                  <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: SLATE_MUTED }}>Already lost</div>
                </div>
                <div className="text-[26px] font-semibold tabular-nums leading-none" style={{ color: SLATE_TEXT }}>$1,108</div>
                <div className="text-[11.5px] mt-2" style={{ color: SLATE_MUTED }}>12 expired or denied</div>
              </div>
              {/* Reclaimed */}
              <div className="rounded-lg p-4 border" style={{ backgroundColor: EMERALD_BG, borderColor: EMERALD_BD }}>
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-3.5 h-3.5" style={{ color: EMERALD_FG }} />
                  <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: EMERALD_FG }}>Reclaimed MTD</div>
                </div>
                <div className="text-[26px] font-semibold tabular-nums leading-none" style={{ color: EMERALD_FG }}>$48,210</div>
                <div className="text-[11.5px] mt-2" style={{ color: SLATE_MUTED }}>211 groups recovered</div>
              </div>
            </div>
          </div>

          {/* Faded "Today's work" placeholder so the page doesn't feel empty */}
          <div className="mt-8 grid grid-cols-4 gap-3 opacity-50 pointer-events-none">
            {["File today","Stuck after submit","Respond","Re-attest"].map((c) => (
              <div key={c} className="bg-white border rounded-lg p-3 h-32" style={{ borderColor: HAIRLINE }}>
                <div className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: SLATE_MUTED }}>{c}</div>
                <div className="mt-3 space-y-1.5">
                  {[1,2,3].map(i => <div key={i} className="h-3 rounded" style={{ backgroundColor: SLATE_50 }} />)}
                </div>
              </div>
            ))}
          </div>

          {/* ============== Tour card — anchored below the KPI strip ============== */}
          <div className="absolute z-20" style={{ top: 220, left: 32 }}>
            {/* Pointer notch (coral, points up at the KPI strip) */}
            <div className="relative w-full flex justify-start ml-12 -mb-px">
              <div
                className="w-0 h-0"
                style={{
                  borderLeft: "9px solid transparent",
                  borderRight: "9px solid transparent",
                  borderBottom: `9px solid ${CORAL}`,
                }}
              />
            </div>

            <div
              className="w-[460px] rounded-2xl bg-white overflow-hidden flex flex-col"
              style={{
                boxShadow:
                  "0 24px 64px -16px rgba(27,42,74,0.30), 0 8px 24px -12px rgba(27,42,74,0.20), 0 0 0 1px rgba(27,42,74,0.06)",
              }}
            >
              {/* Top accent stripe */}
              <div
                className="h-[3px] w-full"
                style={{
                  background: `linear-gradient(90deg, ${CORAL} 0%, ${CORAL} 30%, ${BRAND_BLUE} 70%, ${NAVY} 100%)`,
                }}
              />

              {/* Header band */}
              <div
                className="h-9 px-4 flex items-center justify-between text-white"
                style={{ background: `linear-gradient(95deg, ${NAVY} 0%, #233560 60%, #2A3F6E 100%)` }}
              >
                <div className="flex items-center gap-2">
                  <Mark size={14} />
                  <span className="text-[11.5px] font-semibold tracking-wide">ClaimClear</span>
                  <span className="text-white/40">·</span>
                  <span className="text-[10px] uppercase tracking-widest text-white/70">Tour</span>
                </div>
                <div className="text-[10.5px] tabular-nums text-white/70">Step 9 of 14</div>
              </div>

              {/* Body */}
              <div className="px-5 pt-4 pb-3 flex flex-col gap-3">
                {/* Cross-reference badge — connects back to the process model */}
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider"
                    style={{ color: NAVY, backgroundColor: "#EEF1F8", border: `1px solid ${NAVY}25` }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: NAVY }} />
                    Process Step 5 · Respond
                  </span>
                  <span className="text-[10.5px] font-medium" style={{ color: SLATE_MUTED }}>
                    in the app
                  </span>
                </div>

                <h2 className="text-[18px] font-semibold leading-tight" style={{ color: SLATE_TEXT, letterSpacing: "-0.01em" }}>
                  Dashboard — the money model
                </h2>

                <p className="text-[13.5px] leading-[1.55]" style={{ color: SLATE_MUTED }}>
                  Every group lands in exactly one bucket:{" "}
                  <span className="font-semibold" style={{ color: ROSE_FG }}>At risk</span> (in flight),{" "}
                  <span className="font-semibold" style={{ color: SLATE_TEXT }}>Already lost</span> (expired or denied), or{" "}
                  <span className="font-semibold" style={{ color: EMERALD_FG }}>Reclaimed</span> (approved).
                  The numbers always reconcile, so you can trust the totals — this is how you see Step 5 outcomes adding up over time.
                </p>
              </div>

              {/* Footer */}
              <div className="px-5 pb-4 pt-1 flex flex-col gap-3">
                {/* Compact phase pipeline (5 dots) */}
                <div className="flex items-center gap-1">
                  {PHASES.map((p, idx) => {
                    const isCurrent = p.n === 5;
                    const isDone = p.n < 5;
                    return (
                      <React.Fragment key={p.n}>
                        <div className="flex items-center gap-1">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor: isDone || isCurrent ? p.color : "#CBD5E1",
                              boxShadow: isCurrent ? `0 0 0 3px ${p.color}33` : "none",
                            }}
                          />
                          <span className="text-[10px] font-medium" style={{ color: isCurrent ? p.color : isDone ? SLATE_MUTED : "#94A3B8" }}>
                            {p.label}
                          </span>
                        </div>
                        {idx < PHASES.length - 1 && <span className="text-slate-300 text-[10px] mx-0.5">·</span>}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: HAIRLINE }}>
                  <button className="text-[12px] font-medium" style={{ color: SLATE_MUTED }}>Skip tour</button>
                  <div className="flex items-center gap-1.5">
                    <button className="px-3 py-1.5 text-[12px] font-medium rounded-md" style={{ color: SLATE_MUTED }}>
                      Back
                    </button>
                    <button
                      className="flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-semibold text-white rounded-md"
                      style={{
                        background: `linear-gradient(135deg, ${CORAL} 0%, #D04F32 100%)`,
                        boxShadow: `0 4px 12px -2px ${CORAL}80, 0 1px 2px -1px rgba(208,79,50,0.3)`,
                      }}
                    >
                      <span>Next: Today's work</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
