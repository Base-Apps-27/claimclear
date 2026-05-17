import "./_group.css";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  Upload,
  MessageSquare,
  History,
  XCircle,
  Tag,
  Link as LinkIcon,
  Circle,
  Copy,
  Layers,
  Inbox,
  Send,
  Paperclip,
  Check,
  PauseCircle
} from "lucide-react";

type LegStatus = "investigating" | "ready" | "review" | "hold";
type EvidenceFile = { name: string; size: string; date: string; missing?: boolean; requiredBy?: string; badge?: string };
type SopAnswer = { q: string; a: string; state: "yes" | "no" | "blocked" | "pending"; blockReason?: string };
type LegAuditEntry = { when: string; who: string; what: string; tone?: "block" | "ok" | "muted" };
type LegVerdict = { tone: "approved" | "denied" | "pending"; headline: string; sub: string };
type Leg = {
  key: string;
  ref: string;
  serviceDate: string;
  amount: string;
  errorType: string;
  status: LegStatus;
  statusLabel: string;
  sopProgress: string;
  evidenceCount: string;
  sop: SopAnswer[];
  evidence: EvidenceFile[];
  evidenceTotal: number;
  audit: LegAuditEntry[];
  verdict: LegVerdict;
};

const LEGS: Record<string, Leg> = {
  "1278": {
    key: "1278",
    ref: "15018283",
    serviceDate: "Apr 18, 2026, 12:00 AM",
    amount: "$40.01",
    errorType: "GPS Pickup Too Far from Residence",
    status: "investigating",
    statusLabel: "Investigating",
    sopProgress: "SOP 3/4",
    evidenceCount: "2/3",
    evidenceTotal: 3,
    sop: [
      { q: "Was the ride cancelled?", a: "No", state: "yes" },
      { q: "Did driver claim pick up?", a: "Yes", state: "yes" },
      { q: "GPS deviation under 5 mi?", a: "No - requires manual mapping", state: "blocked", blockReason: "needs gps_log.csv" },
      { q: "Submit exemption?", a: "Pending", state: "pending" },
    ],
    evidence: [
      { name: "trip_manifest.pdf", size: "124 KB", date: "Apr 19" },
      { name: "driver_statement.txt", size: "12 KB", date: "Apr 19" },
      { name: "gps_log.csv", size: "—", date: "—", missing: true, requiredBy: "SOP Q3" },
    ],
    audit: [
      { when: "Apr 19, 10:15 AM", who: "System", what: "Leg extracted from invoice", tone: "muted" },
      { when: "May 9, 3:30 PM", who: "Operator 1", what: "Walked SOP to Q3 — hit GPS-deviation block", tone: "block" },
      { when: "May 13, 7:43 AM", who: "System", what: "Group-level payor response received (does not auto-resolve this leg — blocked)", tone: "muted" },
    ],
    verdict: {
      tone: "pending",
      headline: "Pending — awaiting evidence",
      sub: "SOP Q3 blocked on gps_log.csv. Leg cannot resolve until evidence is provided.",
    },
  },
  "1277": {
    key: "1277",
    ref: "15018282",
    serviceDate: "Apr 18, 2026, 12:00 AM",
    amount: "$40.01",
    errorType: "GPS Pickup Too Far from Residence",
    status: "investigating",
    statusLabel: "Investigating",
    sopProgress: "SOP 4/4",
    evidenceCount: "3/3",
    evidenceTotal: 3,
    sop: [
      { q: "Was the ride cancelled?", a: "No", state: "yes" },
      { q: "Did driver claim pick up?", a: "Yes", state: "yes" },
      { q: "GPS deviation under 5 mi?", a: "Yes", state: "yes" },
      { q: "Submit exemption?", a: "Yes - package ready", state: "yes" },
    ],
    evidence: [
      { name: "trip_manifest.pdf", size: "124 KB", date: "Apr 19" },
      { name: "driver_statement.txt", size: "12 KB", date: "Apr 19" },
      { name: "gps_log.csv", size: "145 KB", date: "Apr 20" },
    ],
    audit: [
      { when: "Apr 19, 10:15 AM", who: "System", what: "Leg extracted from invoice", tone: "muted" },
      { when: "May 8, 2:14 PM", who: "Operator 1", what: "Walked SOP Q1–Q4 clean", tone: "ok" },
      { when: "May 13, 7:43 AM", who: "System", what: "Group payor verdict applied — Approved (duplicate-cluster resolver)", tone: "ok" },
    ],
    verdict: {
      tone: "approved",
      headline: "Approved — No recoupment",
      sub: "Inherited from group verdict on closed ticket #88582. Set by System via duplicate-cluster resolution.",
    },
  },
};

const STATUS_PILL: Record<LegStatus, { bg: string; fg: string; border: string }> = {
  ready: { bg: "var(--cc-green-bg)", fg: "var(--cc-green-fg)", border: "var(--cc-green-border)" },
  review: { bg: "var(--cc-amber-bg)", fg: "var(--cc-amber-fg)", border: "var(--cc-amber-border)" },
  investigating: { bg: "var(--cc-blue-bg)", fg: "var(--cc-blue-fg)", border: "var(--cc-blue-border)" },
  hold: { bg: "var(--cc-muted)", fg: "var(--cc-muted-fg)", border: "var(--cc-border)" },
};

