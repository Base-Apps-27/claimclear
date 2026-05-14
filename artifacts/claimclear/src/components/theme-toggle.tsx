import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WrapTooltip } from "@/components/info-tooltip";
import { useTheme, useThemeToggleNewIndicator } from "@/hooks/use-theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { isNew, dismiss } = useThemeToggleNewIndicator();
  const isDark = theme === "dark";

  const handleClick = () => {
    toggleTheme();
    if (isNew) dismiss();
  };

  return (
    <WrapTooltip
      content={
        isNew
          ? "New! Toggle dark mode — your choice is remembered on this browser."
          : isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
      }
      side="bottom"
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClick}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        aria-pressed={isDark}
        data-testid="theme-toggle"
        className="relative h-8 w-8"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        {isNew && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-card"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent/60 animate-ping"
            />
            <span className="sr-only">New feature</span>
          </>
        )}
      </Button>
    </WrapTooltip>
  );
}
