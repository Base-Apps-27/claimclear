// Single source of truth for every date/time render in the operator app.
//
// Why this module exists: until #562 the same record displayed a different
// day on Dashboard, list, detail and chart because each surface called a
// different formatter — `formatDate` cast bare `YYYY-MM-DD` to local
// midnight, `formatDateTime` parsed ISO instants in browser TZ, the
// Insights chart axes forced UTC, and the server's "today" math used the
// host TZ. Each helper was correct in isolation; together they produced
// drift. This module routes every render through one display timezone
// so day-boundary bugs can't reappear surface-by-surface.
//
// Configured by `VITE_DISPLAY_TIMEZONE` (default `America/New_York` —
// the dispatch operations TZ). Service-date strings (`YYYY-MM-DD`) are
// rendered as the authored calendar day, never converted; absolute
// timestamps are rendered in the chosen display timezone.

import { parseISO } from "date-fns";

const FALLBACK_TZ = "America/New_York";

/**
 * Short label for the active display TZ (e.g. "ET", "PT"). Falls back
 * to the IANA name when the zone isn't one of the common US zones —
 * that way UI copy that interpolates "{tzShort()}" can never lie about
 * the active zone if the deployment overrides `DISPLAY_TIMEZONE` (#562).
 */
export function getDisplayTimezoneShort(): string {
  const tz = getDisplayTimezone();
  switch (tz) {
    case "America/New_York": return "ET";
    case "America/Los_Angeles": return "PT";
    case "America/Chicago": return "CT";
    case "America/Denver": return "MT";
    default: return tz;
  }
}

// Compile-time constant injected by `vite.config.ts` via `define`.
// Declared on the global scope so esbuild/Rollup can perform the
// substitution unambiguously (a bare identifier, not a property access
// that could be optional-chained away). Falls back to `undefined` when
// running under node (tests) — `getDisplayTimezone()` then uses
// `process.env.DISPLAY_TIMEZONE` so client and server defaults stay in
// lockstep on a single env var (#562).
declare const __DISPLAY_TIMEZONE__: string | undefined;

export function getDisplayTimezone(): string {
  // Vite replaces `__DISPLAY_TIMEZONE__` with the compile-time literal,
  // so the client bundle always sees the value chosen at build time
  // from either `VITE_DISPLAY_TIMEZONE` (explicit client override) or
  // the unified `DISPLAY_TIMEZONE` deployment env. Wrapped in a safe
  // probe so node test runners (where the constant is undeclared)
  // don't ReferenceError; they fall through to `process.env`.
  let buildTz: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buildTz = typeof __DISPLAY_TIMEZONE__ !== "undefined" ? __DISPLAY_TIMEZONE__ : undefined;
  } catch {
    buildTz = undefined;
  }
  if (buildTz) return buildTz;
  // Node fallback (tests, SSR-style helpers): read the same env var the
  // server uses so a single `DISPLAY_TIMEZONE` value drives both sides.
  if (typeof process !== "undefined" && process.env) {
    const envTz = process.env.VITE_DISPLAY_TIMEZONE || process.env.DISPLAY_TIMEZONE;
    if (envTz) return envTz;
  }
  return FALLBACK_TZ;
}

