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

  const steps = useMemo(() => TOUR_STEPS.map(buildJoyrideStep), []);

  // Auto-start once per browser session when the stored version is stale.
  useEffect(() => {
    if (!enabled || autoStartedRef.current) return;
    if (!tourState) return;
    if (tourState.tourVersionSeen === CURRENT_TOUR_VERSION) return;
    autoStartedRef.current = true;
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
      if (el || attempts > 60) {
        window.clearInterval(t);
        setRun(true);
      }
    }, 100);
    return () => window.clearInterval(t);
  }, [run, stepIndex, location]);

  const finish = useCallback(() => {
    setRun(false);
    setStepIndex(0);
    if (tourState?.tourVersionSeen !== CURRENT_TOUR_VERSION) {
      updateTourState.mutate({ data: { tourVersionSeen: CURRENT_TOUR_VERSION } });
    }
  }, [tourState, updateTourState]);

  const handleEvent = useCallback(
    (data: EventData) => {
      const { action, index, status, type } = data;
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        finish();
        return;
      }
      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        const next = index + (action === ACTIONS.PREV ? -1 : 1);
        if (next < 0 || next >= TOUR_STEPS.length) {
          finish();
          return;
        }
        setStepIndex(next);
      }
    },
    [finish],
  );

  const startTour = useCallback(() => {
    autoStartedRef.current = true;
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
