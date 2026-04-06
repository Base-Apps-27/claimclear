import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface InfoTooltipProps {
  content: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  iconClassName?: string;
  children?: React.ReactNode;
}

export function InfoTooltip({ content, side = "top", className, iconClassName, children }: InfoTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children || (
          <span className={`inline-flex items-center cursor-help ${className || ""}`}>
            <HelpCircle className={`h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground ${iconClassName || ""}`} />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs text-xs leading-relaxed">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

export function WrapTooltip({ content, side = "top", children }: { content: string; side?: "top" | "right" | "bottom" | "left"; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs text-xs leading-relaxed">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
