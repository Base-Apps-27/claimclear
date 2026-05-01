import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FacetCheckboxListItem = {
  id: string;
  label: string;
  italic?: boolean;
  hint?: string;
};

export type FacetCheckboxListProps = {
  heading?: ReactNode;
  options: FacetCheckboxListItem[];
  selected: string[];
  onToggle: (id: string, next: boolean) => void;
  testIdPrefix?: string;
  // For radio-style "at most one" categories like Filing Deadline that
  // already use a single string in the URL.
  exclusive?: boolean;
  hint?: ReactNode;
};

export function FacetCheckboxList({
  heading,
  options,
  selected,
  onToggle,
  testIdPrefix,
  exclusive = false,
  hint,
}: FacetCheckboxListProps) {
  return (
    <div className="flex flex-col h-full">
      {heading && (
        <div className="p-4 border-b shrink-0">
          <h4 className="text-sm font-medium">{heading}</h4>
        </div>
      )}
      <div className="p-3 space-y-3 overflow-auto">
        {options.map(opt => {
          const id = testIdPrefix
            ? `${testIdPrefix}-${opt.id}`
            : `facet-${opt.id}`;
          const isChecked = selected.includes(opt.id);
          return (
            <div key={opt.id} className="flex items-start space-x-3">
              <Checkbox
                id={id}
                checked={isChecked}
                onCheckedChange={checked => {
                  const next = Boolean(checked);
                  if (exclusive && next) {
                    // Clear any previously-selected exclusive value first so
                    // the URL param ends up holding exactly one value.
                    selected
                      .filter(s => s !== opt.id)
                      .forEach(s => onToggle(s, false));
                  }
                  onToggle(opt.id, next);
                }}
                data-testid={id}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label
                  htmlFor={id}
                  className={cn(
                    "text-sm font-medium leading-none cursor-pointer block",
                    opt.italic && "italic text-muted-foreground",
                  )}
                >
                  {opt.label}
                </Label>
                {opt.hint && (
                  <p className="text-xs text-muted-foreground">{opt.hint}</p>
                )}
              </div>
            </div>
          );
        })}
        {hint && <p className="text-xs text-muted-foreground pt-1">{hint}</p>}
      </div>
    </div>
  );
}
