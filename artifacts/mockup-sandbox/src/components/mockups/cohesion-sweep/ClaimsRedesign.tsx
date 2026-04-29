import {
  Sparkles, Tag, Download, FileText, MoreVertical, ChevronRight, AlertCircle, Filter,
} from "lucide-react";
import {
  PageHeader, FilterStrip, StatusStrip, StatusDot, Section, ActionGroup, RowAction, StatusPill, Recommended, PrimaryButton,
} from "./_shared";

type Status = "Needs Review" | "Needs Evidence" | "On Hold" | "In Dispute" | "Approved" | "Denied" | "Closed";
const tabs: ("All" | Status)[] = ["All", "Needs Review", "Needs Evidence", "On Hold", "In Dispute", "Approved", "Denied"];
const counts: Record<"All" | Status, number> = {
  "All": 187, "Needs Review": 24, "Needs Evidence": 18, "On Hold": 6,
  "In Dispute": 92, "Approved": 31, "Denied": 16, "Closed": 0,
};

const claims = [
  { id: 1, conf: "C-2026-04812", group: "INV-2026-0419", member: "CLT-44210", date: "Apr 24", amount: "$184.50", status: "Needs Review" as Status, errorType: "Mileage Mismatch", age: "2h" },
  { id: 2, conf: "C-2026-04813", group: "INV-2026-0419", member: "CLT-44211", date: "Apr 24", amount: "$98.40",  status: "Needs Review" as Status, errorType: "Outside Auth Window", age: "2h" },
  { id: 3, conf: "C-2026-04814", group: "INV-2026-0418", member: "CLT-44089", date: "Apr 23", amount: "$245.20", status: "Needs Evidence" as Status, errorType: "GPS Deviation", age: "1d" },
  { id: 4, conf: "C-2026-04815", group: "INV-2026-0418", member: "CLT-44090", date: "Apr 23", amount: "$176.80", status: "In Dispute" as Status, errorType: "Mileage Mismatch", age: "1d" },
  { id: 5, conf: "C-2026-04816", group: "INV-2026-0417", member: "CLT-43984", date: "Apr 22", amount: "$198.00", status: "In Dispute" as Status, errorType: "Outside Auth Window", age: "2d" },
  { id: 6, conf: "C-2026-04817", group: "INV-2026-0417", member: "CLT-43985", date: "Apr 22", amount: "$215.90", status: "On Hold" as Status, errorType: "Awaiting member contact", age: "2d" },
  { id: 7, conf: "C-2026-04818", group: "INV-2026-0416", member: "CLT-43880", date: "Apr 21", amount: "$184.50", status: "Approved" as Status, errorType: "GPS Deviation", age: "3d" },
  { id: 8, conf: "C-2026-04819", group: "INV-2026-0416", member: "CLT-43881", date: "Apr 21", amount: "$112.40", status: "Denied" as Status, errorType: "Mileage Mismatch", age: "3d" },
];

const statusTone = (s: Status) =>
  s === "Approved" ? "green" :
  s === "Denied" ? "red" :
  s === "On Hold" ? "amber" :
  s === "Needs Evidence" ? "amber" :
  s === "In Dispute" ? "blue" : "blue" as const;

const selected = [1, 2];

