import { ReactNode } from "react";
import {
  ChevronLeft, UserPlus, Edit2, Save, Plus, Paperclip, Send,
  Mail, Gavel, Stamp, FileText, Activity, Pin, Eye, ChevronRight,
  AlertTriangle, CheckCircle2, XCircle, PauseCircle, Lock, ArrowUpRight,
  ListChecks, RefreshCw, Sparkles, Layers,
} from "lucide-react";
import { StatusPill } from "./_shared";

/* ------------------------------------------------------------------ */
/* Card helper                                                         */
/* ------------------------------------------------------------------ */

function Card({ title, action, icon, children, padded = true }: {
  title: ReactNode; action?: ReactNode; icon?: ReactNode;
  children: ReactNode; padded?: boolean;
}) {
  return (
    <div className="cc-card">
      <div className="px-4 py-3 flex items-center justify-between"
           style={{ borderBottom: "1px solid var(--cc-border)" }}>
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {action}
      </div>
      <div className={padded ? "p-4" : ""}>{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm"
         style={{ borderBottom: "1px dashed var(--cc-border)" }}>
      <span className="text-xs uppercase tracking-wide font-medium"
            style={{ color: "var(--cc-muted-fg)" }}>{label}</span>
      <span className="font-medium" style={{ color: "var(--cc-fg)" }}>{value}</span>
    </div>
  );
}

function Kpi({ label, value, sub, tone = "neutral" }: {
  label: string; value: ReactNode; sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const c =
    tone === "good" ? "var(--cc-success)" :
    tone === "warn" ? "var(--cc-warning)" :
    tone === "bad"  ? "var(--cc-destructive)" : "var(--cc-fg)";
  return (
    <div className="cc-card p-3">
      <div className="text-[10px] uppercase tracking-wide font-semibold mb-1"
           style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className="text-xl font-bold mono" style={{ color: c }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mock data                                                           */
/* ------------------------------------------------------------------ */

const legs = [
  { id: "CLM-7184-1", member: "Robinson, T.", pickup: "03/30 08:55", drop: "03/30 09:30", amount: "$71.50", subStatus: "Ready",          tone: "green"  as const, included: true },
  { id: "CLM-7184-2", member: "Robinson, T.", pickup: "03/30 09:42", drop: "03/30 10:18", amount: "$82.68", subStatus: "Investigating", tone: "amber"  as const, included: true },
  { id: "CLM-7184-3", member: "Robinson, T.", pickup: "03/30 14:10", drop: "03/30 14:46", amount: "$74.20", subStatus: "Blocked",       tone: "red"    as const, included: true },
  { id: "CLM-7184-4", member: "Robinson, T.", pickup: "03/30 15:55", drop: "03/30 16:34", amount: "$55.82", subStatus: "Excluded",      tone: "muted"  as const, included: false },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function GroupDetailRedensified() {
  return (
    <div className="cc-scope min-h-screen p-6" style={{ background: "var(--cc-bg)", color: "var(--cc-fg)" }}>
      <div className="max-w-[1180px] mx-auto space-y-4">

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
          <a className="hover:underline inline-flex items-center gap-1" href="#">
            <ChevronLeft className="w-3 h-3" /> Invoice groups
          </a>
          <span>/</span>
          <span style={{ color: "var(--cc-fg)" }} className="mono">INV-1855844580</span>
        </div>

        {/* Header */}
        <div className="cc-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-1 h-12 rounded" style={{ background: "var(--cc-purple-fg)" }} />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide font-semibold mb-0.5"
                     style={{ color: "var(--cc-muted-fg)" }}>
                  Invoice group
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold mono">INV-1855844580</h1>
                  <StatusPill tone="amber">Needs Evidence</StatusPill>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>·</span>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                    Modivcare · DOS <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}>03/30/26</span> ·
                    <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}> 4 legs</span> ·
                    <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}> $284.20</span>
                  </span>
                </div>
                <div className="text-xs mt-1.5" style={{ color: "var(--cc-muted-fg)" }}>
                  Owned by <span className="font-medium" style={{ color: "var(--cc-fg)" }}>Danny K.</span> ·
                  Updated <span className="font-medium" style={{ color: "var(--cc-fg)" }}>14 min ago</span> ·
                  6d in queue · 3 of 4 legs in dispute
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
                <PauseCircle className="w-3.5 h-3.5" /> Place group on hold
              </button>
              <button className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                      style={{ background: "var(--cc-purple-fg)", color: "white" }}>
                <Send className="w-3.5 h-3.5" /> Submit to portal
              </button>
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-5 gap-3">
          <Kpi label="Total exposure"  value="$284.20" sub="all legs" />
          <Kpi label="In dispute"      value="$228.38" sub="3 legs"  tone="warn" />
          <Kpi label="Excluded"        value="$55.82"  sub="1 leg"   tone="neutral" />
          <Kpi label="Recovered"       value="$0.00"   sub="—"       tone="good" />
          <Kpi label="Days in queue"   value="6"       sub="vs 12d avg" tone="warn" />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-12 gap-4">

          {/* LEFT — orchestration body (8 cols) */}
          <div className="col-span-8 space-y-4">

            {/* Aggregate context */}
            <Card
              title="Aggregate context"
              icon={<Layers className="w-3.5 h-3.5" />}
              action={
                <button className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                        style={{ background: "var(--cc-purple-fg)", color: "white" }}>
                  <Save className="w-3 h-3" /> Save
                </button>
              }
            >
              <div className="text-xs mb-2 font-medium" style={{ color: "var(--cc-muted-fg)" }}>
                Group context — shared across all legs in this invoice
              </div>
              <textarea
                rows={2}
                defaultValue="Modivcare denied entire invoice citing PCS not on file. Driver had documented reroute on Maple Ave for legs 2 and 3."
                className="w-full text-sm rounded p-2 mb-3"
                style={{
                  border: "1px solid var(--cc-border)",
                  background: "var(--cc-card)",
                  color: "var(--cc-fg)",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
              <div className="text-xs mb-2 font-medium" style={{ color: "var(--cc-muted-fg)" }}>
                Per-leg context roll-up
              </div>
              <div className="space-y-1.5 text-xs">
                {legs.filter(l => l.included).map(l => (
                  <div key={l.id} className="flex items-start gap-2 px-2 py-1.5 rounded"
                       style={{ background: "var(--cc-muted)" }}>
                    <span className="font-mono font-semibold flex-shrink-0"
                          style={{ color: "var(--cc-purple-fg)" }}>{l.id}</span>
                    <span style={{ color: "var(--cc-fg)" }}>
                      {l.id === "CLM-7184-1" && "On-time, no exceptions."}
                      {l.id === "CLM-7184-2" && "Driver reroute — 14 min over quoted time. PCS attached separately."}
                      {l.id === "CLM-7184-3" && "PCS expired prior to DOS — pending payor clarification."}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Group details + Evidence (two-up) */}
            <div className="grid grid-cols-2 gap-4">
              <Card
                title="Group details"
                icon={<FileText className="w-3.5 h-3.5" />}
                action={
                  <button className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                          style={{ border: "1px solid var(--cc-border)" }}>
                    <Edit2 className="w-3 h-3" /> Edit
                  </button>
                }
              >
                <div className="space-y-0">
                  <Field label="Invoice #"      value={<span className="mono">INV-1855844580</span>} />
                  <Field label="Payor"          value="Modivcare" />
                  <Field label="Plan"           value="MCA-NY-2026" />
                  <Field label="DOS"            value={<span className="mono">03/30/2026</span>} />
                  <Field label="Submitted"      value={<span style={{ color: "var(--cc-muted-fg)" }}>—</span>} />
                  <Field label="Error type"     value="PCS not on file" />
                  <Field label="Closure reason" value={<span style={{ color: "var(--cc-muted-fg)" }}>n/a</span>} />
                </div>
              </Card>

              <Card
                title={<>Group evidence <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>· 5 files</span></>}
                icon={<Paperclip className="w-3.5 h-3.5" />}
                action={
                  <button className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                          style={{ border: "1px solid var(--cc-border)" }}>
                    <Plus className="w-3 h-3" /> Attach
                  </button>
                }
                padded={false}
              >
                {[
                  { name: "modivcare_denial_1855844580.pdf", who: "Importer" },
                  { name: "PCS_Robinson_2026.pdf",            who: "Danny K." },
                  { name: "trip_log_03-30.csv",               who: "Importer" },
                  { name: "driver_note_reroute.png",          who: "Mira S."  },
                  { name: "phone_log_billing_call.txt",       who: "Danny K." },
                ].map((f, i, arr) => (
                  <div key={f.name} className="px-3 py-1.5 text-xs flex items-center gap-2"
                       style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
                    <Paperclip className="w-3 h-3 flex-shrink-0" style={{ color: "var(--cc-muted-fg)" }} />
                    <span className="font-medium flex-1 truncate">{f.name}</span>
                    <span className="text-[10px]" style={{ color: "var(--cc-muted-fg)" }}>{f.who}</span>
                  </div>
                ))}
              </Card>
            </div>

            {/* Rides / legs table */}
            <Card
              title={<>Rides & legs <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>· 4 rides · 3 disputed</span></>}
              icon={<ListChecks className="w-3.5 h-3.5" />}
              action={
                <div className="flex items-center gap-1.5">
                  <button className="cc-btn text-xs px-2 py-1"
                          style={{ border: "1px solid var(--cc-border)" }}>All</button>
                  <button className="cc-btn text-xs px-2 py-1"
                          style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
                    Disputed only
                  </button>
                </div>
              }
              padded={false}
            >
              <div className="text-[11px] uppercase tracking-wide font-semibold grid grid-cols-12 px-4 py-2"
                   style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}>
                <div className="col-span-3">Leg / member</div>
                <div className="col-span-3">Pickup → Dropoff</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-2">Sub-status</div>
                <div className="col-span-2 text-right">Action</div>
              </div>
              {legs.map((l, i) => (
                <div key={l.id}
                     className={`grid grid-cols-12 px-4 py-2.5 text-sm items-center hover:bg-[var(--cc-muted)]
                                 ${!l.included ? "opacity-60" : ""}`}
                     style={{ borderBottom: i < legs.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
                  <div className="col-span-3">
                    <div className="font-mono font-semibold text-xs" style={{ color: "var(--cc-purple-fg)" }}>
                      {l.id}
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>
                      {l.member}
                    </div>
                  </div>
                  <div className="col-span-3 text-xs mono" style={{ color: "var(--cc-fg)" }}>
                    {l.pickup} → {l.drop}
                  </div>
                  <div className="col-span-2 text-right mono font-semibold">{l.amount}</div>
                  <div className="col-span-2">
                    <StatusPill tone={l.tone}>{l.subStatus}</StatusPill>
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1.5">
                    <button className="cc-btn text-[11px] inline-flex items-center gap-0.5 px-1.5 py-1"
                            style={{ color: "var(--cc-purple-fg)" }}>
                      Open <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </Card>

            {/* Submission preview */}
            <Card
              title="Submission preview"
              icon={<Sparkles className="w-3.5 h-3.5" />}
              action={
                <button className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                        style={{ border: "1px solid var(--cc-border)" }}>
                  <RefreshCw className="w-3 h-3" /> Generate preview
                </button>
              }
            >
              <div className="mb-3">
                <div className="text-xs font-medium mb-1.5" style={{ color: "var(--cc-fg)" }}>
                  Understanding readback
                </div>
                <div className="text-xs p-2.5 rounded space-y-1"
                     style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}>
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>1 leg still investigating</strong> (CLM-7184-2).
                      Submission unlocks once every disputed leg is Ready or Dropped.
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-xs p-2.5 rounded font-mono leading-relaxed"
                   style={{
                     background: "var(--cc-muted)",
                     color: "var(--cc-muted-fg)",
                     border: "1px dashed var(--cc-border)",
                   }}>
                <div style={{ color: "var(--cc-fg)" }}>Re: Invoice INV-1855844580 · Member Robinson, T. · DOS 03/30/26</div>
                <div className="mt-1.5">Disputing 3 of 4 legs against initial denial. PCS on file as of 04/30/26 (attached). Reroute documentation included for legs 2 and 3…</div>
                <div className="mt-1.5 italic">[preview generates here once readback gates pass]</div>
              </div>
            </Card>

            {/* Post-submit verdict + responses (placeholder, dim because not yet submitted) */}
            <Card
              title="Payor responses & per-leg verdict"
              icon={<Gavel className="w-3.5 h-3.5" />}
              action={
                <button disabled className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                        style={{ border: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }}>
                  Record verdict…
                </button>
              }
            >
              <div className="flex items-center gap-2 text-xs p-2.5 rounded"
                   style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}>
                <Lock className="w-3.5 h-3.5" />
                <span>
                  Activates after this group is submitted to portal.
                  Per-leg verdicts are recorded here and surface read-only on each leg page.
                </span>
              </div>
            </Card>
          </div>

          {/* RIGHT — rail (4 cols) */}
          <div className="col-span-4 space-y-4">

            {/* MAS card with action */}
            <Card
              title="MAS action"
              icon={<Stamp className="w-3.5 h-3.5" />}
              action={
                <span className="text-xs px-2 py-0.5 rounded font-semibold"
                      style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}>
                  Reattest required
                </span>
              }
            >
              <div className="text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>
                Re-attestation required before resubmission. Affects 3 legs.
              </div>
              <div className="space-y-1 mb-3">
                <Field label="Originally attested" value={<span className="mono">Apr 22, 11:14</span>} />
                <Field label="Cancel reason"       value="Driver substitution" />
                <Field label="Reattest by"         value={<span className="mono" style={{ color: "var(--cc-warning)" }}>Apr 30</span>} />
              </div>
              <button className="cc-btn w-full justify-center text-xs gap-1 inline-flex items-center py-2"
                      style={{ background: "var(--cc-amber-fg)", color: "white" }}>
                <CheckCircle2 className="w-3.5 h-3.5" /> Mark MAS reattest complete
              </button>
              <div className="text-[11px] mt-1.5 text-center" style={{ color: "var(--cc-muted-fg)" }}>
                Closes follow-up #207
              </div>
            </Card>

            {/* Notes */}
            <Card
              title={<>Notes <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>· 2</span></>}
              icon={<Pin className="w-3.5 h-3.5" />}
            >
              <div className="space-y-3">
                {[
                  { who: "Danny K.", when: "1h ago", text: "Group split between PCS and MAS issues — reattest first, then resubmit all 3 disputed legs together." },
                  { who: "Mira S.",  when: "Yesterday", text: "Modivcare confirmed the reattest dispute window is 7 days." },
                ].map(n => (
                  <div key={n.text} className="text-sm flex gap-2 items-start">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
                         style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
                      {n.who.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0 text-xs">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-semibold">{n.who}</span>
                        <span style={{ color: "var(--cc-muted-fg)" }}>{n.when}</span>
                      </div>
                      <div style={{ color: "var(--cc-fg)" }}>{n.text}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--cc-border)" }}>
                <textarea
                  rows={2}
                  placeholder="Add a group note…"
                  className="w-full text-xs rounded p-2"
                  style={{
                    border: "1px solid var(--cc-border)",
                    background: "var(--cc-card)",
                    color: "var(--cc-fg)",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>
            </Card>

            {/* Audit timeline */}
            <Card
              title="Audit timeline"
              icon={<Activity className="w-3.5 h-3.5" />}
              padded={false}
            >
              {[
                { icon: <Edit2 className="w-3 h-3" />, text: "Aggregate context updated", who: "Danny K.", when: "14m ago", tone: "var(--cc-blue-fg)" },
                { icon: <Send className="w-3 h-3" />, text: "Leg CLM-7184-2 walk advanced", who: "Danny K.", when: "14m ago", tone: "var(--cc-blue-fg)" },
                { icon: <XCircle className="w-3 h-3" />, text: "Leg CLM-7184-4 excluded (member outside coverage)", who: "Danny K.", when: "Apr 28", tone: "var(--cc-muted-fg)" },
                { icon: <AlertTriangle className="w-3 h-3" />, text: "Reattest required by payor", who: "system", when: "Apr 27", tone: "var(--cc-warning)" },
                { icon: <Paperclip className="w-3 h-3" />, text: "5 files attached at intake", who: "Importer", when: "Apr 25", tone: "var(--cc-muted-fg)" },
                { icon: <CheckCircle2 className="w-3 h-3" />, text: "Group classified as PCS-not-on-file", who: "Danny K.", when: "Apr 25", tone: "var(--cc-success)" },
                { icon: <FileText className="w-3 h-3" />, text: "Group created from import batch #4488", who: "system", when: "Apr 25", tone: "var(--cc-muted-fg)" },
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

            {/* Close this group */}
            <Card
              title="Close this group"
              icon={<XCircle className="w-3.5 h-3.5" />}
            >
              <div className="text-xs mb-3" style={{ color: "var(--cc-muted-fg)" }}>
                Close after the payor has issued a final decision on every disputed leg.
              </div>
              <div className="space-y-2">
                <button className="cc-btn w-full justify-start text-xs gap-2 inline-flex items-center px-2.5 py-2"
                        style={{ border: "1px solid var(--cc-border)" }}>
                  <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--cc-success)" }} />
                  <div className="text-left flex-1">
                    <div>Approved (full / partial)</div>
                    <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>Records recovered amount per leg</div>
                  </div>
                </button>
                <button className="cc-btn w-full justify-start text-xs gap-2 inline-flex items-center px-2.5 py-2"
                        style={{ border: "1px solid var(--cc-border)" }}>
                  <XCircle className="w-3.5 h-3.5" style={{ color: "var(--cc-destructive)" }} />
                  <div className="text-left flex-1">
                    <div>Denied by payor</div>
                    <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>Records loss across remaining disputed legs</div>
                  </div>
                </button>
                <button className="cc-btn w-full justify-start text-xs gap-2 inline-flex items-center px-2.5 py-2"
                        style={{ border: "1px solid var(--cc-border)" }}>
                  <ChevronLeft className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
                  <div className="text-left flex-1">
                    <div>Withdrawn / cannot dispute</div>
                    <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>Closes without filing</div>
                  </div>
                </button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
