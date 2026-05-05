import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Bell, Settings, HelpCircle, PlayCircle, MapPin, ArrowRight, X } from "lucide-react";
import { T } from "./tokens";
import { STEPS } from "./steps";

function Mark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6.5L12 3L20 6.5V12C20 16.5 16.5 20 12 21C7.5 20 4 16.5 4 12V6.5Z"
        stroke="white" strokeWidth="1.6" strokeLinejoin="round" fill="rgba(255,255,255,0.08)" />
      <path d="M8.5 12L11 14.5L15.5 9.5" stroke={T.CORAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type ActivePage =
  | "dashboard" | "queue" | "responses" | "attestation"
  | "invoice-groups" | "group-detail" | "claims" | "claim-detail"
  | null;

const PAGE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  queue: "Queue",
  responses: "Responses Awaiting Review",
  attestation: "Attestation Queue",
  "invoice-groups": "Invoice Groups",
  "group-detail": "Invoice Groups / G-4291",
  claims: "Claims",
  "claim-detail": "Claims / Car #1042",
};

const PAGE_FRIENDLY: Record<string, string> = {
  dashboard: "Dashboard",
  queue: "Queue",
  responses: "Responses",
  attestation: "Attestation",
  "invoice-groups": "Invoice Groups",
  "group-detail": "Group detail",
  claims: "Claims",
  "claim-detail": "Claim detail",
};

const SIDEBAR_KEY: Record<string, string> = {
  dashboard: "dashboard",
  queue: "queue",
  responses: "responses",
  attestation: "attestation",
  "invoice-groups": "groups",
  "group-detail": "groups",
  claims: "claims",
  "claim-detail": "claims",
};

