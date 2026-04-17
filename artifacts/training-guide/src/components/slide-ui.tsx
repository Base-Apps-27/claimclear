import type { ReactNode } from "react";

type AccentColor = "accent" | "orange";
type CalloutColor = "accent" | "orange" | "primary";

const accentDot: Record<AccentColor, string> = {
  accent: "bg-accent",
  orange: "bg-orange",
};
const accentText: Record<AccentColor, string> = {
  accent: "text-accent",
  orange: "text-orange",
};
const calloutBg: Record<CalloutColor, string> = {
  accent: "bg-accent",
  orange: "bg-orange",
  primary: "bg-primary",
};

export function SlideShell({
  eyebrow,
  step,
  totalSteps,
  title,
  subtitle,
  accent = "accent",
  children,
}: {
  eyebrow?: string;
  step?: number;
  totalSteps?: number;
  title: string;
  subtitle?: string;
  accent?: AccentColor;
  children: ReactNode;
}) {
  const eyebrowText =
    eyebrow ?? (step != null && totalSteps != null ? `Step ${step} of ${totalSteps}` : "");
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div
        className="absolute top-0 right-0 bg-primary/[0.03] rounded-bl-full"
        style={{ width: "40vw", height: "40vh" }}
      />
      <div
        className="relative z-10 flex flex-col h-full"
        style={{ padding: "4.5vh 5.5vw" }}
      >
        <div
          className="flex items-center justify-between"
          style={{ marginBottom: "0.6vh" }}
        >
          <div className="flex items-center gap-[0.7vw]">
            <div
              className={`${accentDot[accent]} rounded-full`}
              style={{ width: "0.55vw", height: "0.55vw" }}
            />
            <span
              className={`font-body ${accentText[accent]} font-semibold tracking-wider uppercase`}
              style={{ fontSize: "1vw" }}
            >
              {eyebrowText}
            </span>
          </div>
          {step != null && totalSteps != null && (
            <span
              className="font-body text-muted"
              style={{ fontSize: "0.95vw" }}
            >
              {String(step).padStart(2, "0")} / {String(totalSteps).padStart(2, "0")}
            </span>
          )}
        </div>
        <h2
          className="font-display text-primary font-bold tracking-tight"
          style={{ fontSize: "2.6vw", lineHeight: "1.1" }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            className="font-body text-muted"
            style={{ fontSize: "1.15vw", marginTop: "0.8vh" }}
          >
            {subtitle}
          </p>
        )}
        <div
          className="flex-1 flex min-h-0"
          style={{ marginTop: "2.5vh", gap: "2vw" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function Browser({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-white rounded-[0.7vw] border border-primary/15 overflow-hidden shadow-sm h-full flex flex-col">
      <div
        className="flex items-center gap-[0.6vw] bg-primary/5 border-b border-primary/10 shrink-0"
        style={{ padding: "0.7vh 0.8vw" }}
      >
        <div className="flex gap-[0.3vw]">
          <div
            className="rounded-full bg-orange/70"
            style={{ width: "0.6vw", height: "0.6vw" }}
          />
          <div
            className="rounded-full bg-primary/20"
            style={{ width: "0.6vw", height: "0.6vw" }}
          />
          <div
            className="rounded-full bg-primary/20"
            style={{ width: "0.6vw", height: "0.6vw" }}
          />
        </div>
        <div
          className="flex-1 bg-white rounded-[0.4vw] border border-primary/10 text-muted font-body text-center truncate"
          style={{ padding: "0.35vh 0.7vw", fontSize: "0.8vw" }}
        >
          cc.agapeny.app{url}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "review", label: "Review Queue" },
  { key: "queue", label: "Work Queue" },
  { key: "groups", label: "Invoice Groups" },
  { key: "claims", label: "All Claims" },
  { key: "portal", label: "Portal Submissions" },
  { key: "summary", label: "Summary" },
  { key: "errors", label: "Error Types" },
  { key: "settings", label: "Settings" },
];

export function AppSidebar({ active }: { active: string }) {
  return (
    <div className="bg-primary h-full shrink-0" style={{ width: "11vw" }}>
      <div
        className="flex items-center gap-[0.4vw] border-b border-white/10"
        style={{ padding: "1.4vh 1vw" }}
      >
        <div
          className="bg-orange rounded-[0.25vw]"
          style={{ width: "1.1vw", height: "1.1vw" }}
        />
        <span
          className="font-display text-white font-bold"
          style={{ fontSize: "0.9vw" }}
        >
          ClaimClear
        </span>
      </div>
      <div style={{ padding: "1vh 0" }}>
        {NAV_ITEMS.map((it) => {
          const isActive = active === it.key;
          return (
            <div
              key={it.key}
              className={`flex items-center ${
                isActive
                  ? "bg-white/10 text-white border-l-2 border-orange"
                  : "text-white/55 border-l-2 border-transparent"
              }`}
              style={{ padding: "0.65vh 1vw", fontSize: "0.78vw" }}
            >
              <span className="font-body">{it.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PILL: Record<string, string> = {
  amber: "bg-[#FEF3C7] text-[#92400E]",
  orange: "bg-[#FFE4DA] text-[#B23A1C]",
  violet: "bg-[#EDE9FE] text-[#6D28D9]",
  green: "bg-[#D1FAE5] text-[#065F46]",
  red: "bg-[#FEE2E2] text-[#991B1B]",
  muted: "bg-[#E5E9F0] text-[#4B5A75]",
  blue: "bg-[#DBEAFE] text-[#1D4ED8]",
};

export function StatusPill({
  label,
  kind,
  size = "sm",
}: {
  label: string;
  kind: keyof typeof PILL;
  size?: "sm" | "md";
}) {
  const fontSize = size === "md" ? "0.9vw" : "0.7vw";
  const padY = size === "md" ? "0.35vh" : "0.2vh";
  const padX = size === "md" ? "0.9vw" : "0.65vw";
  return (
    <span
      className={`inline-flex items-center font-body font-semibold rounded-full ${PILL[kind]}`}
      style={{ padding: `${padY} ${padX}`, fontSize }}
    >
      {label}
    </span>
  );
}

export function Callout({
  number,
  title,
  body,
  color = "accent",
}: {
  number: number | string;
  title: string;
  body: string;
  color?: CalloutColor;
}) {
  return (
    <div
      className="bg-white rounded-[0.7vw] border border-primary/10 flex gap-[0.9vw]"
      style={{ padding: "1.2vh 1vw" }}
    >
      <div
        className={`${calloutBg[color]} text-white font-display font-bold rounded-full flex items-center justify-center shrink-0`}
        style={{ width: "1.9vw", height: "1.9vw", fontSize: "1.05vw" }}
      >
        {number}
      </div>
      <div className="min-w-0">
        <p
          className="font-display text-primary font-semibold"
          style={{ fontSize: "1.05vw" }}
        >
          {title}
        </p>
        <p
          className="font-body text-muted"
          style={{ fontSize: "0.9vw", marginTop: "0.25vh", lineHeight: "1.45" }}
        >
          {body}
        </p>
      </div>
    </div>
  );
}

export function NumberBadge({
  n,
  color = "orange",
}: {
  n: number | string;
  color?: CalloutColor;
}) {
  return (
    <span
      className={`${calloutBg[color]} text-white font-display font-bold rounded-full inline-flex items-center justify-center`}
      style={{ width: "1.5vw", height: "1.5vw", fontSize: "0.85vw" }}
    >
      {n}
    </span>
  );
}

export function PageHeading({
  title,
  sub,
}: {
  title: string;
  sub?: string;
}) {
  return (
    <div>
      <p
        className="font-display text-primary font-bold"
        style={{ fontSize: "1.3vw" }}
      >
        {title}
      </p>
      {sub && (
        <p
          className="font-body text-muted"
          style={{ fontSize: "0.8vw", marginTop: "0.3vh" }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
