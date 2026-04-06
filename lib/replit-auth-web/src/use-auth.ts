import { useState, useEffect, useCallback, useRef } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

export type SessionExpiryReason = "expired_absolute" | "expired_idle" | null;

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sessionExpiry: SessionExpiryReason;
  login: () => void;
  logout: () => void;
  clearAuth: () => void;
}

const AUTH_POLL_INTERVAL = 2 * 60 * 1000;

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpiry, setSessionExpiry] = useState<SessionExpiryReason>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { user: AuthUser | null; sessionExpiry?: string };
      setUser(data.user ?? null);
      if (!data.user && data.sessionExpiry) {
        setSessionExpiry(data.sessionExpiry as SessionExpiryReason);
      }
    } catch {
      setUser(null);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    checkAuth();
    pollRef.current = setInterval(checkAuth, AUTH_POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [checkAuth]);

  const clearAuth = useCallback(() => {
    setUser(null);
    setSessionExpiry("expired_idle");
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const login = useCallback(() => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";
    window.location.href = `/api/login?returnTo=${encodeURIComponent(base)}`;
  }, []);

  const logout = useCallback(() => {
    window.location.href = "/api/logout";
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    sessionExpiry,
    login,
    logout,
    clearAuth,
  };
}
