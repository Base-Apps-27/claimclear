import "./_queue.css";
import { PauseCircle, Play, ArrowUpRight } from "lucide-react";
import {
  HeaderStrip, ClassificationStrip, MasterList,
  legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 Hold-exit hero.
 *
 * Shown when the active leg or its group is on hold — *not* an SOP
 * hold (those still render the existing HoldTerminal inside the SOP
 * player). This covers:
 *   - manual leg hold:   subStatus === "blocked" (useHoldClaim)
 *   - manual group hold: group.status === "On Hold" (useHoldInvoiceGroup)
 *
 * Each maps to its existing release mutation:
 *   - useRemoveHold(legId)              → leg-scoped clear
 *   - useRemoveInvoiceGroupHold(groupId) → group-scoped clear
 *
 * Every field below already exists on the claim/group payload:
 *   holdReason, holdPlacedAt, holdPendingFrom (see openapi.yaml L5404).
 *
 * Two variants stacked side-by-side in the same iframe so we can see
 * both shapes; only one renders at a time in the real wizard.
 */
export default function V3HoldExit() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          {/* Group summary — same one-line bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.625rem",
            padding: "0.5rem 0.75rem",
            background: "var(--cc-card)", border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-radius)",
          }}>
            <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
            <div className="cc-segmented" style={{ marginLeft: "auto" }}>
              <button className="is-active">Leg 1 <Icons.AlertTriangle className="w-2.5 h-2.5 inline ml-1" /></button>
              <button>Leg 2 <Icons.CheckCircle2 className="w-2.5 h-2.5 inline ml-1" /></button>
              <button>Leg 3 <Icons.HelpCircle className="w-2.5 h-2.5 inline ml-1" /></button>
            </div>
          </div>

          {/* Hero — two side-by-side variants for the design review */}
          <div style={{
            flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 16, padding: "0 1.25rem",
            alignContent: "center", alignItems: "center",
          }}>
            <HoldCard
              scope="leg"
              title="This leg is on hold"
              reasonLabel="Awaiting member response"
              placedAt="3 days ago by Maya R."
              pendingFrom="Member · phone outreach in progress"
              clearLabel="Clear leg hold"
            />
            <HoldCard
              scope="group"
              title="The whole invoice is on hold"
              reasonLabel="Awaiting payor portal response"
              placedAt="6 days ago by Jordan K."
              pendingFrom="MAS Medicaid portal · ticket #48211"
              clearLabel="Clear group hold"
            />
          </div>

          {/* Same chips strip — closed by default */}
          <div style={{ padding: "0 1.25rem" }}>
            <div className="cc-counts-strip">
              <button className="cc-count-pill">
                <Icons.Paperclip className="w-3 h-3" /> Evidence
                <span className="cc-count-n">4</span>
              </button>
              <button className="cc-count-pill">
                <Icons.FileText className="w-3 h-3" /> Notes
                <span className="cc-count-n">2</span>
              </button>
              <button className="cc-count-pill">
                <Icons.MessageSquare className="w-3 h-3" /> Comms
                <span className="cc-count-n">1</span>
              </button>
              <button className="cc-count-pill">
                <Icons.Activity className="w-3 h-3" /> Activity
                <span className="cc-count-n">11</span>
              </button>
            </div>
          </div>

          {/* Same sticky footer */}
          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-amber">Paused</span>
            <span className="cc-meta text-xs flex-1">Hold blocks the walk. Clear the hold to resume — or stop and come back later.</span>
            <button className="cc-btn cc-btn-primary" disabled>
              <Icons.Send className="w-3.5 h-3.5" /> Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HoldCard({
  scope, title, reasonLabel, placedAt, pendingFrom, clearLabel,
}: {
  scope: "leg" | "group";
  title: string;
  reasonLabel: string;
  placedAt: string;
  pendingFrom: string;
  clearLabel: string;
}) {
  return (
    <div style={{
      background: "var(--cc-amber-bg)",
      border: "1px solid var(--cc-amber-border)",
      borderRadius: "var(--cc-radius)",
      padding: "1.125rem 1.25rem 1rem",
    }}>
      {/* Scope chip + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="cc-pill cc-pill-amber" style={{ fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: 0.4 }}>
          {scope === "leg" ? "Leg-scoped hold" : "Group-scoped hold"}
        </span>
        <span className="cc-meta" style={{ fontSize: "0.6875rem", marginLeft: "auto" }}>
          {placedAt}
        </span>
      </div>

      {/* Pause icon + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PauseCircle className="w-6 h-6" style={{ color: "var(--cc-amber-fg)", flexShrink: 0 }} />
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--cc-fg)" }}>
          {title}
        </h3>
      </div>

      {/* Reason + pending-from — already on the payload */}
      <div style={{
        marginTop: 10, padding: "8px 10px",
        background: "var(--cc-card)",
        border: "1px solid var(--cc-amber-border)",
        borderRadius: 8,
        fontSize: "0.75rem", lineHeight: 1.45,
      }}>
        <div>
          <span className="cc-meta" style={{ fontSize: "0.6875rem" }}>Reason:</span>{" "}
          <span style={{ fontWeight: 500 }}>{reasonLabel}</span>
        </div>
        <div style={{ marginTop: 4 }}>
          <span className="cc-meta" style={{ fontSize: "0.6875rem" }}>Pending from:</span>{" "}
          <span>{pendingFrom}</span>
        </div>
      </div>

      {/* Primary clear-hold CTA */}
      <div className="cc-sop-actions" style={{ marginTop: 12 }}>
        <button className="cc-btn cc-btn-primary">
          <Play className="w-3.5 h-3.5" /> {clearLabel}
        </button>
      </div>

      {/* Footnote: open details for full context */}
      <div style={{
        marginTop: 10, paddingTop: 8,
        borderTop: "1px dashed var(--cc-amber-border)",
        fontSize: "0.6875rem", color: "var(--cc-muted-fg)",
      }}>
        {scope === "leg"
          ? "Clearing this hold returns the leg to the SOP walk where it left off."
          : "Clearing this hold returns the whole invoice to the queue."}
        {" "}
        <a href="#" className="cc-link" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          Open details <ArrowUpRight className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