const AUDIT_LOG = [
  { action: "queued 2 legs for re-attestation", author: "someidy.s@agapeny.com", time: "3d ago", type: "note" },
  { action: "Promoted 2 draft verdicts to operator_confirmed", author: "someidy.s@agapeny.com", time: "3d ago", type: "check" },
  { action: "Upgraded synthetic portal_response #497 with LLM classification", author: "system:duplicate_cluster_response_upgrade", time: "4d ago", type: "check" },
  { action: "Phase advanced from submitted → response_received", author: "System (duplicate-cluster phase backfill 2026-05-13)", time: "4d ago", type: "send" },
  { action: "Synthetic portal_response inserted", author: "System (duplicate-cluster response backfill 2026-05-13)", time: "4d ago", type: "send" },
  { action: "Routed to Ready to Review — verdict found on closed ticket #88582", author: "System (duplicate-cluster resolver 2026-05-13)", time: "5d ago", type: "send" },
  { action: 'Portal submission #1129 cancelled from "draft" status', author: "Emil J", time: "1w ago", type: "x" },
  { action: "Status changed from Portal Queued to Awaiting Response", author: "Batch Processor", time: "1w ago", type: "clock" },
  { action: "Status changed from Awaiting Response to Portal Queued (backfill)", author: "system (backfill)", time: "1w ago", type: "clock" },
];

const GROUP_FILES = [
  { id: "b0a6e5c3-11f7-4905-904a-4cfe1147b668.png", badge: "L1" },
  { id: "833cd17e-8dac-447d-93cd-f4a22eac3334.png", badge: "L1" },
  { id: "6b6ec689-1699-4939-af5a-aa4bb941185e.png", badge: "L1" },
  { id: "1fa92a44-76ff-429a-8cf9-a33347a812f1.png", badge: "L2" },
  { id: "625a2070-b6cf-4d4f-bc12-daff065a0bba.png", badge: "L2" },
  { id: "1d80aebe-a6f9-4f53-8557-ed94e3c1a40c.png", badge: "L2" },
  { id: "8b78ff9e-07c9-4866-a898-9397cb319527.png", badge: "L2" }
];

