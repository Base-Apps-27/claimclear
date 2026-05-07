import Queue from "@/pages/queue";

// Task #517 — Queue V3 walk-first wizard, mounted as a sibling URL to
// /queue. Reuses the entire Queue page (hero, classification inbox,
// master list, filter chips, deadline tiers, presence, SSE refresh,
// row-settle animations) and only swaps the right-pane workspace for
// the V3 wizard via the `variant` prop. Same data, same query keys —
// flipping between /queue and /queue-v3 on the same `?group=<id>` is
// a chrome-only swap with no divergence.
export default function QueueV3() {
  return <Queue variant="v3" />;
}
