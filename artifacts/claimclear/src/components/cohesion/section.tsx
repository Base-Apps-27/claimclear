import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionProps = {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
};

export function Section({ title, icon, action, children, padded = true, className }: SectionProps) {
  return (
    <div className={cn("rounded-md border border-border bg-card overflow-hidden", className)}>
      {(title || action) && (
        <div className="px-4 py-3 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {icon}
            {title}
          </div>
          {action}
        </div>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </div>
  );
}
