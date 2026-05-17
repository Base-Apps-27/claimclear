import "./_group.css";
import { useState } from "react";
import {
  ArrowLeft, ArrowRight, CheckCircle2, AlertTriangle, Clock, FileText, Upload,
  MessageSquare, History, XCircle, Tag, Link as LinkIcon, Circle, Copy, Layers,
  Inbox, Send, Paperclip, Check, PauseCircle
} from "lucide-react";

type LegStatus = "investigating" | "ready" | "review" | "hold";
type EvidenceFile = { name: string; size: string; date: string; missing?: boolean; requiredBy?: string; badge?: string };
type SopAnswer = { q: string; a: string; state: "yes" | "no" | "blocked" | "pending"; blockReason?: string };
type LegAuditEntry = { when: string; who: string; what: string; tone?: "block" | "ok" | "muted" };
type LegVerdict = { tone: "approved" | "denied" | "pending"; headline: string; sub: string };
type Leg = {
  key: string; ref: string; serviceDate: string; amount: string; errorType: string;
  status: LegStatus; statusLabel: string; sopProgress: string; evidenceCount: string;
  sop: SopAnswer[]; evidence: EvidenceFile[]; evidenceTotal: number;
  audit: LegAuditEntry[]; verdict: LegVerdict;
};

const LEGS: Record<string, Leg> = {
  "1278": {
    key: "1278", ref: "15018283", serviceDate: "Apr 18, 2026, 12:00 AM", amount: "$40.01",
    errorType: "GPS Pickup Too Far from Residence", status: "investigating", statusLabel: "Pending",
    sopProgress: "SOP 3/4", evidenceCount: "2/3", evidenceTotal: 3,
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
      tone: "pending", headline: "Pending — awaiting evidence", sub: "SOP Q3 blocked on gps_log.csv. Leg cannot resolve until evidence is provided.",
    },
  },
  "1277": {
    key: "1277", ref: "15018282", serviceDate: "Apr 18, 2026, 12:00 AM", amount: "$40.01",
    errorType: "GPS Pickup Too Far from Residence", status: "investigating", statusLabel: "Approved",
    sopProgress: "SOP 4/4", evidenceCount: "3/3", evidenceTotal: 3,
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
      tone: "approved", headline: "Approved — No recoupment", sub: "Inherited from group verdict on closed ticket #88582. Set by System via duplicate-cluster resolution.",
    },
  },
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

