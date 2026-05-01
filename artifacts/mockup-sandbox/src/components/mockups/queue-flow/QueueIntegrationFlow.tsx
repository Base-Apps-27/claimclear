import {
  AlertTriangle,
  Inbox,
  ChevronRight,
  Sparkles,
  Send,
  CheckCircle2,
  FileText,
  Layers,
  ListChecks,
  Wand2,
  ArrowDown,
  ArrowLeft,
  MousePointer2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../ui/card";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Separator } from "../../ui/separator";

/**
 * QueueIntegrationFlow — single annotated artboard that shows the full
 * end-to-end Queue page exactly as it ships today (Classification Inbox,
 * urgency banner, three workflow tabs, group rows, split-view workspace,
 * submission gauntlet) AND calls out where the new "Preview & edit AI
 * write-up" step plugs in. The slot is rendered as a highlighted
 * placeholder pointing left to the existing E1 (inline) and E2
 * (slide-over) variants on the canvas.
 *
 * Three stacked stages:
 *   1. Queue page — no group selected (full-width list)
 *   2. Queue page — group selected (split view, gauntlet appears)
 *   3. Inside the gauntlet — current steps + the new preview/edit slot
 *
 * Each stage is a faithful, lower-fidelity restatement of what's in
 * artifacts/claimclear (queue.tsx + invoice-group-submission-gauntlet.tsx)
 * — same labels, same ordering, same status copy — so reviewers can map
 * mockup → real code without guessing.
 */
export default function QueueIntegrationFlow() {
  return (
    <div className="cc-scope min-h-screen bg-slate-100 font-sans text-slate-900 p-6 space-y-6">
      <FlowHeader />

      <Stage
        index={1}
        title="Queue page · no group selected"
        subtitle="Operator lands here. Triage in Classification Inbox, then pick a group from a workflow tab."
        sourceFile="artifacts/claimclear/src/pages/queue.tsx"
      >
        <QueuePageList />
      </Stage>

      <FlowArrow label="Operator clicks a row in any tab" />

      <Stage
        index={2}
        title="Queue page · group selected"
        subtitle="The right column appears (lg:col-span-2) with the InvoiceGroupSubmissionGauntlet rendered inline. List collapses to lg:col-span-1."
        sourceFile="queue.tsx → InlineGroupWorkspace → InvoiceGroupSubmissionGauntlet"
      >
        <QueuePageSplitView />
      </Stage>

      <FlowArrow label="Operator works the gauntlet steps top-down" />

      <Stage
        index={3}
        title="Inside the submission gauntlet · the missing step"
        subtitle="Today the gauntlet jumps from 'Generate preview' to 'Submit to portal' with no editable surface between them. That gap is what E1 and E2 fill."
        sourceFile="artifacts/claimclear/src/components/invoice-group-submission-gauntlet.tsx"
        highlight
      >
        <GauntletSlot />
      </Stage>

      <IntegrationLegend />
    </div>
  );
}

/* ===================================================================
   Header / chrome
   =================================================================== */
function FlowHeader() {
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "hsl(217 91% 95%)", color: "hsl(217 91% 35%)" }}
        >
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Integration map
          </div>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight">
            How the Preview &amp; Edit step lands inside today's Queue
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            The two variants you already have on the canvas (E1 inline,
            E2 slide-over) are <em>just</em> the new step in stage 3
            below. Every other element on these screens — Classification
            Inbox, urgency banner, three workflow tabs, split-view
            workspace, gauntlet readback / generate-preview / submit
            actions — is a <strong>representative restatement</strong>{" "}
            of what already exists in{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">
              artifacts/claimclear
            </code>{" "}
            today. Lower fidelity than the real app; same structure and
            ordering.
          </p>
        </div>
      </div>
    </div>
  );
}

interface StageProps {
  index: number;
  title: string;
  subtitle: string;
  sourceFile: string;
  highlight?: boolean;
  children: React.ReactNode;
}

