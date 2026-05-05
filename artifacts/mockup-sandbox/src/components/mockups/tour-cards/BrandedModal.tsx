import React from "react";
import { ArrowRight, ArrowUpRight, Mail, Globe, CheckCircle2, FileText } from "lucide-react";

const NAVY = "#1B2A4A";
const BRAND_BLUE = "#1F6FEB";
const CORAL = "#E0654A";
const AMBER_BG = "#FEF6E0";
const AMBER_FG = "#B45309";
const AMBER_BD = "#F4D38A";
const SKY_BG = "#E0F2FE";
const SKY_FG = "#0369A1";
const EMERALD_BG = "#ECFDF5";
const EMERALD_FG = "#047857";
const EMERALD_BD = "#A7F3D0";
const ROSE_BG = "#FEF2F2";
const ROSE_FG = "#B91C1C";
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

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6.5L12 3L20 6.5V12C20 16.5 16.5 20 12 21C7.5 20 4 16.5 4 12V6.5Z"
        stroke="white" strokeWidth="1.6" strokeLinejoin="round" fill="rgba(255,255,255,0.08)" />
      <path d="M8.5 12L11 14.5L15.5 9.5" stroke={CORAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandedModal() {
  return (
    <div
      className="min-h-screen w-full relative flex items-center justify-center font-sans overflow-hidden"
      style={{ background: "linear-gradient(180deg, #F4F6F9 0%, #ECF0F5 100%)" }}
    >
      {/* ---------- Faded app behind the modal (with actual color, not greyscale) ---------- */}
      <div className="absolute inset-0 z-0 pointer-events-none flex flex-col gap-5 p-8" style={{ opacity: 0.32 }}>
        {/* top bar */}
        <div className="h-11 bg-white border border-[#E2E8F0] rounded-md shadow-sm flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: NAVY }} />
            <div className="h-3 w-28 rounded" style={{ backgroundColor: "#CBD5E1" }} />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-20 rounded-full" style={{ backgroundColor: AMBER_BG, border: `1px solid ${AMBER_BD}` }} />
            <div className="h-6 w-16 rounded-full" style={{ backgroundColor: EMERALD_BG, border: `1px solid ${EMERALD_BD}` }} />
            <div className="h-6 w-6 rounded-full" style={{ backgroundColor: BRAND_BLUE }} />
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Open disputes", color: NAVY,        value: "184" },
            { label: "Owed",          color: AMBER_FG,    value: "$12,480" },
            { label: "Reclaimed MTD", color: EMERALD_FG,  value: "$48,210" },
            { label: "At risk",       color: ROSE_FG,     value: "$3,205" },
          ].map((k) => (
            <div key={k.label} className="h-28 bg-white rounded-lg border border-[#E2E8F0] shadow-sm p-4 flex flex-col justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: k.color }} />
                <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: SLATE_MUTED }}>
                  {k.label}
                </div>
              </div>
              <div className="text-2xl font-semibold tabular-nums" style={{ color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Queue table hint */}
        <div className="flex-1 bg-white border border-[#E2E8F0] rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="h-4 w-40 rounded" style={{ backgroundColor: "#CBD5E1" }} />
            <div className="flex gap-2">
              <div className="h-6 w-20 rounded" style={{ backgroundColor: SKY_BG }} />
              <div className="h-6 w-20 rounded" style={{ backgroundColor: AMBER_BG }} />
            </div>
          </div>
          <div className="space-y-2">
            {[
              { pillBg: AMBER_BG,   pillW: 14 },
              { pillBg: EMERALD_BG, pillW: 16 },
              { pillBg: ROSE_BG,    pillW: 12 },
              { pillBg: SKY_BG,     pillW: 18 },
              { pillBg: AMBER_BG,   pillW: 14 },
              { pillBg: EMERALD_BG, pillW: 16 },
            ].map((row, i) => (
              <div key={i} className="h-10 rounded flex items-center px-3 gap-3" style={{ backgroundColor: i % 2 ? "#F8FAFC" : "white", border: `1px solid ${HAIRLINE}` }}>
                <div className="h-3 w-3 rounded-sm bg-slate-200" />
                <div className="h-2.5 w-32 rounded bg-slate-200" />
                <div className="h-2.5 w-24 rounded bg-slate-200" />
                <div className="ml-auto flex items-center gap-2">
                  <div className="h-5 rounded-full" style={{ width: row.pillW * 4, backgroundColor: row.pillBg }} />
                  <div className="h-2.5 w-12 rounded bg-slate-200 tabular-nums" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Subtle radial spotlight focuses the eye on the modal */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(27,42,74,0) 0%, rgba(27,42,74,0.06) 55%, rgba(27,42,74,0.18) 100%)",
        }}
      />

      {/* ---------- Modal ---------- */}
      <div
        className="relative z-10 w-[760px] max-w-[94vw] rounded-2xl bg-white overflow-hidden flex flex-col"
        style={{
          boxShadow:
            "0 24px 64px -16px rgba(27,42,74,0.28), 0 8px 24px -12px rgba(27,42,74,0.18), 0 0 0 1px rgba(27,42,74,0.06)",
        }}
      >
        {/* Top accent stripe (coral → blue gradient) */}
        <div
          className="h-[3px] w-full"
          style={{
            background: `linear-gradient(90deg, ${CORAL} 0%, ${CORAL} 30%, ${BRAND_BLUE} 70%, ${NAVY} 100%)`,
          }}
        />

        {/* Header band */}
        <div
          className="h-11 px-5 flex items-center justify-between text-white"
          style={{
            background: `linear-gradient(95deg, ${NAVY} 0%, #233560 60%, #2A3F6E 100%)`,
          }}
        >
          <div className="flex items-center gap-2.5">
            <Mark />
            <span className="text-[13px] font-semibold tracking-wide">ClaimClear</span>
            <span className="text-white/40">·</span>
            <span className="text-[11px] uppercase tracking-widest text-white/70">Onboarding</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/70">
            <span className="tabular-nums">about 90 sec left</span>
          </div>
        </div>

        {/* Body — two columns */}
        <div className="grid grid-cols-[1fr_280px] gap-8 px-8 pt-5 pb-4">
          {/* Left: badge + title + copy */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: CORAL, backgroundColor: "#FDECE6", border: `1px solid #F6C7B6` }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: CORAL }} />
                Step 4 · Submit
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: SLATE_MUTED }}>
                Process orientation · 4 of 5
              </span>
            </div>

            <h2 className="text-[26px] font-semibold leading-[1.15]" style={{ color: SLATE_TEXT, letterSpacing: "-0.01em" }}>
              Submit the dispute
            </h2>

            <p className="text-[14.5px] leading-[1.55]" style={{ color: SLATE_MUTED, maxWidth: "52ch" }}>
              Once fact-finding produces clean evidence, submit the dispute to MAS — either through the payor portal or by email,
              depending on what each invoice requires.{" "}
              <span style={{ color: SLATE_TEXT, fontWeight: 500 }}>The app routes you to the right channel.</span>
            </p>

            {/* "What happens next" mini callout */}
            <div className="flex items-start gap-2.5 rounded-lg px-3 py-2"
              style={{ backgroundColor: EMERALD_BG, border: `1px solid ${EMERALD_BD}` }}>
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: EMERALD_FG }} />
              <div className="text-[12.5px] leading-snug" style={{ color: EMERALD_FG }}>
                After submission, the dispute moves to{" "}
                <span className="font-semibold">Responses Awaiting Review</span> — that's the next stop.
              </div>
            </div>
          </div>

          {/* Right: contextual visual — the routing concept */}
          <div className="flex flex-col gap-3">
            <div className="text-[10.5px] uppercase tracking-widest font-semibold" style={{ color: SLATE_MUTED }}>
              Routing
            </div>

            {/* Source */}
            <div className="rounded-lg border bg-white p-3 flex items-center gap-2.5"
              style={{ borderColor: HAIRLINE }}>
              <div className="h-8 w-8 rounded-md flex items-center justify-center"
                style={{ backgroundColor: "#EEF2FF", color: BRAND_BLUE }}>
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold truncate" style={{ color: SLATE_TEXT }}>Clean evidence packet</div>
                <div className="text-[10.5px]" style={{ color: SLATE_MUTED }}>Ready to send</div>
              </div>
            </div>

            {/* Connector */}
            <div className="flex items-center justify-center -my-1">
              <svg width="40" height="20" viewBox="0 0 40 20" fill="none" aria-hidden>
                <path d="M20 0 L10 12 M20 0 L30 12 M20 0 V18" stroke={CORAL} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 3" />
              </svg>
            </div>

            {/* Two channels */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-2.5 flex flex-col items-start gap-1.5 relative overflow-hidden"
                style={{ borderColor: CORAL, backgroundColor: "#FDECE6" }}>
                <div className="absolute top-0 right-0 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-bl-md"
                  style={{ backgroundColor: CORAL, color: "white" }}>
                  Portal
                </div>
                <Globe className="w-4 h-4 mt-0.5" style={{ color: CORAL }} />
                <div className="text-[11px] font-semibold leading-tight" style={{ color: NAVY }}>MAS Portal</div>
                <div className="text-[10px] leading-tight" style={{ color: SLATE_MUTED }}>Web submission</div>
              </div>
              <div className="rounded-lg border p-2.5 flex flex-col items-start gap-1.5 relative overflow-hidden"
                style={{ borderColor: HAIRLINE, backgroundColor: "white" }}>
                <div className="absolute top-0 right-0 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-bl-md"
                  style={{ backgroundColor: SKY_BG, color: SKY_FG }}>
                  Email
                </div>
                <Mail className="w-4 h-4 mt-0.5" style={{ color: SKY_FG }} />
                <div className="text-[11px] font-semibold leading-tight" style={{ color: NAVY }}>Outlook</div>
                <div className="text-[10px] leading-tight" style={{ color: SLATE_MUTED }}>Channel-specific</div>
              </div>
            </div>

            <div className="mt-1 flex items-center gap-1.5 text-[10.5px]" style={{ color: SLATE_MUTED }}>
              <ArrowUpRight className="w-3 h-3" style={{ color: CORAL }} />
              <span>Channel chosen per invoice</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-5 pt-1 flex flex-col gap-3.5">
          {/* Phase pipeline (5 colored chips) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              {PHASES.map((p, idx) => {
                const isCurrent = p.n === 4;
                const isDone = p.n < 4;
                const isPending = p.n > 4;
                return (
                  <React.Fragment key={p.n}>
                    <div
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
                      style={{
                        backgroundColor: isCurrent ? p.color : isDone ? "white" : "#F1F5F9",
                        color: isCurrent ? "white" : isDone ? p.color : "#94A3B8",
                        border: `1px solid ${isCurrent ? p.color : isDone ? p.color + "55" : "transparent"}`,
                        boxShadow: isCurrent ? `0 4px 12px -2px ${p.color}66` : "none",
                      }}
                    >
                      <span
                        className="h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold tabular-nums"
                        style={{
                          backgroundColor: isCurrent ? "rgba(255,255,255,0.25)" : isDone ? p.color : "transparent",
                          color: isCurrent ? "white" : isDone ? "white" : "#94A3B8",
                          border: isPending ? `1px solid #CBD5E1` : "none",
                        }}
                      >
                        {isDone ? "✓" : p.n}
                      </span>
                      <span className={isPending ? "" : ""}>{p.label}</span>
                    </div>
                    {idx < PHASES.length - 1 && (
                      <div
                        className="h-px w-3"
                        style={{ backgroundColor: idx < 3 ? PHASES[idx].color + "66" : "#E2E8F0" }}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="text-[10.5px] uppercase tracking-wider font-medium" style={{ color: SLATE_MUTED }}>
              Step 4 of 14 in the full tour
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: HAIRLINE }}>
            <button
              className="text-[13px] font-medium transition-colors"
              style={{ color: SLATE_MUTED }}
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              <button
                className="px-4 py-2 text-[13px] font-medium rounded-md transition-colors"
                style={{ color: SLATE_MUTED, backgroundColor: "transparent" }}
              >
                Back
              </button>
              <button
                className="flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-semibold text-white rounded-md transition-all"
                style={{
                  background: `linear-gradient(135deg, ${CORAL} 0%, #D04F32 100%)`,
                  boxShadow: `0 6px 16px -4px ${CORAL}80, 0 2px 4px -1px rgba(208,79,50,0.3)`,
                }}
              >
                <span>Next: Read the response</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
