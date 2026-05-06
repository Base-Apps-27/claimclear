import * as React from "react"
import { cn } from "@/lib/utils"
import { useReducedMotion } from "@/hooks/use-reduced-motion"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  )
}

export interface SkeletonSwapProps {
  /** While true the skeleton is visible; once false the children fade in. */
  loading: boolean;
  /** Skeleton tree shown while loading. */
  skeleton: React.ReactNode;
  /** Loaded content. */
  children: React.ReactNode;
  className?: string;
  /** Crossfade duration in ms. Default 150. */
  durationMs?: number;
}

/**
 * Crossfade swap between a skeleton tree and its loaded content
 * (Task #493). Replaces the hard pop you get when content arrives.
 *
 * Three internal phases keep the animation tight without a blank frame:
 *   - "loading"      → only the skeleton is rendered (drives layout).
 *   - "transitioning" → on the load-completion edge we render BOTH:
 *       children mount opaque-fading-in for `durationMs`, with the
 *       skeleton overlaid absolutely fading 1 → 0 over the same window.
 *       Both keyframes run from real CSS classes (see index.css) so
 *       neither tree ever flashes blank.
 *   - "loaded"       → the skeleton unmounts, children remain.
 *
 * Reduced-motion users get an instant swap — the wrapper drops the
 * fade entirely and renders only the active child.
 */
export function SkeletonSwap({
  loading,
  skeleton,
  children,
  className,
  durationMs = 150,
}: SkeletonSwapProps) {
  const reduced = useReducedMotion();

  type Phase = "loading" | "transitioning" | "loaded";
  const [phase, setPhase] = React.useState<Phase>(loading ? "loading" : "loaded");

  React.useEffect(() => {
    if (reduced) {
      setPhase(loading ? "loading" : "loaded");
      return;
    }
    if (loading) {
      setPhase("loading");
      return;
    }
    setPhase("transitioning");
    const t = window.setTimeout(() => setPhase("loaded"), durationMs);
    return () => window.clearTimeout(t);
  }, [loading, durationMs, reduced]);

  if (reduced) {
    return (
      <div
        className={className}
        data-testid="skeleton-swap"
        data-reduced-motion="true"
        data-loading={loading ? "true" : "false"}
      >
        {loading ? skeleton : children}
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div
        className={className}
        data-testid="skeleton-swap"
        data-loading="true"
      >
        {skeleton}
      </div>
    );
  }

  if (phase === "loaded") {
    return (
      <div
        className={className}
        data-testid="skeleton-swap"
        data-loading="false"
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn("relative", className)}
      data-testid="skeleton-swap"
      data-loading="transitioning"
    >
      <div className="cc-skeleton-fade-in">{children}</div>
      <div
        aria-hidden
        className="cc-skeleton-fade-out absolute inset-0 pointer-events-none"
      >
        {skeleton}
      </div>
    </div>
  );
}

export { Skeleton }