function Stage({ index, title, subtitle, sourceFile, highlight, children }: StageProps) {
  return (
    <section
      className={`rounded-xl border bg-white p-5 shadow-sm ${
        highlight ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-300"
      }`}
    >
      <div className="mb-4 flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            highlight
              ? "bg-amber-500 text-white"
              : "bg-slate-900 text-white"
          }`}
        >
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-tight">{title}</h3>
          <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>
          <div className="mt-1.5 font-mono text-[11px] text-slate-500">{sourceFile}</div>
        </div>
        {highlight && (
          <Badge
            className="shrink-0"
            style={{
              background: "hsl(38 92% 50%)",
              color: "white",
            }}
          >
            <Wand2 className="mr-1 h-3 w-3" /> Where E1 / E2 plug in
          </Badge>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">{children}</div>
    </section>
  );
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <div className="h-px flex-1 bg-slate-300" />
      <div className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
        <MousePointer2 className="h-3.5 w-3.5 text-slate-500" />
        {label}
        <ArrowDown className="h-3.5 w-3.5 text-slate-500" />
      </div>
      <div className="h-px flex-1 bg-slate-300" />
    </div>
  );
}

/* ===================================================================
   Stage 1 — Queue page, no group selected
   =================================================================== */
function QueuePageList() {
  return (
    <div className="space-y-3">
      {/* Page header */}
      <div className="space-y-0.5">
        <div className="text-lg font-bold leading-tight">Invoice queue</div>
        <div className="text-[11px] text-slate-600">
          Operator workspace. Triage new imports in the Classification
          Inbox, then work the Action Required tab. Earliest service date
          first; red badges mark groups that must file today.
        </div>
      </div>

      {/* Urgent banner */}
      <div
        className="flex items-center gap-2 rounded border px-3 py-2 text-[11px]"
        style={{
          background: "hsl(0 80% 96%)",
          borderColor: "hsl(0 70% 80%)",
          color: "hsl(0 70% 30%)",
        }}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>
          <strong>3 groups must file today</strong>
          <span className="opacity-80"> · check Action Required, Portal Queued, and On Hold</span>
        </span>
      </div>

      {/* Classification Inbox (collapsed strip — common case) */}
      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2 text-[12px] font-semibold">
            <Inbox className="h-3.5 w-3.5 text-slate-500" />
            Classification Inbox
            <Badge variant="secondary" className="text-[10px]">2 awaiting triage</Badge>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 text-[11px]">
        <div className="rounded bg-slate-900 px-3 py-1.5 font-semibold text-white">
          Action Required <span className="ml-1 rounded bg-white/20 px-1">14</span>
        </div>
        <div className="px-3 py-1.5 text-slate-600">
          Portal Queued <span className="ml-1 rounded bg-slate-200 px-1">6</span>
        </div>
        <div className="px-3 py-1.5 text-slate-600">
          On Hold <span className="ml-1 rounded bg-slate-200 px-1">2</span>
        </div>
      </div>

      <p className="text-[10px] text-slate-500 leading-snug">
        <span className="font-medium text-slate-700">New + Needs Evidence.</span> Sorted earliest
        service date first; red Today = file before EOD, amber = within 2 days, neutral = within
        a week.
      </p>

      {/* List rows */}
      <div className="space-y-1.5">
        {[
          { inv: "INV-2026-04812", rides: 4, status: "New", err: "GPS Pickup Too Far from Residence", amt: "$184.50", urgent: true },
          { inv: "INV-2026-04790", rides: 2, status: "Needs Evidence", err: "Missing PCS form", amt: "$96.00", days: 2 },
          { inv: "INV-2026-04754", rides: 6, status: "New", err: "Distance variance", amt: "$312.40", days: 5 },
          { inv: "INV-2026-04701", rides: 1, status: "Needs Evidence", err: "Signature missing", amt: "$48.00", days: 7 },
          { inv: "INV-2026-04688", rides: 3, status: "New", err: "GPS dropoff variance", amt: "$144.00", days: 9 },
        ].map((r) => (
          <QueueRow key={r.inv} {...r} />
        ))}
      </div>

      {/* Empty workspace placeholder (mirrors real "select a group" empty state) */}
      <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-center">
        <FileText className="mx-auto mb-1 h-5 w-5 text-slate-400" />
        <div className="text-[11px] font-medium text-slate-700">Select an invoice group to process</div>
        <div className="text-[10px] text-slate-500">Click any row to start the dispute workflow inline.</div>
      </div>
    </div>
  );
}

function QueueRow({
  inv,
  rides,
  status,
  err,
  amt,
  urgent,
  days,
}: {
  inv: string;
  rides: number;
  status: string;
  err: string;
  amt: string;
  urgent?: boolean;
  days?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-[11px] hover:bg-slate-50">
      <div className="flex min-w-0 items-center gap-2">
        {urgent && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
            style={{ background: "hsl(0 84% 50%)" }}
          >
            Today
          </span>
        )}
        <span className="font-mono font-semibold">{inv}</span>
        <span className="text-slate-500">{rides} ride{rides === 1 ? "" : "s"}</span>
        <Badge variant="secondary" className="text-[10px]">{status}</Badge>
        {!urgent && days != null && (
          <span
            className="rounded border px-1.5 py-0.5 text-[9px] font-semibold"
            style={
              days <= 2
                ? { background: "hsl(38 92% 95%)", color: "hsl(28 90% 35%)", borderColor: "hsl(38 92% 75%)" }
                : { background: "hsl(0 0% 96%)", color: "hsl(0 0% 40%)", borderColor: "transparent" }
            }
          >
            {days}d left
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-slate-600">
        <span className="truncate max-w-[180px]">{err}</span>
        <span className="font-medium text-slate-900">{amt}</span>
        <ChevronRight className="h-3 w-3 text-slate-400" />
      </div>
    </div>
  );
}

/* ===================================================================
   Stage 2 — Queue page, group selected (split view)
   =================================================================== */
function QueuePageSplitView() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Left: collapsed list (lg:col-span-1) */}
      <div className="col-span-1 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Tabs collapse to col-span-1
        </div>
        <div className="space-y-1.5">
          <div
            className="flex items-center justify-between rounded border-2 border-blue-500 bg-blue-50 px-2 py-1.5 text-[10px] ring-2 ring-blue-200"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="rounded px-1 py-0.5 text-[8px] font-bold text-white"
                style={{ background: "hsl(0 84% 50%)" }}
              >
                Today
              </span>
              <span className="font-mono font-semibold">INV-2026-04812</span>
            </div>
            <span className="font-medium">$184.50</span>
          </div>
          {["INV-2026-04790", "INV-2026-04754", "INV-2026-04701"].map((inv) => (
            <div
              key={inv}
              className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-600"
            >
              <span className="font-mono">{inv}</span>
              <ChevronRight className="h-3 w-3 text-slate-400" />
            </div>
          ))}
        </div>
      </div>

      {/* Right: workspace (lg:col-span-2) */}
      <div className="col-span-2 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Inline workspace appears (col-span-2) — sticky at lg:top-4
        </div>

        {/* Workspace header */}
        <div className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2">
          <div className="text-[12px] font-semibold">
            Process Invoice Group
            <span className="ml-2 text-[10px] font-normal text-slate-500">
              INV-2026-04812 · New
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <span>Full Details</span>
            <span>Close</span>
          </div>
        </div>

        {/* PRIMARY: Rides & legs — each leg carries its content + the
            operator's per-leg context. There is no separate "aggregate
            context" surface above this anymore. */}
        <div className="rounded border-2 border-blue-400 bg-blue-50/60 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <ListChecks className="h-3 w-3" /> Rides &amp; legs
              <span className="ml-1 rounded bg-white px-1 py-0 text-[9px] font-normal text-slate-600 border border-slate-200">
                4 legs · 3 with context · 1 missing
              </span>
            </div>
            <Badge
              className="text-[9px]"
              style={{ background: "hsl(217 91% 50%)", color: "white" }}
            >
              Primary
            </Badge>
          </div>
          <div className="space-y-1">
            <LegContextRow id="#88412" hasContext />
            <LegContextRow id="#88413" hasContext />
            <LegContextRow id="#88414" hasContext={false} />
            <LegContextRow id="#88415" hasContext />
          </div>
          <div className="mt-1.5 text-[9.5px] italic text-slate-500">
            Per-leg content + per-leg operator context · feeds the AI write-up below
          </div>
        </div>

        {/* Submission gauntlet — the focus of stage 3 */}
        <div className="rounded border-2 border-dashed border-amber-400 bg-amber-50/40 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <Sparkles className="h-3 w-3" /> Submission preview (gauntlet)
            </div>
            <Badge
              className="text-[9px]"
              style={{ background: "hsl(38 92% 50%)", color: "white" }}
            >
              See stage 3 →
            </Badge>
          </div>
          <div className="space-y-1">
            <GauntletStepRow num={0} gate label="Gate · all legs resolved" done detail="4 / 4 ready" />
            <GauntletStepRow num={1} label="Understanding readback confirmed" done detail="Apr 28, 11:31 AM" />
            <GauntletStepRow num={2} label="Generate preview" done detail="Apr 28, 11:34 AM" />
            <GauntletStepRow num={3} label="Submit to portal" pending />
          </div>
        </div>
      </div>
    </div>
  );
}

function LegContextRow({ id, hasContext }: { id: string; hasContext: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-[10px] ${
        hasContext
          ? "border-slate-200 bg-white"
          : "border-amber-300 bg-amber-50"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono font-semibold">{id}</span>
        <span className="text-slate-500">leg content (data)</span>
      </div>
      <div className="flex items-center gap-1">
        {hasContext ? (
          <Badge className="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100">
            ✓ context saved
          </Badge>
        ) : (
          <Badge className="text-[9px] bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100">
            + add context
          </Badge>
        )}
      </div>
    </div>
  );
}

function GauntletStepRow({
  num,
  label,
  done,
  pending,
  detail,
  gate,
}: {
  num: number;
  label: string;
  done?: boolean;
  pending?: boolean;
  detail?: string;
  gate?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded bg-white px-2 py-1 text-[10px]">
      <div
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${
          gate
            ? "bg-slate-200 text-slate-700 ring-1 ring-slate-300"
            : done
              ? "bg-emerald-600 text-white"
              : pending
                ? "bg-slate-300 text-slate-700"
                : "bg-slate-100 text-slate-500"
        }`}
      >
        {gate ? "✓" : done ? <CheckCircle2 className="h-2.5 w-2.5" /> : num}
      </div>
      <span className={`font-medium ${done ? "text-slate-900" : "text-slate-700"}`}>{label}</span>
      {detail && <span className="ml-auto text-slate-500">{detail}</span>}
    </div>
  );
}

