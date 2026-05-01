// Startup-error guard (Task #258).
//
// The previous publish failed silently: production runtime logs were empty
// because the process exited before any `logger.info` line was emitted. This
// module installs a top-level safety net so any unhandled exception or
// rejection leaves a clear FATAL line in stdout/stderr — deployment runtime
// logs capture stdout, so the next failure (whatever its cause) is at least
// debuggable.
//
// Side-effect-only import. Must be imported FIRST in `index.ts`, before any
// other module — ES module imports are hoisted, so importing this module
// before `./app` and the rest guarantees the handlers are registered before
// any other top-level code runs.
//
// We distinguish startup-time fatals from post-startup ones by a flag the
// listen callback flips. That keeps the message accurate so an incident
// triaged from the runtime log isn't misled about when things broke.

import { logger } from "./logger";

let serverIsListening = false;

export function markServerStarted(): void {
  serverIsListening = true;
}

function logFatalAndExit(reason: string, err: unknown): never {
  const phase = serverIsListening ? "unhandled process error" : "server failed to start";
  try {
    logger.fatal({ err }, `FATAL: ${phase} (${reason})`);
  } catch {
    // The logger itself may be unusable mid-crash — fall back to stderr so
    // a line still lands in the deployment runtime log.
    // eslint-disable-next-line no-console
    console.error(`FATAL: ${phase} (${reason})`, err);
  }
  process.exit(1);
}

process.on("uncaughtException", (err) => {
  logFatalAndExit("uncaughtException", err);
});

process.on("unhandledRejection", (reason) => {
  logFatalAndExit("unhandledRejection", reason);
});
