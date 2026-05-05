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

function effectiveRoute(def: TourStepDef): string | null {
  return def.route ?? routeForPage(def.page);
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
        const nextRoute = effectiveRoute(nextDef);
        if (nextRoute && nextRoute !== location) {
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
        const nextRoute = effectiveRoute(nextDef);
        const isCrossRoute = !!nextRoute && nextRoute !== location;
        if (isCrossRoute) {
          // Cross-route transition (e.g. step 13 /queue → step 14
          // /responses-awaiting-review). If we just call setLocation +
          // setStepIndex synchronously, Joyride's overlay/spotlight
          // remains mounted while the new page mounts underneath, and
          // the mid-transition DOM race blanked the host page on the
          // first /responses landing. Fix: tear Joyride down BEFORE
          // navigating, then re-arm on the next paint after the new
          // route's DOM has had a chance to mount.
          setRun(false);
          setStepIndex(next);
          setLocation(nextRoute!);
          // Two RAFs ≈ "after the next paint", which is reliably after
          // the new page's first commit + layout. Avoids depending on
          // any specific page's data-fetch timing.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setRun(true));
          });
          return;
        }
        setStepIndex(next);
      }
    },
    [closeTour, finishAndMarkSeen, location, setLocation],
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
      const isDetailScope = startDef.page === "group-detail" || startDef.page === "claim-detail";
      if (!isDetailScope) {
        const startRoute = effectiveRoute(startDef);
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
  }, [location, setLocation]);

  // If the tour starts on a step that has a route, ensure we're on it.
  useEffect(() => {
    if (!run) return;
    const def = TOUR_STEPS[stepIndex];
    if (!def) return;
    const route = effectiveRoute(def);
    if (!route) return;
    // Don't yank the user off a detail page when the current step's
    // anchor is on that exact detail surface.
    if (def.page === "group-detail" && location.startsWith("/invoice-groups/")) return;
    if (def.page === "claim-detail" && location.startsWith("/claims/")) return;
    if (route !== location) {
      setLocation(route);
    }
  }, [run, stepIndex, location, setLocation]);

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
            // Kill ALL of Joyride's built-in opacity transitions on
            // both the dim overlay and the spotlight cutout. Joyride
            // re-mounts these on every step, so the default 0.2-0.3s
            // opacity fade was the "individual parts transitioning"
            // artifact between consecutive centered modals (steps 1-7
            // share target=body, identical position — the only thing
            // that visibly changed step-to-step was that fade).
            // With transition:none the overlay simply IS, full-stop,
            // and the only thing the user sees move between steps is
            // the card content swap.
            styles={{
              overlay: { transition: "none" },
              spotlight: { transition: "none" } as React.CSSProperties,
            }}
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
              // Give a freshly route-changed page a beat to mount
              // before Joyride paints its overlay/spotlight on top.
              // Belt with the cross-route setRun(false) suspenders in
              // STEP_AFTER above.
              loaderDelay: 350,
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
