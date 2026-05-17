import "./_group.css";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  MessageSquare,
  XCircle,
  Tag,
  Link as LinkIcon,
  Copy,
  Layers,
  Inbox,
  Send,
  Check,
  PauseCircle
} from "lucide-react";
import {
  LEGS,
  AUDIT_LOG,
  GROUP_FILES,
  KpiTile,
  AdminRow,
  ClosureReasonRow,
  FieldRow,
  LegRow,
  FocusPanel
} from "./D2Ledger";

/* ------------------------------------------------------------------ */
/*  D2F — "Two-Column Focus-Front"                                      */
/*  Same chrome as D2/D2D. Same primitives. Same typography.            */
/*  Difference vs D2D: right rail is dissolved — Communication +        */
/*  Group Evidence + Notes + Activity stack BELOW the focus panel       */
/*  inside the main column. Operator's left action rail is preserved.   */
/* ------------------------------------------------------------------ */

export default function D2F_TwoCol() {
  const [selectedKey, setSelectedKey] = useState("1278");
  const selected = LEGS[selectedKey];

  return (
    <div className="cc-scope flex flex-col h-screen overflow-hidden bg-[var(--cc-bg)] text-[var(--cc-fg)]">

      {/* 1. TOP UTILITY BAR + HEADER (verbatim from D2) */}
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

      {/* 2. PAYOR ALERT BANNER (verbatim from D2) */}
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

      {/* 3. KPI STRIP (verbatim from D2) */}
      <div className="flex-none border-b border-[var(--cc-border)] bg-[var(--cc-bg)] flex divide-x divide-[var(--cc-border)] z-10 relative">
        <KpiTile label="Total Exposure" value="$80.02" sub="2 legs" />
        <KpiTile label="In Dispute" value="$0.00" sub="0 legs" />
        <KpiTile label="Non-Issue" value="$0.00" sub="—" />
        <KpiTile label="Recovered" value="$0.00" sub="—" />
        <KpiTile label="Days in Queue" value="19" />
      </div>

      {/* 4. 2-COLUMN BODY  ←—— THE DIFFERENCE FROM D2D */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT COLUMN: Summary & Actions (verbatim from D2/D2D) */}
        <div className="w-[260px] shrink-0 border-r border-[var(--cc-border)] flex flex-col overflow-y-auto bg-[var(--cc-bg)] custom-scrollbar">
          <SidebarLeft />
        </div>

        {/* MAIN COLUMN: legs strip → focus panel → comm card → 3-up evidence/notes/activity */}
        <div className="flex-1 flex flex-col bg-[var(--cc-bg)] overflow-hidden">

          {/* Header row — verbatim from D2D */}
          <div className="flex-none px-4 py-3 border-b border-[var(--cc-border)] flex items-center justify-between bg-[var(--cc-card)] shadow-sm z-10">
            <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--cc-fg)]">
              <Layers className="w-4 h-4 text-[var(--cc-muted-fg)]" />
              Disputed Legs <span className="text-[var(--cc-muted-fg)] font-normal text-xs ml-1">(2 active)</span>
            </h2>
          </div>

          {/* Single scroll container so focus panel + side panels read as one body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-[var(--cc-bg)]">

            {/* Ledger as horizontal strip — D2's LegRow verbatim (same as D2D) */}
            <div className="p-4 border-b border-[var(--cc-border)] bg-[var(--cc-muted)]/30 flex items-stretch gap-2 overflow-x-auto custom-scrollbar shadow-inner">
              {Object.values(LEGS).map((leg) => (
                <div key={leg.key} className="shrink-0 w-[300px]">
                  <LegRow
                    leg={leg}
                    selected={selectedKey === leg.key}
                    onClick={() => setSelectedKey(leg.key)}
                  />
                </div>
              ))}
            </div>

            {/* Focus panel — verbatim */}
            <FocusPanel leg={selected} />

            {/* Communication card — full width, verbatim markup from D2/D2D's SidebarRight */}
            <div className="p-4 border-t border-[var(--cc-border)]">
              <CommunicationCard />
            </div>

            {/* 3-up sub-grid: Group Evidence / Notes / Activity History */}
            <div className="px-4 pb-4 grid grid-cols-3 gap-4">
              <GroupEvidenceCard />
              <NotesCard />
              <ActivityCard />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Left sidebar — verbatim copy of D2D's SidebarLeft                   */
