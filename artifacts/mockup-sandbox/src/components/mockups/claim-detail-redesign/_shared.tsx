import { ReactNode } from "react";

export const claim = {
  confNumber: "C-2026-04812",
  refNumber: "REF-887193-A",
  status: "In Dispute",
  outcome: "Pending",
  date: "Apr 24, 2026",
  clientNumber: "CLT-44210",
  carNumber: "VAN-118",
  claimAmount: "$184.50",
  payorEmail: "claims@masmedicaid.gov",
  errorDetails: "Trip mileage mismatch (rate code R-12 expected 14.2 mi, billed 9.8 mi); Pickup time falls outside authorized window 09:00-17:00",
  errorTypeName: null as string | null,
  holdReason: null as string | null,
  approvedAmount: null as string | null,
  parentInvoice: { id: 2, number: "INV-2026-0419", legCount: 12, totalAmount: "$2,184.50" },
};

export const validOutcomes = ["In Dispute", "Approved", "Denied", "Withdrawn"];
export const validStatuses = ["Needs Review", "Needs Evidence", "On Hold", "Submitted", "Closed"];

export const evidenceItems = [
  { id: 1, type: "Trip Log", note: "GPS-verified mileage 14.2mi", at: "Apr 25, 10:14am", by: "M. Rivera" },
  { id: 2, type: "Authorization Letter", note: "Member auth window includes 18:30 pickup", at: "Apr 25, 11:02am", by: "M. Rivera" },
];

export const submissions = [
  { id: 1, status: "Completed", submittedAt: "Apr 26, 9:01am", confirmation: "MAS-2026-A8841" },
];

export const responses = [
  {
    id: 1,
    type: "denial",
    typeLabel: "Denied",
    source: "email",
    subject: "Re: Dispute C-2026-04812 - Determination",
    body: "After review, the claim is denied. The trip exceeded the approved mileage authorization for rate code R-12.",
    sender: "MAS Adjudicator",
    receivedAt: "Apr 27, 2:15pm",
    confidence: "high",
    processed: false,
  },
];

export const emails = [
  { id: 1, dir: "outbound", sender: "ClaimClear", subject: "Dispute submission - C-2026-04812", at: "Apr 26, 9:01am", body: "Submitted dispute with GPS log and authorization letter." },
  { id: 2, dir: "inbound", sender: "MAS Adjudicator", subject: "Re: Dispute C-2026-04812 - Determination", at: "Apr 27, 2:15pm", body: "After review the claim is denied. The trip exceeded the approved mileage authorization for rate code R-12." },
];

export const auditLog = [
  { id: 1, at: "Apr 27, 2:16pm", actor: "system", action: "Response received and matched (denial)", viaGroup: false },
  { id: 2, at: "Apr 26, 9:01am", actor: "M. Rivera", action: "Queued for portal submission", viaGroup: false },
  { id: 3, at: "Apr 25, 11:02am", actor: "M. Rivera", action: "Added evidence: Authorization Letter", viaGroup: false },
  { id: 4, at: "Apr 25, 10:14am", actor: "M. Rivera", action: "Added evidence: Trip Log", viaGroup: false },
  { id: 5, at: "Apr 24, 4:48pm", actor: "M. Rivera", action: "Outcome set to In Dispute (group)", viaGroup: true },
  { id: 6, at: "Apr 24, 4:30pm", actor: "system", action: "Imported from invoice INV-2026-0419", viaGroup: true },
];

export const errorTypes = [
  { id: 1, name: "Mileage Mismatch", category: "Billing" },
  { id: 2, name: "Outside Auth Window", category: "Eligibility" },
  { id: 3, name: "Duplicate Charge", category: "Billing" },
];

export function Section({ title, children, action, className = "", icon }: { title: ReactNode; children: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={`cc-card ${className}`}>
      <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: "var(--cc-border)" }}>
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    "In Dispute": "var(--cc-blue-bg)",
    "Submitted": "var(--cc-blue-bg)",
    "Needs Review": "var(--cc-amber-bg)",
    "Needs Evidence": "var(--cc-amber-bg)",
    "On Hold": "var(--cc-purple-bg)",
    "Closed": "var(--cc-muted)",
    "Approved": "var(--cc-green-bg)",
    "Denied": "var(--cc-red-bg)",
  };
  const fg: Record<string, string> = {
    "In Dispute": "var(--cc-blue-fg)",
    "Submitted": "var(--cc-blue-fg)",
    "Needs Review": "var(--cc-amber-fg)",
    "Needs Evidence": "var(--cc-amber-fg)",
    "On Hold": "var(--cc-purple-fg)",
    "Closed": "var(--cc-muted-fg)",
    "Approved": "var(--cc-green-fg)",
    "Denied": "var(--cc-red-fg)",
  };
  return (
    <span className="cc-badge" style={{ background: colors[status] || "var(--cc-muted)", color: fg[status] || "var(--cc-fg)", border: "none" }}>
      {status}
    </span>
  );
}

export function PresenceAvatars() {
  return (
    <div className="flex -space-x-1.5">
      <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center border-2 border-white font-medium">MR</div>
    </div>
  );
}

export function InvoiceContextBar() {
  return (
    <div className="cc-card flex items-center gap-3 px-4 py-2 text-sm" style={{ background: "var(--cc-muted)", borderColor: "var(--cc-border)" }}>
      <span style={{ color: "var(--cc-muted-fg)" }}>Part of invoice</span>
      <a href="#" className="font-semibold mono" style={{ color: "var(--cc-primary)" }}>{claim.parentInvoice.number}</a>
      <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
      <span>{claim.parentInvoice.legCount} legs</span>
      <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
      <span>{claim.parentInvoice.totalAmount} total</span>
      <span className="ml-auto text-xs" style={{ color: "var(--cc-muted-fg)" }}>This claim is leg 4 of 12</span>
    </div>
  );
}
