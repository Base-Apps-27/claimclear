import { AlertTriangle, RotateCcw, X, Trash2 } from "lucide-react";
import { FrameLabel, Annotation } from "../queue-redesign/_shared";

export default function R5() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900, padding: "0.875rem" }}>
      <FrameLabel
        tag="REWIND·R5"
        title="Confirm dialogs · light (no draft) vs heavy (draft will be discarded)"
        principles={["P3", "P9"]}
      />

      <div style={{ marginBottom: "0.75rem" }}>
        <Annotation tone="muted">
          <strong>Two flavors, same endpoint.</strong>{" "}
          Light dialog appears when no AI draft exists yet — quick confirmation, single primary
          button. Heavy dialog appears when rewinding will discard a generated note (and the
          reviewed-at stamp, if present) — adds a tinted callout and a slower, two-step affirm.
        </Annotation>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", padding: "1.5rem 1.25rem", background: "rgba(15,23,42,0.04)", borderRadius: "var(--cc-radius)" }}>
        <DialogFrame label="Light · no draft to lose">
          <Dialog
            kind="light"
            currentVerdict="Cannot dispute · within tolerance"
            popsCount={3}
          />
        </DialogFrame>

        <DialogFrame label="Heavy · draft + review will be discarded">
          <Dialog
            kind="heavy"
            currentVerdict="Cannot dispute · within tolerance"
            popsCount={3}
          />
        </DialogFrame>
      </div>
    </div>
  );
}

function DialogFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <span className="cc-meta text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      <div style={{ display:"flex", justifyContent:"center", alignItems:"flex-start", padding:"1.25rem 0", background:"rgba(15,23,42,0.06)", borderRadius:"var(--cc-radius)", minHeight:520 }}>
        {children}
      </div>
    </div>
  );
}

function Dialog({ kind, currentVerdict, popsCount }: { kind: "light" | "heavy"; currentVerdict: string; popsCount: number }) {
  return (
    <div style={{
      width: 460,
      background: "var(--cc-card)",
      border: "1px solid var(--cc-border)",
      borderRadius: "var(--cc-radius)",
      boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", padding:"0.875rem 1rem", borderBottom:"1px solid var(--cc-border)" }}>
        <RotateCcw className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
        <span className="font-semibold text-sm">Rewind walk for Leg 2 (8847294)?</span>
        <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft:"auto", padding:"0 4px" }} aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding:"1rem", display:"flex", flexDirection:"column", gap:"0.75rem" }}>
        <KV k="Currently" v={currentVerdict} />
        <KV k="Going back" v={`${popsCount} answers will be undone`} />

        {kind === "heavy" && (
          <div style={{ display:"flex", gap:"0.625rem", padding:"0.75rem 0.875rem", background:"rgba(245,158,11,0.08)", border:"1px solid var(--cc-amber-fg)", borderRadius:"var(--cc-radius)" }}>
            <AlertTriangle className="w-4 h-4" style={{ color:"var(--cc-amber-fg)", flexShrink:0, marginTop:2 }} />
            <div style={{ display:"flex", flexDirection:"column", gap:"0.25rem" }}>
              <div className="font-semibold text-[13px]" style={{ color:"var(--cc-amber-fg)" }}>This will also discard:</div>
              <ul style={{ display:"flex", flexDirection:"column", gap:2, margin:0, paddingLeft: "1rem" }}>
                <li className="text-[12px]">The generated dispute note for this invoice</li>
                <li className="text-[12px]">Your <em>reviewed-at</em> stamp</li>
              </ul>
              <div className="cc-meta text-[11px]" style={{ marginTop:2 }}>You'll regenerate the note after fixing the walk.</div>
            </div>
          </div>
        )}

        {kind === "light" && (
          <div className="cc-meta text-[11px]" style={{ padding:"0.375rem 0" }}>
            No AI draft exists yet for this invoice — nothing else changes.
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", padding:"0.75rem 1rem", borderTop:"1px solid var(--cc-border)", background:"var(--cc-bg)" }}>
        <button className="cc-btn cc-btn-ghost cc-btn-sm">Cancel</button>
        {kind === "light" ? (
          <button className="cc-btn cc-btn-primary cc-btn-sm" style={{ marginLeft:"auto" }} data-testid="rewind-confirm-light">
            <RotateCcw className="w-3.5 h-3.5" /> Rewind walk
          </button>
        ) : (
          <button className="cc-btn cc-btn-sm" style={{
            marginLeft:"auto",
            background:"var(--cc-amber-fg)", color:"#fff", borderColor:"var(--cc-amber-fg)",
          }} data-testid="rewind-confirm-heavy">
            <Trash2 className="w-3.5 h-3.5" /> Rewind &amp; discard draft
          </button>
        )}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display:"flex", gap:"0.625rem" }}>
      <span className="cc-meta text-[11px] uppercase tracking-wider" style={{ width:90, flexShrink:0 }}>{k}</span>
      <span className="text-[13px]">{v}</span>
    </div>
  );
}
