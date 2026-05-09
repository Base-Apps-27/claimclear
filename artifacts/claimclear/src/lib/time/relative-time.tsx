// `<RelativeTime>` — a relative-time render that always carries an
// absolute-time hover tooltip in the display TZ. Centralised so every
// "3m ago" surface gets the same hover affordance (#562 — operators
// were guessing the wall-clock time behind a relative label).

import { useEffect, useState } from "react";
import { absoluteTooltip, formatRelative } from "./index";

interface Props {
  iso: string | null | undefined;
  /** When true, re-renders every 60s so "3m ago" stays accurate without a parent ticker. */
  live?: boolean;
  className?: string;
  testId?: string;
}

export function RelativeTime({ iso, live = false, className, testId }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, [live]);
  if (!iso) return null;
  return (
    <span
      className={className}
      title={absoluteTooltip(iso)}
      data-testid={testId}
    >
      {formatRelative(iso)}
    </span>
  );
}
