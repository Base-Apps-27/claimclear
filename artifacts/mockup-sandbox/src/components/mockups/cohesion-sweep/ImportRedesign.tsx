import { Upload, FileSpreadsheet, Tag, CheckCircle2, ArrowRight, AlertCircle, Sparkles, X, Eye } from "lucide-react";
import { ReactNode } from "react";
import {
  PageHeader, Section, ActionGroup, RowAction, StatusPill, Recommended, PrimaryButton,
} from "./_shared";

function StageStepper({ stage }: { stage: 1 | 2 | 3 | 4 }) {
  const steps = [
    { n: 1, label: "Upload" },
    { n: 2, label: "Map columns" },
    { n: 3, label: "Classify errors" },
    { n: 4, label: "Confirm import" },
  ];
  return (
    <div className="cc-card flex items-center px-4 py-3 gap-2 text-sm">
      {steps.map((s, i) => {
        const done = s.n < stage;
        const cur = s.n === stage;
        return (
          <div key={s.n} className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style={{
              background: done ? "var(--cc-success)" : cur ? "var(--cc-blue-fg)" : "var(--cc-muted)",
              color: done || cur ? "white" : "var(--cc-muted-fg)",
            }}>
              {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.n}
            </div>
            <span className="font-medium" style={{ color: cur ? "var(--cc-fg)" : done ? "var(--cc-fg)" : "var(--cc-muted-fg)" }}>{s.label}</span>
            {i < steps.length - 1 && <ArrowRight className="w-3.5 h-3.5 mx-1" style={{ color: "var(--cc-muted-fg)" }} />}
          </div>
        );
      })}
    </div>
  );
}

const classifyRows: { code: string; count: number; desc: string; suggested: string; conf: "high" | "med" | "low" }[] = [
  { code: "R-12 mileage",      count: 8, desc: "Trip exceeded authorized mileage", suggested: "Mileage Mismatch",     conf: "high" },
  { code: "Outside auth window", count: 5, desc: "Pickup outside 09:00–17:00",       suggested: "Outside Auth Window",  conf: "high" },
  { code: "GPS deviation",     count: 4, desc: "Route differs from manifest",       suggested: "GPS Deviation",        conf: "med" },
  { code: "Duplicate charge",  count: 2, desc: "Claim already on file",             suggested: "Duplicate Charge",     conf: "high" },
  { code: "Unknown error",     count: 4, desc: "Reason text didn't match a rule",   suggested: "(needs your decision)", conf: "low" },
];

const confTone = (c: "high" | "med" | "low") => c === "high" ? "green" : c === "med" ? "amber" : "red";

export function ImportRedesign() {
  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <PageHeader title="Import job-status report" sub="Step 3 of 4 · Classify errors" search={false} accent="blue" />

      <StageStepper stage={3} />

      <div className="cc-card flex items-center gap-3 px-4 py-3" style={{ background: "var(--cc-blue-bg)" }}>
        <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cc-blue-fg)" }} />
        <div className="flex-1 text-sm" style={{ color: "var(--cc-blue-fg)" }}>
          <strong>23 claims found</strong> in <span className="mono">job-status-2026-04-28.csv</span>. Coding rules matched 19 automatically. 4 need your decision.
        </div>
        <span className="text-xs" style={{ color: "var(--cc-blue-fg)" }}>$4,210.80 total</span>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-8 space-y-3">
          <Section
            title={<><Tag className="w-4 h-4" />Error groups detected</>}
            action={<a href="#" className="text-xs" style={{ color: "var(--cc-primary)" }}>Edit coding rules</a>}
            padded={false}
          >
            <div className="text-xs px-3 py-2 flex items-center gap-3" style={{ background: "var(--cc-muted)", borderBottom: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }}>
              <span style={{ minWidth: 200 }}>Source code</span>
              <span style={{ minWidth: 80, textAlign: "right" }}>Claims</span>
              <span className="flex-1">Suggested error type</span>
              <span style={{ minWidth: 80 }}>Confidence</span>
              <span style={{ width: 80 }} />
            </div>
            {classifyRows.map(r => (
              <div key={r.code} className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: "1px solid var(--cc-border)" }}>
                <div style={{ minWidth: 200 }}>
                  <div className="text-sm font-medium">{r.code}</div>
                  <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>{r.desc}</div>
                </div>
                <span className="text-sm font-medium mono" style={{ minWidth: 80, textAlign: "right" }}>{r.count}</span>
                <span className="text-sm flex-1" style={{ color: r.conf === "low" ? "var(--cc-muted-fg)" : "var(--cc-fg)" }}>{r.suggested}</span>
                <div style={{ minWidth: 80 }}><StatusPill tone={confTone(r.conf)}>{r.conf}</StatusPill></div>
                <button className="cc-btn cc-btn-sm cc-btn-ghost"><Eye className="w-3 h-3" />Review</button>
              </div>
            ))}
          </Section>

          <Section title={<><FileSpreadsheet className="w-4 h-4" />Source file</>}>
            <div className="flex items-center gap-3 text-sm">
              <FileSpreadsheet className="w-4 h-4" style={{ color: "var(--cc-success)" }} />
              <span className="mono">job-status-2026-04-28.csv</span>
              <span style={{ color: "var(--cc-muted-fg)" }}>· 23 rows · 184 KB · uploaded 2m ago by M. Rivera</span>
              <button className="ml-auto cc-btn cc-btn-sm cc-btn-ghost">Replace</button>
            </div>
          </Section>
        </div>

        <aside className="col-span-4 space-y-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)", background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}>
              <span className="flex items-center gap-2"><Upload className="w-4 h-4" />Import progress</span>
              <span className="text-xs font-normal" style={{ opacity: 0.75 }}>step 3 / 4</span>
            </div>

            <Recommended
              tone="blue"
              title="4 unknown errors need your decision"
              body="Pick the right type and we'll save it as a new coding rule for next time."
              cta={<PrimaryButton tone="blue"><Tag className="w-4 h-4" />Resolve 4 unknowns</PrimaryButton>}
              sub="Then continue to Confirm."
            />

            <ActionGroup label="When done">
              <RowAction icon={<ArrowRight className="w-3.5 h-3.5" />} label="Continue to Confirm"      sub="19 of 23 ready" />
              <RowAction icon={<Upload className="w-3.5 h-3.5" />}     label="Save and finish later"   sub="Picks up where you left off" />
            </ActionGroup>

            <ActionGroup label="Selection">
              <RowAction icon={<X className="w-3.5 h-3.5" />} label="Discard import" muted />
            </ActionGroup>
          </div>

          <div className="cc-card p-3 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
            <div className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" />
              <span>If a code keeps showing up as Unknown, edit your <strong>coding rules</strong> to map it permanently.</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
