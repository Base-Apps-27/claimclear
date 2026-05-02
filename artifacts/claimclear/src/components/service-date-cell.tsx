// Replaces the bare em-dash that the Invoice Groups list and group
// detail used to render whenever `service_date` was null. Drives the
// labeled empty state introduced in Task #353.
//
// The contract is the `serviceDateReason` enum the server attaches to
// every list row + the detail payload (see
// `lib/api-spec/openapi.yaml` and `lib/group-no-date-reason.ts`):
//
//   has_date                → render the formatted date
//   no_claims               → "No claims attached"  → /import
//   no_dated_claims         → "No dated claims"     → group detail
//   parse_failed            → "Couldn't read dates" → group detail
//   all_dated_legs_excluded → "All dated legs excluded" → group detail
//
// Two render variants:
//   • <ServiceDateCell />        — compact, fits inside a table cell
//   • <ServiceDateBanner />      — header-strip variant for the detail
//                                  page; same label + link, more
//                                  breathing room and an inline icon.

import * as React from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  CalendarOff,
  FileQuestion,
  FilterX,
  Inbox,
} from "lucide-react";
import { formatDate } from "@/lib/format";

export type ServiceDateReason =
  | "has_date"
  | "no_claims"
  | "no_dated_claims"
  | "parse_failed"
  | "all_dated_legs_excluded";

export interface ServiceDateCellProps {
  /**
   * The group's earliest service date (ISO YYYY-MM-DD) or null. When
   * `reason === 'has_date'` this is rendered via `formatDate`.
   */
  earliestDate: string | null | undefined;
  /**
   * Reason classifier. Falls back to `no_claims`-style language if
   * unknown so the UI never renders the bare dash again.
   */
  reason: ServiceDateReason | null | undefined;
  /**
   * The group id is used to build the action link target on every
   * empty-state branch except `no_claims` (which always points at the
   * importer).
   */
  groupId: number;
  /** True when the group's filing deadline is today/past (urgency styling). */
  isUrgent?: boolean;
  /** Compact (table) renders smaller; falls through to default otherwise. */
  className?: string;
  /** Test-id prefix applied to the wrapper for e2e selectors. */
  testIdPrefix?: string;
}

interface ReasonMeta {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: (groupId: number) => string;
  linkLabel: string;
}

// Static mapping kept on this module so unit tests can assert against
// it without re-mounting React. Each entry is intentionally short —
// the list cell is narrow, and the longer prose lives in the detail
// banner via the `description` prop on `<ServiceDateBanner />`.
export const SERVICE_DATE_REASON_META: Record<
  Exclude<ServiceDateReason, "has_date">,
  ReasonMeta
> = {
  no_claims: {
    Icon: Inbox,
    label: "No claims attached",
    href: () => "/import",
    linkLabel: "Import claims",
  },
  no_dated_claims: {
    Icon: CalendarOff,
    label: "No dated claims",
    href: (id) => `/invoice-groups/${id}`,
    linkLabel: "Open group",
  },
  parse_failed: {
    Icon: FileQuestion,
    label: "Couldn't read claim dates",
    href: (id) => `/invoice-groups/${id}`,
    linkLabel: "Open group",
  },
  all_dated_legs_excluded: {
    Icon: FilterX,
    label: "All dated legs excluded",
    href: (id) => `/invoice-groups/${id}`,
    linkLabel: "Review legs",
  },
};

function resolveReason(
  reason: ServiceDateReason | null | undefined,
  earliestDate: string | null | undefined,
): ServiceDateReason {
  if (reason === "has_date") return "has_date";
  if (
    reason === "no_claims" ||
    reason === "no_dated_claims" ||
    reason === "parse_failed" ||
    reason === "all_dated_legs_excluded"
  ) {
    return reason;
  }
  // Defensive defaults for callers that pre-date the server contract:
  // if we have a date string just render it, otherwise mirror the most
  // common empty-state branch the typed-DATE world produces.
  return earliestDate ? "has_date" : "no_dated_claims";
}

export function ServiceDateCell({
  earliestDate,
  reason,
  groupId,
  isUrgent,
  className,
  testIdPrefix = "service-date-cell",
}: ServiceDateCellProps) {
  const r = resolveReason(reason, earliestDate);
  if (r === "has_date") {
    return (
      <span
        className={[
          "whitespace-nowrap tabular-nums text-xs",
          isUrgent ? "font-semibold text-foreground" : "text-muted-foreground",
          className ?? "",
        ].join(" ").trim()}
        data-testid={`${testIdPrefix}-${groupId}`}
        data-reason="has_date"
      >
        {earliestDate ? formatDate(earliestDate) : "—"}
      </span>
    );
  }

  const meta = SERVICE_DATE_REASON_META[r];
  const Icon = meta.Icon;
  return (
    <Link
      href={meta.href(groupId)}
      className={[
        "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors",
        className ?? "",
      ].join(" ").trim()}
      data-testid={`${testIdPrefix}-${groupId}`}
      data-reason={r}
      title={`${meta.label} — ${meta.linkLabel}`}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span className="italic">{meta.label}</span>
    </Link>
  );
}

export interface ServiceDateBannerProps
  extends Omit<ServiceDateCellProps, "className" | "testIdPrefix"> {
  className?: string;
  testIdPrefix?: string;
}

export function ServiceDateBanner({
  earliestDate,
  reason,
  groupId,
  isUrgent,
  className,
  testIdPrefix = "service-date-banner",
}: ServiceDateBannerProps) {
  const r = resolveReason(reason, earliestDate);
  if (r === "has_date") {
    return (
      <span
        className={[
          "inline-flex items-center gap-1 text-xs",
          isUrgent ? "font-semibold text-foreground" : "text-muted-foreground",
          className ?? "",
        ].join(" ").trim()}
        data-testid={`${testIdPrefix}-${groupId}`}
        data-reason="has_date"
      >
        Service date{" "}
        <span className="font-medium tabular-nums text-foreground">
          {earliestDate ? formatDate(earliestDate) : "—"}
        </span>
      </span>
    );
  }

  const meta = SERVICE_DATE_REASON_META[r];
  const Icon = meta.Icon;
  return (
    <Link
      href={meta.href(groupId)}
      className={[
        "inline-flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-900 transition-colors",
        className ?? "",
      ].join(" ").trim()}
      data-testid={`${testIdPrefix}-${groupId}`}
      data-reason={r}
    >
      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="font-medium">{meta.label}</span>
      <span className="text-muted-foreground">·</span>
      <span className="underline-offset-2 hover:underline">{meta.linkLabel}</span>
    </Link>
  );
}
