// Custom Joyride tooltip component for the ClaimClear admin tour (V2).
//
// Joyride v3 lets us swap its default tooltip for any React component
// via the `tooltipComponent` prop. The component receives
// `TooltipRenderProps` — most importantly `step.data` (our own
// `TourStepDef` carrying kind/page/processStep) and the spread-able
// `backProps` / `primaryProps` / `skipProps` that wire the buttons we
// render into Joyride's actual Back / Next / Skip lifecycle.
//
// This file is the production graduation of the canvas mockup at
// artifacts/mockup-sandbox/src/components/mockups/tour-cards/full-tour/TourCard.tsx
// — same brand chrome (accent stripe, navy header band, phase pill,
// pipeline) and the same framer-motion entrance/exit animations. The
// elaborate halo positioning the mockup did manually is dropped here
// because Joyride handles the spotlight + arrow itself; we just render
// the card content and let Joyride place us.

import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Globe, Mail, FileText, ArrowUpRight } from "lucide-react";
// Animation policy (per user feedback May 5):
// The card must fade in AS A SINGLE UNIT. Previously the outer wrapper
// was static while inner pieces (phase-pipeline pills) animated their
// fill color and box-shadow on each step change — which read as
// "individual parts of the card transitioning separately" rather than
// one cohesive card change. We now do the inverse:
//   • OUTER wrapper (ModalCard / CoachCard): one motion.div fade-in
//     (opacity 0→1, ~220ms, ease-out). Joyride re-mounts the
//     tooltipComponent on every step, so this fade fires once per
//     step transition — the user perceives "the whole card faded in",
//     which is the requested behavior.
//   • INNER PhasePipeline atoms: plain divs / spans. Static styles
//     derived from `current` at render time, no `animate` prop, no
//     framer transition. They simply ARE in their step state when
//     the card mounts — they don't independently move.
import type { TooltipRenderProps } from "react-joyride";
import type { ProcessStepValue, TourStepDef } from "./tour-config";

// ─────────────────────────────────────────────────────────────────────
// Brand tokens (mirrored from the mockup so the card looks identical
// in both the canvas sandbox and production).
// ─────────────────────────────────────────────────────────────────────
const T = {
  NAVY: "#1B2A4A",
  NAVY_2: "#233560",
  NAVY_3: "#2A3F6E",
  BRAND_BLUE: "#1F6FEB",
  CORAL: "#E0654A",
  CORAL_DARK: "#D04F32",
  CORAL_BG: "#FDECE6",
  CORAL_BD: "#F6C7B6",
  AMBER_FG: "#B45309",
  SKY_FG: "#0369A1",
  SKY_BG: "#E0F2FE",
  EMERALD_BG: "#ECFDF5",
  EMERALD_FG: "#047857",
  EMERALD_BD: "#A7F3D0",
  SLATE_50: "#F8FAFC",
  SLATE_TEXT: "#0F172A",
  SLATE_MUTED: "#475569",
  SLATE_300: "#CBD5E1",
  SLATE_400: "#94A3B8",
  HAIRLINE: "#E2E8F0",
} as const;

const PHASES = [
  { n: 1 as const, label: "Upload",     color: T.AMBER_FG },
  { n: 2 as const, label: "Understand", color: T.SKY_FG },
  { n: 3 as const, label: "Gather",     color: T.EMERALD_FG },
  { n: 4 as const, label: "Submit",     color: T.CORAL },
  { n: 5 as const, label: "Respond",    color: T.NAVY },
];

