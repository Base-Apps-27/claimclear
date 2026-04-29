import { ReactNode } from "react";
import "../claim-detail-redesign/_group.css";

export type SubStatus =
  | "Draft" | "Pending" | "Queued" | "In Progress"
  | "Submitted" | "Failed" | "Cancelled" | "Dry Run";

export const submissions: {
  id: number; conf: string; status: SubStatus; amount: string;
  age: string; issue: string; attempts?: string; nextRetry?: string;
  ticket?: string; error?: string; claimedBy?: string; sandboxRun?: boolean;
}[] = [
  { id: 1, conf: "C-2026-04820", status: "Draft",     amount: "$184.50", age: "2m ago",  issue: "GPS Control Deviation" },
  { id: 2, conf: "C-2026-04821", status: "Draft",     amount: "$98.40",  age: "8m ago",  issue: "Vehicle, Driver, or TPP", sandboxRun: true },
  { id: 3, conf: "C-2026-04822", status: "Draft",     amount: "$245.20", age: "14m ago", issue: "Other Issue or Question" },
  { id: 4, conf: "C-2026-04812", status: "Pending",   amount: "$184.50", age: "23m ago", issue: "GPS Control Deviation", attempts: "1/4", nextRetry: "retry in 23s" },
  { id: 5, conf: "C-2026-04813", status: "Pending",   amount: "$98.40",  age: "31m ago", issue: "Custom Payment Request", attempts: "1/4" },
  { id: 6, conf: "C-2026-04814", status: "Pending",   amount: "$245.20", age: "44m ago", issue: "MAS Trips App Issue", attempts: "1/4" },
  { id: 7, conf: "C-2026-04815", status: "Queued",    amount: "$176.80", age: "1h ago",  issue: "GPS Control Deviation", claimedBy: "M. Rivera" },
  { id: 8, conf: "C-2026-04816", status: "In Progress", amount: "$198.00", age: "1h ago", issue: "Custom Payment Request", attempts: "2/4" },
  { id: 9, conf: "C-2026-04817", status: "Submitted", amount: "$215.90", age: "2h ago",  issue: "GPS Control Deviation", ticket: "MAS-2026-A8841" },
  { id: 10, conf: "C-2026-04818", status: "Submitted", amount: "$184.50", age: "3h ago", issue: "Vehicle, Driver, or TPP", ticket: "MAS-2026-A8839" },
  { id: 11, conf: "C-2026-04819", status: "Failed",   amount: "$112.40", age: "4h ago",  issue: "GPS Control Deviation", attempts: "3/4", error: "Portal session expired" },
];

export const statusOrder: SubStatus[] = ["Draft", "Pending", "Queued", "In Progress", "Submitted", "Failed"];

export const counts: Record<SubStatus, number> = {
  Draft: 3, Pending: 3, Queued: 1, "In Progress": 1, Submitted: 2, Failed: 1, Cancelled: 0, "Dry Run": 0,
};

export const recentRuns = [
  { id: "b-22", at: "7m ago",  by: "M. Rivera", total: 23, ok: 23, fail: 0, status: "Success" as const },
  { id: "b-21", at: "1h ago",  by: "M. Rivera", total: 12, ok: 11, fail: 1, status: "Success" as const },
  { id: "b-20", at: "3h ago",  by: "system",    total:  6, ok:  4, fail: 2, status: "Failed"  as const },
];

export const fieldsForDrawer = [
  { label: "Issue Type",  value: "GPS Control Deviation" },
  { label: "Subject",     value: "Dispute C-2026-04812 — mileage mismatch" },
  { label: "Email",       value: "claims@nemtprovider.com" },
  { label: "Provider",    value: "MetroRide NEMT Inc." },
  { label: "Phone",       value: "(518) 555-0144" },
  { label: "Invoice #",   value: "INV-2026-0419" },
  { label: "GPS Breadcrumbs", value: "Yes" },
];

export const narrativeText =
  "On Apr 14, 2026 at 09:42, member CLT-44210 was transported by VAN-118 from 410 Union St to Albany Medical Center. The trip was rejected with rate code R-12 mileage mismatch (expected 14.2 mi, billed 9.8 mi). GPS breadcrumbs from the on-board telematics confirm the route distance was 14.18 mi, within the authorized rate code. We have attached the trip log and the member's auth letter showing the pickup falls within the approved window 09:00–17:00.";

export const attachments = [
  { name: "trip-log-04812.pdf", size: "124 KB", kind: "pdf" },
  { name: "auth-letter-CLT-44210.pdf", size: "86 KB",  kind: "pdf" },
  { name: "gps-breadcrumb.png", size: "212 KB", kind: "img" },
];