export default function D2Ledger() {
  const [selectedKey, setSelectedKey] = useState("1278");
  const selected = LEGS[selectedKey];

  return (
    <div className="cc-scope flex flex-col h-screen overflow-hidden bg-[var(--cc-bg)] text-[var(--cc-fg)]">
      
      {/* 1. TOP UTILITY BAR + HEADER */}
      <div className="flex-none bg-[var(--cc-card)] border-b border-[var(--cc-border)] flex flex-col z-20 shadow-sm relative">
        <div className="px-6 py-2 border-b border-[var(--cc-border)] flex items-center justify-between text-sm bg-[var(--cc-bg)]">
          <div className="flex items-center">
            <button className="flex items-center gap-1.5 text-[var(--cc-muted-fg)] hover:text-[var(--cc-fg)] transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Invoice groups
            </button>
            <span className="mx-2 text-[var(--cc-muted-fg)]">/</span>
            <span className="font-medium mono">1865697140</span>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-[var(--cc-muted-fg)] hover:text-[var(--cc-fg)] flex items-center gap-1.5 transition-colors">
              <Layers className="w-4 h-4" /> Transitions
            </button>
            <button className="text-[var(--cc-muted-fg)] hover:text-[var(--cc-fg)] flex items-center gap-1.5 transition-colors">
              <Inbox className="w-4 h-4" /> Sync inbox
            </button>
          </div>
        </div>

        <div className="px-6 py-4 flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-1 h-12 rounded bg-[var(--cc-green-fg)] shrink-0" aria-hidden="true" />
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold mono">1865697140</h1>
                <span className="cc-badge bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)]">Response received</span>
                <span className="cc-badge cc-badge-secondary border-dashed text-[var(--cc-muted-fg)]">cached: Ready to Review</span>
                <span className="cc-badge bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)]">Approved</span>
                <span className="text-sm font-medium px-2 py-0.5 rounded-md bg-[var(--cc-muted)] border border-[var(--cc-border)] flex items-center gap-1">
                  GPS Pickup Too Far from Residence
                </span>
                <span className="text-sm text-[var(--cc-muted-fg)] px-1">—</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-[var(--cc-muted-fg)] mt-1.5">
                <span>Updated 3d ago</span>
                <span>•</span>
                <span>19d in queue</span>
                <span>•</span>
                <span>Service date <span className="text-[var(--cc-fg)] font-medium">Apr 18, 2026</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. PAYOR ALERT BANNER */}
      <div className="flex-none px-6 py-2.5 bg-[var(--cc-blue-bg)] border-b border-[var(--cc-blue-border)] flex items-start gap-3 relative z-10">
        <MessageSquare className="w-4 h-4 text-[var(--cc-blue-fg)] mt-0.5 shrink-0" />
        <div className="flex-1 text-sm text-[var(--cc-blue-fg)]">
          <p className="font-semibold mb-0.5">New response from payor · Verdict on closed ticket #88582 (duplicate-cluster backfill) · 4d ago</p>
          <p className="opacity-90 truncate max-w-4xl">"GPS Exemption Request Approved A detailed review of the GPS data received for invoice 1865697140 confirmed GPS compliance despite the event IDs submitted…"</p>
        </div>
        <button className="cc-btn cc-btn-sm bg-white/50 hover:bg-white text-[var(--cc-blue-fg)] border-[var(--cc-blue-border)] shrink-0">
          Jump to thread
        </button>
      </div>

      {/* 3. KPI STRIP */}
      <div className="flex-none border-b border-[var(--cc-border)] bg-[var(--cc-bg)] flex divide-x divide-[var(--cc-border)] z-10 relative">
        <KpiTile label="Total Exposure" value="$80.02" sub="2 legs" />
        <KpiTile label="In Dispute" value="$0.00" sub="0 legs" />
        <KpiTile label="Non-Issue" value="$0.00" sub="—" />
        <KpiTile label="Recovered" value="$0.00" sub="—" />
        <KpiTile label="Days in Queue" value="19" />
      </div>

      {/* 4. 3-COLUMN BODY */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* LEFT COLUMN: Summary & Actions */}
        <div className="w-[260px] shrink-0 border-r border-[var(--cc-border)] flex flex-col overflow-y-auto bg-[var(--cc-bg)] custom-scrollbar">
          <div className="p-4 space-y-4">
            
            {/* Primary CTA */}
            <div className="flex flex-col gap-2">
              <div className="text-[10px] text-[var(--cc-muted-fg)] uppercase tracking-wider font-semibold">Primary Action</div>
              <button className="w-full flex items-center justify-between px-4 py-3 bg-[var(--cc-primary)] hover:bg-[hsl(219_85%_45%)] text-white rounded-md transition-colors group shadow-sm border border-[var(--cc-primary)]">
                <div className="text-left">
                  <div className="font-semibold text-sm">Open in queue</div>
                  <div className="text-[10px] opacity-80 mt-0.5 font-medium">Walk SOP &amp; build submission</div>
                </div>
                <ArrowRight className="w-5 h-5 opacity-80 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            {/* Submission Summary */}
            <div className="cc-card overflow-hidden">
              <div className="bg-[var(--cc-muted)]/50 px-3 py-2 border-b border-[var(--cc-border)] flex items-center justify-between">
                 <h3 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--cc-muted-fg)]">Submission Summary</h3>
                 <span className="cc-badge bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)] text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5">Ready to Review</span>
              </div>
              <div className="p-3 bg-[var(--cc-card)]">
                <p className="text-[10px] text-[var(--cc-muted-fg)] mb-3 leading-tight">
                  Read-only snapshot of where this group is in the submission pipeline. All operator actions live in the queue.
                </p>
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[var(--cc-muted-fg)]">Preview generated</span>
                    <span className="flex items-center gap-1 text-[var(--cc-success)] font-medium">
                      <CheckCircle2 className="w-3 h-3" /> May 9, 4:07 PM
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[var(--cc-muted-fg)]">Draft reviewed</span>
                    <span className="flex items-center gap-1 text-[var(--cc-success)] font-medium">
                      <CheckCircle2 className="w-3 h-3" /> May 9, 4:07 PM
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[var(--cc-muted-fg)]">Last submitted</span>
                    <span className="flex items-center gap-1 text-[var(--cc-success)] font-medium">
                      <CheckCircle2 className="w-3 h-3" /> May 9, 5:39 PM
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Group Details */}
            <div className="cc-card overflow-hidden">
               <div className="bg-[var(--cc-muted)]/50 px-3 py-2 border-b border-[var(--cc-border)]">
                 <h3 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--cc-muted-fg)]">Group Details</h3>
              </div>
              <div className="p-2 px-3">
                <FieldRow label="Invoice #" value={<span className="flex items-center gap-1">1865697140 <Copy className="w-3 h-3 text-[var(--cc-muted-fg)] cursor-pointer" /></span>} />
                <FieldRow label="Payor" value="—" />
                <FieldRow label="Plan" value="SR50480M" />
                <FieldRow label="Submitted" value="May 9 2026, 5:39 PM" />
                <FieldRow label="Error Type" value={<span className="truncate max-w-[120px] block" title="GPS Pickup Too Far from Residence">GPS Pickup...</span>} />
                <FieldRow label="Closure Rsn" value={<span className="text-[var(--cc-muted-fg)]">n/a</span>} />
              </div>
            </div>

            {/* Admin Actions — consolidated: Overrides + MAS + Close-group */}
            <div className="cc-card overflow-hidden">
               <div className="bg-[var(--cc-purple-bg)] px-3 py-2 border-b border-[var(--cc-purple-border)] text-[var(--cc-purple-fg)] flex items-center justify-between">
                 <h3 className="text-[10px] uppercase tracking-wider font-semibold">Overrides &amp; Admin</h3>
                 <span className="text-[9px] uppercase tracking-wider font-bold opacity-70">Operator only</span>
              </div>

              {/* MAS status row */}
              <div className="px-3 py-2 border-b border-[var(--cc-border)] bg-[var(--cc-amber-bg)]/40 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--cc-amber-fg)]">
                  <AlertTriangle className="w-3 h-3" /> MAS · Reattest required
                </div>
                <span className="text-[9px] font-semibold text-[var(--cc-muted-fg)] uppercase tracking-wide">2 legs</span>
              </div>
              <button className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-[var(--cc-success)] hover:bg-[var(--cc-muted)] border-b border-[var(--cc-border)] flex items-center gap-1.5">
                <Check className="w-3 h-3" /> Mark as already re-attested
              </button>

              {/* Group-level overrides */}
              <div className="p-1.5 flex flex-col gap-0.5">
                <AdminRow label="Place on hold" icon={<PauseCircle className="w-3.5 h-3.5" />} />
                <AdminRow label="Withdraw" icon={<XCircle className="w-3.5 h-3.5" />} />
                <AdminRow label="Reclassify legs" icon={<Tag className="w-3.5 h-3.5" />} />
                <AdminRow label="Mark duplicates" icon={<LinkIcon className="w-3.5 h-3.5" />} />
              </div>

              {/* Close-group with closure-reason picker */}
              <div className="border-t border-[var(--cc-border)] bg-[var(--cc-muted)]/30 p-2 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] px-1">
                  <CheckCircle2 className="w-3 h-3" /> Close this group
                </div>
                <div className="flex flex-col gap-0.5">
                  <ClosureReasonRow label="Denied by Payor" hint="Payor verdict received · close-out" />
                  <ClosureReasonRow label="Withdrawn" hint="Operator-initiated withdrawal" />
                  <ClosureReasonRow label="Resolved · non-issue" hint="No further action needed" />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* CENTER COLUMN: Ledger + Focus Panel */}
        <div className="flex-1 border-r border-[var(--cc-border)] flex flex-col bg-[var(--cc-bg)] overflow-hidden">
          
          <div className="flex-1 flex flex-col min-h-0 relative">
            <div className="flex-none px-4 py-3 border-b border-[var(--cc-border)] flex items-center justify-between bg-[var(--cc-card)] shadow-sm z-10">
              <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--cc-fg)]">
                <Layers className="w-4 h-4 text-[var(--cc-muted-fg)]" />
                Disputed Legs <span className="text-[var(--cc-muted-fg)] font-normal text-xs ml-1">(2 active)</span>
              </h2>
            </div>
            
            {/* Ledger List */}
            <div className="flex-none p-4 space-y-2 border-b border-[var(--cc-border)] bg-[var(--cc-muted)]/30 max-h-[300px] overflow-y-auto custom-scrollbar shadow-inner">
              {Object.values(LEGS).map((leg) => (
                <LegRow
                  key={leg.key}
                  leg={leg}
                  selected={selectedKey === leg.key}
                  onClick={() => setSelectedKey(leg.key)}
                />
              ))}
            </div>

            {/* Persistent Focus Panel */}
            <div className="flex-1 overflow-y-auto bg-[var(--cc-bg)] custom-scrollbar">
              <FocusPanel leg={selected} />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Comms & Audit */}
        <div className="w-[320px] shrink-0 bg-[var(--cc-bg)] flex flex-col overflow-y-auto custom-scrollbar">
          
          <div className="p-4 space-y-4">
             {/* Communication & Payor Responses (consolidated thread) */}
             <div className="cc-card overflow-hidden border-[var(--cc-green-border)]">
                <div className="bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] px-3 py-2 border-b border-[var(--cc-green-border)] flex items-center justify-between">
                  <h3 className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-1.5"><MessageSquare className="w-3 h-3" /> Communication</h3>
                  <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-white/60 border border-[var(--cc-green-border)] rounded">Group verdict · Approved</span>
                </div>
                <div className="divide-y divide-[var(--cc-border)]">

                   {/* Message 1: payor verdict via portal (the response) */}
                   <div className="p-3 bg-[var(--cc-card)]">
                     <div className="flex items-center justify-between mb-1 text-xs">
                        <span className="font-semibold text-[var(--cc-fg)]">Payor portal · backfill</span>
                        <span className="text-[var(--cc-muted-fg)] text-[10px]">May 13, 2026 · 7:43 AM</span>
                     </div>
                     <div className="flex items-center gap-1.5 mb-2 mt-1.5">
                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] rounded border border-[var(--cc-green-border)]">approval</span>
                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-[var(--cc-muted)] text-[var(--cc-muted-fg)] rounded border border-[var(--cc-border)]">portal</span>
                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-[var(--cc-muted)] text-[var(--cc-muted-fg)] rounded border border-[var(--cc-border)]">ticket #88582</span>
                     </div>
                     <p className="text-[11px] font-semibold text-[var(--cc-fg)] mb-1">GPS Exemption Request Approved</p>
                     <p className="text-[11px] text-[var(--cc-fg)] opacity-90 leading-relaxed bg-[var(--cc-muted)]/40 p-2 rounded border border-[var(--cc-border)]">
                       A detailed review of the GPS data received for invoice 1865697140 confirmed GPS compliance despite the event IDs submitted via GPS being incorrect.
                     </p>
                     <p className="text-[10px] text-[var(--cc-muted-fg)] mt-2 italic">Applied to: Leg #1277 ✓ · Leg #1278 blocked (missing evidence)</p>
                   </div>

                   {/* Message 2: operator note replying to verdict */}
                   <div className="p-3 bg-[var(--cc-card)]">
                     <div className="flex items-center justify-between mb-1 text-xs">
                        <span className="font-semibold text-[var(--cc-fg)]">Operator 1 · note</span>
                        <span className="text-[var(--cc-muted-fg)] text-[10px]">May 13, 2026 · 9:02 AM</span>
                     </div>
                     <p className="text-[11px] text-[var(--cc-fg)]">Verdict applied to Leg #1277. Need to resolve Leg #1278 GPS log separately before this group can fully close.</p>
                   </div>

                   {/* Message 3: original outbound submission */}
                   <div className="p-3 bg-[var(--cc-card)]">
                     <div className="flex items-center justify-between mb-1 text-xs">
                        <span className="font-semibold text-[var(--cc-fg)]">Outbound · portal submission</span>
                        <span className="text-[var(--cc-muted-fg)] text-[10px]">May 9, 2026 · 5:39 PM</span>
                     </div>
                     <div className="flex items-center gap-1.5 mb-2 mt-1.5">
                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-[var(--cc-blue-bg)] text-[var(--cc-blue-fg)] rounded border border-[var(--cc-blue-border)]">submission</span>
                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-[var(--cc-muted)] text-[var(--cc-muted-fg)] rounded border border-[var(--cc-border)]">2 legs · GPS exemption pkg</span>
                     </div>
                     <p className="text-[11px] text-[var(--cc-fg)]">Submitted GPS exemption package for both legs to payor portal. Awaiting verdict.</p>
                   </div>

                   {/* Reply box */}
                   <div className="p-2 bg-[var(--cc-muted)]/30 flex gap-2">
                      <input type="text" placeholder="Reply to thread..." className="flex-1 cc-input text-xs py-1.5 bg-[var(--cc-card)]" />
                      <button className="cc-btn cc-btn-sm cc-btn-primary px-2 py-1"><Send className="w-3.5 h-3.5" /></button>
                   </div>
                </div>
             </div>

             {/* Group Evidence */}
             <div className="cc-card overflow-hidden">
                <div className="bg-[var(--cc-muted)]/50 px-3 py-2 border-b border-[var(--cc-border)]">
                  <h3 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--cc-muted-fg)]">Group Evidence • 7 files</h3>
                </div>
                <div className="p-2 flex flex-wrap gap-1.5 bg-[var(--cc-card)]">
                   {GROUP_FILES.map((f, i) => (
                     <div key={i} className="flex items-center gap-1.5 border border-[var(--cc-border)] rounded px-1.5 py-1 text-[10px] hover:border-[var(--cc-primary)] cursor-pointer group">
                        <FileText className="w-3 h-3 text-[var(--cc-blue-fg)]" />
                        <span className="truncate max-w-[80px] font-medium" title={f.id}>{f.id}</span>
                        <span className="px-1 bg-[var(--cc-muted)] rounded font-semibold text-[var(--cc-muted-fg)]">{f.badge}</span>
                     </div>
                   ))}
                </div>
             </div>

             {/* Notes */}
             <div className="cc-card overflow-hidden">
                <div className="bg-[var(--cc-muted)]/50 px-3 py-2 border-b border-[var(--cc-border)] flex items-center justify-between">
                  <h3 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--cc-muted-fg)]">Notes • 0</h3>
                </div>
                <div className="p-3 bg-[var(--cc-card)] text-center">
                   <p className="text-[11px] text-[var(--cc-muted-fg)] italic mb-3">No notes recorded for this group yet.</p>
                   <div className="flex gap-2">
                     <input type="text" placeholder="Add note..." className="flex-1 cc-input text-[11px] py-1.5" />
                     <button className="cc-btn cc-btn-sm cc-btn-primary px-2 py-1"><Send className="w-3.5 h-3.5" /></button>
                   </div>
                </div>
             </div>

             {/* Audit Trail */}
             <div className="cc-card overflow-hidden">
                <div className="bg-[var(--cc-muted)]/50 px-3 py-2 border-b border-[var(--cc-border)] flex items-center justify-between">
                  <h3 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--cc-muted-fg)]">Activity history</h3>
                </div>
                <div className="p-3 bg-[var(--cc-card)] space-y-4 text-xs">
                   {AUDIT_LOG.map((log, i) => (
                     <div key={i} className="flex gap-2.5 items-start">
                        <div className="mt-0.5 text-[var(--cc-muted-fg)] shrink-0 opacity-70">
                          {log.type === "note" ? <FileText className="w-3.5 h-3.5" /> :
                           log.type === "check" ? <CheckCircle2 className="w-3.5 h-3.5 text-[var(--cc-success)]" /> :
                           log.type === "send" ? <Send className="w-3.5 h-3.5 text-[var(--cc-blue-fg)]" /> :
                           log.type === "x" ? <XCircle className="w-3.5 h-3.5 text-[var(--cc-destructive)]" /> :
                           <Clock className="w-3.5 h-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                           <p className="text-[11px] text-[var(--cc-fg)] leading-snug break-words">{log.action}</p>
                           <p className="text-[9px] text-[var(--cc-muted-fg)] mt-0.5 font-medium uppercase tracking-wide">{log.author} • {log.time}</p>
                        </div>
                     </div>
                   ))}
                </div>
             </div>

          </div>
        </div>
      </div>
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 p-3 px-4 flex flex-col justify-center">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--cc-muted-fg)] mb-1">{label}</div>
      <div className="text-xl font-bold mono tracking-tight text-[var(--cc-fg)]">{value}</div>
      {sub && <div className="text-[10px] text-[var(--cc-muted-fg)] mt-0.5 font-medium">{sub}</div>}
    </div>
  );
}

