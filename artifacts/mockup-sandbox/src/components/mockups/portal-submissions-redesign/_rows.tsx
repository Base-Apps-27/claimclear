import { Clock, CheckCircle2, AlertTriangle, Loader2, FlaskConical, MoreVertical } from "lucide-react";
import { submissions, SubStatusPill, type SubStatus } from "./_shared";

export function SubmissionRow({ sub, selected, highlighted }: { sub: typeof submissions[number]; selected?: boolean; highlighted?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 transition-colors" style={{
      borderBottom: "1px solid var(--cc-border)",
      background: highlighted ? "var(--cc-blue-bg)" : selected ? "var(--cc-muted)" : "var(--cc-card)",
    }}>
      {sub.status === "Draft" || sub.status === "Pending" ? (
        <input type="checkbox" defaultChecked={selected} className="rounded" style={{ accentColor: "var(--cc-primary)" }} />
      ) : (
        <div style={{ width: 16 }} />
      )}
      <span className="mono text-xs font-semibold" style={{ color: highlighted ? "var(--cc-blue-fg)" : "var(--cc-primary)", minWidth: 116 }}>{sub.conf}</span>
      <SubStatusPill status={sub.status} />
      {sub.attempts && (
        <span className="cc-badge cc-badge-secondary text-[10px]">{sub.attempts}</span>
      )}
      {sub.nextRetry && (
        <span className="cc-badge text-[10px]" style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)", border: "none" }}>
          <Clock className="w-2.5 h-2.5" />{sub.nextRetry}
        </span>
      )}
      {sub.ticket && (
        <span className="cc-badge text-[10px] mono" style={{ background: "var(--cc-green-bg)", color: "var(--cc-green-fg)", border: "none" }}>
          <CheckCircle2 className="w-2.5 h-2.5" />{sub.ticket}
        </span>
      )}
      {sub.error && (
        <span className="cc-badge text-[10px]" style={{ background: "var(--cc-red-bg)", color: "var(--cc-red-fg)", border: "none" }}>
          <AlertTriangle className="w-2.5 h-2.5" />{sub.error}
        </span>
      )}
      {sub.claimedBy && (
        <span className="text-[11px] italic" style={{ color: "var(--cc-muted-fg)" }}>claimed by {sub.claimedBy}</span>
      )}
      {sub.status === "In Progress" && (
        <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--cc-blue-fg)" }} />
      )}
      {sub.sandboxRun && (
        <span className="cc-badge text-[10px]" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", border: "none" }}>
          <FlaskConical className="w-2.5 h-2.5" />sandbox verified
        </span>
      )}
      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{sub.issue}</span>
        <span className="text-sm font-medium mono" style={{ minWidth: 60, textAlign: "right" }}>{sub.amount}</span>
        <span className="text-[11px]" style={{ color: "var(--cc-muted-fg)", minWidth: 56, textAlign: "right" }}>{sub.age}</span>
        <button className="p-1 rounded hover:bg-[var(--cc-muted)]"><MoreVertical className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} /></button>
      </div>
    </div>
  );
}

export function StatusGroup({ status, children, count, defaultOpen = true }: { status: SubStatus; children: React.ReactNode; count: number; defaultOpen?: boolean }) {
  if (count === 0) return null;
  return (
    <div className="cc-card overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2" style={{ background: "var(--cc-muted)", borderBottom: defaultOpen ? "1px solid var(--cc-border)" : "none" }}>
        <SubStatusPill status={status} />
        <span className="text-xs font-medium" style={{ color: "var(--cc-muted-fg)" }}>{count} {count === 1 ? "item" : "items"}</span>
        <button className="ml-auto text-xs" style={{ color: "var(--cc-muted-fg)" }}>{defaultOpen ? "Collapse" : "Expand"}</button>
      </div>
      {defaultOpen && children}
    </div>
  );
}
