import { useState, type ReactNode } from "react";
import { Filter as FilterIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// The Faceted Rail is the canonical advanced-filter shell for ClaimClear
// list pages. See docs/architecture/filter-pattern.md for anatomy, behavior
// rules, and a recipe for adding new categories.
export type FacetedFilterCategory = {
  id: string;
  label: string;
  icon: LucideIcon;
  appliedCount: number;
  // Right-pane content for the active category. Page owns the controls and
  // the URL-param plumbing; the shell only handles category switching, the
  // applied-count badges, and the open/close + clear/done footer chrome.
  render: () => ReactNode;
};

export type FacetedFilterProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: FacetedFilterCategory[];
  totalApplied: number;
  onClearAll: () => void;
  // Override the trigger label/test id when needed; defaults match the mockup.
  triggerLabel?: string;
  triggerTestId?: string;
  // Default category when the popover opens. Falls back to the first category
  // with applied filters, then the first category in the list.
  initialCategoryId?: string;
};

export function FacetedFilter({
  open,
  onOpenChange,
  categories,
  totalApplied,
  onClearAll,
  triggerLabel = "Filter",
  triggerTestId = "button-open-filters",
  initialCategoryId,
}: FacetedFilterProps) {
  const fallbackCategoryId =
    initialCategoryId ??
    categories.find(c => c.appliedCount > 0)?.id ??
    categories[0]?.id ??
    "";
  const [activeId, setActiveId] = useState<string>(fallbackCategoryId);

  const active =
    categories.find(c => c.id === activeId) ?? categories[0];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-2",
            totalApplied > 0 && "border-primary/40 bg-primary/5",
          )}
          data-testid={triggerTestId}
        >
          <FilterIcon className="h-4 w-4" />
          {triggerLabel}
          {totalApplied > 0 && (
            <span
              className="ml-1 inline-flex items-center justify-center min-w-5 h-5 rounded-full text-[10px] font-bold bg-primary text-primary-foreground px-1.5"
              data-testid="faceted-filter-total-badge"
            >
              {totalApplied}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[640px] p-0 shadow-lg"
        align="end"
        sideOffset={8}
        data-testid="faceted-filter-popover"
      >
        <div className="flex h-[420px] overflow-hidden">
          {/* Left rail: filter categories */}
          <div className="w-[180px] bg-muted/30 border-r flex flex-col">
            <div className="p-3 border-b">
              <h3 className="text-sm font-semibold">Filters</h3>
            </div>
            <ScrollArea className="flex-1">
              <nav
                className="p-2 space-y-1"
                role="tablist"
                aria-label="Filter categories"
              >
                {categories.map(category => {
                  const isActive = active?.id === category.id;
                  const Icon = category.icon;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveId(category.id)}
                      data-testid={`faceted-filter-category-${category.id}`}
                      className={cn(
                        "w-full flex items-center justify-between px-2.5 py-2 text-sm rounded-md transition-colors text-left",
                        isActive
                          ? "bg-background shadow-sm border font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/80 hover:text-foreground border border-transparent",
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon
                          className={cn(
                            "h-4 w-4",
                            isActive
                              ? "text-primary"
                              : "text-muted-foreground/70",
                          )}
                        />
                        <span>{category.label}</span>
                      </span>
                      {category.appliedCount > 0 && (
                        <span
                          className={cn(
                            "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-primary/10 text-primary",
                          )}
                          data-testid={`faceted-filter-category-count-${category.id}`}
                        >
                          {category.appliedCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </ScrollArea>
          </div>

          {/* Right pane: active category's controls */}
          <div className="flex-1 bg-background flex flex-col min-w-0">
            {active?.render()}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t bg-muted/10">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="text-muted-foreground hover:text-foreground"
            data-testid="faceted-filter-clear-all"
          >
            Clear all
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2" data-testid="faceted-filter-applied-count">
              {totalApplied} applied
            </span>
            <Button
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="faceted-filter-done"
            >
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
