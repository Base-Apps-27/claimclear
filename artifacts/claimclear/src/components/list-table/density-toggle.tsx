import { AlignJustify, AlignLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type Density = "comfortable" | "compact";

interface DensityToggleProps {
  density: Density;
  onToggle: () => void;
}

export function DensityToggle({ density, onToggle }: DensityToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" onClick={onToggle} className="px-2.5">
          {density === "comfortable" ? (
            <AlignJustify className="h-4 w-4" />
          ) : (
            <AlignLeft className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {density === "comfortable" ? "Switch to compact view" : "Switch to comfortable view"}
      </TooltipContent>
    </Tooltip>
  );
}