function AdminRow({ label, icon, tone }: { label: string; icon?: React.ReactNode; tone?: string }) {
  return (
    <button className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors flex items-center gap-2 hover:bg-[var(--cc-muted)] ${tone || "text-[var(--cc-muted-fg)] hover:text-[var(--cc-fg)]"}`}>
      {icon && <span className="opacity-70">{icon}</span>}
      <span className="font-medium">{label}</span>
    </button>
  );
}

function ClosureReasonRow({ label, hint }: { label: string; hint: string }) {
  return (
    <button className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-[var(--cc-card)] flex items-center justify-between gap-2 transition-colors border border-transparent hover:border-[var(--cc-border)]">
      <div className="flex flex-col">
        <span className="font-semibold text-[11px] text-[var(--cc-fg)]">{label}</span>
        <span className="text-[10px] text-[var(--cc-muted-fg)]">{hint}</span>
      </div>
      <ArrowRight className="w-3 h-3 text-[var(--cc-muted-fg)] shrink-0" />
    </button>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm border-b border-dashed border-[var(--cc-border)] last:border-0">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--cc-muted-fg)] shrink-0">{label}</span>
      <span className="font-medium mono text-right text-[11px] truncate ml-2">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Leg row in the ledger                                              */
/* ------------------------------------------------------------------ */

function LegRow({ leg, selected, onClick }: { leg: Leg; selected: boolean; onClick: () => void }) {
  const pill = STATUS_PILL[leg.status];
  const dim = leg.status === "hold" ? "text-[var(--cc-muted-fg)] opacity-80" : "";
  
  return (
    <button
      className={`w-full text-left rounded-md border p-3 transition-all relative overflow-hidden group ${
        selected
          ? "bg-[var(--cc-card)] border-[var(--cc-primary)] shadow-sm ring-1 ring-[var(--cc-primary)] z-10"
          : "bg-[var(--cc-card)] border-[var(--cc-border)] hover:border-[var(--cc-primary)] hover:shadow-sm"
      }`}
      onClick={onClick}
    >
      {selected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--cc-primary)]" />}
      
      <div className="flex justify-between items-start mb-1.5">
        <div>
          <div className={`font-mono text-sm font-bold flex items-center gap-1.5 ${dim}`}>
             {leg.ref} <span className="text-[9px] font-sans font-semibold tracking-wider text-[var(--cc-muted-fg)] px-1.5 py-0.5 bg-[var(--cc-muted)] rounded border border-[var(--cc-border)]">LEG #{leg.key}</span>
          </div>
          <div className="text-[10px] text-[var(--cc-muted-fg)] mt-1 font-medium tracking-wide uppercase">{leg.serviceDate}</div>
        </div>
        <div className="text-right">
           <span className={`font-bold text-sm mono ${dim}`}>{leg.amount}</span>
           <div className="mt-1.5">
             <span
               className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border"
               style={{ background: pill.bg, color: pill.fg, borderColor: pill.border }}
             >
               {leg.statusLabel}
             </span>
           </div>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Focus panel — renders for ANY selected leg                          */
/* ------------------------------------------------------------------ */

function FocusPanel({ leg }: { leg: Leg }) {
  const validEvidence = leg.evidence.filter((e) => !e.missing).length;
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* FOCUS HEADER & ACTIONS */}
      <div className="flex items-start justify-between gap-4 border-b border-[var(--cc-border)] pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
             <h2 className="text-2xl font-bold mono">{leg.ref}</h2>
             <span className="text-xs font-semibold tracking-wider uppercase text-[var(--cc-muted-fg)] bg-[var(--cc-muted)] px-2 py-0.5 rounded border border-[var(--cc-border)]">Leg #{leg.key}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[var(--cc-muted-fg)] font-medium uppercase tracking-wide mt-2">
            <span className="text-[var(--cc-fg)] font-bold text-sm mono tracking-tight">{leg.amount}</span>
            <span>•</span>
            <span>Service: {leg.serviceDate}</span>
            <span>•</span>
            <span className="truncate max-w-[250px]">{leg.errorType}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button className="cc-btn cc-btn-sm cc-btn-ghost text-[var(--cc-muted-fg)] border border-[var(--cc-border)] bg-white hover:bg-[var(--cc-muted)]"><Tag className="w-3 h-3" /> Reclassify</button>
            <button className="cc-btn cc-btn-sm cc-btn-ghost text-[var(--cc-muted-fg)] border border-[var(--cc-border)] bg-white hover:bg-[var(--cc-muted)]"><XCircle className="w-3 h-3" /> Exclude</button>
            <button className="cc-btn cc-btn-sm cc-btn-ghost text-[var(--cc-muted-fg)] border border-[var(--cc-border)] bg-white hover:bg-[var(--cc-muted)]"><LinkIcon className="w-3 h-3" /> Mark dup</button>
            <button className="cc-btn cc-btn-sm cc-btn-ghost text-[var(--cc-muted-fg)] border border-[var(--cc-border)] bg-white hover:bg-[var(--cc-muted)]"><CheckCircle2 className="w-3 h-3" /> Offline</button>
          </div>
          <button className="text-xs text-[var(--cc-primary)] font-semibold hover:underline flex items-center gap-1 mt-1">Walk this SOP in Queue <ArrowRight className="w-3 h-3" /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
         
         {/* LEFT SUB-COLUMN: SOP */}
         <div className="space-y-6">
            <div className="cc-card overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--cc-muted)]/50 border-b border-[var(--cc-border)] flex justify-between items-center">
                <h3 className="font-semibold text-xs uppercase tracking-wider flex items-center gap-2 text-[var(--cc-muted-fg)]">
                  <Layers className="w-3.5 h-3.5" />
                  SOP Transcript
                </h3>
                <span className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 bg-[var(--cc-card)] border border-[var(--cc-border)] text-[var(--cc-muted-fg)] rounded">{leg.sopProgress}</span>
              </div>
              <div className="bg-[var(--cc-card)]">
                {leg.sop.map((row, i) => (
                  <SopRow key={i} index={i + 1} row={row} />
                ))}
              </div>
            </div>
            
            {/* AUDIT (Leg specific — data-driven) */}
            <div className="cc-card p-4 bg-[var(--cc-card)]">
               <h3 className="font-semibold mb-3 flex items-center gap-2 text-[var(--cc-muted-fg)] text-[10px] uppercase tracking-wider">
                 <History className="w-3.5 h-3.5" /> Per-Leg Audit Excerpt
               </h3>
               <div className="space-y-3 pl-1">
                 {leg.audit.map((e, i) => {
                   const dot =
                     e.tone === "block" ? "bg-[var(--cc-amber-bg)] border-[var(--cc-amber-border)]" :
                     e.tone === "ok"    ? "bg-[var(--cc-green-bg)] border-[var(--cc-green-border)]" :
                                          "bg-[var(--cc-border)]";
                   return (
                     <div key={i} className="relative pl-4 border-l-2 border-[var(--cc-border)]">
                       <div className={`absolute w-2 h-2 ${dot} border rounded-full -left-[5px] top-1.5`}></div>
                       <p className="text-[10px] text-[var(--cc-muted-fg)] mb-0.5 uppercase tracking-wide font-medium">{e.when} • {e.who}</p>
                       <p className="text-xs text-[var(--cc-fg)]">{e.what}</p>
                     </div>
                   );
                 })}
               </div>
            </div>
         </div>

         {/* RIGHT SUB-COLUMN: Evidence */}
         <div className="space-y-6">
            <div className="cc-card overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--cc-muted)]/50 border-b border-[var(--cc-border)] flex justify-between items-center">
                <h3 className="font-semibold text-xs uppercase tracking-wider flex items-center gap-2 text-[var(--cc-muted-fg)]">
                  <Paperclip className="w-3.5 h-3.5" />
                  Per-Leg Evidence
                  <span className="text-[var(--cc-muted-fg)] font-normal text-[10px] ml-1">
                    ({validEvidence}/{leg.evidenceTotal})
                  </span>
                </h3>
              </div>
              <div className="p-3 space-y-2 bg-[var(--cc-muted)]/30">
                {leg.evidence.map((file, i) => (
                  <EvidenceFileRow key={i} file={file} />
                ))}

                {/* DROP ZONE */}
                <div className="mt-3 border border-dashed border-[var(--cc-muted-fg)] opacity-60 rounded-md p-4 flex flex-col items-center justify-center text-center bg-[var(--cc-card)] hover:bg-[var(--cc-muted)] transition-colors cursor-pointer">
                  <Upload className="w-4 h-4 text-[var(--cc-muted-fg)] mb-1.5" />
                  <p className="text-[11px] font-medium text-[var(--cc-fg)] uppercase tracking-wide">Drag &amp; drop evidence</p>
                </div>
              </div>
            </div>
            
            {/* LEG VERDICT — data-driven per leg */}
            <LegVerdictCard verdict={leg.verdict} />
         </div>

      </div>
    </div>
  );
}

function SopRow({ index, row }: { index: number; row: SopAnswer }) {
  const isBlocked = row.state === "blocked";
  const isPending = row.state === "pending";
  const icon =
    row.state === "yes"     ? <CheckCircle2 className="w-3.5 h-3.5 text-[var(--cc-success)]" /> :
    row.state === "no"      ? <CheckCircle2 className="w-3.5 h-3.5 text-[var(--cc-success)]" /> :
    row.state === "blocked" ? <AlertTriangle className="w-3.5 h-3.5 text-[var(--cc-amber-fg)]" /> :
                              <Circle className="w-3.5 h-3.5 text-[var(--cc-muted-fg)]" />;
  const wrap =
    isBlocked ? "bg-[var(--cc-amber-bg)]/50 border-[var(--cc-amber-border)]/50" :
    isPending ? "bg-[var(--cc-card)] opacity-60" :
                "bg-[var(--cc-card)]";
  return (
    <div className={`flex px-4 py-3 border-b border-[var(--cc-border)] last:border-0 ${wrap}`}>
      <div className="w-6 shrink-0 pt-0.5">{icon}</div>
      <div className="flex-1 text-xs">
        <p className={`mb-1 uppercase tracking-wide font-semibold text-[10px] ${isBlocked ? "text-[var(--cc-amber-fg)]" : "text-[var(--cc-muted-fg)]"}`}>
          {row.q}
        </p>
        <p className={isBlocked ? "font-bold text-[var(--cc-amber-fg)] text-[13px]" : "font-medium text-[13px] text-[var(--cc-fg)]"}>
          {row.a}
        </p>
      </div>
    </div>
  );
}

function LegVerdictCard({ verdict }: { verdict: LegVerdict }) {
  if (verdict.tone === "approved") {
    return (
      <div className="cc-card p-4 bg-[var(--cc-green-bg)]/30 border-[var(--cc-green-border)]">
        <h3 className="font-bold text-[10px] uppercase tracking-wider mb-2 flex items-center gap-2 text-[var(--cc-green-fg)]">
          <CheckCircle2 className="w-3.5 h-3.5" /> Leg Verdict
        </h3>
        <p className="font-bold text-[var(--cc-fg)] mb-1 text-sm">{verdict.headline}</p>
        <p className="text-[11px] font-medium text-[var(--cc-muted-fg)]">{verdict.sub}</p>
      </div>
    );
  }
  if (verdict.tone === "denied") {
    return (
      <div className="cc-card p-4 bg-[var(--cc-amber-bg)]/40 border-[var(--cc-amber-border)]">
        <h3 className="font-bold text-[10px] uppercase tracking-wider mb-2 flex items-center gap-2 text-[var(--cc-amber-fg)]">
          <XCircle className="w-3.5 h-3.5" /> Leg Verdict
        </h3>
        <p className="font-bold text-[var(--cc-fg)] mb-1 text-sm">{verdict.headline}</p>
        <p className="text-[11px] font-medium text-[var(--cc-muted-fg)]">{verdict.sub}</p>
      </div>
    );
  }
  // pending
  return (
    <div className="cc-card p-4 bg-[var(--cc-muted)]/40 border border-dashed border-[var(--cc-border)]">
      <h3 className="font-bold text-[10px] uppercase tracking-wider mb-2 flex items-center gap-2 text-[var(--cc-muted-fg)]">
        <Clock className="w-3.5 h-3.5" /> Leg Verdict
      </h3>
      <p className="font-bold text-[var(--cc-fg)] mb-1 text-sm">{verdict.headline}</p>
      <p className="text-[11px] font-medium text-[var(--cc-muted-fg)]">{verdict.sub}</p>
    </div>
  );
}

function EvidenceFileRow({ file }: { file: EvidenceFile }) {
  if (file.missing) {
    return (
      <div className="flex items-center justify-between p-2.5 rounded border border-[var(--cc-amber-border)] bg-[var(--cc-amber-bg)] relative overflow-hidden shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-white/60 rounded border border-[var(--cc-amber-border)] text-[var(--cc-amber-fg)]"><AlertTriangle className="w-3.5 h-3.5" /></div>
          <div>
            <p className="text-[12px] font-bold text-[var(--cc-amber-fg)]">{file.name}</p>
            <p className="text-[9px] font-bold text-[var(--cc-amber-fg)] opacity-90 uppercase tracking-wider mt-0.5">
              MISSING{file.requiredBy ? ` • ${file.requiredBy}` : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between p-2.5 rounded border border-[var(--cc-border)] bg-[var(--cc-card)] shadow-sm group hover:border-[var(--cc-primary)] cursor-pointer transition-colors">
      <div className="flex items-center gap-3">
        <div className="p-1.5 bg-[var(--cc-blue-bg)] rounded border border-[var(--cc-blue-border)] text-[var(--cc-blue-fg)] group-hover:bg-[var(--cc-primary)] group-hover:text-white group-hover:border-[var(--cc-primary)] transition-colors"><FileText className="w-3.5 h-3.5" /></div>
        <div>
          <p className="text-[12px] font-bold text-[var(--cc-fg)] truncate max-w-[180px]">{file.name}</p>
          <p className="text-[10px] text-[var(--cc-muted-fg)] font-mono font-medium tracking-tight mt-0.5">{file.size} • {file.date}</p>
        </div>
      </div>
      <Check className="w-4 h-4 text-[var(--cc-success)] opacity-80" />
    </div>
  );
}
