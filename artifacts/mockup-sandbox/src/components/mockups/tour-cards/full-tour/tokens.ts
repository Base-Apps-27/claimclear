export const T = {
  NAVY: "#1B2A4A",
  NAVY_2: "#233560",
  NAVY_3: "#2A3F6E",
  BRAND_BLUE: "#1F6FEB",
  CORAL: "#E0654A",
  CORAL_DARK: "#D04F32",
  CORAL_BG: "#FDECE6",
  CORAL_BD: "#F6C7B6",
  AMBER_BG: "#FEF6E0",
  AMBER_FG: "#B45309",
  AMBER_BD: "#F4D38A",
  SKY_BG: "#E0F2FE",
  SKY_FG: "#0369A1",
  SKY_BD: "#BAE6FD",
  EMERALD_BG: "#ECFDF5",
  EMERALD_FG: "#047857",
  EMERALD_BD: "#A7F3D0",
  ROSE_BG: "#FEF2F2",
  ROSE_FG: "#B91C1C",
  ROSE_BD: "#FECACA",
  SLATE_50: "#F8FAFC",
  SLATE_TEXT: "#0F172A",
  SLATE_MUTED: "#475569",
  SLATE_300: "#CBD5E1",
  SLATE_400: "#94A3B8",
  HAIRLINE: "#E2E8F0",
  BG: "#F4F6F9",
} as const;

export type ProcessStep = 1 | 2 | 3 | 4 | 5 | "all" | "transition" | "closing";

export const PHASES = [
  { n: 1 as const, label: "Upload",     color: T.AMBER_FG },
  { n: 2 as const, label: "Understand", color: T.SKY_FG },
  { n: 3 as const, label: "Gather",     color: T.EMERALD_FG },
  { n: 4 as const, label: "Submit",     color: T.CORAL },
  { n: 5 as const, label: "Respond",    color: T.NAVY },
];

export function phaseColor(s: ProcessStep): string {
  if (s === 1) return T.AMBER_FG;
  if (s === 2) return T.SKY_FG;
  if (s === 3) return T.EMERALD_FG;
  if (s === 4) return T.CORAL;
  if (s === 5) return T.NAVY;
  return T.CORAL;
}
