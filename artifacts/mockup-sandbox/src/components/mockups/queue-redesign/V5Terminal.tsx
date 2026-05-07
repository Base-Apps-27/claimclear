import {
  HeaderStrip, ClassificationStrip, MasterList, GroupHeaderCard,
  SubmissionFooter, FrameLabel, Annotation, Icons,
} from "./_shared";

/**
 * V5 — Terminal / re-attest state.
 * Focused on the moment that bites hardest under the current
 * production layout: every leg has reached a terminal verdict and
 * the group is ready to either Re-attest or Close out. Today the
 * footer teleports based on whether a leg is expanded; under the
 * V1/V2 pattern the footer has exactly one home, and the legs
 * themselves collapse to single-line summaries.
 */
export default function V5Terminal() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 760 }}>
      <FrameLabel
        tag="V5"
        title="Terminal / re-attest state · footer never moves · legs are read-only summaries"
        principles={["P1", "P3", "P4", "P6", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 620 }}>
        <MasterList />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <GroupHeaderCard
            trailing={
              <div className="flex items-center gap-1">
                <span className="cc-pill cc-pill-green">All legs concluded</span>
              </div>
            }
          />

          <Annotation tone="muted">
            Every leg has terminated. Per P3, the legs collapse to single-line
            verdict summaries — no SOP transcript, no walk controls, no per-leg
            CTAs. The next decision lives <strong>only</strong> in the pinned
            footer below (P4 — one home, never teleports).
          </Annotation>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <TerminalLegRow conf="C-2026-04812" date="Apr 24" amount="$184.50" verdict="Approved (operator)" tone="green" />
            <TerminalLegRow conf="C-2026-04813" date="Apr 24" amount="$612.40" verdict="Approved (operator)" tone="green" />
            <TerminalLegRow conf="C-2026-04814" date="Apr 25" amount="$605.20" verdict="Non-contestable" tone="muted" />
          </div>

          <div style={{ flex: 1 }} />

          <SubmissionFooter variant="reattest" pinned />

          <Annotation tone="amber">
            <strong>Compare with today:</strong> the production page renders
            the Re-attest CTA either inside the expanded leg (when one is open)
            or as a free-floating card after the legs panel (when none is open).
            Operators see it move between two locations. Here it never moves.
          </Annotation>
        </div>
      </div>

      {/* Second pane — the close-out variant of the same state */}
      <div style={{ borderTop: "2px dashed var(--cc-border)", padding: "0.875rem 1rem", display: "flex", flexDirection: "column", gap: "0.5rem", background: "hsl(210 18% 98%)" }}>
        <div className="flex items-center gap-2">
          <Icons.ArrowDown className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
          <span className="font-semibold text-sm">Variant of the same state — close-out only</span>
          <span className="cc-meta text-xs">When no legs are contestable, the same footer slot carries the close-out CTA instead of re-attest. Same physical location, different content.</span>
        </div>
        <SubmissionFooter variant="closeout" pinned />
      </div>
    </div>
  );
}

function TerminalLegRow({ conf, date, amount, verdict, tone }: { conf: string; date: string; amount: string; verdict: string; tone: "green" | "muted" | "red" }) {
  const pillClass = tone === "green" ? "cc-pill-green" : tone === "red" ? "cc-pill-red" : "cc-pill-muted";
  return (
    <div className="cc-leg-row">
      <div className="cc-leg-row-head" style={{ cursor: "default" }}>
        <span className="cc-leg-chev"><Icons.CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--cc-green-fg)" }} /></span>
        <span className="mono text-[12px] font-medium">{conf}</span>
        <span className="cc-meta text-[11px]">{date}</span>
        <span className="cc-meta text-[11px] tabular-nums">{amount}</span>
        <span className={`cc-pill ${pillClass} ml-auto`}>{verdict}</span>
        <button className="cc-btn cc-btn-ghost cc-btn-sm">Change</button>
      </div>
    </div>
  );
}