export function ClaimsRedesign() {
  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <PageHeader title="Claims" sub="187 active · search and triage individual claims" accent="blue" />

      <FilterStrip tabs={tabs} active="All" counts={counts} accent="blue" />

      <StatusStrip>
        <StatusDot tone="green" />
        <span className="font-medium">Recovery on track</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>$24,810 in dispute · $8,140 recovered this week</span>
        <a href="#" className="ml-auto" style={{ color: "var(--cc-primary)", fontWeight: 500 }}>Open Summary →</a>
      </StatusStrip>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-8 space-y-3">
          <div className="cc-card flex items-center gap-3 px-4 py-3" style={{ background: "var(--cc-blue-bg)" }}>
            <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cc-blue-fg)" }} />
            <div className="flex-1 text-sm">
              <span className="font-medium" style={{ color: "var(--cc-blue-fg)" }}>24 claims awaiting review.</span>
              <span style={{ color: "var(--cc-blue-fg)", opacity: 0.85 }}> All have a likely error type already suggested.</span>
            </div>
            <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-blue-fg)", color: "white", border: "none" }}>
              Open triage
            </button>
          </div>

          <Section
            title={<>All claims <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>· {claims.length} of 187</span></>}
            action={
              <div className="flex items-center gap-1">
                <button className="cc-btn cc-btn-sm cc-btn-ghost"><Filter className="w-3 h-3" />Sort: Newest</button>
              </div>
            }
            padded={false}
          >
            <div className="text-xs px-3 py-2 flex items-center gap-3" style={{ background: "var(--cc-muted)", borderBottom: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }}>
              <input type="checkbox" className="rounded" style={{ accentColor: "var(--cc-primary)" }} />
              <span style={{ minWidth: 116 }}>Conf #</span>
              <span style={{ minWidth: 110 }}>Status</span>
              <span style={{ minWidth: 130 }}>Group</span>
              <span style={{ minWidth: 90 }}>Member</span>
              <span className="ml-auto" style={{ minWidth: 80, textAlign: "right" }}>Amount</span>
              <span style={{ minWidth: 40, textAlign: "right" }}>Age</span>
              <span style={{ width: 24 }} />
            </div>
            {claims.map(c => {
              const isSel = selected.includes(c.id);
              return (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 transition-colors" style={{
                  borderBottom: "1px solid var(--cc-border)",
                  background: isSel ? "var(--cc-blue-bg)" : "var(--cc-card)",
                }}>
                  <input type="checkbox" defaultChecked={isSel} className="rounded" style={{ accentColor: "var(--cc-primary)" }} />
                  <span className="mono text-xs font-semibold" style={{ color: "var(--cc-primary)", minWidth: 116 }}>{c.conf}</span>
                  <div style={{ minWidth: 110 }}><StatusPill tone={statusTone(c.status)}>{c.status}</StatusPill></div>
                  <span className="mono text-xs" style={{ color: "var(--cc-purple-fg)", minWidth: 130 }}>{c.group}</span>
                  <span className="text-xs mono" style={{ color: "var(--cc-muted-fg)", minWidth: 90 }}>{c.member}</span>
                  <span className="text-[11px] truncate flex-1" style={{ color: "var(--cc-muted-fg)" }}>{c.errorType}</span>
                  <span className="text-sm font-medium mono" style={{ minWidth: 80, textAlign: "right" }}>{c.amount}</span>
                  <span className="text-[11px]" style={{ color: "var(--cc-muted-fg)", minWidth: 40, textAlign: "right" }}>{c.age}</span>
                  <button className="p-1 rounded hover:bg-[var(--cc-muted)]"><MoreVertical className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} /></button>
                </div>
              );
            })}
            <div className="px-3 py-2 flex items-center justify-between text-xs" style={{ color: "var(--cc-muted-fg)" }}>
              <span>Showing 1–8 of 187</span>
              <div className="flex items-center gap-1">
                <button className="cc-btn cc-btn-sm cc-btn-ghost">Prev</button>
                <button className="cc-btn cc-btn-sm cc-btn-ghost">Next <ChevronRight className="w-3 h-3" /></button>
              </div>
            </div>
          </Section>
        </div>

        <aside className="col-span-4 space-y-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)", background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}>
              <span className="flex items-center gap-2"><FileText className="w-4 h-4" />What you can do</span>
              <span className="text-xs font-normal" style={{ opacity: 0.75 }}>{selected.length} selected</span>
            </div>

            <Recommended
              tone="blue"
              title="Triage 24 unreviewed claims"
              body="Walk through reviewer-assist on each one. Average 35 sec per claim."
              cta={<PrimaryButton tone="blue"><Sparkles className="w-4 h-4" />Start triage</PrimaryButton>}
            />

            <ActionGroup label="On selection">
              <RowAction icon={<Tag className="w-3.5 h-3.5" />} label={`Apply error type to ${selected.length}…`} />
              <RowAction icon={<FileText className="w-3.5 h-3.5" />} label="Move to On Hold" />
              <RowAction icon={<Download className="w-3.5 h-3.5" />} label="Export selected (CSV)" />
            </ActionGroup>

            <ActionGroup label="Bulk edit">
              <RowAction icon={<Tag className="w-3.5 h-3.5" />} label="Reassign owner…" muted />
              <RowAction icon={<FileText className="w-3.5 h-3.5" />} label="Add internal note to selected…" muted />
            </ActionGroup>

            <ActionGroup label="Selection">
              <RowAction icon={<MoreVertical className="w-3.5 h-3.5" />} label="Clear selection" muted />
            </ActionGroup>
          </div>

          <div className="cc-card p-3 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
            <div className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" />
              <span>To dispute many at once, work from <span style={{ color: "var(--cc-purple-fg)", fontWeight: 500 }}>Invoice Groups</span> instead.</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
