import React from "react";
import { Search, Bell, Settings, HelpCircle, PlayCircle } from "lucide-react";
import { T } from "./tokens";

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

// Map active page → which sidebar entry should be highlighted
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
  children: React.ReactNode;
};

export function MockApp({ activePage, children }: Props) {
  const pageLabel = activePage ? PAGE_LABELS[activePage] : "Dashboard";
  const activeKey = activePage ? SIDEBAR_KEY[activePage] : "dashboard";

  return (
    <div className="w-full h-screen overflow-hidden flex flex-col font-sans" style={{ backgroundColor: T.BG, color: T.SLATE_TEXT }}>
      <div className="h-11 bg-white border-b flex items-center justify-between px-4 flex-shrink-0" style={{ borderColor: T.HAIRLINE }}>
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
          <Bell className="w-3.5 h-3.5" style={{ color: T.SLATE_MUTED }} />
          <Settings className="w-3.5 h-3.5" style={{ color: T.SLATE_MUTED }} />
          <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white" style={{ backgroundColor: T.BRAND_BLUE }}>JM</div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div
          data-tour="sidebar"
          className="w-48 border-r bg-white py-3 px-2.5 flex flex-col gap-0.5 flex-shrink-0"
          style={{ borderColor: T.HAIRLINE }}
        >
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
                style={{
                  backgroundColor: active ? "rgba(31,111,235,0.08)" : "transparent",
                  color: active ? T.BRAND_BLUE : T.SLATE_TEXT,
                }}>
                <span>{item.label}</span>
                {item.badge && (
                  <span className="text-[9.5px] font-bold tabular-nums px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: item.badge.bg, color: item.badge.color }}>
                    {item.badge.v}
                  </span>
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
              <div key={item.key}
                className="px-2 py-1.5 rounded-md text-[12px] font-medium"
                style={{
                  backgroundColor: active ? "rgba(31,111,235,0.08)" : "transparent",
                  color: active ? T.BRAND_BLUE : T.SLATE_MUTED,
                }}>
                {item.label}
              </div>
            );
          })}

          <div className="text-[9.5px] uppercase tracking-widest font-semibold mb-1 mt-3 px-2" style={{ color: T.SLATE_400 }}>Help</div>
          <div className="flex items-center gap-1.5 px-2 py-1 text-[12px]" style={{ color: T.SLATE_MUTED }}>
            <HelpCircle className="w-3 h-3" /> Documentation
          </div>
          <div data-tour="sidebar-take-tour"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[12px] font-medium"
            style={{ color: T.NAVY, backgroundColor: T.SLATE_50 }}>
            <PlayCircle className="w-3.5 h-3.5" /> Take the tour
          </div>
        </div>

        <div className="flex-1 overflow-hidden p-4">{children}</div>
      </div>
    </div>
  );
}
