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

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function pad4(n: number): string { return String(n).padStart(4, "0"); }

function reassembleIfValid(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(ms)) return null;
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() + 1 !== m ||
    back.getUTCDate() !== d
  ) return null;
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Normalize a service-date string to ISO `YYYY-MM-DD`. Accepts:
 *   - ISO `YYYY-MM-DD` (with or without a trailing time component)
 *   - US-style `M/D/YYYY` and `M/D/YY` (with optional zero padding)
 *
 * Returns null for empty / unparseable / impossible-calendar input
 * (e.g. `2026-02-30`) so callers can skip the row instead of throwing
 * inside deadline math.
 *
 * Why this exists: `claims.date` was a TEXT column historically populated
 * from the importer's raw CSV inputs, which arrived in M/D/YYYY (and
 * later M/D/YY) shape. Migration 0020 backfilled stored values to ISO
 * and the importer now writes ISO, but this normalizer remains the
 * safety net for any stray non-ISO row that slips in.
 */
export function normalizeServiceDate(input: string | null | undefined): string | null {
  if (!input || typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return reassembleIfValid(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (usMatch) {
    const m = Number(usMatch[1]);
    const d = Number(usMatch[2]);
    let y = Number(usMatch[3]);
    if (usMatch[3].length === 2) {
      // Excel-style window: 00-69 -> 2000-2069, 70-99 -> 1970-1999.
      y = y < 70 ? 2000 + y : 1900 + y;
    }
    return reassembleIfValid(y, m, d);
  }

  return null;
}

/**
 * Strict ISO YYYY-MM-DD guard used by the deadline helpers. After
 * Task #351 promoted `claims.date` to a typed DATE column, drizzle's
 * `mode: "string"` parser returns either a strict YYYY-MM-DD string
 * or null on every read path — so the helpers no longer accept the
 * legacy M/D/YYYY shape (the importer rejects unparseable input at
 * write time and `normalizeServiceDate` only runs there).
 *
 * This guard remains so that empty / null / structurally-invalid
 * strings (e.g. a hand-rolled "2026-02-30" in a test fixture) still
 * degrade gracefully to "no deadline known" instead of crashing the
 * dashboard via an Invalid Date.
 */
function isValidYMD(s: string | null | undefined): s is string {
  if (!s || typeof s !== "string") return false;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  return reassembleIfValid(Number(m[1]), Number(m[2]), Number(m[3])) !== null;
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
  // Inputs come from the typed `claims.date` column (DATE, drizzle
  // mode "string") or aggregates over it cast to text — both yield a
  // strict ISO YYYY-MM-DD or null. The `normalizeServiceDate` round-
  // trip the helper used to perform is now redundant on those paths;
  // this guard remains as a safety net for malformed test inputs.
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
 * the prior Friday, it lands on today (in ET) — the team must file it
 * today because tomorrow is too late.
 *
 * Strict equality: past-due rows are NOT urgent. Operationally we never
 * carry past-due unsubmitted invoices (the daily routine clears them
 * the day they hit the deadline), so flagging older slips as "Today"
 * just inflated the count and labelled future deadlines incorrectly.
 * Use {@link isAtOrPastEffectiveDeadline} when you need the broader
 * "past or at the deadline" predicate (e.g. the post-submit "stuck"
 * tier, where a slipped Portal Queued group still needs a chase).
 */
export function isUrgentDeadline(
  serviceDate: string | null,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): boolean {
  if (!isValidYMD(serviceDate)) return false;
  const today = dateKeyInTz(now, tz);
  const deadline = shiftDeadlineKeyForOfficeClosure(rawDeadlineKey(serviceDate));
  // YYYY-MM-DD strings sort lexicographically as dates, so `===` is a
  // valid calendar comparison here — no Date round-trip required.
  return deadline === today;
}

/**
 * True when the effective (weekend-shifted) deadline is today or has
 * already passed. Used by the "submitted but unconfirmed" tier so that
 * Portal Queued groups whose deadline slipped without acknowledgement
 * still light up the chase-confirmation badge — even though they are
 * no longer "Urgent" in the strict file-today sense.
 */
export function isAtOrPastEffectiveDeadline(
  serviceDate: string | null,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): boolean {
  if (!isValidYMD(serviceDate)) return false;
  const today = dateKeyInTz(now, tz);
  const deadline = shiftDeadlineKeyForOfficeClosure(rawDeadlineKey(serviceDate));
  return deadline <= today;
}

/**
 * Backwards-compatible Date-input variant of the office-closure shift.
 * Mirrors the YMD logic but operates on a `Date`, used by callers that
 * still pass `Date` objects (e.g. weekend deadline shifting in the
 * dashboard). New code should prefer the YMD-string variants above.
 */
/**
 * Format a `YYYY-MM-DD` calendar string for human-facing display
 * ("Apr 6, 2026"). Use this for any date emitted into emails, the
 * daily brief, exports, PDFs, or other server-rendered surfaces —
 * never `new Date(ymd).toLocaleDateString()`, which parses the bare
 * calendar day as midnight UTC and renders one day earlier in any
 * negative-UTC offset (ET in April: UTC-4 → 8pm Apr 5 → "Apr 5").
 *
 * Returns the literal `dash` argument (default em-dash) when the input
 * is null/empty/malformed so a missing service date never looks like
 * "Jan 1, 1970" in a brief.
 */
export function formatServiceDate(ymd: string | null | undefined, dash: string = "—"): string {
  if (!ymd) return dash;
  const slice = ymd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slice)) return dash;
  const { y, m, d } = parseYMD(slice);
  // Build the display date with `Date.UTC` + `Intl.DateTimeFormat` in
  // UTC so the rendered day is exactly the calendar day in the input
  // — independent of the host's TZ env var. Same approach the rest of
  // this module uses to keep the calendar math TZ-stable.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return fmt.format(new Date(Date.UTC(y, m - 1, d)));
}

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