// `Intl.DateTimeFormat` is reused per (tz, options) shape — building one
// per render shows up in flame graphs once tables get long.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function getFmt(opts: Intl.DateTimeFormatOptions, tz: string): Intl.DateTimeFormat {
  const key = `${tz}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz });
    fmtCache.set(key, f);
  }
  return f;
}

// `YYYY-MM-DD` (calendar day) vs full ISO timestamp routing. Calendar
// days are rendered as the authored day with no TZ conversion at all —
// a service-date stored as "2026-04-06" must render as "Apr 6, 2026"
// in every timezone, every browser. Full timestamps are rendered in
// the chosen display TZ so audit/email-receipt times line up across
// surfaces.
function isCalendarOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseCalendarDayUtc(s: string): Date {
  // Anchor calendar-only inputs at UTC midnight, then format in UTC so
  // the displayed day is exactly the input day regardless of the
  // display TZ. (Calendar days have no instant — the convention is to
  // render the authored day.)
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Render a date for human display. Accepts either a bare `YYYY-MM-DD`
 * calendar day (rendered as the authored day, no conversion) or a full
 * ISO timestamp (rendered as the wall-clock day in the display TZ).
 */
export function formatDate(input: string | null | undefined): string {
  if (!input) return "N/A";
  try {
    const tz = getDisplayTimezone();
    if (isCalendarOnly(input)) {
      return getFmt({ year: "numeric", month: "short", day: "numeric" }, "UTC")
        .format(parseCalendarDayUtc(input));
    }
    return getFmt({ year: "numeric", month: "short", day: "numeric" }, tz)
      .format(parseISO(input));
  } catch {
    return input;
  }
}

/**
 * Compact, year-less date for tight row chrome (e.g. the Responses
 * Awaiting Review row leg-meta line). Renders as `APR 24` for a bare
 * `YYYY-MM-DD` input or as `APR 24` (display-TZ wall day) for an ISO
 * timestamp. Falls back to the raw input on parse failure.
 */
export function formatDateCompact(input: string | null | undefined): string {
  if (!input) return "N/A";
  try {
    const tz = getDisplayTimezone();
    const fmt = isCalendarOnly(input)
      ? getFmt({ month: "short", day: "numeric" }, "UTC")
          .format(parseCalendarDayUtc(input))
      : getFmt({ month: "short", day: "numeric" }, tz)
          .format(parseISO(input));
    // "Apr 24" -> "APR 24"; locale separators (e.g. "24 avr.") are
    // upper-cased verbatim.
    return fmt.toUpperCase();
  } catch {
    return input;
  }
}

/**
 * Render a date+time for human display. Calendar-only inputs render
 * "Apr 6, 2026 12:00 AM" in UTC (preserving the day). ISO timestamps
 * render in the display TZ.
 */
export function formatDateTime(input: string | null | undefined): string {
  if (!input) return "N/A";
  try {
    const tz = getDisplayTimezone();
    const opts: Intl.DateTimeFormatOptions = {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    };
    if (isCalendarOnly(input)) {
      return getFmt(opts, "UTC").format(parseCalendarDayUtc(input));
    }
    return getFmt(opts, tz).format(parseISO(input));
  } catch {
    return input;
  }
}

/**
 * Wall-clock time in the display TZ ("3:42 PM"). Used by the batch
 * pill and any "next firing at" affordance.
 */
export function formatTime(input: string | null | undefined): string {
  if (!input) return "—";
  try {
    return getFmt({ hour: "numeric", minute: "2-digit" }, getDisplayTimezone())
      .format(parseISO(input));
  } catch {
    return input ?? "—";
  }
}

/**
 * "Mon", "Tue" etc. Calendar-only `YYYY-MM-DD` inputs render the
 * authored day (anchored at UTC, formatted in UTC) so the weekday
 * always matches the day stored on the wire — same authored-day
 * contract as `formatDate` (#562). Full ISO timestamps render in the
 * display TZ.
 */
export function formatWeekday(input: string): string {
  if (isCalendarOnly(input)) {
    return getFmt({ weekday: "short" }, "UTC").format(parseCalendarDayUtc(input));
  }
  return getFmt({ weekday: "short" }, getDisplayTimezone()).format(parseISO(input));
}

/** Calendar-day key (YYYY-MM-DD) in the display TZ for an ISO instant. */
export function dayKeyInDisplayTz(input: string | Date): string {
  const d = typeof input === "string" ? parseISO(input) : input;
  // en-CA happens to format YYYY-MM-DD natively.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getDisplayTimezone(),
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/**
 * Compact relative-time string ("just now", "3m ago", "2d ago"). For
 * anything older than a week falls back to a display-TZ short date.
 */
export function formatRelative(input: string | null | undefined, now: number = Date.now()): string {
  if (!input) return "";
  const then = new Date(input).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return formatDate(input);
}

/**
 * Tick label for time-series charts ("Apr 6"). Accepts either a
 * calendar-day key (rendered without conversion) or a full ISO
 * timestamp (rendered in the display TZ).
 */
export function formatChartTick(input: string): string {
  try {
    if (isCalendarOnly(input)) {
      return getFmt({ month: "short", day: "numeric" }, "UTC")
        .format(parseCalendarDayUtc(input));
    }
    return getFmt({ month: "short", day: "numeric" }, getDisplayTimezone())
      .format(parseISO(input));
  } catch {
    return input;
  }
}

/**
 * Server-clock "now" rendered in the display TZ as a calendar key
 * (YYYY-MM-DD). Mirror of `serverTodayKey` in the API server's
 * `lib/dates.ts` so the client and server agree on what "today" is.
 */
export function serverNowInDisplayTz(now: Date = new Date()): string {
  return dayKeyInDisplayTz(now);
}

/** Absolute-time tooltip text for a relative-time render. */
export function absoluteTooltip(input: string | null | undefined): string {
  if (!input) return "";
  try {
    return `${formatDateTime(input)} (${getDisplayTimezone()})`;
  } catch {
    return input ?? "";
  }
}
