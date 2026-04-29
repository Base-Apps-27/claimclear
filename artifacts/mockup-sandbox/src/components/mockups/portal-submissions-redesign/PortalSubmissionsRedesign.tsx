import "../claim-detail-redesign/_group.css";
import {
  Play, Sparkles, FlaskConical, Edit2, Tag, X, History, Bot, AlertCircle, ChevronRight,
} from "lucide-react";
import {
  submissions, statusOrder, counts, recentRuns,
  PageHeader, StatusStrip, Section, ActionGroup, RowAction,
} from "./_shared";
import { SubmissionRow, StatusGroup } from "./_rows";

export function PortalSubmissionsRedesign() {
  const grouped = statusOrder.reduce<Record<string, typeof submissions>>((acc, s) => {
    acc[s] = submissions.filter(x => x.status === s);
    return acc;
  }, {});
  const draftIds = grouped["Draft"].map(d => d.id);
  const selectedDrafts = draftIds.length;

  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <PageHeader counts={counts} activeFilter="All" />
      <StatusStrip />

      <div className="grid grid-cols-12 gap-5">
        {/* MAIN COLUMN */}
        <div className="col-span-8 space-y-3">
          {/* Recommendation bar — same vocabulary as Variant C "Recommended" */}
          <div className="cc-card flex items-center gap-3 px-4 py-3" style={{ background: "var(--cc-blue-bg)", borderColor: "var(--cc-blue-border, var(--cc-border))" }}>
            <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cc-blue-fg)" }} />
            <div className="flex-1 text-sm">
              <span className="font-medium" style={{ color: "var(--cc-blue-fg)" }}>3 drafts ready to queue.</span>
              <span style={{ color: "var(--cc-blue-fg)", opacity: 0.85 }}> Bot will pick them up on the next run.</span>
            </div>
            <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-blue-fg)", color: "white", border: "none" }}>
              <Play className="w-3 h-3" />Queue 3 drafts
            </button>
          </div>

          {statusOrder.map(s => (
            <StatusGroup key={s} status={s} count={grouped[s].length} defaultOpen={s !== "Submitted"}>
              {grouped[s].map(row => (
                <SubmissionRow key={row.id} sub={row} selected={row.status === "Draft"} />
              ))}
            </StatusGroup>
          ))}
        </div>

        {/* PINNED RIGHT RAIL — Bulk actions / queue control */}
        <aside className="col-span-4 space-y-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)", background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}>
              <span className="flex items-center gap-2"><Bot className="w-4 h-4" />Run the queue</span>
              <span className="text-xs font-normal" style={{ opacity: 0.75 }}>{selectedDrafts} selected</span>
            </div>

            {/* Recommended / primary */}
            <div className="p-4" style={{ background: "var(--cc-blue-bg)", borderTop: "1px solid var(--cc-border)" }}>
              <div className="text-xs uppercase font-semibold mb-2" style={{ color: "var(--cc-blue-fg)" }}>Recommended</div>
              <button className="cc-btn w-full justify-center" style={{ background: "var(--cc-blue-fg)", color: "white", border: "none", padding: "0.5rem 0.75rem" }}>
                <Play className="w-4 h-4" />Process all pending (4)
              </button>
              <div className="text-xs mt-2" style={{ color: "var(--cc-blue-fg)", opacity: 0.85 }}>
                Estimated 4–6 minutes. One worker processes the queue at a time.
              </div>
            </div>

            <ActionGroup label="On selection">
              <RowAction icon={<Play className="w-3.5 h-3.5" />}        label={`Process selected (${selectedDrafts})`} sub="Bot will fill the form and submit" />
              <RowAction icon={<FlaskConical className="w-3.5 h-3.5" />} label="Sandbox-run selected"                  sub="Dry run — fills the form, captures a screenshot, doesn't submit" />
              <RowAction icon={<X className="w-3.5 h-3.5" />}            label="Cancel selected" muted />
            </ActionGroup>

            <ActionGroup label="Bulk edit">
              <RowAction icon={<Tag className="w-3.5 h-3.5" />}    label="Apply error type to selected…" />
              <RowAction icon={<Edit2 className="w-3.5 h-3.5" />}  label="Edit subject for selected…" />
            </ActionGroup>

            <ActionGroup label="Selection">
              <RowAction icon={<X className="w-3.5 h-3.5" />} label="Clear selection" muted />
            </ActionGroup>
          </div>

          {/* Recent runs — collapsed into a small card */}
          <div className="cc-card overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)" }}>
              <span className="flex items-center gap-2"><History className="w-4 h-4" />Recent runs</span>
              <a href="#" className="text-xs font-normal" style={{ color: "var(--cc-primary)" }}>See all</a>
            </div>
            <div className="text-sm">
              {recentRuns.map(r => (
                <div key={r.id} className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid var(--cc-border)" }}>
                  <span className={`cc-badge text-[10px]`} style={{
                    background: r.status === "Success" ? "var(--cc-green-bg)" : "var(--cc-red-bg)",
                    color: r.status === "Success" ? "var(--cc-green-fg)" : "var(--cc-red-fg)",
                    border: "none",
                  }}>{r.status}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs">{r.ok}/{r.total} ok{r.fail > 0 ? `, ${r.fail} failed` : ""}</div>
                    <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>{r.at} · {r.by}</div>
                  </div>
                  <ChevronRight className="w-3 h-3" style={{ color: "var(--cc-muted-fg)" }} />
                </div>
              ))}
            </div>
          </div>

          <div className="cc-card p-3 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
            <div className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" />
              <span>Need to reorder the queue? Cancel + recreate the draft on the claim.</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
