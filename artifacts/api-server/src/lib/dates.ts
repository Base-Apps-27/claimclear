// Deadline / "today" math, anchored to America/New_York.
//
// The team operates from a single ET-based office, so every "today",
// "30-day filing window", and "is this urgent?" decision must use the
// ET calendar — not the host's wall clock and not UTC. Earlier versions
// of this module relied on `setHours(0,0,0,0)` and `getDate()` against a
// `Date`, which silently followed the host's `TZ` env var. In autoscaled
// containers that defaults to UTC, which made an item with a Friday-ET
// deadline flip to "urgent" up to five hours late and made the
// urgent-snapshot key swap days at the wrong moment. See Task #298.
//
// All math is performed on YYYY-MM-DD calendar strings, with day-of-week
// computed from a UTC anchor — that way DST transitions never produce a
// 23h or 25h day for our purposes (the office's "Friday" is still
// "Friday" on the spring-forward Sunday, and the cron's idea of "today"
// stays stable across the boundary).

const DEFAULT_TZ = "America/New_York";
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Render a Date as a YYYY-MM-DD calendar key in the given IANA timezone.
 * Uses Intl so it never depends on the process TZ env var.
 */
export function dateKeyInTz(date: Date, tz: string = DEFAULT_TZ): string {
  // en-CA happens to format as YYYY-MM-DD natively, so we avoid the
  // locale-specific reordering en-US would do.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

function parseYMD(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

/**
 * True when `s` looks like a valid YYYY-MM-DD prefix. Production data
 * has historically included empty strings, partial dates, and other
 * malformed entries that cause `addDaysToYMD` to throw a RangeError
 * deep inside dashboard aggregation. Public deadline helpers gate on
 * this so a single bad row can't 500 the whole dashboard. */
function isValidYMD(s: string | null | undefined): s is string {
  if (!s || typeof s !== "string") return false;
  const head = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return false;
  const { y, m, d } = parseYMD(head);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return false;
  }
  // Round-trip guard catches things like 2026-02-30 that `Date.UTC`
  // would silently roll forward to March 2.
  const ms = ymdToUtcMillis({ y, m, d });
  if (!Number.isFinite(ms)) return false;
  const back = new Date(ms);
  return (
    back.getUTCFullYear() === y &&
    back.getUTCMonth() + 1 === m &&
    back.getUTCDate() === d
  );
}

function ymdToUtcMillis(parts: { y: number; m: number; d: number }): number {
  return Date.UTC(parts.y, parts.m - 1, parts.d);
}

export function addDaysToYMD(s: string, days: number): string {
  const ms = ymdToUtcMillis(parseYMD(s)) + days * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 0 = Sunday, ..., 6 = Saturday. Operates purely on the calendar key. */
function dayOfWeekYMD(s: string): number {
  return new Date(ymdToUtcMillis(parseYMD(s))).getUTCDay();
}

function diffDaysYMD(later: string, earlier: string): number {
  return Math.round(
    (ymdToUtcMillis(parseYMD(later)) - ymdToUtcMillis(parseYMD(earlier))) / MS_PER_DAY,
  );
}

function rawDeadlineKey(serviceDate: string): string {
  // Service dates may arrive as `YYYY-MM-DD` or as ISO timestamps; we
  // normalise to the calendar day. The 30-day filing rule is a calendar
  // count, not a 30 * 24h elapsed-time count.
  return addDaysToYMD(serviceDate.slice(0, 10), 30);
}

/**
 * If a YYYY-MM-DD deadline lands on a Saturday or Sunday, pull it back
 * to the prior Friday because the office is closed on weekends.
 */
function shiftDeadlineKeyForOfficeClosure(deadlineKey: string): string {
  const dow = dayOfWeekYMD(deadlineKey);
  if (dow === 6) return addDaysToYMD(deadlineKey, -1); // Sat -> Fri
  if (dow === 0) return addDaysToYMD(deadlineKey, -2); // Sun -> Fri
  return deadlineKey;
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Server-clock "today" key as YYYY-MM-DD in ET. Embedded into deadline-
 * driven API responses so the client can detect day rollover via a
 * server signal instead of trusting the user's machine clock.
 */
export function serverTodayKey(now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  return dateKeyInTz(now, tz);
}

/**
 * Calendar days remaining until the raw 30-day deadline. Negative when
 * the deadline has already passed.
 */
export function daysRemaining(
  serviceDate: string | null,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): number | null {
  if (!isValidYMD(serviceDate)) return null;
  const today = dateKeyInTz(now, tz);
  const deadline = rawDeadlineKey(serviceDate);
  return diffDaysYMD(deadline, today);
}

/**
 * Like {@link daysRemaining}, but pulls weekend deadlines back to the
 * prior Friday so the displayed countdown reflects the day the team can
 * actually act.
 */
export function effectiveDaysRemaining(
  serviceDate: string | null,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): number | null {
  if (!isValidYMD(serviceDate)) return null;
  const today = dateKeyInTz(now, tz);
  const deadline = shiftDeadlineKeyForOfficeClosure(rawDeadlineKey(serviceDate));
  return diffDaysYMD(deadline, today);
}

/**
 * A deadline is "urgent" when, after shifting weekend deadlines back to
 * the prior Friday, it lands on today (in ET) or earlier — the team
 * must file it today because tomorrow is too late.
 */
export function isUrgentDeadline(
  serviceDate: string | null,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): boolean {
  if (!isValidYMD(serviceDate)) return false;
  const today = dateKeyInTz(now, tz);
  const deadline = shiftDeadlineKeyForOfficeClosure(rawDeadlineKey(serviceDate));
  // YYYY-MM-DD strings sort lexicographically as dates, so `<=` is a
  // valid calendar comparison here — no Date round-trip required.
  return deadline <= today;
}

/**
 * Backwards-compatible Date-input variant of the office-closure shift.
 * Mirrors the YMD logic but operates on a `Date`, used by callers that
 * still pass `Date` objects (e.g. weekend deadline shifting in the
 * dashboard). New code should prefer the YMD-string variants above.
 */
export function shiftDeadlineForOfficeClosure(deadline: Date): Date {
  const d = new Date(deadline);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() - 1);
  else if (dow === 0) d.setDate(d.getDate() - 2);
  return d;
}

/**
 * The next business day strictly after `today`. Skips Saturday and
 * Sunday. Operates on host-local Date math; intended for callers that
 * already have a local-time anchor (the API process is pinned to ET via
 * the `TZ` env var, so this matches the rest of this module).
 */
export function nextBusinessDay(today: Date): Date {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}
