// Toast verb variety (Task #494).
//
// A tiny helper that picks a success verb from a curated pool so
// repeated saves don't all read "Saved · Saved · Saved". Use only
// for success toasts; error/warning copy stays unchanged.
//
// `pickSuccessVerb()` is plain pseudo-random — no per-user state,
// no anti-repeat memory. The pool is small enough on purpose: the
// goal is "feels like a real teammate said it", not novelty for
// its own sake. Tests can pass a `rng` to make the pick
// deterministic.

export const SUCCESS_VERBS = [
  "Saved",
  "Locked in",
  "Got it",
  "Done",
] as const;

export type SuccessVerb = (typeof SUCCESS_VERBS)[number];

export function pickSuccessVerb(rng: () => number = Math.random): SuccessVerb {
  const i = Math.floor(rng() * SUCCESS_VERBS.length);
  return SUCCESS_VERBS[Math.min(i, SUCCESS_VERBS.length - 1)];
}
