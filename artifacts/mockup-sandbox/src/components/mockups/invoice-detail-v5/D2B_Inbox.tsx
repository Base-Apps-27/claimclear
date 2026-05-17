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

export default function D2B_Inbox() {
  const [view, setView] = useState<"overview" | "1278" | "1277">("1278");

  return (
    <div className="cc-scope flex h-screen overflow-hidden bg-[var(--cc-bg)] text-[var(--cc-fg)]">
       
       {/* LEFT NAVIGATOR */}
       <div className="w-[280px] shrink-0 border-r border-[var(--cc-border)] flex flex-col bg-[var(--cc-card)] z-10 shadow-sm relative">
          <div className="p-3 border-b border-[var(--cc-border)] bg-[var(--cc-bg)]">
             <div className="text-xs text-[var(--cc-muted-fg)] font-medium flex items-center gap-1.5 mb-1.5"><ArrowLeft className="w-3 h-3"/> Invoice Groups</div>
             <div className="font-mono font-bold text-lg leading-none">1865697140</div>
          </div>
          
          <div className="p-3 border-b border-[var(--cc-border)] bg-[var(--cc-card)] space-y-1.5 text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">
             <div className="flex justify-between"><span>Exposure</span><span className="font-mono text-[var(--cc-fg)]">$80.02</span></div>
             <div className="flex justify-between"><span>Dispute</span><span className="font-mono text-[var(--cc-fg)]">$0.00</span></div>
             <div className="flex justify-between"><span>Queue Time</span><span className="font-mono text-[var(--cc-fg)]">19d</span></div>
          </div>

          <div className="flex-1 overflow-y-auto">
             <div onClick={() => setView("overview")} className={`p-4 border-b border-[var(--cc-border)] cursor-pointer hover:bg-[var(--cc-muted)]/50 transition-colors ${view === 'overview' ? 'bg-[var(--cc-blue-bg)]/20 border-l-4 border-l-[var(--cc-primary)]' : 'border-l-4 border-l-transparent'}`}>
                <div className="font-semibold text-sm mb-1 text-[var(--cc-fg)]">Group Overview</div>
                <div className="text-xs text-[var(--cc-muted-fg)] flex items-center gap-2">
                   <Layers className="w-3.5 h-3.5" /> Summary, details, admin
                </div>
             </div>
             
             <div className="px-4 py-2 bg-[var(--cc-muted)]/30 border-b border-[var(--cc-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)]">
                2 Active Legs
             </div>

             {Object.values(LEGS).map(leg => (
               <div key={leg.key} onClick={() => setView(leg.key as any)} className={`p-4 border-b border-[var(--cc-border)] cursor-pointer hover:bg-[var(--cc-muted)]/50 transition-colors ${view === leg.key ? 'bg-[var(--cc-blue-bg)]/20 border-l-4 border-l-[var(--cc-primary)]' : 'border-l-4 border-l-transparent'}`}>
                  <div className="flex justify-between items-start mb-1">
                     <div className="font-mono text-sm font-medium">{leg.ref}</div>
                     <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${leg.statusLabel === 'Approved' ? 'bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border border-[var(--cc-green-border)]' : 'bg-[var(--cc-amber-bg)] text-[var(--cc-amber-fg)] border border-[var(--cc-amber-border)]'}`}>{leg.statusLabel}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-[var(--cc-muted-fg)]">
                     <span className="font-mono">{leg.amount}</span>
                     <span>Updated 3d ago</span>
                  </div>
               </div>
             ))}
          </div>
       </div>

       {/* CENTER DETAIL */}
       <div className="flex-1 bg-[var(--cc-bg)] overflow-y-auto border-r border-[var(--cc-border)]">
          {view === "overview" ? (
             <div className="max-w-4xl mx-auto p-8 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="space-y-4">
                   <h1 className="text-3xl font-bold mono tracking-tight text-[var(--cc-fg)]">Invoice 1865697140</h1>
                   <div className="flex gap-2">
                      <span className="cc-badge bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)]">Response received</span>
                      <span className="cc-badge bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] border-[var(--cc-green-border)]">Approved</span>
                   </div>
                </div>

                <div className="cc-card p-5 flex gap-4 bg-[var(--cc-blue-bg)] border-[var(--cc-blue-border)] shadow-sm">
                   <MessageSquare className="w-5 h-5 text-[var(--cc-blue-fg)] shrink-0" />
                   <div>
                      <h4 className="text-sm font-bold text-[var(--cc-blue-fg)]">New response from payor · Verdict on ticket #88582</h4>
                      <p className="text-sm text-[var(--cc-blue-fg)] mt-1 opacity-90 leading-relaxed">"GPS Exemption Request Approved A detailed review of the GPS data received for invoice 1865697140 confirmed GPS compliance despite the event IDs submitted..."</p>
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                   <div className="space-y-6">
                      <div className="cc-card p-5 space-y-4">
                         <div className="flex items-center justify-between border-b border-[var(--cc-border)] pb-2">
                            <h3 className="text-[11px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">Submission Summary</h3>
                            <span className="text-[9px] bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Ready to review</span>
                         </div>
                         <div className="space-y-2 text-sm">
                            <div className="flex justify-between items-center"><span className="text-[var(--cc-muted-fg)]">Preview generated</span><span className="flex items-center gap-1 font-medium"><CheckCircle2 className="w-3.5 h-3.5 text-[var(--cc-success)]"/> May 9, 4:07 PM</span></div>
                            <div className="flex justify-between items-center"><span className="text-[var(--cc-muted-fg)]">Draft reviewed</span><span className="flex items-center gap-1 font-medium"><CheckCircle2 className="w-3.5 h-3.5 text-[var(--cc-success)]"/> May 9, 4:07 PM</span></div>
                            <div className="flex justify-between items-center"><span className="text-[var(--cc-muted-fg)]">Last submitted</span><span className="flex items-center gap-1 font-medium"><CheckCircle2 className="w-3.5 h-3.5 text-[var(--cc-success)]"/> May 9, 5:39 PM</span></div>
                         </div>
                      </div>

                      <div className="cc-card p-5 space-y-4">
                         <h3 className="text-[11px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider border-b border-[var(--cc-border)] pb-2">Group Details</h3>
                         <div className="space-y-3 text-sm">
                            <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Plan</span><span className="font-medium">SR50480M</span></div>
                            <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Error Type</span><span>GPS Pickup Too Far from Residence</span></div>
                            <div className="flex justify-between"><span className="text-[var(--cc-muted-fg)]">Service Date</span><span>Apr 18, 2026</span></div>
                         </div>
                      </div>
                   </div>

                   <div className="space-y-6">
                      <div className="cc-card p-5 space-y-4 border-[var(--cc-purple-border)] shadow-sm">
                         <h3 className="text-[11px] uppercase font-bold text-[var(--cc-purple-fg)] tracking-wider border-b border-[var(--cc-purple-border)] pb-2">Admin Actions</h3>
                         <div className="p-3 bg-[var(--cc-amber-bg)]/40 border border-[var(--cc-amber-border)] rounded-md space-y-2">
                            <div className="text-xs font-bold text-[var(--cc-amber-fg)] flex items-center gap-1.5"><AlertTriangle className="w-4 h-4"/> MAS Reattest Required</div>
                            <button className="cc-btn cc-btn-sm bg-white hover:bg-[var(--cc-muted)] w-full justify-center">Mark as already re-attested</button>
                         </div>
                         <div className="grid grid-cols-2 gap-2 pt-2">
                            <button className="cc-btn cc-btn-sm w-full justify-center text-xs">Place on hold</button>
                            <button className="cc-btn cc-btn-sm w-full justify-center text-xs">Withdraw</button>
                            <button className="cc-btn cc-btn-sm w-full justify-center text-xs">Reclassify</button>
                            <button className="cc-btn cc-btn-sm w-full justify-center text-xs">Mark duplicate</button>
                         </div>
                         <div className="border-t border-[var(--cc-border)] pt-4 space-y-2">
                            <h4 className="text-xs font-bold flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4"/> Close Group</h4>
                            <select className="cc-select text-sm py-2">
                               <option>Denied by Payor</option>
                               <option>Withdrawn</option>
                               <option>Resolved - non-issue</option>
                            </select>
                            <button className="cc-btn cc-btn-sm w-full justify-center">Close</button>
                         </div>
                      </div>
                   </div>
                </div>
             </div>
          ) : (
             <div className="max-w-4xl mx-auto p-8 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {(() => {
                   const leg = LEGS[view];
                   return (
                      <>
                        <div className="flex justify-between items-end border-b border-[var(--cc-border)] pb-6">
                           <div>
                              <div className="flex items-center gap-2 mb-2">
                                 <span className="text-xs font-bold uppercase tracking-wider text-[var(--cc-muted-fg)]">Leg Dossier</span>
                                 <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${leg.statusLabel === 'Approved' ? 'bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)]' : 'bg-[var(--cc-amber-bg)] text-[var(--cc-amber-fg)]'}`}>{leg.statusLabel}</span>
                              </div>
                              <h2 className="text-3xl font-bold mono">{leg.ref}</h2>
                              <p className="text-sm text-[var(--cc-muted-fg)] mt-1">{leg.errorType} · {leg.amount}</p>
                           </div>
                           <div className="flex gap-2">
                              <button className="cc-btn"><PauseCircle className="w-4 h-4" /> Hold leg</button>
                              <button className="cc-btn"><Tag className="w-4 h-4" /> Reclassify</button>
                           </div>
                        </div>
                        
                        <div className={`p-5 rounded-lg border shadow-sm ${leg.verdict.tone === 'approved' ? 'bg-[var(--cc-green-bg)] border-[var(--cc-green-border)] text-[var(--cc-green-fg)]' : 'bg-[var(--cc-amber-bg)] border-[var(--cc-amber-border)] text-[var(--cc-amber-fg)]'}`}>
                           <h4 className="font-bold flex items-center gap-2 text-base">
                              {leg.verdict.tone === 'approved' ? <CheckCircle2 className="w-5 h-5"/> : <AlertTriangle className="w-5 h-5"/>}
                              {leg.verdict.headline}
                           </h4>
                           <p className="text-sm opacity-90 mt-1.5 ml-7">{leg.verdict.sub}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-8">
                           <div className="space-y-5">
                              <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] border-b border-[var(--cc-border)] pb-2 flex justify-between">
                                 SOP Transcript <span className="bg-[var(--cc-muted)] px-1.5 rounded">{leg.sopProgress}</span>
                              </h3>
                              <div className="space-y-3">
                                 {leg.sop.map((s, i) => (
                                    <div key={i} className={`p-3 border rounded-md shadow-sm text-sm ${s.state === 'blocked' ? 'bg-[var(--cc-red-bg)]/30 border-[var(--cc-red-border)]' : 'bg-[var(--cc-card)] border-[var(--cc-border)]'}`}>
                                       <div className="text-[var(--cc-muted-fg)] mb-1 text-xs">{s.q}</div>
                                       <div className="font-medium flex items-center gap-1.5">
                                          {s.state === 'yes' && <CheckCircle2 className="w-4 h-4 text-[var(--cc-success)]"/>}
                                          {s.state === 'blocked' && <XCircle className="w-4 h-4 text-[var(--cc-destructive)]"/>}
                                          {s.a}
                                       </div>
                                    </div>
                                 ))}
                              </div>
                           </div>
                           <div className="space-y-8">
                              <div className="space-y-5">
                                 <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] border-b border-[var(--cc-border)] pb-2 flex justify-between">
                                    Evidence <span className="bg-[var(--cc-muted)] px-1.5 rounded">{leg.evidenceCount}</span>
                                 </h3>
                                 <div className="space-y-2">
                                    {leg.evidence.map((e, i) => (
                                       <div key={i} className={`p-3 border rounded-md flex justify-between items-center text-sm ${e.missing ? 'bg-[var(--cc-red-bg)]/30 border-[var(--cc-red-border)]' : 'bg-[var(--cc-card)] border-[var(--cc-border)] shadow-sm'}`}>
                                          <div className="flex items-center gap-2">
                                             <FileText className={`w-4 h-4 ${e.missing ? 'text-[var(--cc-red-fg)]' : 'text-[var(--cc-muted-fg)]'}`} />
                                             <span className="font-mono">{e.name}</span>
                                             {e.missing && <span className="text-[9px] font-bold uppercase tracking-wider bg-[var(--cc-red-fg)] text-white px-1.5 py-0.5 rounded ml-2">Missing</span>}
                                          </div>
                                          <span className="text-[var(--cc-muted-fg)] text-xs">{e.size}</span>
                                       </div>
                                    ))}
                                 </div>
                                 <div className="p-6 border-2 border-dashed border-[var(--cc-border)] rounded-lg flex flex-col items-center justify-center text-center bg-[var(--cc-muted)]/20 text-[var(--cc-muted-fg)] cursor-pointer hover:bg-[var(--cc-muted)]/50 transition-colors">
                                    <Upload className="w-6 h-6 mb-2 opacity-70" />
                                    <span className="text-sm font-medium text-[var(--cc-fg)]">Drag & drop evidence</span>
                                    <span className="text-xs mt-1">or click to browse</span>
                                 </div>
                              </div>
                              <div className="space-y-5">
                                 <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted-fg)] border-b border-[var(--cc-border)] pb-2">Leg Audit</h3>
                                 <div className="space-y-3 text-sm">
                                    {leg.audit.map((a,i) => (
                                       <div key={i} className="flex gap-4">
                                          <div className="w-[120px] shrink-0 text-[var(--cc-muted-fg)] text-xs flex flex-col">
                                             <span className="font-medium text-[var(--cc-fg)]">{a.who}</span>
                                             <span className="opacity-80">{a.when}</span>
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
                      </>
                   )
                })()}
             </div>
          )}
       </div>

       {/* RIGHT RAIL - Context & Comms */}
       <div className="w-[360px] shrink-0 bg-[var(--cc-bg)] flex flex-col border-l border-[var(--cc-border)] shadow-sm z-10 relative">
          
          <div className="flex-none px-4 py-3 border-b border-[var(--cc-border)] bg-[var(--cc-card)]">
             <button className="cc-btn cc-btn-primary w-full justify-center shadow-sm">
                Open in queue <ArrowRight className="w-4 h-4 ml-1" />
             </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
             
             {/* Communication */}
             <div className="cc-card overflow-hidden shadow-sm">
                <div className="px-3 py-2 bg-[var(--cc-green-bg)] border-b border-[var(--cc-green-border)] text-[var(--cc-green-fg)] flex justify-between items-center">
                   <h3 className="text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5"/> Communication</h3>
                </div>
                <div className="divide-y divide-[var(--cc-border)] bg-[var(--cc-card)]">
                   <div className="p-3">
                      <div className="flex justify-between items-center mb-2"><span className="font-bold text-xs text-[var(--cc-fg)]">Payor portal</span><span className="text-[10px] text-[var(--cc-muted-fg)]">May 13</span></div>
                      <div className="text-xs bg-[var(--cc-muted)]/40 p-2.5 rounded border border-[var(--cc-border)] leading-relaxed">
                         "GPS Exemption Request Approved A detailed review of the GPS data confirmed compliance..."
                      </div>
                   </div>
                   <div className="p-3">
                      <div className="flex justify-between items-center mb-2"><span className="font-bold text-xs text-[var(--cc-fg)]">Operator 1</span><span className="text-[10px] text-[var(--cc-muted-fg)]">May 13</span></div>
                      <div className="text-xs bg-[var(--cc-muted)]/40 p-2.5 rounded border border-[var(--cc-border)] leading-relaxed">
                         "Verdict applied to Leg #1277."
                      </div>
                   </div>
                   <div className="p-3 bg-[var(--cc-muted)]/10">
                      <textarea className="cc-input text-xs" rows={3} placeholder="Reply to thread..."></textarea>
                      <div className="flex justify-end mt-2"><button className="cc-btn cc-btn-sm"><Send className="w-3 h-3"/> Send</button></div>
                   </div>
                </div>
             </div>

             {/* Notes */}
             <div className="cc-card p-4 space-y-3 shadow-sm">
                <h3 className="text-[10px] uppercase font-bold text-[var(--cc-muted-fg)] tracking-wider">Internal Notes</h3>
                <textarea className="cc-input text-xs" rows={2} placeholder="Add a note..."></textarea>
             </div>

             {/* Activity History */}
             <div className="cc-card overflow-hidden shadow-sm">
                <div className="px-3 py-2 bg-[var(--cc-muted)]/50 border-b border-[var(--cc-border)] flex justify-between items-center">
                   <h3 className="text-[10px] uppercase font-bold tracking-wider text-[var(--cc-muted-fg)] flex items-center gap-1.5"><History className="w-3.5 h-3.5"/> Full History</h3>
                </div>
                <div className="p-3 bg-[var(--cc-card)]">
                   <div className="space-y-4">
                      {AUDIT_LOG.map((a,i) => (
                         <div key={i} className="text-xs">
                            <div className="text-[var(--cc-fg)] mb-0.5">{a.action}</div>
                            <div className="flex justify-between text-[10px] text-[var(--cc-muted-fg)] font-medium"><span>{a.author}</span><span>{a.time}</span></div>
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
