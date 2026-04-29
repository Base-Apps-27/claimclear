import "../claim-detail-redesign/_group.css";
import {
  Play, Sparkles, FlaskConical, Edit2, X, FileText, Image as ImageIcon, Bot,
  Send, ExternalLink, ChevronRight, Activity, CheckCircle2, RefreshCw, Loader2, Pencil,
} from "lucide-react";
import { useState } from "react";
import {
  submissions, statusOrder, counts, fieldsForDrawer, narrativeText, attachments, botActivity,
  PageHeader, StatusStrip, SubStatusPill,
} from "./_shared";
import { SubmissionRow, StatusGroup } from "./_rows";

const focused = submissions.find(s => s.conf === "C-2026-04812")!;

export function PortalSubmissionDrawer() {
  const [tab, setTab] = useState<"payload" | "sandbox" | "activity">("payload");
  const grouped = statusOrder.reduce<Record<string, typeof submissions>>((acc, s) => {
    acc[s] = submissions.filter(x => x.status === s);
    return acc;
  }, {});

  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <PageHeader counts={counts} activeFilter="All" />
      <StatusStrip />

      <div className="grid grid-cols-12 gap-5">
        {/* COMPRESSED LIST — drawer focused on right */}
        <div className="col-span-7 space-y-3">
          <div className="cc-card flex items-center gap-3 px-4 py-2.5" style={{ background: "var(--cc-blue-bg)" }}>
            <Sparkles className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--cc-blue-fg)" }} />
            <div className="flex-1 text-xs font-medium" style={{ color: "var(--cc-blue-fg)" }}>3 drafts ready to queue.</div>
            <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-blue-fg)", color: "white", border: "none", fontSize: 11 }}>
              <Play className="w-3 h-3" />Queue 3
            </button>
          </div>

          {statusOrder.map(s => (
            <StatusGroup key={s} status={s} count={grouped[s].length} defaultOpen={s !== "Submitted"}>
              {grouped[s].map(row => (
                <SubmissionRow key={row.id} sub={row} highlighted={row.id === focused.id} />
              ))}
            </StatusGroup>
          ))}
        </div>

        {/* UNIFIED VIEW DRAWER — replaces both former dialogs */}
        <aside className="col-span-5 space-y-0" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden" style={{ borderColor: "var(--cc-blue-border, var(--cc-blue-fg))" }}>
            {/* Drawer header — distinguishable from page header */}
            <div style={{ height: 3, background: "var(--cc-blue-fg)" }} />
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--cc-border)" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="cc-badge mono" style={{
                    background: "var(--cc-blue-fg)", color: "white", border: "none",
                    padding: "0.15rem 0.5rem", fontSize: 10, letterSpacing: "0.05em",
                  }}>
                    <Send className="w-2.5 h-2.5" />SUBMISSION
                  </span>
                  <span className="mono font-bold text-sm">{focused.conf}</span>
                  <SubStatusPill status={focused.status} />
                </div>
                <button className="p-1 rounded hover:bg-[var(--cc-muted)]"><X className="w-4 h-4" style={{ color: "var(--cc-muted-fg)" }} /></button>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>
                <span>{focused.amount}</span><span>·</span>
                <span>{focused.issue}</span><span>·</span>
                <span>attempt {focused.attempts}</span>
              </div>
            </div>

            {/* Tab strip — single source of truth for "viewing" this submission */}
            <div className="flex" style={{ background: "var(--cc-muted)", borderBottom: "1px solid var(--cc-border)" }}>
              <DrawerTab label="Payload"  hint="What we'll send" icon={<FileText className="w-3.5 h-3.5" />} active={tab === "payload"}  onClick={() => setTab("payload")} />
              <DrawerTab label="Sandbox"  hint="Dry-run proof"   icon={<FlaskConical className="w-3.5 h-3.5" />} active={tab === "sandbox"}  onClick={() => setTab("sandbox")} />
              <DrawerTab label="Activity" hint="Bot timeline"    icon={<Activity className="w-3.5 h-3.5" />} active={tab === "activity"} onClick={() => setTab("activity")} />
            </div>

            {/* Tab content */}
            <div className="p-4 space-y-3" style={{ background: "var(--cc-bg)", maxHeight: 720, overflowY: "auto" }}>
              {tab === "payload" && <PayloadTab />}
              {tab === "sandbox" && <SandboxTab />}
              {tab === "activity" && <ActivityTab />}
            </div>

            {/* Drawer footer — single primary + a couple of escape hatches */}
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--cc-border)", background: "var(--cc-card)" }}>
              <button className="cc-btn" style={{ background: "var(--cc-blue-fg)", color: "white", border: "none" }}>
                <Play className="w-4 h-4" />Process now
              </button>
              <button className="cc-btn cc-btn-ghost"><X className="w-4 h-4" />Cancel</button>
              <a href="#" className="ml-auto text-xs flex items-center gap-1" style={{ color: "var(--cc-primary)" }}>Open claim {focused.conf} <ChevronRight className="w-3 h-3" /></a>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DrawerTab({ label, hint, icon, active, onClick }: { label: string; hint: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex-1 px-3 py-2.5 text-left transition-colors" style={{
      background: active ? "var(--cc-bg)" : "transparent",
      borderRight: "1px solid var(--cc-border)",
      borderBottom: active ? "2px solid var(--cc-blue-fg)" : "2px solid transparent",
      marginBottom: -1,
    }}>
      <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: active ? "var(--cc-blue-fg)" : "var(--cc-fg)" }}>
        {icon}{label}
      </div>
      <div className="text-[10px] mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{hint}</div>
    </button>
  );
}

function DrawerSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="cc-card">
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)", background: "var(--cc-card)" }}>
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cc-muted-fg)" }}>{title}</span>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function PayloadTab() {
  return (
    <>
      <div className="rounded p-2.5 text-[11px] flex items-start gap-2" style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}>
        <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>This is the exact payload the bot will paste into the MAS portal form. Editing here updates the draft — nothing is sent until you click Process.</span>
      </div>

      <DrawerSection title="Form fields" action={<button className="cc-btn cc-btn-ghost cc-btn-sm"><Pencil className="w-3 h-3" />Edit</button>}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {fieldsForDrawer.map(f => (
            <div key={f.label} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--cc-muted-fg)" }}>{f.label}</div>
              <div className="text-xs mt-0.5 truncate" title={f.value}>{f.value}</div>
            </div>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection title="Dispute narrative" action={
        <div className="flex items-center gap-1">
          <button className="cc-btn cc-btn-ghost cc-btn-sm"><Sparkles className="w-3 h-3" />Regenerate</button>
          <button className="cc-btn cc-btn-ghost cc-btn-sm"><Pencil className="w-3 h-3" />Edit</button>
        </div>
      }>
        <div className="text-xs leading-relaxed" style={{ color: "var(--cc-fg)" }}>{narrativeText}</div>
      </DrawerSection>

      <DrawerSection title={`Attachments (${attachments.length})`} action={<button className="cc-btn cc-btn-ghost cc-btn-sm"><Edit2 className="w-3 h-3" />Manage</button>}>
        <div className="space-y-1.5">
          {attachments.map(a => (
            <div key={a.name} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded" style={{ background: "var(--cc-muted)" }}>
              {a.kind === "img" ? <ImageIcon className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} /> : <FileText className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />}
              <span className="flex-1 truncate mono">{a.name}</span>
              <span style={{ color: "var(--cc-muted-fg)" }}>{a.size}</span>
            </div>
          ))}
        </div>
      </DrawerSection>
    </>
  );
}

