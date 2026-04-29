import type { ReactNode } from "react";
import type { PresenceViewer } from "@workspace/api-client-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function formatViewerNames(viewers: PresenceViewer[]): string {
  const names = viewers.map(v => v.userName || v.userEmail);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

/**
 * Wraps a state-changing action so that, when other viewers are present,
 * the explanatory tooltip appears on hover. The caller is responsible for
 * also passing `disabled` to the button itself (so the click handler does
 * not fire and other disabled conditions still apply); the Button
 * component renders its own dimmed style when disabled.
 *
 * The wrapping span deliberately KEEPS pointer events so Radix Tooltip
 * can detect hover/focus — disabled native buttons swallow these events,
 * but the surrounding span receives them.
 */
export function PresenceLockWrapper({
  reason,
  children,
  className,
}: {
  reason: string | null;
  children: ReactNode;
  className?: string;
}) {
  if (!reason) {
    return <>{children}</>;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={`inline-flex ${className ?? ""}`.trim()}
            data-presence-locked="true"
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
