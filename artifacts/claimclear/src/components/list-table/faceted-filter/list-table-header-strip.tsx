import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FacetedFilter, type FacetedFilterCategory } from "./faceted-filter";
import { DimWhileOpen } from "./dim-while-open";

// Standard header strip for list pages that use the Faceted Rail.
// Renders search input + "N matching" count on the left, and the Filter
// trigger (with total applied-count badge) on the right. Pages drop in any
// page-specific buttons (density toggle, columns menu, CSV export, etc.) via
// the `extras` slot — they sit between the matching-count line and the
// Filter trigger so the filter button stays at the strip's far edge, matching
// the mockup. Children are wrapped in DimWhileOpen so the table behind the
// popover automatically de-emphasizes while filtering is active.
export type ListTableHeaderStripProps = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchTestId?: string;

  matchingCount: number;
  matchingNoun: { one: string; other: string };
  // Optional override of the trailing word ("matching"). Some pages prefer
  // "found" or a domain-specific verb.
  matchingVerb?: string;

  filterOpen: boolean;
  onFilterOpenChange: (open: boolean) => void;
  filterCategories: FacetedFilterCategory[];
  totalApplied: number;
  onClearAllFilters: () => void;
  initialCategoryId?: string;

  extras?: ReactNode;
  children: ReactNode;
};

export function ListTableHeaderStrip({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchTestId,
  matchingCount,
  matchingNoun,
  matchingVerb = "matching",
  filterOpen,
  onFilterOpenChange,
  filterCategories,
  totalApplied,
  onClearAllFilters,
  initialCategoryId,
  extras,
  children,
}: ListTableHeaderStripProps) {
  const noun = matchingCount === 1 ? matchingNoun.one : matchingNoun.other;

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-3 bg-card border rounded-md p-2.5"
        data-testid="list-table-header-strip"
      >
        <div className="relative w-72 flex-shrink-0">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            className="pl-9 pr-8 h-9"
            value={searchValue}
            onChange={e => onSearchChange(e.target.value)}
            data-testid={searchTestId}
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <span
          className="text-sm text-muted-foreground font-medium tabular-nums"
          data-testid="list-table-matching-count"
        >
          {matchingCount.toLocaleString()} {noun} {matchingVerb}
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {extras}
          <FacetedFilter
            open={filterOpen}
            onOpenChange={onFilterOpenChange}
            categories={filterCategories}
            totalApplied={totalApplied}
            onClearAll={onClearAllFilters}
            initialCategoryId={initialCategoryId}
          />
        </div>
      </div>

      <DimWhileOpen open={filterOpen}>{children}</DimWhileOpen>
    </div>
  );
}