/* ------------------------------------------------------------------ */

function SidebarLeft() {
  return (
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

      {/* Admin Actions */}
      <div className="cc-card overflow-hidden">
        <div className="bg-[var(--cc-purple-bg)] px-3 py-2 border-b border-[var(--cc-purple-border)] text-[var(--cc-purple-fg)] flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-wider font-semibold">Overrides &amp; Admin</h3>
          <span className="text-[9px] uppercase tracking-wider font-bold opacity-70">Operator only</span>
        </div>

        <div className="px-3 py-2 border-b border-[var(--cc-border)] bg-[var(--cc-amber-bg)]/40 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--cc-amber-fg)]">
            <AlertTriangle className="w-3 h-3" /> MAS · Reattest required
          </div>
          <span className="text-[9px] font-semibold text-[var(--cc-muted-fg)] uppercase tracking-wide">2 legs</span>
        </div>
        <button className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-[var(--cc-success)] hover:bg-[var(--cc-muted)] border-b border-[var(--cc-border)] flex items-center gap-1.5">
          <Check className="w-3 h-3" /> Mark as already re-attested
        </button>

        <div className="p-1.5 flex flex-col gap-0.5">
          <AdminRow label="Place on hold" icon={<PauseCircle className="w-3.5 h-3.5" />} />
          <AdminRow label="Withdraw" icon={<XCircle className="w-3.5 h-3.5" />} />
          <AdminRow label="Reclassify legs" icon={<Tag className="w-3.5 h-3.5" />} />
          <AdminRow label="Mark duplicates" icon={<LinkIcon className="w-3.5 h-3.5" />} />
        </div>

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
  );
}

/* ------------------------------------------------------------------ */
/*  Below cards — verbatim copies of the 4 sections from D2D's          */
/*  SidebarRight, broken out so the main column can lay them in a       */
/*  full-width Comm + 3-up grid.                                        */
/* ------------------------------------------------------------------ */

function CommunicationCard() {
  return (
    <div className="cc-card overflow-hidden border-[var(--cc-green-border)]">
      <div className="bg-[var(--cc-green-bg)] text-[var(--cc-green-fg)] px-3 py-2 border-b border-[var(--cc-green-border)] flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-1.5"><MessageSquare className="w-3 h-3" /> Communication</h3>
        <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-white/60 border border-[var(--cc-green-border)] rounded">Group verdict · Approved</span>
      </div>
      <div className="divide-y divide-[var(--cc-border)]">
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
        <div className="p-3 bg-[var(--cc-card)]">
          <div className="flex items-center justify-between mb-1 text-xs">
            <span className="font-semibold text-[var(--cc-fg)]">Operator 1 · note</span>
            <span className="text-[var(--cc-muted-fg)] text-[10px]">May 13, 2026 · 9:02 AM</span>
          </div>
          <p className="text-[11px] text-[var(--cc-fg)]">Verdict applied to Leg #1277. Need to resolve Leg #1278 GPS log separately before this group can fully close.</p>
        </div>
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
        <div className="p-2 bg-[var(--cc-muted)]/30 flex gap-2">
          <input type="text" placeholder="Reply to thread..." className="flex-1 cc-input text-xs py-1.5 bg-[var(--cc-card)]" />
          <button className="cc-btn cc-btn-sm cc-btn-primary px-2 py-1"><Send className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

function GroupEvidenceCard() {
  return (
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
  );
}

function NotesCard() {
  return (
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
  );
}

function ActivityCard() {
  return (
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
  );
}
