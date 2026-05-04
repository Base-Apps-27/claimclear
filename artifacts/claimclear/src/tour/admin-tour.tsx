import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Joyride, ACTIONS, EVENTS, STATUS, type Step, type EventData } from "react-joyride";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import {
  useGetUserTourState,
  useUpdateUserTourState,
  getGetUserTourStateQueryKey,
} from "@workspace/api-client-react";
import { CURRENT_TOUR_VERSION, TOUR_STEPS, type TourStepDef } from "./tour-config";

type TourContextValue = {
  startTour: () => void;
  isAvailable: boolean;
};

const TourContext = createContext<TourContextValue>({
  startTour: () => {},
  isAvailable: false,
});

export function useAdminTour() {
  return useContext(TourContext);
}

function buildJoyrideStep(def: TourStepDef): Step {
  return {
    target: def.target,
    placement: def.placement ?? "auto",
    title: def.title,
    content: def.body,
  };
}

export function AdminTourProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const enabled = isAuthenticated && user?.status === "active";

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

  // Cross-page navigation: pause when the active step needs a different
  // route, then resume once the target element is in the DOM.
  useEffect(() => {
    if (!run) return;
    const def = TOUR_STEPS[stepIndex];
    if (!def) return;
    if (def.route && def.route !== location) {
      setRun(false);
      setLocation(def.route);
    }
  }, [run, stepIndex, location, setLocation]);

  useEffect(() => {
    if (run) return;
    const def = TOUR_STEPS[stepIndex];
    if (!def) return;
    if (!autoStartedRef.current && stepIndex === 0) return;
    if (def.route && def.route !== location) return;
    if (def.target === "body") {
      setRun(true);
      return;
    }
    let attempts = 0;
    const t = window.setInterval(() => {
      const el = document.querySelector(def.target);
      attempts += 1;
      if (el) {
        window.clearInterval(t);
        setRun(true);
      } else if (attempts > 60) {
        // Target never showed up. Quietly halt the tour at the previous
        // step instead of resuming into a guaranteed TARGET_NOT_FOUND. We
        // intentionally do NOT mark the version seen here — the user can
        // replay manually from the sidebar, or auto-retry on next reload.
        window.clearInterval(t);
      }
    }, 100);
    return () => window.clearInterval(t);
  }, [run, stepIndex, location]);

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

      // Joyride mounted a step's tooltip — proof that the user actually saw
      // something. This is the gate for any "mark seen" write below.
      if (type === EVENTS.TOOLTIP) {
        sawAtLeastOneStepRef.current = true;
      }

      // Target not found: stop the tour quietly. Do NOT advance, do NOT mark
      // seen. (Previously this branch incremented stepIndex, which cascaded
      // through every step and ended in finish() — silently marking the user
      // "done" without them ever seeing the tour. That's the bug that left
      // existing users stranded with tourVersionSeen set to a version they
      // never actually viewed.)
      if (type === EVENTS.TARGET_NOT_FOUND) {
        closeTour();
        return;
      }

      // Explicit completion or user-initiated skip from joyride status.
      // Defensive: only persist "seen" if at least one step actually rendered.
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        if (sawAtLeastOneStepRef.current) {
          finishAndMarkSeen();
        } else {
          closeTour();
        }
        return;
      }

      // Normal step transition (Next/Back/Close on a rendered step).
      if (type === EVENTS.STEP_AFTER) {
        const next = index + (action === ACTIONS.PREV ? -1 : 1);
        if (next < 0 || next >= TOUR_STEPS.length) {
          // Walked off an end. Forward exit on a real run = completion;
          // anything else just closes without a DB write.
          if (next >= TOUR_STEPS.length && sawAtLeastOneStepRef.current) {
            finishAndMarkSeen();
          } else {
            closeTour();
          }
          return;
        }
        setStepIndex(next);
      }
    },
    [closeTour, finishAndMarkSeen],
  );

  const startTour = useCallback(() => {
    autoStartedRef.current = true;
    sawAtLeastOneStepRef.current = false;
    setStepIndex(0);
    setRun(true);
  }, []);

  const value = useMemo<TourContextValue>(
    () => ({ startTour, isAvailable: !!enabled }),
    [startTour, enabled],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {enabled && (
        <Joyride
          steps={steps}
          run={run}
          stepIndex={stepIndex}
          continuous
          scrollToFirstStep
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
          }}
          locale={{
            back: "Back",
            close: "Close",
            last: "Done",
            next: "Next",
            skip: "Skip tour",
          }}
        />
      )}
    </TourContext.Provider>
  );
}