function phaseColor(s: ProcessStepValue): string {
  if (s === 1) return T.AMBER_FG;
  if (s === 2) return T.SKY_FG;
  if (s === 3) return T.EMERALD_FG;
  if (s === 4) return T.CORAL;
  if (s === 5) return T.NAVY;
  return T.CORAL;
}

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ─────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────
function Mark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6.5L12 3L20 6.5V12C20 16.5 16.5 20 12 21C7.5 20 4 16.5 4 12V6.5Z"
        stroke="white" strokeWidth="1.6" strokeLinejoin="round" fill="rgba(255,255,255,0.08)" />
      <path d="M8.5 12L11 14.5L15.5 9.5" stroke={T.CORAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AccentStripe() {
  return (
    <div className="h-[3px] w-full"
      style={{ background: `linear-gradient(90deg, ${T.CORAL} 0%, ${T.CORAL} 30%, ${T.BRAND_BLUE} 70%, ${T.NAVY} 100%)` }}
    />
  );
}

function HeaderBand({ stepLabel }: { stepLabel: string }) {
  return (
    <div className="h-9 px-4 flex items-center justify-between text-white"
      style={{ background: `linear-gradient(95deg, ${T.NAVY} 0%, ${T.NAVY_2} 60%, ${T.NAVY_3} 100%)` }}>
      <div className="flex items-center gap-2">
        <Mark size={13} />
        <span className="text-[11.5px] font-semibold tracking-wide">ClaimClear</span>
        <span className="text-white/40">·</span>
        <span className="text-[10px] uppercase tracking-widest text-white/70">Onboarding</span>
      </div>
      <div className="text-[10.5px] tabular-nums text-white/70">{stepLabel}</div>
    </div>
  );
}

function PhaseBadge({ ps }: { ps: ProcessStepValue }) {
  if (ps === "transition") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: T.BRAND_BLUE, backgroundColor: "rgba(31,111,235,0.08)", border: `1px solid ${T.BRAND_BLUE}30` }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: T.BRAND_BLUE }} />
        Process orientation
      </span>
    );
  }
  if (ps === "all") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: T.NAVY, backgroundColor: "#EEF1F8", border: `1px solid ${T.NAVY}25` }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: T.NAVY }} />
        All process steps
      </span>
    );
  }
  if (ps === "closing") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: T.EMERALD_FG, backgroundColor: T.EMERALD_BG, border: `1px solid ${T.EMERALD_BD}` }}>
        <CheckCircle2 className="w-2.5 h-2.5" />
        Tour complete
      </span>
    );
  }
  const c = phaseColor(ps);
  const phase = PHASES.find((p) => p.n === ps)!;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: c, backgroundColor: c + "12", border: `1px solid ${c}40` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
      Step {phase.n} · {phase.label}
    </span>
  );
}

