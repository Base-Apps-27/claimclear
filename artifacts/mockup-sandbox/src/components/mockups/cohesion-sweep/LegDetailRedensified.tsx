import { ReactNode } from "react";
import {
  ChevronLeft, PauseCircle, XCircle, UserPlus, Save, Lock, Edit2,
  RotateCcw, Paperclip, Plus, MessageSquare, Mail, ArrowUpRight,
  Gavel, Stamp, Clock, FileText, Activity, AlertTriangle,
  CheckCircle2, Pin, Send,
} from "lucide-react";
import { StatusPill } from "./_shared";

/* ------------------------------------------------------------------ */
/* Card helpers                                                        */
/* ------------------------------------------------------------------ */

function Card({ title, action, icon, children, padded = true, dense = false }: {
  title: ReactNode; action?: ReactNode; icon?: ReactNode;
  children: ReactNode; padded?: boolean; dense?: boolean;
}) {
  return (
    <div className="cc-card">
      <div className={`px-4 ${dense ? "py-2" : "py-3"} flex items-center justify-between`}
           style={{ borderBottom: "1px solid var(--cc-border)" }}>
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {action}
      </div>
      <div className={padded ? "p-4" : ""}>{children}</div>
    </div>
  );
}

function MutedNote({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs flex items-start gap-1.5 px-2.5 py-1.5 rounded"
         style={{ color: "var(--cc-muted-fg)", background: "var(--cc-muted)" }}>
      <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function GoToGroupLink({ children }: { children: ReactNode }) {
  return (
    <a className="text-xs font-medium inline-flex items-center gap-1 hover:underline"
       style={{ color: "var(--cc-purple-fg)" }} href="#group">
      {children}<ArrowUpRight className="w-3 h-3" />
    </a>
  );
}

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm"
         style={{ borderBottom: "1px dashed var(--cc-border)" }}>
      <span className="text-xs uppercase tracking-wide font-medium"
            style={{ color: "var(--cc-muted-fg)" }}>{label}</span>
      <span className="font-medium" style={{ color: "var(--cc-fg)" }}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SOP walk node (compact read-only)                                   */
/* ------------------------------------------------------------------ */

function SopNode({ q, a, terminal }: { q: string; a: string; terminal?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-col items-center mt-0.5">
        <div className="w-2 h-2 rounded-full"
             style={{ background: terminal ? "var(--cc-green-fg)" : "var(--cc-blue-fg)" }} />
        {!terminal && <div className="w-px flex-1 mt-1" style={{ background: "var(--cc-border)", minHeight: 18 }} />}
      </div>
      <div className="flex-1 pb-3">
        <div className="text-xs font-medium" style={{ color: "var(--cc-fg)" }}>{q}</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>
          Answer: <span className="font-semibold" style={{ color: "var(--cc-blue-fg)" }}>{a}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function LegDetailRedensified() {
  return (
    <div className="cc-scope min-h-screen p-6" style={{ background: "var(--cc-bg)", color: "var(--cc-fg)" }}>
      <div className="max-w-[1180px] mx-auto space-y-4">

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
          <a className="hover:underline" href="#">Claims</a>
          <span>/</span>
          <a className="hover:underline inline-flex items-center gap-1" href="#group">
            <ChevronLeft className="w-3 h-3" /> Invoice #INV-1855844580
          </a>
          <span>/</span>
          <span style={{ color: "var(--cc-fg)" }}>Leg #2 of 4</span>
        </div>

        {/* Header */}
        <div className="cc-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-1 h-12 rounded" style={{ background: "var(--cc-blue-fg)" }} />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide font-semibold mb-0.5"
                     style={{ color: "var(--cc-muted-fg)" }}>
                  Leg / claim
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold mono">CLM-7184-2</h1>
                  <StatusPill tone="amber">Investigating</StatusPill>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>·</span>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                    Member <span className="font-medium" style={{ color: "var(--cc-fg)" }}>Robinson, T.</span> ·
                    Pickup <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}>03/30 09:42</span> ·
                    <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}> $82.68</span>
                  </span>
                </div>
                <div className="text-xs mt-1.5" style={{ color: "var(--cc-muted-fg)" }}>
                  Owned by <span className="font-medium" style={{ color: "var(--cc-fg)" }}>Danny K.</span> ·
                  Updated <span className="font-medium" style={{ color: "var(--cc-fg)" }}>14 min ago</span> ·
                  Group state: <span className="font-medium" style={{ color: "var(--cc-fg)" }}>Needs Evidence</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                      style={{ border: "1px solid var(--cc-border)" }}>
                <UserPlus className="w-3.5 h-3.5" /> Reassign
              </button>
              <button className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                      style={{ border: "1px solid var(--cc-border)" }}>
                <PauseCircle className="w-3.5 h-3.5" /> Hold
              </button>
              <button className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                      style={{ border: "1px solid var(--cc-border)" }}>
                <XCircle className="w-3.5 h-3.5" /> Exclude leg
              </button>
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-12 gap-4">

          {/* LEFT — Investigation workspace (8 cols) */}
          <div className="col-span-8 space-y-4">

            {/* Per-leg context */}
            <Card
              title="Per-leg context"
              icon={<Edit2 className="w-3.5 h-3.5" />}
              action={
                <button className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                        style={{ background: "var(--cc-blue-fg)", color: "white" }}>
                  <Save className="w-3 h-3" /> Save
                </button>
              }
            >
              <textarea
                rows={3}
                defaultValue="Driver had to reroute due to street closure on Maple Ave; trip ran 14 min over original quoted time. PCS attached separately."
                className="w-full text-sm rounded p-2"
                style={{
                  border: "1px solid var(--cc-border)",
                  background: "var(--cc-card)",
                  color: "var(--cc-fg)",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
              <div className="text-xs mt-2" style={{ color: "var(--cc-muted-fg)" }}>
                Legs-only context. The group context is shared by all legs and edited on the group page.
              </div>
            </Card>

            {/* SOP walk */}
            <Card
              title="Investigation walk"
              icon={<FileText className="w-3.5 h-3.5" />}
              action={
                <span className="text-xs px-2 py-0.5 rounded"
                      style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}>
                  PCS attestation tree · v3
                </span>
              }
            >
              <SopNode q="Did the trip exceed 60 minutes one-way?" a="No" />
              <SopNode q="Was a Physician Certification Statement (PCS) on file at time of trip?" a="Yes" />
              <SopNode q="Does the PCS cover the date of service?" a="Pending — need to verify" />
              <div className="mt-3 flex items-center gap-2">
                <button className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                        style={{ background: "var(--cc-blue-fg)", color: "white" }}>
                  <Send className="w-3.5 h-3.5" /> Continue walk
                </button>
                <button className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                        style={{ border: "1px solid var(--cc-border)" }}>
                  <RotateCcw className="w-3.5 h-3.5" /> Reset walk
                </button>
                <span className="text-xs ml-auto" style={{ color: "var(--cc-muted-fg)" }}>
                  Last advanced 14 min ago by Danny K.
                </span>
              </div>
            </Card>

            {/* Reclassify */}
            <Card
              title={<>Error type · <span className="font-normal" style={{ color: "var(--cc-muted-fg)" }}>PCS not on file</span></>}
              icon={<AlertTriangle className="w-3.5 h-3.5" />}
              action={
                <button className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                        style={{ border: "1px solid var(--cc-destructive)", color: "var(--cc-destructive)" }}>
                  <RotateCcw className="w-3 h-3" /> Reclassify…
                </button>
              }
            >
              <div className="text-xs flex items-start gap-2"
                   style={{ color: "var(--cc-muted-fg)" }}>
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                               style={{ color: "var(--cc-warning)" }} />
                <span>
                  Reclassifying discards the SOP walk above and resets the drop reason. Pre-submit only.
                </span>
              </div>
            </Card>

            {/* Evidence */}
            <Card
              title={<>Evidence <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>· 3 files</span></>}
              icon={<Paperclip className="w-3.5 h-3.5" />}
              action={
                <button className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                        style={{ border: "1px solid var(--cc-border)" }}>
                  <Plus className="w-3 h-3" /> Attach file
                </button>
              }
              padded={false}
            >
              {[
                { name: "PCS_Robinson_2026-03-30.pdf", size: "184 KB", who: "Danny K.", when: "2 days ago" },
                { name: "trip_log_03-30.csv",          size: "12 KB",  who: "Importer", when: "5 days ago" },
                { name: "driver_note_reroute.png",     size: "1.1 MB", who: "Mira S.",  when: "3 days ago" },
              ].map((f, i, arr) => (
                <div key={f.name}
                     className="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-[var(--cc-muted)] transition-colors"
                     style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
                  <Paperclip className="w-3.5 h-3.5 flex-shrink-0"
                             style={{ color: "var(--cc-muted-fg)" }} />
                  <span className="font-medium flex-1 truncate">{f.name}</span>
                  <span className="text-xs mono" style={{ color: "var(--cc-muted-fg)" }}>{f.size}</span>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                    {f.who} · {f.when}
                  </span>
                  <button className="text-xs hover:underline" style={{ color: "var(--cc-blue-fg)" }}>
                    Open
                  </button>
                </div>
              ))}
            </Card>

            {/* Notes */}
            <Card
              title={<>Notes <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>· 4</span></>}
              icon={<Pin className="w-3.5 h-3.5" />}
            >
              <div className="space-y-3">
                {[
                  { who: "Danny K.", when: "14 min ago", text: "Called billing — PCS confirmed on file but date might be expired. Pulling latest signed copy." },
                  { who: "Mira S.",  when: "Yesterday",  text: "Member is a regular. PCS renewals usually batched on the 15th." },
                  { who: "Danny K.", when: "2 days ago", text: "Reroute documented; will attach driver note shortly." },
                ].map(n => (
                  <div key={n.text} className="text-sm flex gap-2.5 items-start">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                         style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
                      {n.who.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-xs">{n.who}</span>
                        <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{n.when}</span>
                      </div>
                      <div style={{ color: "var(--cc-fg)" }}>{n.text}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--cc-border)" }}>
                <textarea
                  rows={2}
                  placeholder="Add a note for this leg…"
                  className="w-full text-sm rounded p-2"
                  style={{
                    border: "1px solid var(--cc-border)",
                    background: "var(--cc-card)",
                    color: "var(--cc-fg)",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
                <div className="flex justify-end mt-2">
                  <button className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                          style={{ background: "var(--cc-blue-fg)", color: "white" }}>
                    <Send className="w-3 h-3" /> Post note
                  </button>
                </div>
              </div>
            </Card>

            {/* Communication */}
            <Card
              title={<>Communication <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>· 2 messages</span></>}
              icon={<Mail className="w-3.5 h-3.5" />}
              action={
                <button className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                        style={{ border: "1px solid var(--cc-border)" }}>
                  <Mail className="w-3 h-3" /> Reply
                </button>
              }
              padded={false}
            >
              <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--cc-border)" }}>
                <div className="flex items-start gap-2 text-sm">
                  <Mail className="w-3.5 h-3.5 mt-0.5" style={{ color: "var(--cc-muted-fg)" }} />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-semibold text-xs">Modivcare Portal</span>
                      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Apr 28, 11:14 AM</span>
                    </div>
                    <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                      Re: Leg CLM-7184-2 — request additional documentation (PCS valid for DOS).
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="flex items-start gap-2 text-sm">
                  <Mail className="w-3.5 h-3.5 mt-0.5" style={{ color: "var(--cc-blue-fg)" }} />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-semibold text-xs">Danny K.</span>
                      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Apr 28, 12:02 PM</span>
                    </div>
                    <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                      Confirmed PCS active through 04/30/26; uploading signed copy to portal.
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* RIGHT — Group rail (4 cols) */}
          <div className="col-span-4 space-y-4">

            {/* Parent group context */}
            <Card
              title="Parent invoice"
              icon={<FileText className="w-3.5 h-3.5" />}
              action={<GoToGroupLink>Open group</GoToGroupLink>}
            >
              <div className="text-base font-bold mono mb-1">INV-1855844580</div>
              <div className="text-xs mb-3" style={{ color: "var(--cc-muted-fg)" }}>
                Modivcare · DOS 03/30/26 · 4 legs · <span className="mono">$284.20</span> total exposure
              </div>
              <div className="space-y-1">
                <FieldRow label="Group status"  value={<StatusPill tone="amber">Needs Evidence</StatusPill>} />
                <FieldRow label="Legs in dispute" value={<span className="mono">3 of 4</span>} />
                <FieldRow label="Days in queue" value={<span className="mono">6d</span>} />
                <FieldRow label="Group owner"   value="Danny K." />
              </div>
              <div className="text-xs mt-3 p-2 rounded"
                   style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}>
                Group context, evidence, and submission live on the group page.
              </div>
            </Card>

            {/* Latest verdict (read-only) */}
            <Card
              title="Latest payor verdict"
              icon={<Gavel className="w-3.5 h-3.5" />}
              action={<GoToGroupLink>Record on group</GoToGroupLink>}
            >
              <div className="text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>
                Read-only on the leg page. Verdicts are recorded against the group.
              </div>
              <div className="flex items-center gap-2 mb-2">
                <StatusPill tone="muted">No verdict yet</StatusPill>
                <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                  Awaiting submission
                </span>
              </div>
              <MutedNote>
                When the group is submitted to portal, the payor's per-leg verdict will surface here.
              </MutedNote>
            </Card>

            {/* MAS card (read-only) */}
            <Card
              title="MAS action"
              icon={<Stamp className="w-3.5 h-3.5" />}
              action={<GoToGroupLink>Complete on group</GoToGroupLink>}
            >
              <div className="flex items-center gap-2 mb-2">
                <StatusPill tone="amber">Reattest required</StatusPill>
                <span className="text-xs mono" style={{ color: "var(--cc-muted-fg)" }}>due Apr 30</span>
              </div>
              <div className="text-xs mb-2" style={{ color: "var(--cc-fg)" }}>
                Group needs reattestation before resubmission. Three legs (incl. this one) impacted.
              </div>
              <MutedNote>
                Mark MAS complete from the group's MAS card.
              </MutedNote>
            </Card>

            {/* Audit timeline */}
            <Card
              title="Audit timeline"
              icon={<Activity className="w-3.5 h-3.5" />}
              padded={false}
            >
              {[
                { icon: <Edit2 className="w-3 h-3" />, text: "Per-leg context updated", who: "Danny K.", when: "14m ago", tone: "var(--cc-blue-fg)" },
                { icon: <Send className="w-3 h-3" />, text: "SOP walk advanced (q3 → pending)", who: "Danny K.", when: "14m ago", tone: "var(--cc-blue-fg)" },
                { icon: <Mail className="w-3 h-3" />, text: "Portal email reply sent", who: "Danny K.", when: "Apr 28", tone: "var(--cc-purple-fg)" },
                { icon: <AlertTriangle className="w-3 h-3" />, text: "Reattest required (group)", who: "system", when: "Apr 27", tone: "var(--cc-warning)" },
                { icon: <Paperclip className="w-3 h-3" />, text: "Evidence attached: driver_note_reroute.png", who: "Mira S.", when: "Apr 26", tone: "var(--cc-muted-fg)" },
                { icon: <CheckCircle2 className="w-3 h-3" />, text: "Classified as PCS-not-on-file", who: "Danny K.", when: "Apr 25", tone: "var(--cc-success)" },
                { icon: <Clock className="w-3 h-3" />, text: "Leg created from import batch", who: "system", when: "Apr 25", tone: "var(--cc-muted-fg)" },
              ].map((e, i, arr) => (
                <div key={i} className="px-4 py-2 flex items-start gap-2 text-xs"
                     style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
                  <div className="mt-0.5 flex-shrink-0" style={{ color: e.tone }}>{e.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div style={{ color: "var(--cc-fg)" }}>{e.text}</div>
                    <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>
                      {e.who} · {e.when}
                    </div>
                  </div>
                </div>
              ))}
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}
