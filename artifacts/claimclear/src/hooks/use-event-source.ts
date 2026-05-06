import { useEffect, useRef } from "react";

// EventSource lifecycle hook (Task #509).
//
// Six SSE connect functions across `use-claim-events.ts`,
// `use-system-events.ts`, and the dashboard live-updates hook used to
// hand-roll the same EventSource lifecycle: open against
// `${BASE_URL}/<path>`, register listeners, swallow malformed events,
// reconnect on `onerror` with exponential backoff capped at 30s, and
// close on unmount. One of them (system events) also stamped a
// `connectedAt` timestamp so events emitted before the connection
// opened are dropped — the protection that keeps a confetti burst
// from re-firing on reconnect.
//
// This hook owns all of that. The query-invalidation logic and any
// per-event business logic stay in the calling hook; only the
// EventSource plumbing moves here.
//
// `replayGuard` is opt-in. When true, the hook stamps `connectedAt`
// on every successful open and the per-event handler is wrapped to
// ignore JSON payloads whose `timestamp` parses to a value older than
// `connectedAt`. Existing consumers that don't need the guard are not
// behavior-changed.

export interface EventSourceOptions {
  /**
   * Path relative to the artifact's BASE_URL. Must begin with a
   * leading slash (e.g. `/api/claims/123/events`). The hook prefixes
   * the trimmed `BASE_URL` so artifact-prefixed routing keeps working.
   */
  url: string;
  /**
   * Map of named-event handlers to register on the EventSource.
   * Omitted events are simply not subscribed.
   */
  events: Record<string, (event: MessageEvent) => void>;
  /** Optional callback fired on every successful (re)connect. */
  onOpen?: () => void;
  /**
   * When true, ignore named-event payloads whose JSON `timestamp`
   * parses older than the current `connectedAt`. Defaults to false to
   * preserve existing call-site behavior.
   */
  replayGuard?: boolean;
  /**
   * When false the hook does not connect (no EventSource is opened
   * and no reconnect timer runs). Defaults to true.
   */
  enabled?: boolean;
}

export function useEventSource(opts: EventSourceOptions): void {
  const { url, events, onOpen, replayGuard, enabled = true } = opts;

  // Hold mutable bits in refs so connect/reconnect cycles see the
  // latest handlers without re-tearing the EventSource on every
  // parent render.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let retry = 0;
    let connectedAt = 0;

    // Dispatch is ref-driven so handler closures stay live across
    // re-renders without needing to tear down the EventSource. Without
    // this, callbacks that close over values like `user?.email` would
    // see the value frozen at the moment the connection opened —
    // until the next reconnect or remount.
    function makeDispatcher(name: string) {
      return (event: MessageEvent) => {
        if (replayGuard) {
          try {
            const parsed = JSON.parse(event.data);
            const ts = typeof parsed?.timestamp === "string" ? Date.parse(parsed.timestamp) : NaN;
            if (Number.isFinite(ts) && connectedAt > 0 && ts < connectedAt) {
              return;
            }
          } catch {
            // fall through to handler; replay guard is best-effort.
          }
        }
        const handler = eventsRef.current[name];
        if (handler) handler(event);
      };
    }

    function connect() {
      if (cancelled) return;
      const base = (import.meta.env?.BASE_URL ?? "").replace(/\/$/, "");
      es = new EventSource(`${base}${url}`, { withCredentials: true });
      // Subscribe by name once at open time. The dispatcher resolves
      // the live handler from `eventsRef.current` at each fire, so
      // callers can swap callback closures freely.
      for (const name of Object.keys(eventsRef.current)) {
        es.addEventListener(name, makeDispatcher(name));
      }
      es.onopen = () => {
        retry = 0;
        connectedAt = Date.now();
        onOpenRef.current?.();
      };
      es.onerror = () => {
        es?.close();
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** Math.min(retry, 5), 30000);
        retry += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
    // `events` and `onOpen` are read through refs above — only the
    // url, replay-guard mode, and enabled flag actually require a
    // reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, replayGuard, enabled]);
}