export const botActivity = [
  { ok: true,  at: "Apr 26, 9:01am", action: "Logged in to MAS portal", message: "Session created via cached cookie" },
  { ok: true,  at: "Apr 26, 9:01am", action: "Opened New Dispute form", message: "Confirmation # C-2026-04812 located" },
  { ok: true,  at: "Apr 26, 9:02am", action: "Filled form fields",      message: "7 fields populated" },
  { ok: true,  at: "Apr 26, 9:02am", action: "Attached evidence",        message: "3 files (422 KB total)" },
  { ok: true,  at: "Apr 26, 9:02am", action: "Submitted",                message: "Ticket MAS-2026-A8841 assigned" },
];

export const subStatusColor: Record<SubStatus, { bg: string; fg: string }> = {
  "Draft":       { bg: "var(--cc-blue-bg)",   fg: "var(--cc-blue-fg)" },
  "Pending":     { bg: "var(--cc-amber-bg)",  fg: "var(--cc-amber-fg)" },
  "Queued":      { bg: "var(--cc-purple-bg)", fg: "var(--cc-purple-fg)" },
  "In Progress": { bg: "var(--cc-blue-bg)",   fg: "var(--cc-blue-fg)" },
  "Submitted":   { bg: "var(--cc-green-bg)",  fg: "var(--cc-green-fg)" },
  "Failed":      { bg: "var(--cc-red-bg)",    fg: "var(--cc-red-fg)" },
  "Cancelled":   { bg: "var(--cc-muted)",     fg: "var(--cc-muted-fg)" },
  "Dry Run":     { bg: "var(--cc-purple-bg)", fg: "var(--cc-purple-fg)" },
};

export function SubStatusPill({ status }: { status: SubStatus }) {
  const c = subStatusColor[status];
  return (
    <span className="cc-badge" style={{ background: c.bg, color: c.fg, border: "none" }}>{status}</span>
  );
}

export function PageHeader({ counts: c, activeFilter = "All" }: { counts: Record<SubStatus, number>; activeFilter?: "All" | SubStatus }) {
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const tabs: ("All" | SubStatus)[] = ["All", "Draft", "Pending", "Queued", "In Progress", "Submitted", "Failed"];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Portal Submissions</h2>
          <p className="text-sm" style={{ color: "var(--cc-muted-fg)" }}>The MAS portal queue. {total} active items.</p>
        </div>
        <div className="flex items-center gap-2">
          <input placeholder="Search conf #" className="cc-input text-sm" style={{
            background: "var(--cc-card)", border: "1px solid var(--cc-border)",
            borderRadius: 6, padding: "0.4rem 0.65rem", width: 200, fontSize: 13,
          }} />
        </div>
      </div>
      <div className="cc-card flex items-center p-1 gap-1" style={{ background: "var(--cc-muted)", borderColor: "var(--cc-border)", width: "fit-content" }}>
        {tabs.map(t => {
          const count = t === "All" ? total : c[t];
          const active = t === activeFilter;
          return (
            <button key={t} className="px-3 py-1.5 text-xs rounded font-medium transition-colors flex items-center gap-1.5" style={{
              background: active ? "var(--cc-bg)" : "transparent",
              color: active ? "var(--cc-fg)" : "var(--cc-muted-fg)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.04)" : "none",
            }}>
              {t}
              {count > 0 && (
                <span className="text-[10px] px-1 rounded font-bold" style={{
                  background: active ? "var(--cc-muted)" : "transparent",
                  color: active ? "var(--cc-fg)" : "var(--cc-muted-fg)",
                  minWidth: 14, textAlign: "center",
                }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StatusStrip() {
  return (
    <div className="cc-card flex items-center gap-4 px-4 py-2 text-xs" style={{ background: "var(--cc-card)", borderColor: "var(--cc-border)" }}>
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cc-success)" }} />
        <span className="font-medium">Worker healthy</span>
      </span>
      <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
      <span style={{ color: "var(--cc-muted-fg)" }}>Last batch <span style={{ color: "var(--cc-fg)" }}>7m ago</span> by <span style={{ color: "var(--cc-fg)" }}>M. Rivera</span></span>
      <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
      <span style={{ color: "var(--cc-success)" }}>23/23 succeeded</span>
      <a href="#" className="ml-auto" style={{ color: "var(--cc-primary)", fontWeight: 500 }}>View recent runs →</a>
    </div>
  );
}

export function Section({ title, children, action, className = "", icon }: { title: ReactNode; children: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={`cc-card ${className}`}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)" }}>
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function ActionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-2 py-2" style={{ borderTop: "1px solid var(--cc-border)" }}>
      <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function RowAction({ icon, label, sub, disabled, muted, onClick }: { icon: ReactNode; label: string; sub?: string; disabled?: boolean; muted?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left px-2.5 py-1.5 rounded transition-colors flex items-start gap-2 hover:bg-[var(--cc-muted)] disabled:opacity-50 disabled:cursor-not-allowed" disabled={disabled}>
      <div className="mt-0.5" style={{ color: muted ? "var(--cc-muted-fg)" : "var(--cc-fg)" }}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: muted ? "var(--cc-muted-fg)" : "var(--cc-fg)" }}>{label}</div>
        {sub && <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>}
      </div>
    </button>
  );
}