/* ===================================================================
   Stage 3 — Inside the gauntlet, the new slot
   =================================================================== */
function GauntletSlot() {
  return (
    <Card className="border-slate-300">
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4" /> Submission preview
        </CardTitle>
        <CardDescription className="text-xs">
          Confirm the AI's read of the case, then generate the dispute submission preview.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {/* Pre-condition gate — already enforced by the real gauntlet
            via `allResolved` / RESOLVED_SUB_STATUSES. Not a step the
            user clicks; a gate the gauntlet checks before enabling
            readback + submit. Shown here as context. */}
        <ExistingStep
          icon={<ListChecks className="h-3.5 w-3.5" />}
          label="Gate · all legs resolved"
          status="Enforced today by the gauntlet (allResolved). 4 / 4 ready · 0 dropped · 0 excluded."
          gate
        />
        <Separator />

        {/* Step A — already ships */}
        <ExistingStep
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Understanding readback"
          status="Confirmed Apr 28, 11:31 AM"
          done
        />
        <Separator />

        {/* Step B — already ships */}
        <ExistingStep
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Generate preview"
          status="Stamped Apr 28, 11:34 AM (group.previewGeneratedAt)"
          done
        />

        {/* === The slot === */}
        <div className="relative rounded-lg border-2 border-amber-400 bg-amber-50 p-4 shadow-sm">
          <div className="absolute -left-3 -top-3">
            <Badge
              className="shadow"
              style={{ background: "hsl(38 92% 50%)", color: "white" }}
            >
              <Wand2 className="mr-1 h-3 w-3" /> NEW STEP — Preview &amp; edit AI write-up
            </Badge>
          </div>
          <div className="mt-2 flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
              D
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-amber-900">
                AI weaves each leg's content + each leg's operator context
                (from Rides &amp; legs above) into a draft write-up.
                Operator reviews subject + body, edits inline, checks the
                per-leg sources panel, then approves.
              </div>
              <div className="mt-1 text-xs text-amber-800/90">
                Today this step doesn't exist. The operator clicks "Generate
                preview" and the very next visible action is "Submit to
                portal" — there's no editable surface in between, and there's
                no per-leg context input feeding the AI. Both variants on
                the canvas insert exactly here:
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <VariantPointer
                  letter="E1"
                  title="Inline in the gauntlet"
                  body="Expands the gauntlet card with subject + body editor, sources panel, regenerate, save."
                />
                <VariantPointer
                  letter="E2"
                  title="Slide-over over the queue"
                  body="Compact 'Preview generated · Review draft →' row; click opens a takeover sheet with the same editor."
                />
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-[11px] text-amber-900">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>
                  <strong>Both live frames are immediately to the left of this panel on the canvas.</strong>
                  {" "}E1 at x≈-960, E2 at x≈20, both at y=18100.
                </span>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Step E — already ships (the destination) */}
        <ExistingStep
          icon={<Send className="h-3.5 w-3.5" />}
          label="Submit to portal"
          status="Disabled until the steps above are complete"
          pending
        />

        <div className="flex justify-end pt-1">
          <Button size="sm" disabled className="text-xs">
            <Send className="mr-1.5 h-3.5 w-3.5" /> Submit to portal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ExistingStep({
  icon,
  label,
  status,
  done,
  pending,
  gate,
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
  done?: boolean;
  pending?: boolean;
  gate?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          gate
            ? "bg-slate-200 text-slate-700"
            : done
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-500"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">{label}</div>
          {gate && (
            <Badge variant="outline" className="text-[10px] text-slate-600">
              Gate (not a step)
            </Badge>
          )}
          {done && (
            <Badge variant="secondary" className="text-[10px]">
              <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-600" /> Done
            </Badge>
          )}
          {pending && (
            <Badge variant="outline" className="text-[10px] text-slate-500">
              Pending
            </Badge>
          )}
        </div>
        <div className="text-xs text-slate-600">{status}</div>
      </div>
    </div>
  );
}

