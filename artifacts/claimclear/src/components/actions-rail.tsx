import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WrapTooltip } from "@/components/info-tooltip";

export type ActionsRailProps = {
  title: string;
  meta?: ReactNode;
  variant?: "claim" | "group";
  children: ReactNode;
  className?: string;
};

const RAIL_STYLES = {
  claim: {
    border: "border-border",
    headerBg: "bg-muted",
    headerFg: "text-foreground",
  },
  group: {
    border: "border-purple-200 dark:border-purple-900",
    headerBg: "bg-purple-50 dark:bg-purple-950/30",
    headerFg: "text-purple-700 dark:text-purple-300",
  },
} as const;

export function ActionsRail({ title, meta, variant = "claim", children, className }: ActionsRailProps) {
  const styles = RAIL_STYLES[variant];
  return (
    <div
      className={cn("rounded-md border bg-card overflow-hidden", styles.border, className)}
      data-testid="actions-rail"
    >
      <div
        className={cn(
          "px-4 py-3 text-sm font-semibold flex items-center justify-between border-b",
          styles.border,
          styles.headerBg,
          styles.headerFg,
        )}
      >
        <span>{title}</span>
        {meta && <span className="text-xs font-normal opacity-75">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

export type ActionsRailRecommendedProps = {
  variant?: "claim" | "group";
  label: string;
  children: ReactNode;
  description?: ReactNode;
};

export function ActionsRailRecommended({
  variant = "claim",
  label,
  children,
  description,
}: ActionsRailRecommendedProps) {
  const accent =
    variant === "group"
      ? "bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300"
      : "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300";
  return (
    <div className={cn("p-4", accent)} data-testid="actions-rail-recommended">
      <div className="text-xs uppercase font-semibold mb-2">{label}</div>
      {children}
      {description && <div className="text-xs mt-2 opacity-85">{description}</div>}
    </div>
  );
}

export type ActionGroupProps = {
  label: string;
  children: ReactNode;
};

export function ActionGroup({ label, children }: ActionGroupProps) {
  return (
    <div className="px-2 py-2 border-t border-border" data-testid={`action-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export type ActionRowProps = {
  icon?: ReactNode;
  label: string;
  sub?: ReactNode;
  /** Disabled state. When set together with `disabledReason`, an explanatory tooltip is shown. */
  disabled?: boolean;
  /** Tooltip content shown when the row is disabled (or when given without disabled, on hover). */
  disabledReason?: string;
  /** Visual treatments for special states. */
  muted?: boolean;
  warn?: boolean;
  selected?: boolean;
  onClick?: () => void;
  testId?: string;
};

const ActionRowButton = forwardRef<HTMLButtonElement, ActionRowProps>(function ActionRowButton(
  { icon, label, sub, disabled, muted, warn, selected, onClick, testId },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected ? true : undefined}
      data-testid={testId}
      className={cn(
        "w-full text-left px-2.5 py-1.5 rounded-sm transition-colors flex items-start gap-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "hover:bg-muted",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent",
        selected && "bg-accent",
        warn && "bg-amber-50 dark:bg-amber-950/30",
      )}
    >
      {icon && (
        <div
          className={cn(
            "mt-0.5 flex-shrink-0",
            warn
              ? "text-amber-700 dark:text-amber-300"
              : muted
                ? "text-muted-foreground"
                : "text-foreground",
          )}
        >
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "text-sm",
            warn
              ? "text-amber-700 dark:text-amber-300 font-medium"
              : muted
                ? "text-muted-foreground"
                : "text-foreground",
          )}
        >
          {label}
        </div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
    </button>
  );
});

export function ActionRow(props: ActionRowProps) {
  if (!props.disabledReason) {
    return <ActionRowButton {...props} />;
  }
  // Disabled native buttons swallow pointer/focus events, so Radix Tooltip
  // can't trigger when attached directly. Wrap in a focusable span when
  // disabled so the tooltip still fires on hover and keyboard focus.
  if (props.disabled) {
    return (
      <WrapTooltip content={props.disabledReason}>
        <span
          tabIndex={0}
          aria-disabled="true"
          className="block w-full rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ActionRowButton {...props} />
        </span>
      </WrapTooltip>
    );
  }
  return (
    <WrapTooltip content={props.disabledReason}>
      <ActionRowButton {...props} />
    </WrapTooltip>
  );
}
