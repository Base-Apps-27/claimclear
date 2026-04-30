export function daysRemaining(serviceDate: string | null): number | null {
  if (!serviceDate) return null;
  const deadline = new Date(serviceDate);
  deadline.setDate(deadline.getDate() + 30);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  return Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function rawDeadline(serviceDate: string): Date {
  const d = new Date(serviceDate);
  d.setDate(d.getDate() + 30);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isWeekend(date: Date): boolean {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

/**
 * If a deadline falls on a Saturday or Sunday, shift it back to the prior
 * Friday, since the office is closed on weekends. Other days pass through
 * unchanged.
 */
export function shiftDeadlineForOfficeClosure(deadline: Date): Date {
  const d = new Date(deadline);
  const dow = d.getDay();
  if (dow === 6) {
    d.setDate(d.getDate() - 1);
  } else if (dow === 0) {
    d.setDate(d.getDate() - 2);
  }
  return d;
}

/**
 * Returns the next business day strictly after `today`. Skips Saturday and
 * Sunday.
 */
export function nextBusinessDay(today: Date): Date {
  const d = startOfDay(today);
  d.setDate(d.getDate() + 1);
  while (isWeekend(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Like {@link daysRemaining}, but pulls weekend deadlines back to the prior
 * Friday so the displayed countdown reflects the day the team can actually
 * act. Also accepts an explicit `now` for deterministic testing.
 */
export function effectiveDaysRemaining(
  serviceDate: string | null,
  now: Date = new Date(),
): number | null {
  if (!serviceDate) return null;
  const deadline = shiftDeadlineForOfficeClosure(rawDeadline(serviceDate));
  const today = startOfDay(now);
  return Math.ceil((deadline.getTime() - today.getTime()) / MS_PER_DAY);
}

/**
 * A deadline is "urgent" when, after shifting weekend deadlines back to the
 * prior Friday, it lands on today or earlier. In other words: the team must
 * file it today because tomorrow is too late.
 *
 * On a Friday this naturally captures Sat/Sun raw deadlines (they shift back
 * to Friday = today). It does NOT capture next Monday's deadlines on a
 * Friday, because those can still be filed on Monday morning.
 */
export function isUrgentDeadline(
  serviceDate: string | null,
  now: Date = new Date(),
): boolean {
  if (!serviceDate) return false;
  const deadline = shiftDeadlineForOfficeClosure(rawDeadline(serviceDate));
  const today = startOfDay(now);
  return deadline.getTime() <= today.getTime();
}
