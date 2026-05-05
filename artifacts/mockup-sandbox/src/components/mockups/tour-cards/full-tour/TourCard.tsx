import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CheckCircle2, Globe, Mail, FileText, ArrowUpRight } from "lucide-react";
import { T, PHASES, phaseColor, ProcessStep } from "./tokens";
import { STEPS, type StepDef } from "./steps";

const TOTAL_STEPS = STEPS.length;
const VIEWPORT_MARGIN = 16;

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

function PhaseBadge({ ps }: { ps: ProcessStep }) {
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

function PhasePipelineFull({ current }: { current: ProcessStep }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {PHASES.map((p, idx) => {
          const isCurrent = current === p.n;
          const isDone = typeof current === "number" && p.n < current;
          const isPending = !isCurrent && !isDone;
          return (
            <React.Fragment key={p.n}>
              <motion.div layout
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                animate={{
                  backgroundColor: isCurrent ? p.color : isDone ? "#ffffff" : T.SLATE_50,
                  color: isCurrent ? "#ffffff" : isDone ? p.color : T.SLATE_400,
                }}
                transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                style={{
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
              </motion.div>
              {idx < PHASES.length - 1 && (
                <div className="h-px w-2" style={{ backgroundColor: idx < (typeof current === "number" ? current - 1 : -1) ? PHASES[idx].color + "66" : T.HAIRLINE }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function PhasePipelineCompact({ current }: { current: ProcessStep }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PHASES.map((p, idx) => {
        const isCurrent = current === p.n;
        const isDone = typeof current === "number" && p.n < current;
        return (
          <React.Fragment key={p.n}>
            <div className="flex items-center gap-1">
              <motion.span
                className="h-1.5 w-1.5 rounded-full"
                animate={{
                  backgroundColor: (isDone || isCurrent ? p.color : T.SLATE_300),
                  boxShadow: isCurrent ? `0 0 0 2.5px ${p.color}33` : `0 0 0 0px ${p.color}00`,
                }}
                transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
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

function FooterActions({ stepId, nextLabel }: { stepId: number; nextLabel: string }) {
  return (
    <div className="flex items-center justify-between pt-2.5 border-t" style={{ borderColor: T.HAIRLINE }}>
      <button className="text-[11.5px] font-medium" style={{ color: T.SLATE_MUTED }}>Skip tour</button>
      <div className="flex items-center gap-1.5">
        {stepId > 1 && (
          <button className="px-2.5 py-1.5 text-[11.5px] font-medium rounded-md" style={{ color: T.SLATE_MUTED }}>Back</button>
        )}
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-semibold text-white rounded-md"
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

// ============== ROUTING VISUAL (Submit step only) ==============
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

// Motion presets — quick, refined, easeOutExpo-ish
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const EASE_IN: [number, number, number, number]  = [0.4, 0, 1, 1];

// ============== MODAL (centered) ==============
function ModalCard({ step }: { step: StepDef }) {
  const isSubmitStep = step.id === 5;
  const isClosing = step.processStep === "closing";

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none">
      <motion.div
        key={`dim-${step.id}`}
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, rgba(27,42,74,0) 0%, rgba(27,42,74,0.10) 55%, rgba(27,42,74,0.32) 100%)" }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: EASE_OUT }}
      />
      <motion.div
        key={`modal-${step.id}`}
        initial={{ opacity: 0, scale: 0.965, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.985, y: -4 }}
        transition={{ duration: 0.26, ease: EASE_OUT }}
        className={`relative rounded-2xl bg-white overflow-hidden flex flex-col pointer-events-auto ${isSubmitStep ? "w-[640px]" : "w-[480px]"} max-w-full max-h-full`}
        style={{ boxShadow: "0 20px 56px -16px rgba(27,42,74,0.32), 0 8px 24px -12px rgba(27,42,74,0.20), 0 0 0 1px rgba(27,42,74,0.06)" }}
      >
        <AccentStripe />
        <HeaderBand stepLabel={`Step ${step.id} of ${TOTAL_STEPS}`} />

        {isSubmitStep ? (
          <div className="grid grid-cols-[1fr_220px] gap-5 px-5 pt-4 pb-3">
            <div className="flex flex-col gap-2.5">
              <PhaseBadge ps={step.processStep} />
              <h2 className="text-[20px] font-semibold leading-[1.18]" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>{step.title}</h2>
              <p className="text-[12.5px] leading-[1.55]" style={{ color: T.SLATE_MUTED }}>{step.body}</p>
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
            <PhaseBadge ps={step.processStep} />
            <h2 className="text-[19px] font-semibold leading-[1.2]" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>{step.title}</h2>
            <p className="text-[12.5px] leading-[1.6]" style={{ color: T.SLATE_MUTED }}>{step.body}</p>
          </div>
        )}

        <div className="px-5 pb-4 pt-1 flex flex-col gap-2.5">
          {!isClosing && <PhasePipelineFull current={step.processStep} />}
          <FooterActions stepId={step.id} nextLabel={step.nextLabel} />
        </div>
      </motion.div>
    </div>
  );
}

// ============== COACH (anchored) ==============
function CoachCard({ step }: { step: StepDef }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [haloRect, setHaloRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; pointer: "up" | "down" | "left" | "right"; pointerOffset: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const sel = step.anchor?.selector;
      if (!sel) return;
      const el = document.querySelector(sel) as HTMLElement | null;
      const card = cardRef.current;
      if (!el || !card) return;
      const r = el.getBoundingClientRect();
      setHaloRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      const cardW = card.offsetWidth, cardH = card.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      const m = VIEWPORT_MARGIN, gap = 14;
      let top = 0, left = 0, pointer: "up" | "down" | "left" | "right" = "up";
      switch (step.anchor!.placement) {
        case "right":  left = r.right + gap; top = r.top; pointer = "left"; break;
        case "left":   left = r.left - cardW - gap; top = r.top; pointer = "right"; break;
        case "bottom": top = r.bottom + gap; left = r.left; pointer = "up"; break;
        case "top":    top = r.top - cardH - gap; left = r.left; pointer = "down"; break;
      }
      left = Math.max(m, Math.min(vw - cardW - m, left));
      top  = Math.max(m, Math.min(vh - cardH - m, top));
      let pointerOffset = 16;
      if (pointer === "up" || pointer === "down") {
        const cx = r.left + r.width / 2;
        pointerOffset = Math.max(12, Math.min(cardW - 24, cx - left));
      } else {
        const cy = r.top + r.height / 2;
        pointerOffset = Math.max(12, Math.min(cardH - 24, cy - top));
      }
      setPos({ top, left, pointer, pointerOffset });
    };
    measure();
    window.addEventListener("resize", measure);
    const t = setTimeout(measure, 50);
    return () => { window.removeEventListener("resize", measure); clearTimeout(t); };
  }, [step.anchor?.selector, step.anchor?.placement, step.id]);

  // Slide-in offset based on pointer direction (card slides toward anchor)
  const slideFrom = (() => {
    if (!pos) return { x: 0, y: 0 };
    switch (pos.pointer) {
      case "left":  return { x: -10, y: 0 };
      case "right": return { x: 10,  y: 0 };
      case "up":    return { x: 0,   y: -10 };
      case "down":  return { x: 0,   y: 10 };
    }
  })();

  return (
    <>
      {/* Halo with entrance animation + soft continuous breath */}
      {haloRect && (
        <motion.div
          key={`halo-${step.id}`}
          className="absolute pointer-events-none"
          style={{
            top: haloRect.top - 4,
            left: haloRect.left - 4,
            width: haloRect.width + 8,
            height: haloRect.height + 8,
            borderRadius: 12,
            zIndex: 5,
          }}
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{
            opacity: 1, scale: 1,
            boxShadow: [
              `0 0 0 2px ${T.CORAL}, 0 0 0 8px rgba(224,101,74,0.14), 0 16px 36px -12px rgba(224,101,74,0.34)`,
              `0 0 0 2px ${T.CORAL}, 0 0 0 10px rgba(224,101,74,0.22), 0 18px 40px -12px rgba(224,101,74,0.42)`,
              `0 0 0 2px ${T.CORAL}, 0 0 0 8px rgba(224,101,74,0.14), 0 16px 36px -12px rgba(224,101,74,0.34)`,
            ],
          }}
          exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.16, ease: EASE_IN } }}
          transition={{
            opacity: { duration: 0.28, ease: EASE_OUT },
            scale:   { duration: 0.32, ease: EASE_OUT },
            boxShadow: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT, delay: 0.08 }}
            className="absolute -top-2.5 left-2 px-1.5 py-0.5 rounded-md text-[9px] uppercase tracking-widest font-bold text-white whitespace-nowrap"
            style={{ backgroundColor: T.CORAL }}
          >
            Step {step.id} · You are here
          </motion.div>
        </motion.div>
      )}

      <motion.div
        key={`coach-${step.id}`}
        ref={cardRef}
        className="absolute z-10 w-[400px] rounded-2xl bg-white overflow-hidden flex flex-col"
        initial={{ opacity: 0, x: slideFrom.x, y: slideFrom.y, scale: 0.985 }}
        animate={{ opacity: pos ? 1 : 0, x: 0, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99, transition: { duration: 0.14, ease: EASE_IN } }}
        transition={{ duration: 0.28, ease: EASE_OUT, delay: 0.04 }}
        style={{
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          boxShadow: "0 20px 56px -16px rgba(27,42,74,0.36), 0 8px 24px -12px rgba(27,42,74,0.22), 0 0 0 1px rgba(27,42,74,0.06)",
        }}
      >
        {pos && pos.pointer === "up" && (
          <div className="absolute" style={{ top: -8, left: pos.pointerOffset - 8, width: 0, height: 0,
            borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderBottom: `8px solid ${T.CORAL}` }} />
        )}
        {pos && pos.pointer === "down" && (
          <div className="absolute" style={{ bottom: -8, left: pos.pointerOffset - 8, width: 0, height: 0,
            borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: `8px solid ${T.NAVY}` }} />
        )}
        {pos && pos.pointer === "left" && (
          <div className="absolute" style={{ left: -8, top: pos.pointerOffset - 8, width: 0, height: 0,
            borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: `8px solid ${T.CORAL}` }} />
        )}
        {pos && pos.pointer === "right" && (
          <div className="absolute" style={{ right: -8, top: pos.pointerOffset - 8, width: 0, height: 0,
            borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderLeft: `8px solid ${T.CORAL}` }} />
        )}

        <AccentStripe />
        <HeaderBand stepLabel={`Step ${step.id} of ${TOTAL_STEPS}`} />

        <div className="px-4 pt-3 pb-2.5 flex flex-col gap-2">
          <PhaseBadge ps={step.processStep} />
          <h2 className="text-[15px] font-semibold leading-tight" style={{ color: T.SLATE_TEXT, letterSpacing: "-0.01em" }}>{step.title}</h2>
          <p className="text-[11.5px] leading-[1.55]" style={{ color: T.SLATE_MUTED }}>{step.body}</p>
        </div>

        <div className="px-4 pb-3 pt-0.5 flex flex-col gap-2">
          {step.processStep !== "closing" && step.processStep !== "all" && (
            <PhasePipelineCompact current={step.processStep} />
          )}
          <FooterActions stepId={step.id} nextLabel={step.nextLabel} />
        </div>
      </motion.div>
    </>
  );
}

// ============== ENTRY ==============
export function TourCard({ step }: { step: StepDef }) {
  return (
    <div className="fixed inset-0 z-10 pointer-events-none">
      <div className="absolute inset-0">
        <AnimatePresence mode="wait">
          {step.kind === "modal"
            ? <ModalCard key={`m-${step.id}`} step={step} />
            : <CoachCard key={`c-${step.id}`} step={step} />}
        </AnimatePresence>
      </div>
    </div>
  );
}