export default function D2A_Workbench() {
  const [selectedKey, setSelectedKey] = useState("1278");
  const selected = LEGS[selectedKey];

  return (
    <div className="cc-scope flex h-screen overflow-hidden bg-[var(--cc-bg)] text-[var(--cc-fg)]">
      {/* LEFT RAIL */}
      <div className="w-[360px] shrink-0 border-r border-[var(--cc-border)] flex flex-col bg-[var(--cc-bg)] overflow-y-auto custom-scrollbar shadow-sm relative z-10">
        
        {/* Header Strip */}
        <div className="px-4 py-3 border-b border-[var(--cc-border)] bg-[var(--cc-card)]">
          <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] mb-1">
             <ArrowLeft className="w-3 h-3" /> Invoice groups / <span className="mono">1865697140</span>
          </div>
          <div className="flex items-center gap-2 mt-2">
             <h1 className="text-xl font-bold mono">1865697140</h1>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
             <span className="cc-badge bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)]">Response received</span>
             <span className="cc-badge bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)]">Approved</span>
          </div>
          <div className="text-[10px] text-[var(--cc-muted-fg)] mt-2 flex items-center gap-1.5">
             <Clock className="w-3 h-3"/> Updated 3d ago · 19d in queue
          </div>
        </div>

        {/* Alert Banner */}
        <div className="px-4 py-3 bg-[var(--cc-blue-bg)] border-b border-[var(--cc-blue-border)] flex items-start gap-2 text-[var(--cc-blue-fg)]">
           <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" />
           <div className="text-xs leading-relaxed">
             <span className="font-bold block mb-0.5">New response from payor · 4d ago</span>
             <span className="opacity-90">"GPS Exemption Request Approved A detailed review of the GPS data received for invoice 1865697140 confirmed GPS compliance..."</span>
           </div>
        </div>

        <div className="p-4 space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-2">
             <div className="p-2.5 border border-[var(--cc-border)] rounded bg-[var(--cc-card)] shadow-sm">
                <div className="text-[9px] text-[var(--cc-muted-fg)] uppercase font-bold tracking-wider mb-1">Total Exp</div>
                <div className="font-mono text-sm font-semibold">$80.02 <span className="text-xs text-[var(--cc-muted-fg)] font-sans ml-1">(2 legs)</span></div>
             </div>
             <div className="p-2.5 border border-[var(--cc-border)] rounded bg-[var(--cc-card)] shadow-sm">
                <div className="text-[9px] text-[var(--cc-muted-fg)] uppercase font-bold tracking-wider mb-1">In Dispute</div>
                <div className="font-mono text-sm font-semibold">$0.00 <span className="text-xs text-[var(--cc-muted-fg)] font-sans ml-1">(0 legs)</span></div>
             </div>
             <div className="p-2.5 border border-[var(--cc-border)] rounded bg-[var(--cc-card)] shadow-sm">
                <div className="text-[9px] text-[var(--cc-muted-fg)] uppercase font-bold tracking-wider mb-1">Non-Issue</div>
                <div className="font-mono text-sm font-semibold">$0.00</div>
             </div>
             <div className="p-2.5 border border-[var(--cc-border)] rounded bg-[var(--cc-card)] shadow-sm">
                <div className="text-[9px] text-[var(--cc-muted-fg)] uppercase font-bold tracking-wider mb-1">Recovered</div>
                <div className="font-mono text-sm font-semibold">$0.00</div>
             </div>
          </div>

          {/* Submission Summary */}
          <div className="cc-card overflow-hidden">
             <div className="px-3 py-2 bg-[var(--cc-muted)]/50 border-b border-[var(--cc-border)] flex items-center justify-between">
                <h3 className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">Submission Summary</h3>
                <span className="text-[9px] bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Ready to Review</span>
             </div>
             <div className="p-3 text-[11px] space-y-2">
                <div className="flex justify-between items-center"><span className="text-[var(--cc-muted-fg)]">Preview generated</span><span className="flex items-center gap-1 text-[var(--cc-success)] font-medium"><CheckCircle2 className="w-3 h-3"/> May 9</span></div>
                <div className="flex justify-between items-center"><span className="text-[var(--cc-muted-fg)]">Draft reviewed</span><span className="flex items-center gap-1 text-[var(--cc-success)] font-medium"><CheckCircle2 className="w-3 h-3"/> May 9</span></div>
                <div className="flex justify-between items-center"><span className="text-[var(--cc-muted-fg)]">Last submitted</span><span className="flex items-center gap-1 text-[var(--cc-success)] font-medium"><CheckCircle2 className="w-3 h-3"/> May 9</span></div>
             </div>
          </div>

          {/* Group Details */}
          <div className="cc-card p-3 space-y-2 text-xs">
             <h3 className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider mb-1">Group Details</h3>
             <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Payor</span><span>—</span></div>
             <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Plan</span><span className="font-medium">SR50480M</span></div>
             <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Error Type</span><span className="truncate max-w-[150px]" title="GPS Pickup Too Far from Residence">GPS Pickup Too Far...</span></div>
          </div>

          {/* Comms */}
          <div className="cc-card overflow-hidden">
             <div className="px-3 py-2 bg-[var(--cc-muted)]/50 border-b border-[var(--cc-border)]">
                <h3 className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider flex items-center gap-1.5"><MessageSquare className="w-3 h-3"/> Thread</h3>
             </div>
             <div className="p-3 text-[11px] space-y-3">
                <div className="bg-[var(--cc-muted)]/40 p-2 rounded border border-[var(--cc-border)]">
                   <div className="flex justify-between items-center mb-1"><span className="font-bold">Payor portal</span><span className="text-[9px] text-[var(--cc-muted-fg)]">May 13</span></div>
                   <div className="text-[10px] opacity-90 leading-tight">"GPS Exemption Request Approved A detailed review..."</div>
                </div>
                <div className="bg-[var(--cc-muted)]/40 p-2 rounded border border-[var(--cc-border)]">
                   <div className="flex justify-between items-center mb-1"><span className="font-bold">Operator 1</span><span className="text-[9px] text-[var(--cc-muted-fg)]">May 13</span></div>
                   <div className="text-[10px] opacity-90 leading-tight">"Verdict applied to Leg #1277."</div>
                </div>
                <textarea className="cc-input text-xs" rows={2} placeholder="Reply to thread..."></textarea>
             </div>
          </div>

          {/* Evidence */}
          <div className="cc-card p-3">
             <h3 className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider mb-2 flex items-center gap-1.5"><Paperclip className="w-3 h-3"/> Group Evidence</h3>
             <div className="flex flex-wrap gap-1.5">
                {GROUP_FILES.map(f => (
                   <span key={f.id} className="text-[10px] px-1.5 py-0.5 border border-[var(--cc-border)] rounded bg-[var(--cc-muted)]/50 flex items-center gap-1">
                      <span className="font-mono">{f.id.split('-')[0]}</span>
                      <span className="bg-[var(--cc-muted-fg)] text-white text-[8px] px-1 rounded-sm">{f.badge}</span>
                   </span>
                ))}
             </div>
          </div>

          {/* Activity */}
          <div className="cc-card overflow-hidden">
             <div className="px-3 py-2 bg-[var(--cc-muted)]/50 border-b border-[var(--cc-border)]">
                <h3 className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider flex items-center gap-1.5"><History className="w-3 h-3"/> Activity</h3>
             </div>
             <div className="p-3 text-[11px] space-y-2.5 max-h-[150px] overflow-y-auto">
                {AUDIT_LOG.slice(0,4).map((a,i) => (
                   <div key={i} className="flex flex-col gap-0.5">
                      <span className="opacity-90">{a.action}</span>
                      <div className="flex items-center justify-between text-[9px] text-[var(--cc-muted-fg)]">
                         <span>{a.author}</span><span>{a.time}</span>
                      </div>
                   </div>
                ))}
             </div>
          </div>

          {/* Admin */}
          <div className="cc-card overflow-hidden border-[var(--cc-purple-border)]">
             <div className="px-3 py-2 bg-[var(--cc-purple-bg)] text-[var(--cc-purple-fg)] border-b border-[var(--cc-purple-border)]">
                <h3 className="text-[10px] uppercase font-bold tracking-wider">Admin Actions</h3>
             </div>
             <div className="p-2 space-y-1 bg-[var(--cc-amber-bg)]/40 border-b border-[var(--cc-border)]">
                <div className="text-[10px] font-bold text-[var(--cc-amber-fg)] uppercase tracking-wider flex items-center gap-1.5 px-1"><AlertTriangle className="w-3 h-3"/> MAS Reattest</div>
                <button className="w-full text-left px-2 py-1 text-[11px] font-medium text-[var(--cc-success)] hover:bg-[var(--cc-muted)] rounded flex items-center gap-1.5">
                   <Check className="w-3 h-3"/> Mark as already re-attested
                </button>
             </div>
             <div className="p-1">
                <button className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--cc-muted)] rounded flex items-center gap-2 text-[var(--cc-muted-fg)]"><PauseCircle className="w-3.5 h-3.5"/> Place on hold</button>
                <button className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--cc-muted)] rounded flex items-center gap-2 text-[var(--cc-muted-fg)]"><XCircle className="w-3.5 h-3.5"/> Withdraw</button>
                <button className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--cc-muted)] rounded flex items-center gap-2 text-[var(--cc-muted-fg)]"><Tag className="w-3.5 h-3.5"/> Reclassify legs</button>
                <button className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--cc-muted)] rounded flex items-center gap-2 text-[var(--cc-muted-fg)]"><LinkIcon className="w-3.5 h-3.5"/> Mark duplicates</button>
             </div>
             <div className="p-2 border-t border-[var(--cc-border)] bg-[var(--cc-muted)]/30 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--cc-fg)] px-1 mb-1 flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3"/> Close group</div>
                <select className="cc-select text-xs py-1.5">
                   <option>Select reason...</option>
                   <option>Denied by Payor</option>
                   <option>Withdrawn</option>
                   <option>Resolved - non-issue</option>
                </select>
                <button className="cc-btn cc-btn-sm w-full justify-center mt-1">Close Group</button>
             </div>
          </div>

        </div>
      </div>

      {/* RIGHT PANE (Work) */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--cc-bg)] overflow-hidden relative">
         <div className="p-4 px-6 border-b border-[var(--cc-border)] bg-[var(--cc-card)] flex justify-between items-center z-10 shadow-sm">
            <h2 className="text-lg font-bold flex items-center gap-2"><Layers className="w-5 h-5 text-[var(--cc-muted-fg)]"/> Disputed Legs</h2>
            <button className="cc-btn cc-btn-primary px-4 py-2 text-sm shadow-sm">
               Open in queue <ArrowRight className="w-4 h-4 ml-1" />
            </button>
         </div>

         {/* Ledger List */}
         <div className="flex-none p-4 px-6 space-y-2 max-h-[300px] overflow-y-auto bg-[var(--cc-muted)]/20 border-b border-[var(--cc-border)] shadow-inner">
            {Object.values(LEGS).map(leg => (
               <div key={leg.key} onClick={() => setSelectedKey(leg.key)} className={`p-3 border rounded-md cursor-pointer transition-all flex justify-between items-center group ${selectedKey === leg.key ? 'border-[var(--cc-primary)] bg-[var(--cc-card)] shadow-[inset_4px_0_0_var(--cc-primary)]' : 'border-[var(--cc-border)] bg-[var(--cc-card)] hover:border-[var(--cc-primary)]/50'}`}>
                  <div className="flex items-center gap-4">
                     <span className="font-mono font-medium">{leg.ref}</span>
                     <span className="text-xs text-[var(--cc-muted-fg)]">{leg.errorType}</span>
                  </div>
                  <div className="flex items-center gap-6">
                     <span className="font-mono text-sm">{leg.amount}</span>
                     <span className={`cc-badge ${leg.status === 'investigating' ? 'bg-[var(--cc-blue-bg)] text-[var(--cc-blue-fg)] border-[var(--cc-blue-border)]' : 'bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)]'}`}>{leg.statusLabel}</span>
                  </div>
               </div>
            ))}
         </div>

         {/* Focus Panel */}
         <div className="flex-1 overflow-y-auto p-6 bg-[var(--cc-bg)] custom-scrollbar">
            <div className="max-w-5xl mx-auto space-y-6">
               <div className="flex justify-between items-center">
                  <h3 className="text-xl font-bold mono">Leg {selected.ref}</h3>
                  <div className="flex gap-2">
                     <button className="cc-btn cc-btn-sm"><PauseCircle className="w-3.5 h-3.5"/> Hold leg</button>
                     <button className="cc-btn cc-btn-sm"><Tag className="w-3.5 h-3.5"/> Reclassify</button>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-8">
                  {/* Col 1: SOP */}
                  <div className="space-y-4">
                     <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] border-b border-[var(--cc-border)] pb-2 flex items-center justify-between">
                        SOP Transcript
                        <span className="text-[9px] bg-[var(--cc-muted)] px-1.5 py-0.5 rounded">{selected.sopProgress}</span>
                     </h4>
                     <div className="space-y-2 text-sm">
                        {selected.sop.map((s, i) => (
                           <div key={i} className={`p-3 rounded border ${s.state === 'blocked' ? 'bg-[var(--cc-red-bg)]/30 border-[var(--cc-red-border)]' : 'bg-[var(--cc-card)] border-[var(--cc-border)]'}`}>
                              <div className="text-xs text-[var(--cc-muted-fg)] mb-1">{s.q}</div>
                              <div className="font-medium flex items-center gap-1.5">
                                 {s.state === 'yes' && <CheckCircle2 className="w-4 h-4 text-[var(--cc-success)]"/>}
                                 {s.state === 'blocked' && <XCircle className="w-4 h-4 text-[var(--cc-destructive)]"/>}
                                 {s.a}
                              </div>
                           </div>
                        ))}
                     </div>
                  </div>

                  {/* Col 2: Evidence, Verdict, Audit */}
                  <div className="space-y-6">
                     <div className="space-y-4">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] border-b border-[var(--cc-border)] pb-2 flex items-center justify-between">
                           Evidence
                           <span className="text-[9px] bg-[var(--cc-muted)] px-1.5 py-0.5 rounded">{selected.evidenceCount}</span>
                        </h4>
                        <div className="space-y-2">
                           {selected.evidence.map((e, i) => (
                              <div key={i} className={`p-3 rounded border flex justify-between items-center text-sm ${e.missing ? 'bg-[var(--cc-red-bg)]/30 border-[var(--cc-red-border)]' : 'bg-[var(--cc-card)] border-[var(--cc-border)]'}`}>
                                 <div className="flex items-center gap-2">
                                    <FileText className={`w-4 h-4 ${e.missing ? 'text-[var(--cc-red-fg)]' : 'text-[var(--cc-muted-fg)]'}`} />
                                    <span className="font-mono text-xs">{e.name}</span>
                                    {e.missing && <span className="text-[9px] font-bold uppercase tracking-wider bg-[var(--cc-red-fg)] text-white px-1.5 py-0.5 rounded">Missing</span>}
                                 </div>
                                 <span className="text-xs text-[var(--cc-muted-fg)]">{e.size}</span>
                              </div>
                           ))}
                        </div>
                        <div className="p-4 border border-dashed border-[var(--cc-border)] rounded-md flex flex-col items-center justify-center text-center bg-[var(--cc-muted)]/20 text-[var(--cc-muted-fg)] hover:bg-[var(--cc-muted)]/40 transition-colors cursor-pointer">
                           <Upload className="w-5 h-5 mb-2 opacity-70" />
                           <span className="text-sm font-medium">Drag & drop files here</span>
                           <span className="text-xs opacity-70 mt-1">or click to browse</span>
                        </div>
                     </div>

                     <div className="space-y-4">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] border-b border-[var(--cc-border)] pb-2">Verdict</h4>
                        <div className={`p-4 rounded border shadow-sm ${selected.verdict.tone === 'approved' ? 'bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)]' : 'bg-[var(--cc-amber-bg)] text-[var(--cc-amber-fg)] border-[var(--cc-amber-border)]'}`}>
                           <h5 className="font-bold mb-1 flex items-center gap-2">
                              {selected.verdict.tone === 'approved' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                              {selected.verdict.headline}
                           </h5>
                           <p className="text-xs opacity-90 leading-relaxed">{selected.verdict.sub}</p>
                        </div>
                     </div>

                     <div className="space-y-4">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] border-b border-[var(--cc-border)] pb-2">Leg Audit</h4>
                        <div className="space-y-3">
                           {selected.audit.map((a,i) => (
                              <div key={i} className="flex gap-3 text-xs">
                                 <div className="w-[100px] shrink-0 text-[var(--cc-muted-fg)] flex flex-col">
                                    <span className="font-medium text-[var(--cc-fg)]">{a.who}</span>
                                    <span className="text-[10px]">{a.when}</span>
                                 </div>
                                 <div className={`flex-1 ${a.tone === 'ok' ? 'text-[var(--cc-success)] font-medium' : a.tone === 'block' ? 'text-[var(--cc-destructive)] font-medium' : 'text-[var(--cc-muted-fg)]'}`}>
                                    {a.what}
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         </div>
      </div>

    </div>
  );
}