function SandboxTab() {
  return (
    <>
      <div className="rounded p-2.5 text-[11px] flex items-start gap-2" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
        <FlaskConical className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span><strong>Dry run.</strong> Logs in to MAS, fills the form, captures a screenshot — does <em>not</em> click Submit. Use this to verify the payload looks right on the actual portal before processing.</span>
      </div>

      <DrawerSection title="Last sandbox run" action={
        <button className="cc-btn cc-btn-ghost cc-btn-sm"><RefreshCw className="w-3 h-3" />Re-run sandbox</button>
      }>
        <div className="flex items-center gap-2 text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>
          <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--cc-success)" }} />
          <span><span style={{ color: "var(--cc-fg)" }} className="font-medium">M. Rivera</span> · Apr 26, 8:54am · 6.2s</span>
        </div>
        {/* Mock screenshot frame */}
        <div className="rounded overflow-hidden border" style={{ borderColor: "var(--cc-border)", background: "white" }}>
          <div className="px-2 py-1 text-[10px] flex items-center gap-1.5" style={{ background: "#f1f3f5", color: "#495057", borderBottom: "1px solid var(--cc-border)" }}>
            <span className="w-2 h-2 rounded-full bg-red-400" /><span className="w-2 h-2 rounded-full bg-yellow-400" /><span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="ml-2 mono">portal.masmedicaid.gov/disputes/new</span>
          </div>
          <div className="p-3 text-[10px] space-y-1.5" style={{ color: "#495057" }}>
            <div className="font-bold text-[11px]" style={{ color: "#212529" }}>New Dispute Form</div>
            <MockField label="Conf #" value="C-2026-04812" />
            <MockField label="Issue Type" value="GPS Control Deviation" />
            <MockField label="Subject" value="Dispute C-2026-04812 — mileage mismatch" />
            <MockField label="Description" value={narrativeText.slice(0, 120) + "…"} multiline />
            <MockField label="Attachments" value="3 files attached" />
            <div className="flex gap-2 mt-2">
              <button className="px-2 py-1 rounded text-[10px] font-semibold" style={{ background: "#adb5bd", color: "white", cursor: "not-allowed" }} disabled>Submit (not clicked)</button>
              <button className="px-2 py-1 rounded text-[10px] border" style={{ borderColor: "#dee2e6" }}>Cancel</button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs">
          <span style={{ color: "var(--cc-muted-fg)" }}>Captured 212 KB · stored for 30 days</span>
          <a href="#" className="flex items-center gap-1" style={{ color: "var(--cc-primary)" }}>Open full-size <ExternalLink className="w-3 h-3" /></a>
        </div>
      </DrawerSection>
    </>
  );
}

function MockField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div style={{ color: "#868e96" }}>{label}</div>
      <div className="rounded px-1.5 py-1" style={{ background: "#f8f9fa", border: "1px solid #e9ecef", marginTop: 2, minHeight: multiline ? 36 : 18 }}>{value}</div>
    </div>
  );
}

function ActivityTab() {
  return (
    <>
      <div className="rounded p-2.5 text-[11px] flex items-start gap-2" style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}>
        <Bot className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>Step-by-step trace of what the bot did for this submission. Green = succeeded, red = error.</span>
      </div>

      <DrawerSection title="Bot timeline">
        <div className="space-y-2.5">
          {botActivity.map((a, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <div className="flex flex-col items-center pt-0.5">
                <div className="w-2 h-2 rounded-full" style={{ background: a.ok ? "var(--cc-success)" : "var(--cc-destructive)" }} />
                {i < botActivity.length - 1 && <div className="flex-1 w-px mt-1" style={{ background: "var(--cc-border)" }} />}
              </div>
              <div className="flex-1 pb-1.5">
                <div className="font-medium">{a.action}</div>
                {a.message && <div className="text-[11px] mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{a.message}</div>}
                <div className="text-[10px] mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{a.at}</div>
              </div>
            </div>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection title="Result">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4" style={{ color: "var(--cc-success)" }} />
          <span>Submitted — ticket <span className="mono font-semibold">MAS-2026-A8841</span></span>
        </div>
        <div className="text-[11px] mt-1" style={{ color: "var(--cc-muted-fg)" }}>Apr 26, 9:02am · 1m 14s end-to-end</div>
      </DrawerSection>
    </>
  );
}
