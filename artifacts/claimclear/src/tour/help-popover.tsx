// Header "Help on this page" popover — the primary V2 tour entry.
//
// Reads the current wouter route, derives which page-scoped tour fits,
// and offers two actions: "Walk this page" (jumps straight to that
// page's first step) and "Take the full tour" (24 steps, all of
// ClaimClear). Filters TOUR_STEPS live so adding/removing tour steps
// in tour-config.ts updates the popover counts automatically.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, MapPin, PlayCircle, ArrowRight, X } from "lucide-react";
import { useAdminTour } from "./admin-tour";
import { TOUR_STEPS, pageForLocation, type PageKey } from "./tour-config";

const PAGE_FRIENDLY: Record<PageKey, string> = {
  dashboard: "Dashboard",
  queue: "Queue",
  responses: "Responses",
  attestation: "Attestation",
  "invoice-groups": "Invoice Groups",
  "group-detail": "Invoice group detail",
  claims: "Claims",
  "claim-detail": "Claim detail",
};

const T = {
  NAVY: "#1B2A4A",
  CORAL: "#E0654A",
  CORAL_DARK: "#D04F32",
  CORAL_BG: "#FDECE6",
  CORAL_BD: "#F6C7B6",
  BRAND_BLUE: "#1F6FEB",
  SLATE_50: "#F8FAFC",
  SLATE_TEXT: "#0F172A",
  SLATE_MUTED: "#475569",
  HAIRLINE: "#E2E8F0",
};

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function HelpPopover() {
  const [location] = useLocation();
  const { startTour } = useAdminTour();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const pageKey = useMemo(() => pageForLocation(location), [location]);
  const pageSteps = useMemo(
    () => (pageKey ? TOUR_STEPS.filter((s) => s.page === pageKey) : []),
    [pageKey],
  );
  const friendly = pageKey ? PAGE_FRIENDLY[pageKey] : "this page";
  const totalSteps = TOUR_STEPS.length;
  const estSec = Math.max(20, pageSteps.length * 18);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const handleWalkPage = () => {
    setOpen(false);
    if (pageKey && pageSteps.length > 0) {
      startTour({ pageScope: pageKey });
    } else {
      startTour();
    }
  };

  const handleFullTour = () => {
    setOpen(false);
    startTour();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-semibold transition-colors"
        style={{
          borderColor: open ? T.CORAL : T.HAIRLINE,
          backgroundColor: open ? T.CORAL_BG : "transparent",
          color: open ? T.CORAL_DARK : T.SLATE_MUTED,
        }}
        data-tour="header-take-tour"
        data-testid="header-take-tour"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <HelpCircle className="w-4 h-4" style={{ color: open ? T.CORAL : "currentColor" }} />
        <span>Help on this page</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="help-popover"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.14 } }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            role="dialog"
            data-testid="help-popover"
            className="absolute z-50 right-0 top-[40px] w-[360px] rounded-xl bg-white overflow-hidden"
            style={{
              boxShadow:
                "0 20px 56px -16px rgba(27,42,74,0.32), 0 8px 24px -12px rgba(27,42,74,0.20), 0 0 0 1px rgba(27,42,74,0.06)",
            }}
          >
            {/* Notch */}
            <div className="absolute -top-1.5 right-[34px] h-3 w-3 rotate-45 bg-white border-l border-t" style={{ borderColor: "rgba(27,42,74,0.06)" }} />
            {/* Accent stripe */}
            <div className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${T.CORAL} 0%, ${T.CORAL} 30%, ${T.BRAND_BLUE} 70%, ${T.NAVY} 100%)` }} />

            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3" style={{ color: T.CORAL }} />
                  <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: T.CORAL }}>
                    You are on
                  </span>
                </div>
                <button onClick={() => setOpen(false)} className="-mr-1 p-1 rounded hover:bg-slate-100" aria-label="Close">
                  <X className="w-3 h-3" style={{ color: T.SLATE_MUTED }} />
                </button>
              </div>
              <div className="text-[16px] font-semibold leading-tight" style={{ color: T.NAVY, letterSpacing: "-0.01em" }}>
                {friendly}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
                {pageSteps.length > 0
                  ? <>What you do here, in {pageSteps.length} {pageSteps.length === 1 ? "step" : "steps"}.</>
                  : <>No page-specific tour yet — take the full tour below.</>}
              </div>
            </div>

            {pageSteps.length > 0 && (
              <div className="px-4 pb-2.5 flex flex-col gap-1">
                {pageSteps.slice(0, 5).map((s, i) => (
                  <div key={s.id} className="flex items-center gap-2 text-[11px] leading-tight">
                    <span
                      className="h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold tabular-nums flex-shrink-0"
                      style={{ backgroundColor: T.CORAL_BG, color: T.CORAL_DARK, border: `1px solid ${T.CORAL_BD}` }}
                    >
                      {i + 1}
                    </span>
                    <span className="truncate" style={{ color: T.SLATE_TEXT }}>
                      {s.title.split(" — ")[0].split(" · ")[0]}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {pageSteps.length > 0 && (
              <div className="px-4 pb-2 pt-1">
                <button
                  type="button"
                  onClick={handleWalkPage}
                  data-testid="help-popover-walk-page"
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-white text-[12px] font-semibold transition-transform active:scale-[0.99]"
                  style={{
                    background: `linear-gradient(135deg, ${T.CORAL} 0%, ${T.CORAL_DARK} 100%)`,
                    boxShadow: `0 4px 12px -2px ${T.CORAL}80, 0 1px 2px -1px rgba(208,79,50,0.3)`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <PlayCircle className="w-4 h-4" />
                    <div className="text-left leading-tight">
                      <div>Walk this page</div>
                      <div className="text-[9.5px] font-medium opacity-80">
                        {pageSteps.length} steps · ~{estSec}s
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="px-4 pb-3.5">
              <button
                type="button"
                onClick={handleFullTour}
                data-testid="help-popover-full-tour"
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[11.5px] font-semibold border bg-white hover:bg-slate-50"
                style={{ borderColor: T.HAIRLINE, color: T.SLATE_TEXT }}
              >
                <div className="text-left leading-tight">
                  <div>Take the full tour</div>
                  <div className="text-[9.5px] font-medium" style={{ color: T.SLATE_MUTED }}>
                    {totalSteps} steps · ~6 min · all of ClaimClear
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5" style={{ color: T.SLATE_MUTED }} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
