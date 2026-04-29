import {
  Sparkles, Send, Download, FileText, MoreVertical, ChevronRight, AlertCircle, Filter, Layers,
} from "lucide-react";
import {
  PageHeader, FilterStrip, StatusStrip, StatusDot, Section, ActionGroup, RowAction, StatusPill, Recommended, PrimaryButton,
} from "./_shared";

type GStatus = "Action Required" | "Awaiting" | "On Hold" | "Submitted" | "Closed";
const tabs: ("All" | GStatus)[] = ["All", "Action Required", "Awaiting", "On Hold", "Submitted", "Closed"];
const counts: Record<"All" | GStatus, number> = {
  "All": 42, "Action Required": 8, "Awaiting": 14, "On Hold": 3, "Submitted": 12, "Closed": 5,
};

const groups = [
  { id: 1, num: "INV-2026-0419", legs: 12, total: "$2,184.50", status: "Action Required" as GStatus, payor: "MAS / NY Medicaid", age: "2h",  primaryError: "Mileage Mismatch (8 of 12)" },
  { id: 2, num: "INV-2026-0418", legs:  8, total: "$1,476.20", status: "Action Required" as GStatus, payor: "MAS / NY Medicaid", age: "1d",  primaryError: "GPS Deviation (5 of 8)" },
  { id: 3, num: "INV-2026-0417", legs: 16, total: "$3,022.40", status: "Awaiting" as GStatus,        payor: "MAS / NY Medicaid", age: "2d",  primaryError: "Submitted via portal · awaiting MAS reply" },
  { id: 4, num: "INV-2026-0416", legs:  6, total: "$  892.10", status: "On Hold" as GStatus,         payor: "MAS / NY Medicaid", age: "3d",  primaryError: "Member contact required" },
  { id: 5, num: "INV-2026-0415", legs: 14, total: "$2,610.80", status: "Submitted" as GStatus,       payor: "MAS / NY Medicaid", age: "5d",  primaryError: "Ticket MAS-2026-A8841" },
  { id: 6, num: "INV-2026-0414", legs:  9, total: "$1,705.30", status: "Closed" as GStatus,          payor: "MAS / NY Medicaid", age: "1w",  primaryError: "Approved · $1,432.00 recovered" },
];

const statusTone = (s: GStatus) =>
  s === "Action Required" ? "amber" :
  s === "On Hold" ? "amber" :
  s === "Awaiting" ? "purple" :
  s === "Submitted" ? "purple" :
  s === "Closed" ? "green" : "purple" as const;

const selected = [1, 2];