type Props = {
  activePage: ActivePage;
  helpOpen?: boolean;
  children: React.ReactNode;
};

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function MockApp({ activePage, helpOpen: helpOpenProp, children }: Props) {
  const pageLabel = activePage ? PAGE_LABELS[activePage] : "Dashboard";
  const activeKey = activePage ? SIDEBAR_KEY[activePage] : "dashboard";
  const [internalOpen, setInternalOpen] = useState(false);
  const helpOpen = helpOpenProp ?? internalOpen;

  // Page-scoped tour stats (derived from the same STEPS list, no separate config)
  const pageKey = activePage ?? "dashboard";
  const pageSteps = STEPS.filter((s) => s.page === pageKey);
  const totalSteps = STEPS.length;
  const friendly = PAGE_FRIENDLY[pageKey] ?? "this page";
  const estSec = Math.max(20, pageSteps.length * 18);

  return (
    <div className="w-full h-screen overflow-hidden flex flex-col font-sans" style={{ backgroundColor: T.BG, color: T.SLATE_TEXT }}>
      <div className="h-11 bg-white border-b flex items-center justify-between px-4 flex-shrink-0 relative" style={{ borderColor: T.HAIRLINE }}>
        <div className="flex items-center gap-2.5">
          <div className="h-6 w-6 rounded-md flex items-center justify-center" style={{ backgroundColor: T.NAVY }}>
            <Mark size={13} />
          </div>
          <span className="text-[12.5px] font-semibold tracking-tight" style={{ color: T.NAVY }}>ClaimClear</span>
          <span style={{ color: T.SLATE_300 }}>/</span>
          <span className="text-[12px]" style={{ color: T.SLATE_MUTED }}>{pageLabel}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 h-7 w-56 rounded-md border px-2.5" style={{ borderColor: T.HAIRLINE, backgroundColor: T.SLATE_50 }}>
            <Search className="w-3 h-3" style={{ color: T.SLATE_MUTED }} />
            <span className="text-[11px]" style={{ color: T.SLATE_400 }}>Search claims, invoices…</span>
          </div>

          {/* ⭐ Help-on-this-page pill — page-aware tour entry */}
          <button
            data-tour="header-help-pill"
            onClick={() => setInternalOpen((o) => !o)}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] font-semibold transition-colors"
            style={{
              borderColor: helpOpen ? T.CORAL : T.HAIRLINE,
              backgroundColor: helpOpen ? T.CORAL_BG : "white",
              color: helpOpen ? T.CORAL_DARK : T.SLATE_TEXT,
            }}
          >
            <HelpCircle className="w-3.5 h-3.5" style={{ color: helpOpen ? T.CORAL : T.SLATE_MUTED }} />
            <span>Help on this page</span>
          </button>

          <Bell className="w-3.5 h-3.5" style={{ color: T.SLATE_MUTED }} />
          <Settings className="w-3.5 h-3.5" style={{ color: T.SLATE_MUTED }} />
          <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white" style={{ backgroundColor: T.BRAND_BLUE }}>JM</div>
        </div>

        {/* Help popover — anchored under the Help pill */}
        <AnimatePresence>
          {helpOpen && (
            <motion.div
              key="help-popover"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.14 } }}
              transition={{ duration: 0.22, ease: EASE_OUT }}
              className="absolute z-30 right-[120px] top-[44px] w-[360px] rounded-xl bg-white overflow-hidden"
              style={{
                boxShadow: "0 20px 56px -16px rgba(27,42,74,0.32), 0 8px 24px -12px rgba(27,42,74,0.20), 0 0 0 1px rgba(27,42,74,0.06)",
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
                    <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: T.CORAL }}>You are on</span>
                  </div>
                  <button onClick={() => setInternalOpen(false)} className="-mr-1 p-1 rounded hover:bg-slate-100">
                    <X className="w-3 h-3" style={{ color: T.SLATE_MUTED }} />
                  </button>
                </div>
                <div className="text-[16px] font-semibold leading-tight" style={{ color: T.NAVY, letterSpacing: "-0.01em" }}>
                  {friendly}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: T.SLATE_MUTED }}>
                  What you do here, in {pageSteps.length} {pageSteps.length === 1 ? "step" : "steps"}.
                </div>
              </div>

              {/* Step preview list — derived live from STEPS */}
              {pageSteps.length > 0 && (
                <div className="px-4 pb-2.5 flex flex-col gap-1">
                  {pageSteps.slice(0, 5).map((s, i) => (
                    <div key={s.id} className="flex items-center gap-2 text-[11px] leading-tight">
                      <span className="h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold tabular-nums flex-shrink-0"
                        style={{ backgroundColor: T.CORAL_BG, color: T.CORAL_DARK, border: `1px solid ${T.CORAL_BD}` }}>
                        {i + 1}
                      </span>
                      <span className="truncate" style={{ color: T.SLATE_TEXT }}>
                        {s.title.split(" — ")[0].split(" · ")[0]}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Primary action — page tour */}
              <div className="px-4 pb-2 pt-1">
                <button className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-white text-[12px] font-semibold"
                  style={{
                    background: `linear-gradient(135deg, ${T.CORAL} 0%, ${T.CORAL_DARK} 100%)`,
                    boxShadow: `0 4px 12px -2px ${T.CORAL}80, 0 1px 2px -1px rgba(208,79,50,0.3)`,
                  }}>
                  <div className="flex items-center gap-2">
                    <PlayCircle className="w-4 h-4" />
                    <div className="text-left leading-tight">
                      <div>Walk this page</div>
                      <div className="text-[9.5px] font-medium opacity-80">{pageSteps.length} steps · ~{estSec}s</div>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Secondary action — full tour */}
              <div className="px-4 pb-3.5">
                <button className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[11.5px] font-semibold border"
                  style={{ borderColor: T.HAIRLINE, color: T.SLATE_TEXT, backgroundColor: "white" }}>
                  <div className="text-left leading-tight">
                    <div>Take the full tour</div>
                    <div className="text-[9.5px] font-medium" style={{ color: T.SLATE_MUTED }}>{totalSteps} steps · ~6 min · all of ClaimClear</div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5" style={{ color: T.SLATE_MUTED }} />
                </button>
              </div>

              {/* Footer — alternate routes */}
              <div className="px-4 py-2 border-t flex items-center justify-between text-[10.5px]" style={{ borderColor: T.HAIRLINE, backgroundColor: T.SLATE_50 }}>
                <span style={{ color: T.SLATE_MUTED }}>Need a human?</span>
                <a className="font-semibold" style={{ color: T.BRAND_BLUE }}>Ask in #claimclear-help →</a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-1 min-h-0">
        <div data-tour="sidebar" className="w-48 border-r bg-white py-3 px-2.5 flex flex-col gap-0.5 flex-shrink-0" style={{ borderColor: T.HAIRLINE }}>
          <div className="text-[9.5px] uppercase tracking-widest font-semibold mb-1 px-2" style={{ color: T.SLATE_400 }}>Today</div>
          {[
            { key: "dashboard",   label: "Dashboard",   badge: null },
            { key: "queue",       label: "Queue",       badge: { v: "184", color: T.SKY_FG, bg: T.SKY_BG } },
            { key: "responses",   label: "Responses",   badge: { v: "23",  color: T.CORAL,  bg: T.CORAL_BG } },
            { key: "attestation", label: "Attestation", badge: { v: "7",   color: T.AMBER_FG, bg: T.AMBER_BG } },
          ].map((item) => {
            const active = activeKey === item.key;
            return (
              <div key={item.key}
                className="flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] font-medium"
                style={{ backgroundColor: active ? "rgba(31,111,235,0.08)" : "transparent", color: active ? T.BRAND_BLUE : T.SLATE_TEXT }}>
                <span>{item.label}</span>
                {item.badge && (
                  <span className="text-[9.5px] font-bold tabular-nums px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: item.badge.bg, color: item.badge.color }}>{item.badge.v}</span>
                )}
              </div>
            );
          })}

          <div className="text-[9.5px] uppercase tracking-widest font-semibold mb-1 mt-3 px-2" style={{ color: T.SLATE_400 }}>Browse</div>
          {[
            { key: "invoices", label: "Invoices" },
            { key: "groups",   label: "Groups" },
            { key: "claims",   label: "Claims" },
            { key: "submissions", label: "Submissions" },
          ].map((item) => {
            const active = activeKey === item.key;
            return (
              <div key={item.key} className="px-2 py-1.5 rounded-md text-[12px] font-medium"
                style={{ backgroundColor: active ? "rgba(31,111,235,0.08)" : "transparent", color: active ? T.BRAND_BLUE : T.SLATE_MUTED }}>
                {item.label}
              </div>
            );
          })}

          <div className="text-[9.5px] uppercase tracking-widest font-semibold mb-1 mt-3 px-2" style={{ color: T.SLATE_400 }}>Help</div>
          <div className="flex items-center gap-1.5 px-2 py-1 text-[12px]" style={{ color: T.SLATE_MUTED }}>
            <HelpCircle className="w-3 h-3" /> Documentation
          </div>
          <div data-tour="sidebar-take-tour" className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[12px] font-medium"
            style={{ color: T.NAVY, backgroundColor: T.SLATE_50 }}>
            <PlayCircle className="w-3.5 h-3.5" /> Take the tour
          </div>
        </div>

        <div className="flex-1 overflow-hidden p-4">{children}</div>
      </div>
    </div>
  );
}
