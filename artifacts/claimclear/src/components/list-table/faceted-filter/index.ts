// Faceted Rail — the canonical advanced-filter shell for ClaimClear list
// pages. See docs/architecture/filter-pattern.md for full anatomy, behavior
// rules, supported right-pane control types, accessibility notes, and a
// "how to add a new category" recipe.
export {
  FacetedFilter,
  type FacetedFilterCategory,
  type FacetedFilterProps,
} from "./faceted-filter";
export {
  FacetSearchableCheckboxList,
  type FacetSearchableCheckboxListProps,
  type FacetOption,
} from "./facet-searchable-checkbox-list";
export {
  FacetCheckboxList,
  type FacetCheckboxListItem,
  type FacetCheckboxListProps,
} from "./facet-checkbox-list";
export {
  FacetDateRange,
  type FacetDateRangeProps,
  type FacetDateRangeValue,
  type FacetDatePreset,
} from "./facet-date-range";
export {
  FacetNumericRange,
  type FacetNumericRangeProps,
  type FacetNumericRangeValue,
} from "./facet-numeric-range";
export { DimWhileOpen } from "./dim-while-open";
export {
  ListTableHeaderStrip,
  type ListTableHeaderStripProps,
} from "./list-table-header-strip";
