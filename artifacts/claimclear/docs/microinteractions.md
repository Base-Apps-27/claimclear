# Micro-interaction framework

ClaimClear has 9+ micro-interactions today (day-complete confetti, session
milestones + pace badge, decision-tree checkmark, group-cleared card fade,
save breath, bulk row shimmer, copy chirp, row settle, skeleton crossfade,
number ticker, rotating captions). Task #509 consolidated the seven
plumbing concerns those interactions used to re-implement into a small
framework so the next interaction opts into shared primitives instead of
cloning a sibling.

## Primitives

| Concern | Primitive | Replaces |
| --- | --- | --- |
| Reduced-motion check (JS) | `useReducedMotion()` hook + `prefersReducedMotion()` non-hook helper in `src/hooks/use-reduced-motion.ts` | Three inline `window.matchMedia("(prefers-reduced-motion: reduce)")` reads in `use-system-events.ts`, `use-session-milestones.ts`, `use-number-ticker.ts` |
| One-shot timer + cleanup | `useTransientFlag(durationMs)` in `src/hooks/use-transient-flag.ts` | `useState(false) + useRef<number> + setTimeout + cleanup` in `useBreath`, `useClipboardCopy`, plus inline `justProcessed` / `justShipped` / `justCleared` flags in `claim-detail-v2`, `leg-conclusion-row`, `invoice-group-detail-v2` |
| Keyed multi-target one-shot | `useTransientFlagSet<Id>(durationMs)` in the same module | The active-Set + timer inside `useRowBreath` |
| "Did *I* cause this transition?" gate | `useActorCausedTransition(opts)` in `src/hooks/use-actor-caused-transition.ts` | The duplicated 4-line `consumeLocalActionMark` → SSE-author triple-check in three watcher effects (`leg-conclusion-row`, `claim-detail-v2`, `invoice-group-detail-v2`) |
| EventSource lifecycle + reconnect (+ optional replay guard) | `useEventSource(opts)` in `src/hooks/use-event-source.ts` | The 6 connect functions across `use-claim-events.ts` and `use-system-events.ts` |
| Confetti hierarchy | `fireCelebration(tier)` in `src/lib/celebrations.ts` | Inline `fireConfettiBurst` / `fireMiniBurst` helpers; the load-bearing comment blocks asking future contributors not to factor a `fireConfetti(size)` helper |
| Celebration toast copy | `celebrationCopy(ctx)` in the same module | The Friday-afternoon variant for day-complete and the 10/25/50 milestone copy, previously inlined next to the SSE handlers |

The two semantic wrappers (`useBreath`, `useClipboardCopy`) survive
because they carry intent (breath = save confirmation, copy = clipboard
chirp). Their internals delegate to `useTransientFlag`. `useRowBreath`
likewise delegates to `useTransientFlagSet`.

## Confetti hierarchy

`CelebrationTier` is the type system; there is no `fireCelebration("custom",
{ particleCount: 200 })` escape hatch. Adding a new tier requires editing
`src/lib/celebrations.ts` and committing the visual+copy together.

| Tier | Visual | When it fires |
| --- | --- | --- |
| `day-complete` | Dual corner bursts × 80 particles, full viewport spread, top z-index — the loudest signal in the app | Every invoice group dated for some calendar day reaches a concluded state (server-emitted SSE event) |
| `session-milestone` | Single mid-screen burst, 30 particles, narrower spread — visibly the SMALL sibling | Operator crosses 10 / 25 / 50 claims processed in a single signed-in session |

`canvas-confetti` is imported from exactly **one** place
(`src/lib/celebrations.ts`). Direct imports anywhere else in the codebase
are a smell.

## Reduced-motion contract

- **JavaScript-driven animations** (confetti, RAF tickers, one-shot
  timers that compose multiple effects) gate via
  `prefersReducedMotion()` (non-hook) or `useReducedMotion()` (hook).
- **CSS-driven animations** (the `.animate-cc-breath`, `.cc-row-breath`,
  `.cc-pill-just-transitioned` family) gate via the
  `@media (prefers-reduced-motion: reduce)` rules in `index.css` —
  that's the right tool for CSS animations and shouldn't be replaced
  with JS gating.

## Adding a new micro-interaction

Worked example: "When a payor responds, give the matching row a one-shot
glow that fires only when the matching SSE event arrives during this tab's
session — and not when a collaborator's action triggered the refetch."

1. Pick the duration (e.g. 600ms) and the CSS class (`cc-row-glow`).
2. In the row component:

   ```ts
   const { lastClaimUpdateBy } = useClaimEvents(claim.id);
   const { active: glowing, fire: fireGlow } = useTransientFlag(600);
   useActorCausedTransition({
     key: `claim:${claim.id}`,
     lastUpdateBy: lastClaimUpdateBy,
     currentValue: claim.responseCount,
     isTransition: (prev, next) => next > prev,
     onTransition: () => fireGlow(),
   });
   ```

3. Spread `glowing ? "cc-row-glow" : ""` onto the row element.

That's the whole thing. No `useRef` for the prev value, no `setTimeout`
plumbing, no inline `consumeLocalActionMark` line, no `useState(false)`.

For a celebration: add a tier to `CelebrationTier` in
`src/lib/celebrations.ts`, define its visuals in `fireCelebration`, and
add the tier's toast copy to `celebrationCopy`. Then call
`fireCelebration(tier)` + `toast({ ...celebrationCopy(...), duration })`
from the trigger point.
