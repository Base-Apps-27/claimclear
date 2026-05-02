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
