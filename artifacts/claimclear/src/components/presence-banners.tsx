import { useEffect, useState, useRef } from "react";
import type { PresenceViewer, BotPresenceEntry } from "@workspace/api-client-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Eye, Bot, Cog } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";

function timeAgo(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  return `${hours} hours ago`;
}

function useAnimatedVisibility(isActive: boolean) {
  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState<"enter" | "exit" | null>(null);

  useEffect(() => {
    if (isActive && !mounted) {
      setMounted(true);
      setAnimating("enter");
      const timer = setTimeout(() => setAnimating(null), 300);
      return () => clearTimeout(timer);
    }
    if (!isActive && mounted) {
      setAnimating("exit");
      const timer = setTimeout(() => {
        setMounted(false);
        setAnimating(null);
      }, 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isActive, mounted]);

  return { mounted, animating };
}

type PresenceTransitionState = "idle" | "joining" | "leaving";
type ViewerTransition = { viewer: PresenceViewer; state: PresenceTransitionState };

const PRESENCE_RIPPLE_MS = 500;
const PRESENCE_LEAVE_MS = 200;

/**
 * Tracks presence-list joins and leaves so we can play a one-shot ripple on
 * join and a brief fade on leave. Skips ripples on the very first commit so
 * a fresh page load doesn't ripple every already-present viewer. Keeps a
 * leaving viewer mounted for ~200ms after they disappear from the upstream
 * list so the fade-out can play before unmount. Stable identity is the
 * viewer email — re-orders or background refetches that don't change the
 * email set won't fire a ripple.
 */
function usePresenceTransitions(viewers: PresenceViewer[]): ViewerTransition[] {
  const [items, setItems] = useState<ViewerTransition[]>(() =>
    viewers.map(v => ({ viewer: v, state: "idle" as const })),
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const initialMountRef = useRef(true);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const viewersKey = viewers.map(v => v.userEmail).sort().join("|");

  useEffect(() => {
    const prev = itemsRef.current;
    const prevByEmail = new Map(prev.map(p => [p.viewer.userEmail, p]));
    const currentEmails = new Set(viewers.map(v => v.userEmail));
    const wasInitialMount = initialMountRef.current;
    const result: ViewerTransition[] = [];

    viewers.forEach(v => {
      // If this viewer was mid-leave (e.g. flapping connection), cancel the
      // leave so we don't yank them out from under a re-join.
      const leaveKey = `leave:${v.userEmail}`;
      const pendingLeave = timersRef.current.get(leaveKey);
      if (pendingLeave) {
        clearTimeout(pendingLeave);
        timersRef.current.delete(leaveKey);
      }

      const existing = prevByEmail.get(v.userEmail);
      if (!existing || existing.state === "leaving") {
        if (wasInitialMount) {
          result.push({ viewer: v, state: "idle" });
        } else {
          result.push({ viewer: v, state: "joining" });
          const joinKey = `join:${v.userEmail}`;
          const oldJoin = timersRef.current.get(joinKey);
          if (oldJoin) clearTimeout(oldJoin);
          const email = v.userEmail;
          timersRef.current.set(
            joinKey,
            setTimeout(() => {
              timersRef.current.delete(joinKey);
              setItems(curr =>
                curr.map(p =>
                  p.viewer.userEmail === email && p.state === "joining"
                    ? { ...p, state: "idle" }
                    : p,
                ),
              );
            }, PRESENCE_RIPPLE_MS),
          );
        }
      } else {
        // Preserve any in-flight transition (e.g. mid-ripple) and refresh the
        // viewer payload so heartbeat updates flow through without restarting
        // the animation.
        result.push({ viewer: v, state: existing.state });
      }
    });

    prev.forEach(p => {
      if (currentEmails.has(p.viewer.userEmail)) return;
      if (p.state === "leaving") {
        // Already leaving with a timer in flight — keep the entry.
        result.push(p);
        return;
      }
      result.push({ viewer: p.viewer, state: "leaving" });
      const leaveKey = `leave:${p.viewer.userEmail}`;
      const oldLeave = timersRef.current.get(leaveKey);
      if (oldLeave) clearTimeout(oldLeave);
      const email = p.viewer.userEmail;
      timersRef.current.set(
        leaveKey,
        setTimeout(() => {
          timersRef.current.delete(leaveKey);
          setItems(curr =>
            curr.filter(q => !(q.viewer.userEmail === email && q.state === "leaving")),
          );
        }, PRESENCE_LEAVE_MS),
      );
    });

    initialMountRef.current = false;
    setItems(result);
  }, [viewersKey]);

  useEffect(
    () => () => {
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current.clear();
    },
    [],
  );

  return items;
}

function ViewerAvatar({
  viewer,
  state,
}: {
  viewer: PresenceViewer;
  state: PresenceTransitionState;
}) {
  const name = viewer.userName || viewer.userEmail;
  const initial = name.charAt(0).toUpperCase();

  // Opacity classes: leaving fades to 0, joining and idle stay visible.
  // The CSS transition handles both the leave fade-out and the in-place
  // fade-in (initial mount of the wrapper renders at opacity 0 only when
  // state === "joining" because we add the join keyframe class).
  const wrapperClass =
    state === "leaving"
      ? "opacity-0"
      : state === "joining"
        ? "animate-presence-fade-in"
        : "opacity-100";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`relative transition-opacity duration-200 ${wrapperClass}`}
          aria-hidden={state === "leaving" ? "true" : undefined}
        >
          <Avatar className="h-8 w-8 border-2 border-blue-400 shadow-sm">
            <AvatarFallback className="text-xs font-medium bg-blue-100 text-blue-700">
              {initial}
            </AvatarFallback>
          </Avatar>
          {state === "joining" && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full pointer-events-none animate-presence-ripple motion-reduce:hidden"
            />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="font-medium">{name}</p>
        {viewer.lastHeartbeat && (
          <p className="text-xs opacity-80">Viewing since {timeAgo(viewer.lastHeartbeat)}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function HumanPresenceBanner({
  viewers,
  resourceLabel = "claim",
}: {
  viewers: PresenceViewer[];
  resourceLabel?: "claim" | "group";
}) {
  const { user } = useAuth();
  const otherViewers = viewers.filter(v => v.userEmail !== user?.email);
  const { mounted, animating } = useAnimatedVisibility(otherViewers.length > 0);
  const transitions = usePresenceTransitions(otherViewers);

  if (!mounted) return null;

  const names = otherViewers.map(v => v.userName || v.userEmail);
  const nameList = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`;

  const animClass = animating === "enter"
    ? "animate-in slide-in-from-top-2 fade-in duration-300"
    : animating === "exit"
      ? "animate-out fade-out slide-out-to-top-2 duration-300"
      : "";

  return (
    <div className={`${animClass} rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-3 flex items-center gap-3`}>
      <Eye className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
          {nameList} {otherViewers.length === 1 ? "is" : "are"} also viewing this {resourceLabel}
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400">
          {otherViewers.length === 1 && otherViewers[0].lastHeartbeat
            ? `Viewing since ${timeAgo(otherViewers[0].lastHeartbeat)} — actions disabled to prevent conflicts`
            : `Also viewing this ${resourceLabel} — actions disabled to prevent conflicts`}
        </p>
      </div>
      <div className="flex -space-x-2 shrink-0">
        {transitions.map(t => (
          <ViewerAvatar key={t.viewer.userEmail} viewer={t.viewer} state={t.state} />
        ))}
      </div>
    </div>
  );
}

export function BotPresenceBanner({ botActivity }: { botActivity: BotPresenceEntry[] }) {
  const { mounted, animating } = useAnimatedVisibility(botActivity.length > 0);

  if (!mounted) return null;

  const processLabels: Record<string, string> = {
    portal_submission: "Portal submission in progress",
    email_generation: "AI email generation in progress",
  };

  const animClass = animating === "enter"
    ? "animate-in slide-in-from-top-2 fade-in duration-300"
    : animating === "exit"
      ? "animate-out fade-out slide-out-to-top-2 duration-300"
      : "";

  return (
    <div className={`${animClass} rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 flex items-center gap-3`}>
      <div className="relative shrink-0">
        <Bot className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        <Cog className="h-3 w-3 text-amber-500 dark:text-amber-300 absolute -bottom-0.5 -right-0.5 animate-spin" style={{ animationDuration: "3s" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
          Automated process active
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {botActivity.map(b => processLabels[b.type] || `${b.type} in progress`).join(" · ")}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
        </span>
        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Processing</span>
      </div>
    </div>
  );
}

export function PresenceAvatars({ viewers }: { viewers: PresenceViewer[] }) {
  const { user } = useAuth();
  const otherViewers = viewers.filter(v => v.userEmail !== user?.email);
  const transitions = usePresenceTransitions(otherViewers);

  if (transitions.length === 0) return null;

  return (
    <div className="flex -space-x-2 mr-2">
      {transitions.map(t => (
        <ViewerAvatar key={t.viewer.userEmail} viewer={t.viewer} state={t.state} />
      ))}
    </div>
  );
}
