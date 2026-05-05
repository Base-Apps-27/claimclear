import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Joyride, ACTIONS, EVENTS, STATUS, type Step, type EventData } from "react-joyride";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import {
  useGetUserTourState,
  useUpdateUserTourState,
  getGetUserTourStateQueryKey,
} from "@workspace/api-client-react";
import {
  CURRENT_TOUR_VERSION,
  TOUR_STEPS,
  routeForPage,
  pageForLocation,
  type PageKey,
  type TourStepDef,
} from "./tour-config";
import { TourCard } from "./tour-card";

// React error boundary that catches anything thrown inside the Joyride
// subtree (including third-party rendering errors that React's normal
// flow would otherwise propagate to the root). On error we fire `onError`
// (which closes the tour + resets stepIndex) and render NULL so the
// host app — Layout, current page — keeps painting normally. Two prior
// "step 14 white-screens responses-awaiting-review" iterations failed to
// land a root cause; this guarantees the symptom can't recur regardless
// of which exact internal Joyride code path is to blame.
class TourErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: true } {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the dev console so we can still investigate, but don't
    // re-throw — the goal is to keep the host app alive.
    if (import.meta.env.DEV) {
      console.error("[AdminTour] error caught by boundary:", error, info);
    }
    this.props.onError();
  }
  componentDidUpdate(_: unknown, prevState: { hasError: boolean }) {
    // Once we've torn down on error and the parent has reset state,
    // allow the boundary to re-arm so a future startTour() works again.
    if (prevState.hasError && this.state.hasError) {
      // Clear on the next tick so React commits the null-render first.
      queueMicrotask(() => this.setState({ hasError: false }));
    }
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

type StartTourOpts = {
  // If provided, the tour starts at the first step whose `page` matches.
  // Used by the header "Help on this page" popover so a teammate can
  // walk just the page they're on instead of the full 24-step tour.
  pageScope?: PageKey;
};

type TourContextValue = {
  startTour: (opts?: StartTourOpts) => void;
  isAvailable: boolean;
};

const TourContext = createContext<TourContextValue>({
  startTour: () => {},
  isAvailable: false,
});

export function useAdminTour() {
  return useContext(TourContext);
}

// How long Joyride will poll for an anchored step's target element to
// mount before giving up. Generous because cross-page steps may have to
// wait for a route change + data fetch + render before their anchor
// appears in the DOM.
const TARGET_WAIT_MS = 8000;

// Pair of ids resolved from `GET /tour/sample` — the global read-only
// invoice group + claim that anchored steps 18 & 20 navigate to. Both
// can be `null` if the tour-sample seed migration hasn't been applied
// yet; the controller falls back to leaving the user on the list page
// (Joyride's TARGET_NOT_FOUND handler then skips the orphaned step).
type TourSampleIds = { groupId: number | null; claimId: number | null };

function effectiveRoute(def: TourStepDef, sampleIds: TourSampleIds): string | null {
  if (def.dynamicRoute === "tour-sample-group" && sampleIds.groupId != null) {
    return `/invoice-groups/${sampleIds.groupId}`;
  }
  if (def.dynamicRoute === "tour-sample-claim" && sampleIds.claimId != null) {
    return `/claims/${sampleIds.claimId}`;
  }
  return def.route ?? routeForPage(def.page);
}

// True when the current `location` already belongs to the page this
// step targets — even if the URL has a sub-path the page itself
// appended (e.g. responses-awaiting-review pushes `/...
// awaiting-review/<id>` for the auto-selected first row, claim-detail
// pushes `/claims/<id>`). Strict string equality is wrong here because
// it kicks off a route-rewrite war: the tour forces the URL back to
// the bare route, the page's auto-select effect re-appends the id,
// repeat. That ping-pong was the actual cause of the
// "/responses-awaiting-review white-screens mid-mount" crash.
function isOnRoute(def: TourStepDef, location: string, sampleIds: TourSampleIds): boolean {
  const route = effectiveRoute(def, sampleIds);
  if (!route) return true;
  if (route === location) return true;
  if (def.page && pageForLocation(location) === def.page) return true;
  return false;
}

function buildJoyrideStep(def: TourStepDef): Step {
  // Centered modals (target=body) have nothing meaningful to scroll
  // to — and triggering Joyride's scroll on a freshly route-changed
  // page can race with React mount. Always skip scroll for modals;
  // honor explicit `disableScrolling` for coach steps.
  const skipScroll = def.disableScrolling ?? def.placement === "center";
  return {
    target: def.target,
    placement: def.placement,
    title: def.title,
    content: def.body,
    skipBeacon: true,
    targetWaitTimeout: TARGET_WAIT_MS,
    disableScrolling: skipScroll,
    // Stash the full def on the step so our custom tooltipComponent
    // can read kind / processStep / nextLabel without re-deriving.
    data: def,
  } as Step;
}

export function AdminTourProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const enabled = isAuthenticated && user?.status === "approved";

  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: tourState } = useGetUserTourState({
    query: {
      queryKey: getGetUserTourStateQueryKey(),
      enabled,
      staleTime: 5 * 60 * 1000,
    },
  });

  const updateTourState = useUpdateUserTourState({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetUserTourStateQueryKey() });
      },
    },
  });

  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const autoStartedRef = useRef(false);
  // Tour-sample id pair fetched once on mount. Used to materialize the
  // dynamic detail-page routes for steps 18 & 20. Defaults to nulls so
  // the rest of the tour still works in environments where the
  // migration hasn't run yet.
  const [sampleIds, setSampleIds] = useState<TourSampleIds>({ groupId: null, claimId: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/tour/sample", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setSampleIds({
          groupId: typeof data.groupId === "number" ? data.groupId : null,
          claimId: typeof data.claimId === "number" ? data.claimId : null,
        });
      })
      .catch(() => { /* tour falls back to modal-on-list for missing ids */ });
    return () => { cancelled = true; };
  }, [enabled]);
  // Tracks whether at least one tour step has actually rendered for this run.
  // Joyride emits EVENTS.TOOLTIP whenever a step's tooltip mounts in the DOM —
  // we only flip this true on that signal. The DB write that records "user
  // has seen this version" is GATED on this ref, so a tour that aborts before
  // the user ever sees a step (e.g. TARGET_NOT_FOUND on first mount) cannot
  // silently brick auto-start by marking the version "seen" without proof.
  const sawAtLeastOneStepRef = useRef(false);

  const steps = useMemo(() => TOUR_STEPS.map(buildJoyrideStep), []);

  // Auto-start once per browser session when the stored version is stale.
  useEffect(() => {
    if (!enabled || autoStartedRef.current) return;
    if (!tourState) return;
    if (tourState.tourVersionSeen === CURRENT_TOUR_VERSION) return;
    autoStartedRef.current = true;
    sawAtLeastOneStepRef.current = false;
    setStepIndex(0);
    setRun(true);
  }, [enabled, tourState]);

  const closeTour = useCallback(() => {
    setRun(false);
    setStepIndex(0);
  }, []);

  const finishAndMarkSeen = useCallback(() => {
    closeTour();
    if (tourState?.tourVersionSeen !== CURRENT_TOUR_VERSION) {
      updateTourState.mutate({ data: { tourVersionSeen: CURRENT_TOUR_VERSION } });
    }
  }, [closeTour, tourState, updateTourState]);

  const handleEvent = useCallback(
    (data: EventData) => {
      const { action, index, status, type } = data;

      if (type === EVENTS.TOOLTIP) {
        sawAtLeastOneStepRef.current = true;
      }

      // Target not found even after the per-step poll timeout. Skip past
      // this broken step instead of killing the whole tour — one missing
      // anchor shouldn't strand the user.
      if (type === EVENTS.TARGET_NOT_FOUND) {
        const next = index + 1;
        if (next >= TOUR_STEPS.length) {
          if (sawAtLeastOneStepRef.current) {
            finishAndMarkSeen();
          } else {
            closeTour();
          }
          return;
        }
        const nextDef = TOUR_STEPS[next];
        const nextRoute = effectiveRoute(nextDef, sampleIds);
        if (nextRoute && !isOnRoute(nextDef, location, sampleIds)) {
          setLocation(nextRoute);
        }
        setStepIndex(next);
        return;
      }

      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        if (sawAtLeastOneStepRef.current) {
          finishAndMarkSeen();
        } else {
          closeTour();
        }
        return;
      }

      if (type === EVENTS.STEP_AFTER) {
        const next = index + (action === ACTIONS.PREV ? -1 : 1);
        if (next < 0 || next >= TOUR_STEPS.length) {
          if (next >= TOUR_STEPS.length && sawAtLeastOneStepRef.current) {
            finishAndMarkSeen();
          } else {
            closeTour();
          }
          return;
        }
        const nextDef = TOUR_STEPS[next];
        const nextRoute = effectiveRoute(nextDef, sampleIds);
        const isCrossRoute = !!nextRoute && !isOnRoute(nextDef, location, sampleIds);
        if (isCrossRoute) {
          // Cross-route transition. Just navigate + advance the step
          // synchronously. Joyride polls for the next anchor up to
          // TARGET_WAIT_MS and the centered-modal steps don't need
          // an anchor at all. We used to tear Joyride down with
          // setRun(false) and re-arm after two RAFs to dodge a
          // /responses-awaiting-review crash, but that crash was
          // caused by a route ping-pong (page auto-selects first row
          // → tour rewrites URL back → repeat) that `isOnRoute` now
          // prevents. Removing the teardown eliminated the ~700ms
          // visible stall users saw on /invoice-groups and /claims.
          setStepIndex(next);
          setLocation(nextRoute!);
          return;
        }
        setStepIndex(next);
      }
    },
    [closeTour, finishAndMarkSeen, location, setLocation, sampleIds],
  );

  const startTour = useCallback((opts?: StartTourOpts) => {
    autoStartedRef.current = true;
    sawAtLeastOneStepRef.current = false;
    // Resolve the starting index. If a pageScope is provided, jump to the
    // first step belonging to that page; otherwise start from the top.
    let startIndex = 0;
    if (opts?.pageScope) {
      const found = TOUR_STEPS.findIndex((s) => s.page === opts.pageScope);
      if (found >= 0) startIndex = found;
    }
    // Navigate to the right route up-front so Joyride's anchor poll has a
    // shot at finding the first step's target on mount. Group-detail and
    // claim-detail steps deliberately leave the URL alone — those scopes
    // are only ever launched from a detail page (the popover is the only
    // entry point and only renders the option when the user is already on
    // that surface), so the in-URL id is preserved.
    const startDef = TOUR_STEPS[startIndex];
    if (startDef) {
      // Dynamic-route steps (18 & 20) MUST navigate to their resolved
      // detail page even when launched from a detail-scope popover, so
      // the resolved tour-sample id wins over whatever id the user is
      // currently viewing. For non-dynamic detail steps, leave the URL
      // alone so the popover-from-a-detail-page experience is preserved.
      const isDetailScope = startDef.page === "group-detail" || startDef.page === "claim-detail";
      const isDynamic = !!startDef.dynamicRoute;
      if (!isDetailScope || isDynamic) {
        const startRoute = effectiveRoute(startDef, sampleIds);
        if (startRoute && startRoute !== location) {
          setLocation(startRoute);
        }
      }
    }
    // Force a clean false→true transition so Joyride sees `run` change
    // even if we were mid-tour.
    setRun(false);
    setStepIndex(startIndex);
    queueMicrotask(() => setRun(true));
  }, [location, setLocation, sampleIds]);

  // If the tour starts on a step that has a route, ensure we're on it.
  useEffect(() => {
    if (!run) return;
    const def = TOUR_STEPS[stepIndex];
    if (!def) return;
    const route = effectiveRoute(def, sampleIds);
    if (!route) return;
    // Dynamic-route steps (18 & 20) target a specific tour-sample id,
    // so we MUST re-route to that id even if the user happens to be on
    // a different detail page. For other detail-scope steps, leave the
    // URL alone so opening the tour from a detail page preserves the
    // user's row.
    if (!def.dynamicRoute) {
      if (def.page === "group-detail" && location.startsWith("/invoice-groups/")) return;
      if (def.page === "claim-detail" && location.startsWith("/claims/")) return;
    }
    if (!isOnRoute(def, location, sampleIds)) {
      setLocation(route);
    }
  }, [run, stepIndex, location, setLocation, sampleIds]);

  const value = useMemo<TourContextValue>(
    () => ({ startTour, isAvailable: !!enabled }),
    [startTour, enabled],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {enabled && (
        // ErrorBoundary wrap: if anything inside Joyride throws —
        // an unmounted-anchor race, a styles-merge edge case, a third-
        // party hook misbehaving on a freshly-mounted page — close the
        // tour silently instead of white-screening the host app. This
        // is what eliminated the "step 14 crash" symptom for good:
        // even if Joyride's spotlight machinery does throw on landing
        // /responses-awaiting-review, the user just sees the tour
        // disappear, never an empty page.
        <TourErrorBoundary onError={closeTour}>
          <Joyride
            steps={steps}
            run={run}
            stepIndex={stepIndex}
            continuous
            scrollToFirstStep
            tooltipComponent={TourCard}
            debug={import.meta.env.DEV}
            onEvent={handleEvent}
            options={{
              showProgress: true,
              buttons: ["back", "skip", "primary"],
              skipBeacon: true,
              overlayClickAction: false,
              primaryColor: "#1B2A4A",
              zIndex: 10000,
              arrowColor: "#ffffff",
              backgroundColor: "#ffffff",
              textColor: "#0f172a",
              overlayColor: "rgba(15, 23, 42, 0.55)",
              // Reserve room for the sticky app header so spotlights
              // never get hidden behind it after Joyride's auto-scroll.
              scrollOffset: 96,
              // Default Joyride loader delay. We used to bump this to
              // 350ms as part of the cross-route teardown workaround;
              // with the route-rewrite war fixed (see isOnRoute above)
              // the default is enough and removes a perceptible stall
              // on the /invoice-groups and /claims transitions.
              loaderDelay: 100,
            }}
            locale={{
              back: "Back",
              close: "Close",
              last: "Done",
              next: "Next",
              skip: "Skip tour",
            }}
          />
        </TourErrorBoundary>
      )}
    </TourContext.Provider>
  );
}
