// In-memory boot timestamp for the API server process. Used by the
// System Health rollup so we can ignore "expected" cron fires that fall
// before the process actually started — otherwise a fresh deploy looks
// like a degraded job until the next scheduled tick lands.
//
// Resetting on every restart is intentional: a new process has had no
// chance to fire its in-memory cron schedule yet, so anything before
// this timestamp is genuinely "expected to be missed."

const BOOT_TIME = new Date();

export function getBootTime(): Date {
  return BOOT_TIME;
}
