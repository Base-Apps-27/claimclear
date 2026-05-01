import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Visually de-emphasize the wrapped content (typically the table card) while
// the Faceted Rail popover is open, mirroring the mockup's affordance. We
// keep the table interactive so callers don't lose scroll position; the
// dim is purely a visual cue that focus has moved into the filter shell.
export function DimWhileOpen({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "transition-opacity duration-200",
        open ? "opacity-50" : "opacity-100",
        className,
      )}
      aria-hidden={open ? true : undefined}
      data-dimmed={open ? "true" : "false"}
    >
      {children}
    </div>
  );
}