function PhasePipelineFull({ current }: { current: ProcessStepValue }) {
  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, idx) => {
        const isCurrent = current === p.n;
        const isDone = typeof current === "number" && p.n < current;
        const isPending = !isCurrent && !isDone;
        return (
          <React.Fragment key={p.n}>
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{
                backgroundColor: isCurrent ? p.color : isDone ? "#ffffff" : T.SLATE_50,
                color: isCurrent ? "#ffffff" : isDone ? p.color : T.SLATE_400,
                border: `1px solid ${isCurrent ? p.color : isDone ? p.color + "55" : "transparent"}`,
                boxShadow: isCurrent ? `0 3px 10px -2px ${p.color}66` : "none",
              }}
            >
              <span className="h-3 w-3 rounded-full flex items-center justify-center text-[8px] font-bold tabular-nums"
                style={{
                  backgroundColor: isCurrent ? "rgba(255,255,255,0.25)" : isDone ? p.color : "transparent",
                  color: isCurrent ? "white" : isDone ? "white" : T.SLATE_400,
                  border: isPending ? `1px solid ${T.SLATE_300}` : "none",
                }}>
                {isDone ? "✓" : p.n}
              </span>
              <span>{p.label}</span>
            </div>
            {idx < PHASES.length - 1 && (
              <div className="h-px w-2" style={{ backgroundColor: idx < (typeof current === "number" ? current - 1 : -1) ? PHASES[idx].color + "66" : T.HAIRLINE }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PhasePipelineCompact({ current }: { current: ProcessStepValue }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PHASES.map((p, idx) => {
        const isCurrent = current === p.n;
        const isDone = typeof current === "number" && p.n < current;
        return (
          <React.Fragment key={p.n}>
            <div className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 rounded-full inline-block"
                style={{
                  backgroundColor: (isDone || isCurrent ? p.color : T.SLATE_300),
                  boxShadow: isCurrent ? `0 0 0 2.5px ${p.color}33` : "none",
                }}
              />
              <span className="text-[9.5px] font-medium" style={{ color: isCurrent ? p.color : isDone ? T.SLATE_MUTED : T.SLATE_400 }}>
                {p.label}
              </span>
            </div>
            {idx < PHASES.length - 1 && <span className="text-[9px]" style={{ color: T.SLATE_300 }}>·</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function RoutingVisual() {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[9.5px] uppercase tracking-widest font-semibold" style={{ color: T.SLATE_MUTED }}>Routing</div>
      <div className="rounded-lg border bg-white p-2 flex items-center gap-2" style={{ borderColor: T.HAIRLINE }}>
        <div className="h-7 w-7 rounded-md flex items-center justify-center" style={{ backgroundColor: "#EEF2FF", color: T.BRAND_BLUE }}>
          <FileText className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold truncate" style={{ color: T.SLATE_TEXT }}>Clean evidence packet</div>
          <div className="text-[9.5px]" style={{ color: T.SLATE_MUTED }}>Ready to send</div>
        </div>
      </div>
      <div className="flex items-center justify-center -my-0.5">
        <svg width="34" height="16" viewBox="0 0 40 20" fill="none" aria-hidden>
          <path d="M20 0 L10 12 M20 0 L30 12 M20 0 V18" stroke={T.CORAL} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 3" />
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border p-2 flex flex-col items-start gap-1 relative overflow-hidden" style={{ borderColor: T.CORAL, backgroundColor: T.CORAL_BG }}>
          <div className="absolute top-0 right-0 text-[8px] uppercase font-bold tracking-wider px-1 py-0.5 rounded-bl-md" style={{ backgroundColor: T.CORAL, color: "white" }}>Portal</div>
          <Globe className="w-3.5 h-3.5" style={{ color: T.CORAL }} />
          <div className="text-[10px] font-semibold leading-tight" style={{ color: T.NAVY }}>MAS Portal</div>
        </div>
        <div className="rounded-lg border p-2 flex flex-col items-start gap-1 relative overflow-hidden" style={{ borderColor: T.HAIRLINE, backgroundColor: "white" }}>
          <div className="absolute top-0 right-0 text-[8px] uppercase font-bold tracking-wider px-1 py-0.5 rounded-bl-md" style={{ backgroundColor: T.SKY_BG, color: T.SKY_FG }}>Email</div>
          <Mail className="w-3.5 h-3.5" style={{ color: T.SKY_FG }} />
          <div className="text-[10px] font-semibold leading-tight" style={{ color: T.NAVY }}>Outlook</div>
        </div>
      </div>
      <div className="flex items-center gap-1 text-[9.5px]" style={{ color: T.SLATE_MUTED }}>
        <ArrowUpRight className="w-2.5 h-2.5" style={{ color: T.CORAL }} />
        <span>Channel chosen per invoice</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Footer wired to Joyride's button props. Spreading {...primaryProps}
// etc means the Back / Next / Skip clicks dispatch through Joyride's
// own action handler — onEvent in admin-tour.tsx still drives stepIndex
// transitions, route navigation, and the seen-version write.
// ─────────────────────────────────────────────────────────────────────
type ButtonSpread = Pick<TooltipRenderProps, "backProps" | "primaryProps" | "skipProps">;

function FooterActions({
  nextLabel,
  index,
  buttons,
}: { nextLabel: string; index: number; buttons: ButtonSpread }) {
  return (
    <div className="flex items-center justify-between pt-2.5 border-t" style={{ borderColor: T.HAIRLINE }}>
      <button {...buttons.skipProps} className="text-[11.5px] font-medium hover:underline" style={{ color: T.SLATE_MUTED }}>Skip tour</button>
      <div className="flex items-center gap-1.5">
        {index > 0 && (
          <button {...buttons.backProps} className="px-2.5 py-1.5 text-[11.5px] font-medium rounded-md hover:bg-slate-50" style={{ color: T.SLATE_MUTED }}>Back</button>
        )}
        <button
          {...buttons.primaryProps}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-semibold text-white rounded-md transition-transform active:scale-[0.98]"
          style={{
            background: `linear-gradient(135deg, ${T.CORAL} 0%, ${T.CORAL_DARK} 100%)`,
            boxShadow: `0 4px 12px -2px ${T.CORAL}80, 0 1px 2px -1px rgba(208,79,50,0.3)`,
          }}>
          <span>{nextLabel}</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Card variants
// ─────────────────────────────────────────────────────────────────────
function ModalCard({ def, totalSteps, index, buttons, tooltipProps }: {
  def: TourStepDef;
  totalSteps: number;
  index: number;
  buttons: ButtonSpread;
  tooltipProps: TooltipRenderProps["tooltipProps"];
}) {
  const isSubmitStep = def.id === 5;
  const isClosing = def.processStep === "closing";

  return (
    <motion.div
      {...tooltipProps}
      // Single unified fade-in for the whole card. No layout shift, no
      // per-element staggered motion — everything inside (header, body,
      // pipeline, footer) appears together as one block. This is what
      // satisfies "the whole card should fade in as a unit".
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      className={`relative rounded-2xl bg-white overflow-hidden flex flex-col ${isSubmitStep ? "w-[640px]" : "w-[480px]"} max-w-[calc(100vw-2rem)]`}
      style={{ boxShadow: "0 20px 56px -16px rgba(27,42,74,0.32), 0 8px 24px -12px rgba(27,42,74,0.20), 0 0 0 1px rgba(27,42,74,0.06)" }}
    >
      <AccentStripe />
      <HeaderBand stepLabel={`Step ${def.id} of ${totalSteps}`} />

      {isSubmitStep ? (
        <div className="grid grid-cols-[1fr_220px] gap-5 px-5 pt-4 pb-3">
          <div className="flex flex-col gap-2.5">
            <PhaseBadge ps={def.processStep} />
            <h2 className="text-[20px] font-semibold leading-[1.18]" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>{def.title}</h2>
            <p className="text-[12.5px] leading-[1.55]" style={{ color: T.SLATE_MUTED }}>{def.body}</p>
            <div className="flex items-start gap-2 rounded-lg px-2.5 py-1.5 mt-1" style={{ backgroundColor: T.EMERALD_BG, border: `1px solid ${T.EMERALD_BD}` }}>
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: T.EMERALD_FG }} />
              <div className="text-[11px] leading-snug" style={{ color: T.EMERALD_FG }}>
                After submission, the dispute moves to <span className="font-semibold">Responses Awaiting Review</span>.
              </div>
            </div>
          </div>
          <RoutingVisual />
        </div>
      ) : (
        <div className="px-5 pt-4 pb-3 flex flex-col gap-2.5">
          <PhaseBadge ps={def.processStep} />
          <h2 className="text-[19px] font-semibold leading-[1.2]" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>{def.title}</h2>
          <p className="text-[12.5px] leading-[1.6]" style={{ color: T.SLATE_MUTED }}>{def.body}</p>
        </div>
      )}

      <div className="px-5 pb-4 pt-1 flex flex-col gap-2.5">
        {/*
          Only the actual playbook walkthrough modals (steps 2–6, one per
          process step) get the full Upload→Understand→Gather→Submit→Respond
          pipeline. The welcome (1), the post-playbook recap (7), and every
          page-intro modal after that (dashboard, queue, responses, etc.)
          would just be repeating what the operator already saw — the phase
          pill at the top is enough context for those.
        */}
        {!isClosing && def.id >= 2 && def.id <= 6 && (
          <PhasePipelineFull current={def.processStep} />
        )}
        <FooterActions nextLabel={def.nextLabel} index={index} buttons={buttons} />
      </div>
    </motion.div>
  );
}

function CoachCard({ def, totalSteps, index, buttons, tooltipProps }: {
  def: TourStepDef;
  totalSteps: number;
  index: number;
  buttons: ButtonSpread;
  tooltipProps: TooltipRenderProps["tooltipProps"];
}) {
  return (
    <motion.div
      {...tooltipProps}
      // Same single-unit fade as ModalCard. See note above ModalCard.
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      className="w-[400px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white overflow-hidden flex flex-col"
      style={{ boxShadow: "0 20px 56px -16px rgba(27,42,74,0.36), 0 8px 24px -12px rgba(27,42,74,0.22), 0 0 0 1px rgba(27,42,74,0.06)" }}
    >
      <AccentStripe />
      <HeaderBand stepLabel={`Step ${def.id} of ${totalSteps}`} />

      <div className="px-4 pt-3 pb-2.5 flex flex-col gap-2">
        <PhaseBadge ps={def.processStep} />
        <h2 className="text-[15px] font-semibold leading-tight" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>{def.title}</h2>
        <p className="text-[11.5px] leading-[1.55]" style={{ color: T.SLATE_MUTED }}>{def.body}</p>
      </div>

      <div className="px-4 pb-3 pt-0.5 flex flex-col gap-2">
        {def.processStep !== "closing" && def.processStep !== "all" && def.processStep !== "transition" && (
          <PhasePipelineCompact current={def.processStep} />
        )}
        <FooterActions nextLabel={def.nextLabel} index={index} buttons={buttons} />
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Joyride entry point.
// ─────────────────────────────────────────────────────────────────────
export function TourCard(props: TooltipRenderProps) {
  // We stash the full TourStepDef in joyride's `step.data` so the
  // tooltip can read kind/page/processStep without re-deriving them
  // from `step.title`. See admin-tour.tsx → buildJoyrideStep.
  const def = (props.step as { data?: TourStepDef }).data;
  if (!def) {
    // Defensive fallback — render a tiny error chip rather than crash
    // the whole Joyride lifecycle if a step somehow lacks our data.
    return (
      <div {...props.tooltipProps} className="rounded-md bg-white p-3 text-xs text-slate-700 shadow">
        Tour step is missing data
        <button {...props.primaryProps} className="ml-2 underline">Next</button>
      </div>
    );
  }
  const buttons = { backProps: props.backProps, primaryProps: props.primaryProps, skipProps: props.skipProps };
  // No AnimatePresence wrapper: Joyride re-mounts the tooltipComponent
  // for every step transition, so an exit animation never gets a
  // chance to play. A subtle opacity fade on the inner card is enough,
  // and avoids the "card flying around" feel between centered modals
  // that share the same on-screen position.
  try {
    return def.kind === "modal" ? (
      <ModalCard def={def} totalSteps={props.size} index={props.index} buttons={buttons} tooltipProps={props.tooltipProps} />
    ) : (
      <CoachCard def={def} totalSteps={props.size} index={props.index} buttons={buttons} tooltipProps={props.tooltipProps} />
    );
  } catch (err) {
    // Defensive: a thrown error inside the tooltip would otherwise
    // bubble up through Joyride and blank the host page (the symptom
    // the operator saw on step 14). Render a tiny chip so the user
    // can still skip past the broken step.
    if (import.meta.env.DEV) console.error("[TourCard] render error", err);
    return (
      <div {...props.tooltipProps} className="rounded-md bg-white p-3 text-xs text-slate-700 shadow">
        Tour step couldn't render.
        <button {...props.skipProps} className="ml-2 underline">Skip tour</button>
      </div>
    );
  }
}
