import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type FacetOption = {
  id: string;
  label: string;
  // Italicize and mute the label (used for "Unassigned" sentinel rows).
  italic?: boolean;
};

export type FacetSearchableCheckboxListProps = {
  options: FacetOption[];
  selected: string[];
  onToggle: (id: string, next: boolean) => void;
  placeholder?: string;
  // When true, selected options float to the top once the popover opens.
  // Useful for long lists (Error Type, Status) so applied filters don't
  // scroll out of view.
  pinSelected?: boolean;
  emptyMessage?: string;
  testIdPrefix?: string;
};

export function FacetSearchableCheckboxList({
  options,
  selected,
  onToggle,
  placeholder = "Filter options...",
  pinSelected = false,
  emptyMessage = "No results found.",
  testIdPrefix,
}: FacetSearchableCheckboxListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? options.filter(o => o.label.toLowerCase().includes(q))
      : options;
    if (!pinSelected) return matched;
    const sel = matched.filter(o => selected.includes(o.id));
    const rest = matched.filter(o => !selected.includes(o.id));
    return [...sel, ...rest];
  }, [options, query, pinSelected, selected]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b sticky top-0 bg-popover z-10 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={placeholder}
            className="pl-9 h-9"
            value={query}
            onChange={e => setQuery(e.target.value)}
            data-testid={testIdPrefix ? `${testIdPrefix}-search` : undefined}
            aria-label={placeholder}
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              {emptyMessage}
            </div>
          ) : (
            filtered.map(opt => {
              const id = testIdPrefix
                ? `${testIdPrefix}-${opt.id}`
                : `facet-${opt.id}`;
              const isChecked = selected.includes(opt.id);
              return (
                <div key={opt.id} className="flex items-center space-x-3">
                  <Checkbox
                    id={id}
                    checked={isChecked}
                    onCheckedChange={checked =>
                      onToggle(opt.id, Boolean(checked))
                    }
                    data-testid={id}
                  />
                  <Label
                    htmlFor={id}
                    className={cn(
                      "text-sm font-medium leading-none cursor-pointer",
                      opt.italic && "italic text-muted-foreground",
                    )}
                  >
                    {opt.label}
                  </Label>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
