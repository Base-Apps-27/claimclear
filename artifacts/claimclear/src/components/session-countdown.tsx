import { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionTiming {
  absoluteRemainingMs: number;
  idleRemainingMs: number;
  absoluteTotalMs: number;
  idleTotalMs: number;
}

const ABSOLUTE_WARN_MS = 10 * 60 * 1000;
const IDLE_WARN_MS = 30 * 1000;
const POLL_INTERVAL = 15 * 1000;
const TICK_INTERVAL = 1000;

function formatTime(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return `${hr}:${String(remMin).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function SessionCountdown() {
  const [timing, setTiming] = useState<SessionTiming | null>(null);
  const [absoluteRemaining, setAbsoluteRemaining] = useState(Infinity);
  const [idleRemaining, setIdleRemaining] = useState(Infinity);
  const [dismissed, setDismissed] = useState<"absolute" | "idle" | null>(null);
  const lastFetchRef = useRef(0);

  const fetchTiming = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session-info", { credentials: "include" });
      if (!res.ok) return;
      const data: SessionTiming = await res.json();
      setTiming(data);
      setAbsoluteRemaining(data.absoluteRemainingMs);
      setIdleRemaining(data.idleRemainingMs);
      lastFetchRef.current = Date.now();
    } catch {}
  }, []);

  useEffect(() => {
    fetchTiming();
    const id = setInterval(fetchTiming, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchTiming]);

  useEffect(() => {
    if (!timing) return;

    const id = setInterval(() => {
      const elapsed = Date.now() - lastFetchRef.current;
      setAbsoluteRemaining(Math.max(0, timing.absoluteRemainingMs - elapsed));
      setIdleRemaining(Math.max(0, timing.idleRemainingMs - elapsed));
    }, TICK_INTERVAL);

    return () => clearInterval(id);
  }, [timing]);

  useEffect(() => {
    if (absoluteRemaining <= 0 || idleRemaining <= 0) {
      window.location.reload();
    }
  }, [absoluteRemaining, idleRemaining]);

  const handleStayActive = useCallback(() => {
    setDismissed("idle");
    fetch("/api/auth/session-info", { credentials: "include" })
      .then(res => res.json())
      .then((data: SessionTiming) => {
        setTiming(data);
        setAbsoluteRemaining(data.absoluteRemainingMs);
        setIdleRemaining(data.idleRemainingMs);
        lastFetchRef.current = Date.now();
        setTimeout(() => setDismissed(null), 1000);
      })
      .catch(() => {});
  }, []);

  const showAbsoluteWarn = absoluteRemaining <= ABSOLUTE_WARN_MS && absoluteRemaining > 0;
  const showIdleWarn = idleRemaining <= IDLE_WARN_MS && idleRemaining > 0;

  if (dismissed === "idle" && showIdleWarn) return null;

  if (showIdleWarn) {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="bg-amber-600 text-white rounded-lg shadow-2xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Inactivity timeout</p>
              <p className="text-amber-100 text-xs mt-0.5">
                Your session will expire in{" "}
                <span className="font-mono font-bold text-white">{formatTime(idleRemaining)}</span>{" "}
                due to inactivity.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="w-full mt-3 bg-white/20 hover:bg-white/30 text-white border-0 text-xs"
            onClick={handleStayActive}
          >
            <RefreshCw className="h-3 w-3 mr-1.5" />
            I'm still here
          </Button>
        </div>
      </div>
    );
  }

  if (showAbsoluteWarn && dismissed !== "absolute") {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="bg-blue-600 text-white rounded-lg shadow-2xl p-4">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Session ending soon</p>
              <p className="text-blue-100 text-xs mt-0.5">
                Your session expires in{" "}
                <span className="font-mono font-bold text-white">{formatTime(absoluteRemaining)}</span>.
                Save your work and sign in again when needed.
              </p>
            </div>
            <button
              onClick={() => setDismissed("absolute")}
              className="text-blue-200 hover:text-white text-xs flex-shrink-0"
            >
              &times;
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
