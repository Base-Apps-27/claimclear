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
    errorType: "GPS Pickup Too Far from Residence", status: "investigating", statusLabel: "Investigating",
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
    verdict: { tone: "pending", headline: "Pending — awaiting evidence", sub: "SOP Q3 blocked on gps_log.csv." },
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
      { when: "May 13, 7:43 AM", who: "System", what: "Group payor verdict applied — Approved", tone: "ok" },
    ],
    verdict: { tone: "approved", headline: "Approved — No recoupment", sub: "Inherited from group verdict." },
  },
};

const AUDIT_LOG = [
  { action: "queued 2 legs for re-attestation", author: "someidy.s", time: "3d ago" },
  { action: "Promoted 2 draft verdicts", author: "someidy.s", time: "3d ago" },
  { action: "Upgraded synthetic portal_response", author: "system", time: "4d ago" },
  { action: "Phase advanced from submitted → response_received", author: "System", time: "4d ago" },
  { action: "Synthetic portal_response inserted", author: "System", time: "4d ago" },
  { action: "Routed to Ready to Review — verdict found on closed ticket #88582", author: "System", time: "5d ago" },
  { action: 'Portal submission #1129 cancelled from "draft" status', author: "Emil J", time: "1w ago" },
  { action: "Status changed from Portal Queued to Awaiting Response", author: "Batch Processor", time: "1w ago" },
  { action: "Status changed from Awaiting Response to Portal Queued (backfill)", author: "system (backfill)", time: "1w ago" },
];

const GROUP_FILES = [
  { id: "b0a6e5c3.png", badge: "L1" }, { id: "833cd17e.png", badge: "L1" }, { id: "6b6ec689.png", badge: "L1" },
  { id: "1fa92a44.png", badge: "L2" }, { id: "625a2070.png", badge: "L2" }, { id: "1d80aebe.png", badge: "L2" },
  { id: "8b78ff9e.png", badge: "L2" }
];

