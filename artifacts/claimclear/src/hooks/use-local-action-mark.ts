// Local-action mark store (Task #495).
//
// Decision-tree / leg / group "completion" microinteractions used to
// gate purely on the SSE author tag (`lastClaimUpdateBy.current.email
// === user.email`). That works when the SSE event has already been
// received by the time the watcher effect runs, but on the path the
// operator's own mutation success flushes a refetch before the SSE
// event has been processed (or when the SSE author tag is empty for
// admin-side mutations) the gate stays falsy and the animation is
// suppressed for the operator who just earned it.
//
// This module exposes a tiny cross-component mark store so a mutation
// onSuccess handler can leave a short-lived flag for the matching
// watcher effect to consume. Marks are scoped by an opaque key
// (e.g. `claim:123` or `group:45`) and self-expire after `withinMs`
// (default 5s). Consumption is a single-shot read-and-clear so a stale
// mark can't fire the animation twice.
//
// Module-level state is intentional: the producer (a mutation handler)
// and the consumer (a watcher effect) live in different React subtrees,
// and a context provider would have to wrap everything that could ever
// trigger or react to one of these transitions.

const marks = new Map<string, number>();

export function markLocalAction(key: string): void {
  marks.set(key, Date.now());
}

export function consumeLocalActionMark(key: string, withinMs = 5000): boolean {
  const ts = marks.get(key);
  if (ts === undefined) return false;
  marks.delete(key);
  return Date.now() - ts <= withinMs;
}
