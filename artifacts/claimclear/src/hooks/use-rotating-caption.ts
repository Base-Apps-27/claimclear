import * as React from "react";

export interface UseRotatingCaptionOptions {
  /** Whether the loader is currently active. Resets when toggled false. */
  active: boolean;
  /** Captions to cycle through. Index 0 is shown immediately. */
  captions: readonly string[];
  /** Delay before the first rotation kicks in (ms). Default 2000. */
  startAfterMs?: number;
  /** Interval between rotations after the start delay (ms). Default 2500. */
  intervalMs?: number;
}

/**
 * Cycles through reassuring loading captions on slow loads (Task #493).
 *
 * The first caption is returned immediately. After `startAfterMs`, the
 * caption rotates through the remaining entries on `intervalMs`. Short
 * loads (that finish before the start delay) never see a copy change.
 *
 * Reduced-motion users still get the rotation — the spec calls out that
 * the caption change is informational, not animation.
 */
export function useRotatingCaption({
  active,
  captions,
  startAfterMs = 2000,
  intervalMs = 2500,
}: UseRotatingCaptionOptions): string {
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    if (!active || captions.length <= 1) {
      setIndex(0);
      return;
    }
    setIndex(0);
    let intervalId: number | null = null;
    const timeoutId = window.setTimeout(() => {
      setIndex((prev) => (prev + 1) % captions.length);
      intervalId = window.setInterval(() => {
        setIndex((prev) => (prev + 1) % captions.length);
      }, intervalMs);
    }, startAfterMs);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [active, captions.length, startAfterMs, intervalMs]);

  return captions[index] ?? captions[0] ?? "";
}
