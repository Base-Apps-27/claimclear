import "./_header.css";
import type { ReactNode } from "react";

export function Frame({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rh-scope"
      style={{ width: 1280, minHeight: 720, position: "relative" }}
    >
      <div className="rh-frame-label">{label}</div>
      <div className="rh-page" style={{ paddingTop: "2.25rem" }}>
        {children}
      </div>
      {note ? <div className="rh-note">{note}</div> : null}
    </div>
  );
}

export function TablePeek() {
  const rows = [
    ["INV-44218 · BCBS of TX", "Authorization missing", "$1,240.00", "2d"],
    ["INV-44219 · Aetna PPO", "Bundled denial", "$420.00", "3d"],
    ["INV-44221 · UHC", "Coordination of benefits", "$780.00", "5d"],
  ];
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="rh-table-peek">
          <span style={{ color: "var(--rh-fg)", fontWeight: 500 }}>{r[0]}</span>
          <span>{r[1]}</span>
          <span>{r[2]}</span>
          <span>{r[3]} ago</span>
        </div>
      ))}
    </div>
  );
}

export const ICONS = {
  search: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
  ),
  filter: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M6 12h12M10 18h4" /></svg>
  ),
  sort: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M6 12h12M9 18h6" /></svg>
  ),
  caret: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
  ),
  x: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
  ),
  info: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
  ),
  eye: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
  ),
  eyeOff: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/></svg>
  ),
  check: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
  ),
  spark: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>
  ),
  cmd: (
    <svg className="rh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>
  ),
};

export const STATE = {
  groupCount: 99,
  hiddenAcknowledgmentOnly: 6,
  hiddenAwaitingPayor: 0,
  highConfidenceEligible: 12,
  activeFilters: [
    { key: "status", label: "Status: response_pending" },
    { key: "errorType", label: "Error: Authorization missing" },
  ],
  sortLabel: "Oldest response first",
};
