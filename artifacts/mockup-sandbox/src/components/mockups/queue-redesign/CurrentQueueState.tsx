import "./_queue.css";
import { ChevronRight, FileText, X } from "lucide-react";
import {
  HeaderStrip,
  ClassificationStrip,
  MasterList,
  SopActiveCard,
  groupSummary,
  legs,
  Icons,
} from "./_shared";

/**
 * Current production queue page (May 2026) — preserved as-is so we can
 * point at exactly what the V3 edge-drawer redesign is replacing.
 *
 * The two redundant "Full details / Full Details" affordances are
 * intentional: they mirror the live UI from queue.tsx (outer header
 * around line 1758) + inline-group-workspace-mini.tsx GroupSummaryHeader
 * (inner header around line 514).
 */
export default function CurrentQueueState() {
  return (
    <div
      className="cc-scope"
      style={{ width: 1280, minHeight: 860, background: "var(--cc-bg)" }}
    >
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: "0.75rem",
          padding: "0.75rem",
          alignItems: "start",
        }}
      >
        <MasterList dense />

        {/* ── Right pane: the workflow panel as it exists today ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {/* OUTER HEADER #1 — queue.tsx ~line 1758 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              padding: "0.25rem 0.25rem 0.25rem 0.5rem",
              outline: "2px dashed hsl(0 80% 55%)",
              outlineOffset: "4px",
              borderRadius: "6px",
            }}
            data-annotate="outer-header"
          >
            <h3 style={{ fontSize: "1.05rem", fontWeight: 600, margin: 0 }}>
              Process Invoice Group{" "}
              <span
                style={{
                  marginLeft: "0.4rem",
                  fontSize: "0.85rem",
                  fontWeight: 400,
                  color: "var(--cc-meta)",
                }}
              >
                <span className="mono">{groupSummary.invoice}</span> · {groupSummary.status}
              </span>
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <a href="#" className="cc-btn cc-btn-ghost cc-btn-sm">
                Full Details <ChevronRight className="w-3.5 h-3.5" />
              </a>
              <button className="cc-btn cc-btn-ghost cc-btn-sm">
                <X className="w-3.5 h-3.5" /> Close
              </button>
            </div>
          </div>

          {/* INNER HEADER #2 — GroupSummaryHeader from inline-group-workspace-mini.tsx ~line 514 */}
          <div
            className="cc-group-header"
            style={{
              outline: "2px dashed hsl(28 90% 50%)",
              outlineOffset: "4px",
            }}
            data-annotate="inner-header"
          >
            <FileText className="w-4 h-4" style={{ color: "var(--cc-meta)" }} />
            <span className="mono font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-xs">
              {groupSummary.legCount} rides · {groupSummary.total}
            </span>
            <span className="cc-meta text-xs">· Service date Apr 24</span>
            <a
              href="#"
              className="cc-btn cc-btn-ghost cc-btn-sm"
              style={{ marginLeft: "auto" }}
            >
              Full details <ChevronRight className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Leg tabs (also part of GroupSummaryHeader) */}
          <div className="cc-segmented" role="tablist" aria-label="Legs">
            {legs.map((leg, i) => (
              <button
                key={leg.id}
                type="button"
                className={i === 0 ? "is-active" : ""}
              >
                Leg {i + 1}
              </button>
            ))}
          </div>

          {/* Active SOP — same body the live workspace renders */}
          <SopActiveCard />

          {/* Bottom drilldown link — invoice-groups.tsx style "Open INV-… in full view" */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "0.5rem 0.25rem",
              outline: "2px dashed hsl(28 90% 50%)",
              outlineOffset: "4px",
              borderRadius: "6px",
            }}
            data-annotate="bottom-drilldown"
          >
            <a href="#" className="cc-link text-xs inline-flex items-center gap-1">
              Open <span className="mono">{groupSummary.invoice}</span> in full view
              <Icons.ArrowRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
