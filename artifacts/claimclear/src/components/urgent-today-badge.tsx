import { AlertTriangle } from "lucide-react";

interface UrgentTodayBadgeProps {
  isUrgent: boolean | undefined | null;
  size?: "sm" | "md";
  className?: string;
}

export function UrgentTodayBadge({ isUrgent, size = "sm", className = "" }: UrgentTodayBadgeProps) {
  if (!isUrgent) return null;
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      data-testid="badge-urgent-today"
      className={`inline-flex items-center gap-1 rounded font-semibold uppercase tracking-wide whitespace-nowrap ${padding} ${className}`}
      style={{
        background: "hsl(var(--destructive))",
        color: "white",
      }}
      title="Must file today — cannot wait until tomorrow"
    >
      <AlertTriangle className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
      Today
    </span>
  );
}
