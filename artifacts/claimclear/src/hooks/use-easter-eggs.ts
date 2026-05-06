import * as React from "react";

// Easter eggs (Task #494). Two tasteful, never-load-bearing touches:
//
// 1. Konami code (↑ ↑ ↓ ↓ ← → ← → B A) toggles dark mode by adding
//    or removing the `.dark` class on the document root. There is no
//    persisted theme setting today, so this is a per-tab toggle —
//    hidden, low-stakes, and trivially reversible by typing the code
//    again. The listener is mounted once at the App level.
//
// 2. The logo wink lives entirely in CSS (see `.cc-logo-wink` in
//    `index.css`) and is opted into by the sidebar SVG. No hook
//    needed.
//
// Both are wrapped in defensive guards so a missing `document` /
// `window` (SSR, jsdom-without-globals) is a silent no-op.

const KONAMI_SEQUENCE: ReadonlyArray<string> = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Mount once at the app root. Listens for the Konami code and toggles
 * the `.dark` class on `<html>` when the full sequence is entered.
 * Silent failure: any throw inside the handler is swallowed so the
 * easter egg can never break a real interaction.
 */
export function useKonamiDarkMode(): void {
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    let progress = 0;
    const handler = (e: KeyboardEvent) => {
      try {
        if (isTypingTarget(e.target)) {
          progress = 0;
          return;
        }
        const expected = KONAMI_SEQUENCE[progress];
        // Arrow keys are case-sensitive event.key strings; the
        // trailing B/A are matched case-insensitively so capslock
        // doesn't defeat the sequence.
        const keyMatches = expected.startsWith("Arrow")
          ? e.key === expected
          : e.key.toLowerCase() === expected.toLowerCase();
        if (!keyMatches) {
          // Allow the sequence to restart cleanly when the typo is
          // itself the first key of the sequence.
          progress = e.key === KONAMI_SEQUENCE[0] ? 1 : 0;
          return;
        }
        progress += 1;
        if (progress === KONAMI_SEQUENCE.length) {
          progress = 0;
          document.documentElement.classList.toggle("dark");
        }
      } catch {
        progress = 0;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
