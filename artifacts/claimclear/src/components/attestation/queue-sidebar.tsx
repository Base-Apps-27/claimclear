import type { ReactNode } from "react";
import { Section } from "@/components/cohesion";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface QueueSidebarProps {
  title: string;
  count: number;
  listTestId: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Shared sidebar primitive for both Open and Completed tabs of the
 * Attestation page. Wraps the list in a `Section` with a count badge
 * in the header bar, then renders the rows inside a scroll area so
 * long queues don't stretch the page.
 */
export function QueueSidebar({
  title,
  count,
  listTestId,
  footer,
  children,
  className,
}: QueueSidebarProps) {
  return (
    <Section
      title={title}
      action={
        <Badge
          variant="outline"
          className="text-[10px] uppercase tracking-wide font-bold"
        >
          {count}
        </Badge>
      }
      padded={false}
      className={cn("lg:sticky lg:top-4", className)}
    >
      <ScrollArea className="h-[calc(100vh-260px)] max-h-[640px]">
        <ul className="divide-y divide-border" data-testid={listTestId}>
          {children}
        </ul>
      </ScrollArea>
      {footer}
    </Section>
  );
}
