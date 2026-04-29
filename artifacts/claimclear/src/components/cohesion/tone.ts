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
    case "Needs Evidence":
    case "On Hold":
      return "amber";
    case "Resolved":
    case "Approved":
    case "Partially Approved":
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
