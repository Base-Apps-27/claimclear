export type Tone = "blue" | "purple" | "amber" | "green" | "red" | "muted";

type ToneStyle = {
  bg: string;
  fg: string;
  border: string;
};

export const TONE_STYLE: Record<Tone, ToneStyle> = {
  blue: {
    bg: "hsl(var(--cc-blue-bg))",
    fg: "hsl(var(--cc-blue-fg))",
    border: "hsl(var(--cc-blue-border))",
  },
  purple: {
    bg: "hsl(var(--cc-purple-bg))",
    fg: "hsl(var(--cc-purple-fg))",
    border: "hsl(var(--cc-purple-border))",
  },
  amber: {
    bg: "hsl(var(--cc-amber-bg))",
    fg: "hsl(var(--cc-amber-fg))",
    border: "hsl(var(--cc-amber-border))",
  },
  green: {
    bg: "hsl(var(--cc-green-bg))",
    fg: "hsl(var(--cc-green-fg))",
    border: "hsl(var(--cc-green-border))",
  },
  red: {
    bg: "hsl(var(--cc-red-bg))",
    fg: "hsl(var(--cc-red-fg))",
    border: "hsl(var(--cc-red-border))",
  },
  muted: {
    bg: "hsl(var(--muted))",
    fg: "hsl(var(--muted-foreground))",
    border: "hsl(var(--border))",
  },
};

// ─────────────────────────────────────────────────────────────────────
// Wave C T006-A foundation. Disposition → Tone projection. The
// disposition column is the canonical Wave-C+ source for "what state
// is this leg in"; mapping it directly to a tone lets row-aware
// callers (slice B: components/pages) avoid the legacy status string
// entirely. Status-keyed `toneForStatus` below stays as the legacy
// entrypoint for callers that only have a status in scope (URL filter
// pills, group-status pills served from rows that pre-date the
// disposition backfill).
//
// Mapping rationale, kept in sync with `toneForStatus`:
//   blue   = active/actionable        (operator owes the next step)
//   amber  = blocked / needs evidence (operator paused or chasing)
//   green  = positive terminal/active (verdict won, or MAS in flight)
//   red    = adverse terminal         (verdict lost outright)
//   muted  = withdrawn / non-issue    (closed without contest)
// `purple` (Processed) has no clean disposition counterpart — Processed
// is a leg-level "worktree complete, parent not packaged" UI state that
// the disposition column does not encode. Callers needing the purple
// pill keep using `toneForStatus`.
const DISPOSITION_TO_TONE: Record<string, Tone> = {
  unclassified: "blue",
  classifying: "amber",
  blocked: "amber",
  duplicate: "muted",
  disposed_portal: "blue",
  disposed_email: "blue",
  disposed_withdraw: "muted",
  disposed_nonissue: "muted",
  awaiting_review: "blue",
  verdict_drafted: "blue",
  verdict_approved: "green",
  verdict_partial: "green",
  verdict_denied: "red",
  attest_pending: "green",
  attest_queued: "green",
  attested: "green",
  mas_cancelled: "muted",
  attest_not_required: "green",
  final_reattested: "green",
  final_withdrawn: "muted",
  final_denied: "red",
  final_nonissue: "muted",
};

export interface RowForTone {
  disposition?: string | null;
  status?: string | null;
}

/**
 * Row-aware tone picker. Prefers the canonical `disposition` column
 * (skipping the `unclassified` default so a leg whose writer hasn't
 * synced disposition yet still falls through to the legacy status
 * ladder — same fallback rule as `deriveLegSubStatus`). Use this from
 * components/pages that already render a row; `toneForStatus` remains
 * the right call for surfaces that only hold a status string.
 */
export function toneForRow(row: RowForTone | null | undefined): Tone {
  if (!row) return "muted";
  const d = row.disposition;
  if (d && d !== "unclassified" && d in DISPOSITION_TO_TONE) {
    return DISPOSITION_TO_TONE[d];
  }
  return toneForStatus(row.status);
}

export function toneForStatus(status: string | null | undefined): Tone {
  switch (status) {
    case "New":
    case "Needs Review":
    case "Generating Email":
    case "Ready to Review":
    case "Awaiting Response":
    case "Portal Queued":
      return "blue";
    // "Processed" sits in pre-submit but signals "worktree complete,
    // waiting for the invoice to be packaged" — distinct enough from
    // both the actionable blues and the still-needs-attention ambers
    // to deserve a calm purple. Tone is purely visual; the macro-phase
    // bucketing in lifecycle-phase.ts is what drives lifecycle UI.
    case "Processed":
      return "purple";
    case "Needs Evidence":
    case "On Hold":
      return "amber";
    case "Resolved":
    case "Approved":
    case "Partially Approved":
    // MAS Eligible carries a positive MAS portal verdict and is the
    // last step before Resolved (just the off-system re-attest left).
    // Group it with the green family rather than introducing a new
    // tone — keeps the cohesion palette stable.
    case "MAS Eligible":
      return "green";
    case "Denied":
      return "red";
    case "Non-Issue":
    case "Pending":
      return "muted";
    default:
      return "muted";
  }
}