function VariantPointer({
  letter,
  title,
  body,
}: {
  letter: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-md border border-amber-300 bg-white p-2">
      <div className="flex items-center gap-1.5">
        <Badge
          className="text-[10px]"
          style={{ background: "hsl(217 91% 50%)", color: "white" }}
        >
          {letter}
        </Badge>
        <div className="text-xs font-semibold">{title}</div>
      </div>
      <div className="mt-1 text-[11px] leading-snug text-slate-600">{body}</div>
    </div>
  );
}

/* ===================================================================
   Legend
   =================================================================== */
function IntegrationLegend() {
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4 text-xs text-slate-700">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        What's already built · what's new
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" /> Already in artifacts/claimclear
          </div>
          <ul className="ml-4 list-disc space-y-0.5 text-[11px] text-emerald-900/90">
            <li>Classification Inbox + 3 workflow tabs (queue.tsx)</li>
            <li>Urgent Today banner + per-row deadline pills</li>
            <li>Split-view inline workspace + presence locks</li>
            <li>Gauntlet: all-legs-resolved gate, readback, generate-preview, submit-to-portal (gauntlet component)</li>
            <li>Generate-preview mutation + portal-submit mutation</li>
          </ul>
        </div>
        <div className="rounded border border-amber-300 bg-amber-50 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-amber-900">
            <Wand2 className="h-3.5 w-3.5" /> NEW — Preview &amp; edit step (D)
          </div>
          <ul className="ml-4 list-disc space-y-0.5 text-[11px] text-amber-900/90">
            <li>Per-leg context input on every leg in <strong>Rides &amp; legs</strong> (operator's note for THAT leg — no separate "aggregate context" surface)</li>
            <li>Editable subject + rich-text body draft surface</li>
            <li>AI weaves per-leg content + per-leg context into the write-up; sources panel shows what fed each line</li>
            <li>Two delivery shapes: <strong>E1 inline</strong> (expands the gauntlet card) or <strong>E2 slide-over</strong> (takeover sheet over the workspace)</li>
            <li>Lands between "Generate preview" and "Submit to portal"; new "draft reviewed" gate added to Submit</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
