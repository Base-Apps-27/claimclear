import { forwardRef, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMyActivitySummary,
  getGetMyActivitySummaryQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ActivityHeatmap } from "@/components/activity-heatmap";

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

interface ActivityHoverCardProps {
  // The wrapped trigger element. Caller is responsible for ensuring
  // the wrapped element represents the CURRENT signed-in user — the
  // card is self-only by design (no admin/teammate view in v1) and
  // must never be reused around an avatar that points at someone
  // else (e.g. activity-feed actor avatars). See Task #522.
  children: React.ReactNode;
  // Forwarded to the side of the hover card content. Defaults to
  // `right` for the sidebar avatar (sidebar pins the trigger to the
  // left edge of the viewport so opening rightward gives the most
  // room); the header badge passes `bottom`.
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

// Only attached to the signed-in user's own avatar/badge. Fetches
// `/api/dashboard/my-activity-summary` lazily on first open so the
// card is free for users who never hover the avatar; subsequent
// opens are instant thanks to the React Query cache.
export function ActivityHoverCard({ children, side = "right", align = "start" }: ActivityHoverCardProps) {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const tz = useMemo(() => getLocalTimezone(), []);
  const [hasOpened, setHasOpened] = useState(false);

  const queryKey = getGetMyActivitySummaryQueryKey({ tz });
  const enabled = hasOpened && isAuthenticated && user?.status === "approved";
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: ({ signal }) => getMyActivitySummary({ tz }, { signal }),
    enabled,
    // Subsequent opens within a minute are served from cache; the
    // 60s window matches the pip ring's safety-net polling cadence
    // and the SSE invalidation hook (`useStreakPipLiveUpdates`)
    // keeps the data fresh after every qualifying action.
    staleTime: 60_000,
  });

  function handleOpenChange(next: boolean) {
    if (next) {
      setHasOpened(true);
      // Pre-warm: if the cache went stale and we just opened, fire a
      // refetch so the operator sees the latest "today" instead of
      // a number from before the last bump.
      queryClient.invalidateQueries({ queryKey });
    }
  }

  if (!isAuthenticated || !user) return <>{children}</>;

  const fallback = user.displayName?.charAt(0) || user.email.charAt(0).toUpperCase();

  return (
    <HoverCard openDelay={250} closeDelay={120} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        <ActivityHoverCardTrigger>{children}</ActivityHoverCardTrigger>
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={10}
        className="w-[420px] p-4"
        data-testid="activity-hover-card"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={user.profileImageUrl || undefined} />
              <AvatarFallback>{fallback}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {user.displayName || "You"}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {user.email}
              </div>
            </div>
          </div>

          {isError ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              Couldn't load your activity right now.
            </div>
          ) : isLoading || !data ? (
            <div className="space-y-3" aria-busy="true">
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className="h-14 rounded-md bg-muted animate-pulse"
                  />
                ))}
              </div>
              <div className="h-20 rounded-md bg-muted animate-pulse" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                <StatTile label="Today" value={data.today} />
                <StatTile label="This week" value={data.thisWeek} />
                <StatTile label="This month" value={data.thisMonth} />
                <StatTile
                  label="Day streak"
                  value={data.streak}
                  hint="working days"
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Last 12 weeks
                </div>
                {data.dailyCounts.every(d => d.count === 0) ? (
                  <>
                    <div className="text-xs text-muted-foreground">
                      No activity in the last 12 weeks — yet.
                    </div>
                    <ActivityHeatmap dailyCounts={data.dailyCounts} />
                  </>
                ) : (
                  <ActivityHeatmap dailyCounts={data.dailyCounts} />
                )}
              </div>
            </>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// Forwarded-ref wrapper so Radix's `HoverCardTrigger asChild` always
// has a real DOM node to attach pointer / focus / aria handlers to —
// regardless of whether the caller passes a forwardRef component
// (`StreakPipAvatar`), a plain wrapper component (`WrapTooltip`), or
// a raw element. Without this, Radix silently fails to bind hover
// handlers and the card never opens. Render-as-`span` so we don't
// disturb the existing layout (the avatar's flex/gap parent and the
// header badge's inline-flex pill are both happy inside a span).
const ActivityHoverCardTrigger = forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { children: React.ReactNode }
>(({ children, ...props }, ref) => (
  <span
    ref={ref}
    {...props}
    className="inline-flex items-center outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
    tabIndex={0}
  >
    {children}
  </span>
));
ActivityHoverCardTrigger.displayName = "ActivityHoverCardTrigger";

function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md border bg-card px-2 py-2 text-center">
      <div className="text-xl font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
        {label}
      </div>
      {hint ? (
        <div className="text-[9px] text-muted-foreground/70 leading-tight">{hint}</div>
      ) : null}
    </div>
  );
}
