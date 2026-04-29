import "./_group.css";
import {
  AlertTriangle, Tag, Edit2, Send, PauseCircle, TreeDeciduous, Trash2,
  Bot, Mail, Inbox, MessagesSquare, ArrowRight, ArrowRightLeft, CheckCircle, X,
  Eye, ChevronDown, Clock,
} from "lucide-react";
import { claim, evidenceItems, submissions, responses, emails, auditLog, StatusPill, PresenceAvatars, validOutcomes } from "./_shared";

export function Current() {
  return (
    <div className="cc-scope p-6 space-y-5" style={{ width: "100%" }}>
      {/* HEADER STRIP */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold mono">{claim.confNumber}</h2>
          <StatusPill status={claim.status} />
          <span className="cc-badge">{claim.outcome}</span>
        </div>
        <div className="flex items-center gap-2">
          <PresenceAvatars />
          <button className="cc-btn"><Edit2 className="w-3.5 h-3.5" />Edit</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          {/* CLAIM DETAILS CARD - includes its own action (assign error type) */}
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3">Claim Details</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Conf #" value={claim.confNumber} mono />
              <Field label="Date" value={claim.date} />
              <Field label="Client #" value={claim.clientNumber} />
              <Field label="Car #" value={claim.carNumber} />
              <Field label="Amount" value={claim.claimAmount} />
              <Field label="Payor Email" value={claim.payorEmail} />
              <div className="col-span-2">
                <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Ref #</div>
                <div className="mt-1 mono text-sm">{claim.refNumber}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Error Details</div>
                <div className="mt-1.5">
                  <span className="cc-badge" style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)", border: "none" }}>Multiple errors detected</span>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {claim.errorDetails.split(";").map((p, i) => (
                    <li key={i} className="flex gap-2"><span style={{ color: "var(--cc-muted-fg)" }}>{i + 1}.</span><span>{p.trim()}</span></li>
                  ))}
                </ul>
              </div>
              <div className="col-span-2">
                <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Error Type</div>
                <div className="mt-1.5">
                  {/* ACTION inside data card */}
                  <button className="cc-btn" style={{ background: "var(--cc-amber-bg)", borderColor: "var(--cc-amber-border)", color: "var(--cc-amber-fg)" }}>
                    <AlertTriangle className="w-3.5 h-3.5" />Assign Error Type
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* DISPUTE WORKFLOW CARD - has its own decision tree player */}
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3 flex items-center gap-2"><TreeDeciduous className="w-4 h-4" />Dispute Workflow</div>
            <div className="rounded p-3 text-sm" style={{ background: "var(--cc-muted)", border: "1px solid var(--cc-border)" }}>
              <div className="flex items-center gap-2 mb-2"><span className="cc-badge cc-badge-secondary">Step 3 of 5</span><span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Decide dispute path</span></div>
              <div className="font-medium mb-2">Has the trip log been collected?</div>
              <div className="flex gap-2">
                <button className="cc-btn cc-btn-sm">Yes, attach log</button>
                <button className="cc-btn cc-btn-sm">No — request from driver</button>
                <button className="cc-btn cc-btn-sm cc-btn-ghost">Skip step</button>
              </div>
            </div>
          </div>

          {/* ACTIONS CARD - the big chaotic one */}
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3">Actions</div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="cc-select" style={{ width: 180 }}>
                <option>Change Status</option>
                {["Needs Review","Needs Evidence","On Hold","Submitted","Closed"].map(s => <option key={s}>{s}</option>)}
              </select>
              {validOutcomes.slice(0, 2).map(o => (
                <button key={o} className={`cc-btn ${o === claim.status ? "cc-btn-primary" : ""}`}>{o}</button>
              ))}
              <button className="cc-btn">Payer Denied</button>
              <button className="cc-btn">Withdraw — Not Contestable</button>
              <button className="cc-btn">Withdraw — Accepted Loss</button>
              <div className="w-px h-6 mx-1" style={{ background: "var(--cc-border)" }} />
              <button className="cc-btn"><Send className="w-3.5 h-3.5" />Queue for Portal</button>
              <button className="cc-btn"><PauseCircle className="w-3.5 h-3.5" />Place on Hold</button>
            </div>
          </div>

          {/* EVIDENCE CARD with per-item delete actions */}
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3">Evidence</div>
            <div className="text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>Collected Evidence ({evidenceItems.length} items)</div>
            <div className="space-y-2">
              {evidenceItems.map(ev => (
                <div key={ev.id} className="rounded p-3 text-sm flex items-start justify-between" style={{ background: "var(--cc-muted)", border: "1px solid var(--cc-border)" }}>
                  <div>
                    <div className="font-medium">{ev.type}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{ev.note}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]" style={{ color: "var(--cc-muted-fg)" }}>by {ev.by} · {ev.at}</span>
                    <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ color: "var(--cc-destructive)", padding: 4 }}><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PORTAL SUBMISSIONS */}
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Bot className="w-4 h-4" />Portal Submissions</div>
            {submissions.map(s => (
              <div key={s.id} className="rounded p-3 text-sm flex items-center justify-between" style={{ background: "var(--cc-blue-bg)", border: "1px solid var(--cc-blue-border)" }}>
                <div><div className="font-medium" style={{ color: "var(--cc-blue-fg)" }}>{s.status}</div><div className="text-xs mt-0.5" style={{ color: "var(--cc-blue-fg)", opacity: 0.7 }}>{s.submittedAt} · {s.confirmation}</div></div>
                <button className="cc-btn cc-btn-sm">View Log</button>
              </div>
            ))}
          </div>

          {/* RESPONSES with per-response action triplet */}
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3 flex items-center gap-2"><Inbox className="w-4 h-4" />Responses Received <span className="cc-badge cc-badge-secondary">1</span></div>
            {responses.map(r => (
              <div key={r.id} className="rounded p-3 space-y-2" style={{ background: "var(--cc-red-bg)", border: "1px solid var(--cc-red-border)" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm"><Mail className="w-3.5 h-3.5" style={{ color: "var(--cc-red-fg)" }} /><span className="font-medium">Email Response</span><span className="cc-badge" style={{ background: "white" }}>{r.typeLabel}</span><span className="cc-badge" style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)", border: "none" }}>Needs Review</span></div>
                  <span className="text-xs" style={{ opacity: 0.7 }}>{r.receivedAt}</span>
                </div>
                <div className="text-sm font-medium">{r.subject}</div>
                <div className="text-sm rounded p-2" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(0,0,0,0.05)" }}>{r.body}</div>
                <div className="flex items-center gap-2 text-xs" style={{ opacity: 0.65 }}>
                  <span>From: {r.sender}</span>
                  <span className="cc-badge" style={{ background: "var(--cc-green-bg)", color: "var(--cc-green-fg)", border: "none" }}>{r.confidence} confidence</span>
                  <button className="cc-btn cc-btn-ghost cc-btn-sm ml-auto"><ArrowRightLeft className="w-3 h-3" />Not the right claim?</button>
                </div>
                <div className="flex gap-2 pt-1">
                  <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-green-bg)", color: "var(--cc-green-fg)", borderColor: "var(--cc-green-border)" }}><CheckCircle className="w-3 h-3" />Approve</button>
                  <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-red-bg)", color: "var(--cc-red-fg)", borderColor: "var(--cc-red-border)" }}><X className="w-3 h-3" />Deny</button>
                  <button className="cc-btn cc-btn-sm"><Eye className="w-3 h-3" />Mark Reviewed</button>
                </div>
              </div>
            ))}
          </div>

          {/* EMAIL THREAD */}
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3 flex items-center gap-2"><MessagesSquare className="w-4 h-4" />Email Thread <span className="cc-badge cc-badge-secondary">{emails.length}</span></div>
            <div className="space-y-2">
              {emails.map(m => (
                <div key={m.id} className={`rounded p-3 text-sm ${m.dir === "outbound" ? "ml-6" : "mr-6"}`} style={{ background: m.dir === "outbound" ? "var(--cc-blue-bg)" : "var(--cc-muted)", border: "1px solid var(--cc-border)" }}>
                  <div className="flex justify-between items-center"><span className="text-xs font-medium">{m.dir === "outbound" ? "Sent" : "Received"} · {m.sender}</span><span className="text-xs" style={{ opacity: 0.6 }}>{m.at}</span></div>
                  <div className="font-medium mt-1">{m.subject}</div>
                  <div className="text-xs mt-1" style={{ opacity: 0.8 }}>{m.body}</div>
                </div>
              ))}
            </div>
          </div>

          {/* NEXT STEPS - yet another action zone */}
          <div className="cc-card p-4" style={{ background: "var(--cc-blue-bg)", borderWidth: 2, borderColor: "var(--cc-blue-border)" }}>
            <div className="text-sm font-semibold mb-1 flex items-center gap-2" style={{ color: "var(--cc-blue-fg)" }}><ArrowRight className="w-4 h-4" />Next Steps — Response Received</div>
            <div className="text-sm mb-3" style={{ color: "var(--cc-blue-fg)" }}>The dispute was denied. Choose how to proceed:</div>
            <div className="flex flex-wrap gap-2">
              <button className="cc-btn">Accept Loss & Close</button>
              <button className="cc-btn">Dispute Further</button>
              <button className="cc-btn">Place on Hold</button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Notes + separate Audit Trail (claim is "left behind") */}
        <div className="space-y-5">
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3">Notes</div>
            <textarea className="cc-input" rows={3} placeholder="Add a note..." />
            <div className="mt-2 flex justify-end"><button className="cc-btn cc-btn-primary cc-btn-sm">Save Note</button></div>
            <div className="cc-divider my-3" />
            <div className="text-xs space-y-2" style={{ color: "var(--cc-muted-fg)" }}>
              <div>(no notes yet)</div>
            </div>
          </div>
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3 flex items-center justify-between">Audit Trail <ChevronDown className="w-3 h-3" /></div>
            <div className="text-xs space-y-2" style={{ color: "var(--cc-muted-fg)" }}>
              <div className="flex items-center gap-2"><Clock className="w-3 h-3" /><span>(this claim has no audit rows — group actions don't appear here)</span></div>
            </div>
          </div>
          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-2">Reassign</div>
            <button className="cc-btn w-full justify-center"><ArrowRightLeft className="w-3.5 h-3.5" />Reassign to another claim</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className={`text-sm mt-1 font-medium ${mono ? "mono" : ""}`}>{value}</div>
    </div>
  );
}