export function InvoiceGroupsRedesign() {
  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <PageHeader title="Invoice Groups" sub="42 active groups · the unit you actually file in the MAS portal" accent="purple" />

      <FilterStrip tabs={tabs} active="All" counts={counts} accent="purple" />

      <StatusStrip>
        <StatusDot tone="amber" />
        <span className="font-medium">8 groups need action</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>14 awaiting MAS reply · 3 on hold for member contact</span>
        <a href="#" className="ml-auto" style={{ color: "var(--cc-primary)", fontWeight: 500 }}>Open Queue →</a>
      </StatusStrip>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-8 space-y-3">
          <div className="cc-card flex items-center gap-3 px-4 py-3" style={{ background: "var(--cc-purple-bg)" }}>
            <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cc-purple-fg)" }} />
            <div className="flex-1 text-sm">
              <span className="font-medium" style={{ color: "var(--cc-purple-fg)" }}>2 groups ready to dispute.</span>
              <span style={{ color: "var(--cc-purple-fg)", opacity: 0.85 }}> Evidence is complete, error types assigned.</span>
            </div>
            <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-purple-fg)", color: "white", border: "none" }}>
              <Send className="w-3 h-3" />Dispute 2 groups
            </button>
          </div>

          <Section
            title={<>All groups <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>· {groups.length} of 42</span></>}
            action={<button className="cc-btn cc-btn-sm cc-btn-ghost"><Filter className="w-3 h-3" />Sort: Newest</button>}
            padded={false}
          >
            <div className="text-xs px-3 py-2 flex items-center gap-3" style={{ background: "var(--cc-muted)", borderBottom: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }}>
              <input type="checkbox" className="rounded" style={{ accentColor: "var(--cc-purple-fg)" }} />
              <span style={{ minWidth: 130 }}>Invoice #</span>
              <span style={{ minWidth: 130 }}>Status</span>
              <span style={{ minWidth: 60, textAlign: "right" }}>Legs</span>
              <span className="flex-1">Issue</span>
              <span style={{ minWidth: 96, textAlign: "right" }}>Total</span>
              <span style={{ minWidth: 40, textAlign: "right" }}>Age</span>
              <span style={{ width: 24 }} />
            </div>
            {groups.map(g => {
              const isSel = selected.includes(g.id);
              return (
                <div key={g.id} className="flex items-center gap-3 px-3 py-2.5 transition-colors" style={{
                  borderBottom: "1px solid var(--cc-border)",
                  background: isSel ? "var(--cc-purple-bg)" : "var(--cc-card)",
                }}>
                  <input type="checkbox" defaultChecked={isSel} className="rounded" style={{ accentColor: "var(--cc-purple-fg)" }} />
                  <span className="mono text-xs font-semibold" style={{ color: "var(--cc-purple-fg)", minWidth: 130 }}>{g.num}</span>
                  <div style={{ minWidth: 130 }}><StatusPill tone={statusTone(g.status)}>{g.status}</StatusPill></div>
                  <span className="text-sm font-medium mono" style={{ minWidth: 60, textAlign: "right" }}>{g.legs}</span>
                  <span className="text-[11px] truncate flex-1" style={{ color: "var(--cc-muted-fg)" }}>{g.primaryError}</span>
                  <span className="text-sm font-medium mono" style={{ minWidth: 96, textAlign: "right" }}>{g.total}</span>
                  <span className="text-[11px]" style={{ color: "var(--cc-muted-fg)", minWidth: 40, textAlign: "right" }}>{g.age}</span>
                  <button className="p-1 rounded hover:bg-[var(--cc-muted)]"><MoreVertical className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} /></button>
                </div>
              );
            })}
            <div className="px-3 py-2 flex items-center justify-between text-xs" style={{ color: "var(--cc-muted-fg)" }}>
              <span>Showing 1–6 of 42</span>
              <div className="flex items-center gap-1">
                <button className="cc-btn cc-btn-sm cc-btn-ghost">Prev</button>
                <button className="cc-btn cc-btn-sm cc-btn-ghost">Next <ChevronRight className="w-3 h-3" /></button>
              </div>
            </div>
          </Section>
        </div>

        <aside className="col-span-4 space-y-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)", background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
              <span className="flex items-center gap-2"><Layers className="w-4 h-4" />What you can do</span>
              <span className="text-xs font-normal" style={{ opacity: 0.75 }}>{selected.length} selected</span>
            </div>

            <Recommended
              tone="purple"
              title="Dispute 2 groups now"
              body="Bot will file each group as a separate MAS portal submission. Estimated 4–6 minutes."
              cta={<PrimaryButton tone="purple"><Send className="w-4 h-4" />Send to portal queue</PrimaryButton>}
            />

            <ActionGroup label="On selection">
              <RowAction icon={<FileText className="w-3.5 h-3.5" />} label="Open both in workflow player" />
              <RowAction icon={<Download className="w-3.5 h-3.5" />} label="Export selected as packet (PDF)" />
              <RowAction icon={<MoreVertical className="w-3.5 h-3.5" />} label="Move to On Hold" muted />
            </ActionGroup>

            <ActionGroup label="Bulk edit">
              <RowAction icon={<FileText className="w-3.5 h-3.5" />} label="Reassign owner…" muted />
              <RowAction icon={<FileText className="w-3.5 h-3.5" />} label="Apply note template…" muted />
            </ActionGroup>

            <ActionGroup label="Selection">
              <RowAction icon={<MoreVertical className="w-3.5 h-3.5" />} label="Clear selection" muted />
            </ActionGroup>
          </div>

          <div className="cc-card p-3 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
            <div className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" />
              <span>To work one at a time with full evidence, open <span style={{ color: "var(--cc-primary)", fontWeight: 500 }}>Queue</span>.</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