export default function D2C_Timeline() {
  const [tab, setTab] = useState<"legs" | "comms" | "admin">("comms");
  const [selectedKey, setSelectedKey] = useState("1278");
  const selected = LEGS[selectedKey];

  return (
    <div className="cc-scope flex flex-col h-screen overflow-hidden bg-[var(--cc-bg)] text-[var(--cc-fg)]">
       
       {/* TOP STRIP */}
       <div className="flex-none bg-[var(--cc-card)] px-6 py-2 border-b border-[var(--cc-border)] flex items-center justify-between z-20 shadow-sm text-sm">
         <div className="flex items-center gap-2 text-[var(--cc-muted-fg)]">
            <ArrowLeft className="w-4 h-4" /> 
            <span className="font-medium text-[var(--cc-fg)] hover:underline cursor-pointer">Invoice groups</span> 
            <span>/</span> 
            <span className="mono">1865697140</span>
         </div>
         <div className="flex items-center gap-4">
            <button className="flex items-center gap-1.5 text-[var(--cc-muted-fg)] hover:text-[var(--cc-fg)] transition-colors"><Layers className="w-4 h-4"/> Transitions</button>
            <button className="flex items-center gap-1.5 text-[var(--cc-muted-fg)] hover:text-[var(--cc-fg)] transition-colors"><Inbox className="w-4 h-4"/> Sync inbox</button>
         </div>
       </div>

       {/* TIMELINE */}
       <div className="flex-none bg-[var(--cc-card)] pt-8 pb-6 border-b border-[var(--cc-border)] flex flex-col items-center justify-center relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[var(--cc-border)] to-transparent opacity-50"></div>
          
          <div className="w-full max-w-5xl px-8 relative">
             <div className="absolute top-3 left-12 right-12 h-[2px] bg-[var(--cc-border)] -z-10"></div>
             {/* Progress fill */}
             <div className="absolute top-3 left-12 h-[2px] bg-[var(--cc-primary)] -z-10" style={{ width: '80%' }}></div>
             
             <div className="flex justify-between w-full">
                {['Created', 'Drafted', 'Submitted', 'Response received', 'Verdict applied', 'Closed'].map((stage, i) => {
                   const isActive = stage === 'Verdict applied';
                   const isPast = i < 4;
                   return (
                      <div key={stage} className={`flex flex-col items-center gap-3 cursor-pointer group w-32 ${isActive ? 'text-[var(--cc-primary)]' : isPast ? 'text-[var(--cc-fg)] hover:text-[var(--cc-primary)]' : 'text-[var(--cc-muted-fg)] opacity-50'}`}>
                         <div className={`w-6 h-6 rounded-full border-4 flex items-center justify-center bg-[var(--cc-card)] transition-colors ${isActive ? 'border-[var(--cc-primary)] ring-4 ring-[var(--cc-primary)]/20' : isPast ? 'border-[var(--cc-primary)] bg-[var(--cc-primary)]' : 'border-[var(--cc-border)]'}`}>
                            {isPast && !isActive && <Check className="w-3 h-3 text-white" />}
                            {isActive && <div className="w-2 h-2 rounded-full bg-[var(--cc-primary)]"></div>}
                         </div>
                         <div className="text-center">
                            <span className="text-[11px] font-bold uppercase tracking-wider block mb-0.5">{stage}</span>
                            {(isActive || isPast) && <span className="text-[10px] opacity-70 font-medium font-sans">May {9 + i}</span>}
                         </div>
                      </div>
                   )
                })}
             </div>
          </div>
       </div>

       {/* BANNER & KPI STRIP */}
       <div className="flex-none flex flex-col">
          <div className="px-8 py-3 bg-[var(--cc-blue-bg)] border-b border-[var(--cc-blue-border)] flex justify-between items-center text-[var(--cc-blue-fg)] shadow-sm z-10 relative">
             <div className="flex items-center gap-3">
                <MessageSquare className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium">New response from payor · Verdict on closed ticket #88582</span>
             </div>
             <button className="cc-btn cc-btn-sm bg-white/50 border-[var(--cc-blue-border)] text-[var(--cc-blue-fg)]" onClick={() => setTab("comms")}>View Thread</button>
          </div>
          
          <div className="px-8 py-3 bg-[var(--cc-bg)] border-b border-[var(--cc-border)] flex divide-x divide-[var(--cc-border)] z-10 relative shadow-sm">
             <div className="px-6 first:pl-0"><div className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">Total Exposure</div><div className="text-lg font-mono font-bold">$80.02</div></div>
             <div className="px-6"><div className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">In Dispute</div><div className="text-lg font-mono font-bold">$0.00</div></div>
             <div className="px-6"><div className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">Non-Issue</div><div className="text-lg font-mono font-bold">$0.00</div></div>
             <div className="px-6"><div className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">Recovered</div><div className="text-lg font-mono font-bold">$0.00</div></div>
             <div className="px-6"><div className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">Queue Time</div><div className="text-lg font-mono font-bold">19d</div></div>
          </div>
       </div>

       {/* TABBED WORKBENCH */}
       <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-none bg-[var(--cc-card)] border-b border-[var(--cc-border)] px-8 pt-4 flex gap-8 z-10 shadow-sm relative">
             {(["legs", "comms", "admin"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} className={`pb-3 text-[13px] font-bold uppercase tracking-wider transition-colors border-b-2 outline-none ${tab === t ? 'border-[var(--cc-primary)] text-[var(--cc-primary)]' : 'border-transparent text-[var(--cc-muted-fg)] hover:text-[var(--cc-fg)]'}`}>
                   {t === 'legs' ? 'Legs & Dossier' : t === 'comms' ? 'Communication' : 'Admin & Notes'}
                </button>
             ))}
          </div>

          <div className="flex-1 overflow-y-auto bg-[var(--cc-muted)]/10 p-8 custom-scrollbar">
             <div className="max-w-[1400px] mx-auto h-full relative">
                
                {/* LEGS TAB */}
                {tab === "legs" && (
                   <div className="flex h-full gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {/* Left Meta Col */}
                      <div className="w-[320px] shrink-0 space-y-6 flex flex-col">
                         <button className="cc-btn cc-btn-primary w-full justify-center py-3 text-sm shadow-md">
                            Open in Queue <ArrowRight className="w-4 h-4 ml-1" />
                         </button>

                         <div className="cc-card p-4 space-y-4 shadow-sm bg-[var(--cc-card)]">
                            <h3 className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider border-b border-[var(--cc-border)] pb-2">Group Details</h3>
                            <div className="space-y-2 text-sm">
                               <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Plan</span><span className="font-medium">SR50480M</span></div>
                               <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Error</span><span className="truncate max-w-[150px]">GPS Pickup Too Far...</span></div>
                               <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Service</span><span>Apr 18, 2026</span></div>
                            </div>
                         </div>

                         <div className="cc-card shadow-sm overflow-hidden">
                            <div className="p-3 bg-[var(--cc-muted)]/50 border-b border-[var(--cc-border)] flex justify-between items-center">
                               <h3 className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">Submission</h3>
                               <span className="text-[9px] bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] px-1.5 py-0.5 rounded font-bold uppercase">Ready</span>
                            </div>
                            <div className="p-4 space-y-2 text-xs">
                               <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Generated</span><span className="font-medium">May 9</span></div>
                               <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Reviewed</span><span className="font-medium">May 9</span></div>
                               <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Submitted</span><span className="font-medium">May 9</span></div>
                            </div>
                         </div>

                         <div className="cc-card p-4 shadow-sm space-y-3">
                            <h3 className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider border-b border-[var(--cc-border)] pb-2 flex items-center justify-between">Group Evidence <Paperclip className="w-3 h-3"/></h3>
                            <div className="flex flex-wrap gap-2">
                               {GROUP_FILES.map(f => (
                                  <span key={f.id} className="text-[10px] px-2 py-1 border border-[var(--cc-border)] rounded bg-[var(--cc-muted)]/50 font-mono">{f.id.split('-')[0]}</span>
                               ))}
                            </div>
                         </div>
                      </div>

                      {/* Right Work Col */}
                      <div className="flex-1 flex flex-col border border-[var(--cc-border)] bg-[var(--cc-card)] rounded-lg shadow-md overflow-hidden">
                         
                         {/* Ledger List */}
                         <div className="flex-none p-3 border-b border-[var(--cc-border)] bg-[var(--cc-muted)]/30 flex gap-2 overflow-x-auto shadow-inner">
                            {Object.values(LEGS).map(leg => (
                               <div key={leg.key} onClick={() => setSelectedKey(leg.key)} className={`p-3 min-w-[240px] border rounded-md cursor-pointer transition-all flex flex-col gap-2 ${selectedKey === leg.key ? 'border-[var(--cc-primary)] bg-[var(--cc-card)] shadow-sm' : 'border-[var(--cc-border)] bg-transparent hover:border-[var(--cc-primary)]/50'}`}>
                                  <div className="flex justify-between items-center">
                                     <span className="font-mono font-medium">{leg.ref}</span>
                                     <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${leg.statusLabel === 'Approved' ? 'bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)]' : 'bg-[var(--cc-amber-bg)] text-[var(--cc-amber-fg)]'}`}>{leg.statusLabel}</span>
                                  </div>
                                  <div className="text-xs text-[var(--cc-muted-fg)] truncate">{leg.errorType}</div>
                               </div>
                            ))}
                         </div>

                         {/* Dossier */}
                         <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                            <div className="flex justify-between items-end border-b border-[var(--cc-border)] pb-4 mb-6">
                               <h2 className="text-2xl font-bold mono">Leg {selected.ref} Dossier</h2>
                               <div className="flex gap-2">
                                  <button className="cc-btn"><PauseCircle className="w-4 h-4"/> Hold</button>
                                  <button className="cc-btn"><Tag className="w-4 h-4"/> Reclassify</button>
                               </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-10">
                               <div className="space-y-8">
                                  <div className="space-y-4">
                                     <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] flex justify-between border-b border-[var(--cc-border)] pb-2">
                                        SOP Transcript <span className="bg-[var(--cc-muted)] px-1.5 rounded">{selected.sopProgress}</span>
                                     </h3>
                                     <div className="space-y-3">
                                        {selected.sop.map((s,i) => (
                                           <div key={i} className={`p-4 border rounded-md text-sm ${s.state === 'blocked' ? 'bg-[var(--cc-red-bg)]/30 border-[var(--cc-red-border)]' : 'bg-[var(--cc-card)] border-[var(--cc-border)] shadow-sm'}`}>
                                              <div className="text-[var(--cc-muted-fg)] mb-1.5">{s.q}</div>
                                              <div className="font-medium flex items-center gap-1.5">
                                                 {s.state === 'yes' && <CheckCircle2 className="w-4 h-4 text-[var(--cc-success)]"/>}
                                                 {s.state === 'blocked' && <XCircle className="w-4 h-4 text-[var(--cc-destructive)]"/>}
                                                 {s.a}
                                              </div>
                                           </div>
                                        ))}
                                     </div>
                                  </div>
                               </div>
                               
                               <div className="space-y-8">
                                  <div className="space-y-4">
                                     <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] border-b border-[var(--cc-border)] pb-2">Verdict</h3>
                                     <div className={`p-5 rounded-md border shadow-sm ${selected.verdict.tone === 'approved' ? 'bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)]' : 'bg-[var(--cc-amber-bg)] text-[var(--cc-amber-fg)] border-[var(--cc-amber-border)]'}`}>
                                        <h4 className="font-bold flex items-center gap-2 mb-1.5">
                                           {selected.verdict.tone === 'approved' ? <CheckCircle2 className="w-5 h-5"/> : <AlertTriangle className="w-5 h-5"/>}
                                           {selected.verdict.headline}
                                        </h4>
                                        <p className="text-sm opacity-90 leading-relaxed ml-7">{selected.verdict.sub}</p>
                                     </div>
                                  </div>

                                  <div className="space-y-4">
                                     <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] flex justify-between border-b border-[var(--cc-border)] pb-2">
                                        Evidence <span className="bg-[var(--cc-muted)] px-1.5 rounded">{selected.evidenceCount}</span>
                                     </h3>
                                     <div className="space-y-2 text-sm">
                                        {selected.evidence.map((e,i) => (
                                           <div key={i} className={`p-3 border rounded-md flex justify-between items-center ${e.missing ? 'bg-[var(--cc-red-bg)]/30 border-[var(--cc-red-border)]' : 'bg-[var(--cc-card)] shadow-sm border-[var(--cc-border)]'}`}>
                                              <div className="flex items-center gap-2">
                                                 <FileText className={`w-4 h-4 ${e.missing ? 'text-[var(--cc-red-fg)]' : 'text-[var(--cc-muted-fg)]'}`}/>
                                                 <span className="font-mono text-xs">{e.name}</span>
                                                 {e.missing && <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[var(--cc-red-fg)] text-white ml-2">Missing</span>}
                                              </div>
                                           </div>
                                        ))}
                                     </div>
                                     <div className="p-4 border-2 border-dashed border-[var(--cc-border)] rounded-md flex justify-center items-center gap-2 text-[var(--cc-muted-fg)] hover:bg-[var(--cc-muted)]/50 cursor-pointer transition-colors text-sm">
                                        <Upload className="w-4 h-4"/> Drag & drop files to upload
                                     </div>
                                  </div>

                                  <div className="space-y-4">
                                     <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] border-b border-[var(--cc-border)] pb-2">Audit Log</h3>
                                     <div className="space-y-3 text-xs">
                                        {selected.audit.map((a,i) => (
                                           <div key={i} className="flex gap-4 p-2 rounded hover:bg-[var(--cc-muted)]/30 transition-colors">
                                              <div className="w-[120px] shrink-0 text-[var(--cc-muted-fg)]">
                                                 <div className="font-medium text-[var(--cc-fg)]">{a.who}</div>
                                                 <div className="opacity-80 mt-0.5">{a.when}</div>
                                              </div>
                                              <div className={`flex-1 leading-relaxed ${a.tone === 'ok' ? 'text-[var(--cc-success)] font-medium' : a.tone === 'block' ? 'text-[var(--cc-destructive)] font-medium' : 'text-[var(--cc-muted-fg)]'}`}>{a.what}</div>
                                           </div>
                                        ))}
                                     </div>
                                  </div>
                               </div>
                            </div>
                         </div>
                      </div>
                   </div>
                )}

                {/* COMMS TAB */}
                {tab === "comms" && (
                   <div className="max-w-6xl mx-auto h-full flex gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="flex-1 cc-card shadow-md flex flex-col overflow-hidden">
                         <div className="p-6 border-b border-[var(--cc-border)] bg-[var(--cc-card)]">
                            <h2 className="text-xl font-bold flex items-center gap-2"><MessageSquare className="w-5 h-5 text-[var(--cc-muted-fg)]"/> Communication Thread</h2>
                         </div>
                         <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[var(--cc-muted)]/10 custom-scrollbar">
                            <div className="p-5 bg-[var(--cc-card)] border border-[var(--cc-border)] rounded-lg shadow-sm">
                               <div className="flex justify-between items-center mb-3">
                                  <div className="font-bold text-[var(--cc-fg)]">Payor Portal</div>
                                  <div className="text-xs text-[var(--cc-muted-fg)]">May 13, 7:43 AM</div>
                               </div>
                               <div className="flex items-center gap-2 mb-3">
                                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] rounded border border-[var(--cc-green-border)]">approval</span>
                               </div>
                               <p className="text-sm leading-relaxed text-[var(--cc-fg)] bg-[var(--cc-muted)]/30 p-4 rounded-md">"GPS Exemption Request Approved A detailed review of the GPS data received for invoice 1865697140 confirmed GPS compliance..."</p>
                            </div>
                            
                            <div className="p-5 bg-[var(--cc-card)] border border-[var(--cc-border)] rounded-lg shadow-sm">
                               <div className="flex justify-between items-center mb-3">
                                  <div className="font-bold text-[var(--cc-fg)]">Operator 1</div>
                                  <div className="text-xs text-[var(--cc-muted-fg)]">May 13, 9:02 AM</div>
                               </div>
                               <p className="text-sm leading-relaxed text-[var(--cc-fg)]">"Verdict applied to Leg #1277. Need to resolve Leg #1278 GPS log separately before this group can fully close."</p>
                            </div>
                         </div>
                         <div className="p-6 bg-[var(--cc-card)] border-t border-[var(--cc-border)]">
                            <textarea className="cc-input" rows={4} placeholder="Type a reply to the thread..."></textarea>
                            <div className="flex justify-end mt-3"><button className="cc-btn cc-btn-primary px-6"><Send className="w-4 h-4 mr-2"/> Send Reply</button></div>
                         </div>
                      </div>
                      
                      <div className="w-[380px] shrink-0 space-y-6">
                         <div className="cc-card overflow-hidden shadow-md">
                            <div className="p-4 bg-[var(--cc-muted)]/50 border-b border-[var(--cc-border)] flex items-center gap-2">
                               <History className="w-4 h-4 text-[var(--cc-muted-fg)]"/>
                               <h3 className="text-xs uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">Activity History</h3>
                            </div>
                            <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
                               {AUDIT_LOG.map((a,i) => (
                                  <div key={i} className="text-sm border-b border-[var(--cc-border)] pb-3 last:border-0">
                                     <div className="text-[var(--cc-fg)] mb-1 leading-snug">{a.action}</div>
                                     <div className="flex justify-between text-xs text-[var(--cc-muted-fg)] font-medium"><span>{a.author}</span><span>{a.time}</span></div>
                                  </div>
                               ))}
                            </div>
                         </div>
                      </div>
                   </div>
                )}

                {/* ADMIN TAB */}
                {tab === "admin" && (
                   <div className="max-w-6xl mx-auto grid grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="cc-card overflow-hidden shadow-md">
                         <div className="p-6 bg-[var(--cc-purple-bg)] border-b border-[var(--cc-purple-border)] text-[var(--cc-purple-fg)]">
                            <h2 className="text-xl font-bold">Overrides & Admin</h2>
                            <p className="text-sm opacity-90 mt-1">Operator-only group-level actions.</p>
                         </div>
                         
                         <div className="p-6 space-y-6 bg-[var(--cc-card)]">
                            <div className="p-4 bg-[var(--cc-amber-bg)]/40 border border-[var(--cc-amber-border)] rounded-lg space-y-3">
                               <div className="text-sm font-bold text-[var(--cc-amber-fg)] flex items-center gap-2"><AlertTriangle className="w-5 h-5"/> MAS Reattest Required (2 legs)</div>
                               <button className="cc-btn bg-white hover:bg-[var(--cc-muted)] w-full justify-center">Mark as already re-attested</button>
                            </div>
                            
                            <div className="space-y-3">
                               <h3 className="text-[11px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider border-b border-[var(--cc-border)] pb-2">Modify Group</h3>
                               <button className="cc-btn w-full justify-start text-sm py-2"><PauseCircle className="w-4 h-4 text-[var(--cc-muted-fg)] mr-2"/> Place group on hold</button>
                               <button className="cc-btn w-full justify-start text-sm py-2"><XCircle className="w-4 h-4 text-[var(--cc-muted-fg)] mr-2"/> Withdraw group</button>
                               <button className="cc-btn w-full justify-start text-sm py-2"><Tag className="w-4 h-4 text-[var(--cc-muted-fg)] mr-2"/> Reclassify all legs</button>
                               <button className="cc-btn w-full justify-start text-sm py-2"><LinkIcon className="w-4 h-4 text-[var(--cc-muted-fg)] mr-2"/> Mark duplicates</button>
                            </div>
                            
                            <div className="pt-6 border-t border-[var(--cc-border)] space-y-4">
                               <h3 className="text-[11px] uppercase font-bold text-[var(--cc-destructive)] tracking-wider flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4"/> Close this group</h3>
                               <p className="text-sm text-[var(--cc-muted-fg)]">Closing a group removes it from active workflows. Ensure all legs have a terminal verdict.</p>
                               <select className="cc-select w-full">
                                  <option>Select closure reason...</option>
                                  <option>Denied by Payor</option>
                                  <option>Withdrawn</option>
                                  <option>Resolved - non-issue</option>
                               </select>
                               <button className="cc-btn cc-btn-primary w-full justify-center bg-[var(--cc-destructive)] border-[var(--cc-destructive)] hover:bg-[hsl(0_84%_50%)]">Confirm Closure</button>
                            </div>
                         </div>
                      </div>

                      <div className="cc-card shadow-md flex flex-col h-full bg-[var(--cc-card)]">
                         <div className="p-6 border-b border-[var(--cc-border)]">
                            <h2 className="text-xl font-bold">Internal Notes</h2>
                         </div>
                         <div className="flex-1 p-6 flex flex-col gap-4">
                            <div className="flex-1 border-2 border-dashed border-[var(--cc-border)] rounded-lg flex flex-col items-center justify-center text-[var(--cc-muted-fg)] bg-[var(--cc-muted)]/10">
                               <FileText className="w-8 h-8 mb-2 opacity-50"/>
                               <span className="text-sm">No notes recorded for this group yet.</span>
                            </div>
                            <div className="space-y-3">
                               <textarea className="cc-input" rows={4} placeholder="Add a note..."></textarea>
                               <div className="flex justify-end"><button className="cc-btn cc-btn-primary px-6">Save Note</button></div>
                            </div>
                         </div>
                      </div>
                   </div>
                )}
             </div>
          </div>
       </div>

    </div>
  );
}
