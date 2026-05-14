import * as React from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "cc-theme";
const NEW_INDICATOR_KEY = "cc-theme-toggle-seen";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {
    // ignore
  }
  return "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function useTheme() {
  const [theme, setThemeState] = React.useState<Theme>(() => readStoredTheme());

  React.useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore quota / privacy mode failures
    }
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = React.useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return { theme, setTheme, toggleTheme };
}

export function useThemeToggleNewIndicator() {
  const [isNew, setIsNew] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(NEW_INDICATOR_KEY) !== "1";
    } catch {
      return false;
    }
  });

  const dismiss = React.useCallback(() => {
    setIsNew(false);
    try {
      window.localStorage.setItem(NEW_INDICATOR_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  return { isNew, dismiss };
}
