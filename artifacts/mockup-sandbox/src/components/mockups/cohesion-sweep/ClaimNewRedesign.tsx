import { Save, X, FileText, User, Truck, DollarSign, Sparkles, Layers, AlertCircle } from "lucide-react";
import {
  PageHeader, Section, ActionGroup, RowAction, Recommended, PrimaryButton,
} from "./_shared";

function Field({ label, value, hint, mono }: { label: string; value: string; hint?: string; mono?: boolean }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold mb-1" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <input defaultValue={value} className={`cc-input text-sm ${mono ? "mono" : ""}`} style={{
        background: "var(--cc-card)", border: "1px solid var(--cc-border)",
        borderRadius: 6, padding: "0.45rem 0.65rem", fontSize: 13, width: "100%",
      }} />
      {hint && <div className="text-[11px] mt-1" style={{ color: "var(--cc-muted-fg)" }}>{hint}</div>}
    </label>
  );
}

export function ClaimNewRedesign() {
  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <PageHeader title="New claim" sub="Manual entry · use when an import missed something" search={false} accent="blue" />

      <div className="cc-card flex items-center gap-3 px-4 py-3" style={{ background: "var(--cc-blue-bg)" }}>
        <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cc-blue-fg)" }} />
        <div className="flex-1 text-sm" style={{ color: "var(--cc-blue-fg)" }}>
          Most claims should come from the <strong>job-status report import</strong>. Use this form only for one-offs the import missed.
        </div>
        <a href="#" className="cc-btn cc-btn-sm" style={{ background: "var(--cc-blue-fg)", color: "white", border: "none" }}>
          Open Import →
        </a>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-8 space-y-4">
          <Section title={<><FileText className="w-4 h-4" />Claim identifiers</>}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Confirmation #" value="C-2026-04820" mono hint="MAS confirmation number from the original claim" />
              <Field label="Reference #"     value="REF-887194-A" mono />
              <Field label="Service date"    value="Apr 24, 2026" />
              <Field label="Invoice group"   value="INV-2026-0419" mono hint="Group this claim into an existing invoice for filing together" />
            </div>
          </Section>

          <Section title={<><User className="w-4 h-4" />Member & vehicle</>}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Member ID"   value="CLT-44210" mono />
              <Field label="Vehicle / Driver" value="VAN-118 / D. Ortiz" />
              <Field label="Pickup"      value="410 Union St, Albany NY" />
              <Field label="Dropoff"     value="Albany Medical Center" />
            </div>
          </Section>

          <Section title={<><DollarSign className="w-4 h-4" />Amount & error</>}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Claim amount" value="$184.50" mono />
              <Field label="Rate code"    value="R-12" mono />
            </div>
            <div className="mt-3">
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--cc-muted-fg)" }}>Error description</div>
              <textarea className="cc-input text-sm w-full" rows={3} style={{
                background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 6, padding: "0.45rem 0.65rem", fontSize: 13,
              }} defaultValue="Trip mileage mismatch (rate code R-12 expected 14.2 mi, billed 9.8 mi). Pickup time falls within authorized window 09:00-17:00." />
            </div>
          </Section>
        </div>

        <aside className="col-span-4 space-y-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)", background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}>
              <span className="flex items-center gap-2"><Save className="w-4 h-4" />Save claim</span>
            </div>

            <Recommended
              tone="blue"
              title="Save and route to triage"
              body="The claim will land on Claims · Needs Review with the suggested error type pre-applied."
              cta={<PrimaryButton tone="blue"><Save className="w-4 h-4" />Save and triage</PrimaryButton>}
            />

            <ActionGroup label="Other ways to save">
              <RowAction icon={<Save className="w-3.5 h-3.5" />}    label="Save as draft"             sub="Stays out of the queue" />
              <RowAction icon={<Layers className="w-3.5 h-3.5" />}  label="Save and add another"      sub="Same invoice group" />
              <RowAction icon={<X className="w-3.5 h-3.5" />}       label="Cancel"                    muted />
            </ActionGroup>
          </div>

          <div className="cc-card p-3 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
            <div className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" />
              <span>Adding several claims for the same invoice? Use <strong>Save and add another</strong> — the invoice number stays filled in.</span>
            </div>
          </div>

          <div className="cc-card p-3 text-xs">
            <div className="text-[11px] uppercase font-semibold mb-2" style={{ color: "var(--cc-muted-fg)" }}>Linking to existing group</div>
            <div className="flex items-center gap-2 text-sm">
              <Truck className="w-3.5 h-3.5" style={{ color: "var(--cc-purple-fg)" }} />
              <span className="mono" style={{ color: "var(--cc-purple-fg)" }}>INV-2026-0419</span>
              <span style={{ color: "var(--cc-muted-fg)" }}>· 12 legs · $2,184.50</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
