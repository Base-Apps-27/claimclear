import { useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";

// ────────────────────────────────────────────────────────────────────────────
// In-app navigation history tracker
// ────────────────────────────────────────────────────────────────────────────
// Wouter does not expose a history-depth API, and `window.history.length`
// is unreliable (it includes pre-app entries from the same tab as well as
// the initial entry that wouter installs on mount). We track in-app
// navigations ourselves by incrementing a module-level counter on every
// wouter location change EXCEPT the very first render. That gives us a
// trustworthy answer to "did the user actually navigate inside the app?":
//
//   - Fresh tab / deep link / sidebar click as first action:
//       counter = 0 → BackBar uses fallbackHref (logical parent).
//   - User navigated within the app at least once:
//       counter > 0 → BackBar uses window.history.back() (true N-1).
//
// This means a user who deep-links into a leg detail and clicks Back lands
// on the leg's parent invoice (sensible) instead of being bounced to a
// pre-app page or stranded on a no-op.
// ────────────────────────────────────────────────────────────────────────────

let inAppNavCount = 0;

export function hasInAppHistory(): boolean {
  return inAppNavCount > 0;
}

// For tests / story isolation only. Production code should not call this.
export function resetInAppHistoryForTests(): void {
  inAppNavCount = 0;
}

export function HistoryTracker(): null {
  const [location] = useLocation();
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    inAppNavCount += 1;
  }, [location]);
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// BackBar — the hybrid back affordance
// ────────────────────────────────────────────────────────────────────────────
// Renders two affordances side-by-side, both honest:
//
//   1. A literal "← Back" button — true browser-back (N-1) when there is
//      in-app history; otherwise falls back to `fallbackHref` so a user
//      who landed via deep link still has a sensible escape.
//
//   2. A breadcrumb trail — every crumb except the last is a real link to
//      the surface its label names. No more "Claims" routing to /queue,
//      no more "Invoice groups" routing to /dashboard.
//
// Last crumb is always rendered as plain text (you are here).
// ────────────────────────────────────────────────────────────────────────────

export type Crumb = {
  label: string;
  href?: string;
  // When true, render the label in monospace — useful for invoice numbers
  // and IDs that should read as identifiers, not prose.
  mono?: boolean;
};

interface BackBarProps {
  // Where the Back button goes when there is no in-app history yet
  // (deep-link / fresh-tab landing). Should be the logical parent of the
  // current page — for example `/invoice-groups` for a single invoice
  // group detail page.
  fallbackHref: string;
  crumbs: Crumb[];
  testId?: string;
}

export function BackBar({ fallbackHref, crumbs, testId }: BackBarProps) {
  const [, navigate] = useLocation();

  const handleBack = () => {
    if (hasInAppHistory()) {
      window.history.back();
    } else {
      navigate(fallbackHref);
    }
  };

  return (
    <div
      className="flex items-center gap-3 text-xs flex-wrap"
      data-testid={testId ?? "back-bar"}
    >
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-1 px-2 py-1 rounded border hover:bg-muted transition-colors"
        style={{ borderColor: "var(--cc-border)", color: "var(--cc-fg)" }}
        data-testid="back-button"
      >
        <ChevronLeft className="w-3 h-3" /> Back
      </button>
      <div
        className="flex items-center gap-1.5"
        style={{ color: "var(--cc-muted-fg)" }}
        data-testid="back-bar-crumbs"
      >
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          const content = c.mono ? (
            <span className="mono">{c.label}</span>
          ) : (
            <span>{c.label}</span>
          );
          return (
            <span
              key={`${i}-${c.label}`}
              className="inline-flex items-center gap-1.5"
            >
              {i > 0 && <span>/</span>}
              {isLast || !c.href ? (
                <span style={{ color: "var(--cc-fg)" }}>{content}</span>
              ) : (
                <Link href={c.href} className="hover:underline">
                  {content}
                </Link>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
