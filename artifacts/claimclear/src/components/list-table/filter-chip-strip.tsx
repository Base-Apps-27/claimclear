import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface FilterChipStripProps {
  chips: FilterChip[];
  onClearAll: () => void;
}

export function FilterChipStrip({ chips, onClearAll }: FilterChipStripProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 bg-muted/30 border-b">
      {chips.map(chip => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium px-2.5 py-0.5"
        >
          {chip.label}
          <button
            onClick={chip.onRemove}
            className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5 transition-colors"
            aria-label={`Remove ${chip.label} filter`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="text-xs text-muted-foreground h-6 px-2 hover:text-foreground"
      >
        Clear all
      </Button>
    </div>
  );
}
