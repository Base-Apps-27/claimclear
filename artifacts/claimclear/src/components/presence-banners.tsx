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

function ViewerAvatar({ viewer, isNew }: { viewer: PresenceViewer; isNew: boolean }) {
  const name = viewer.userName || viewer.userEmail;
  const initial = name.charAt(0).toUpperCase();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`relative ${isNew ? "animate-in zoom-in-50 duration-300" : ""}`}>
          <Avatar className="h-8 w-8 border-2 border-blue-400 shadow-sm">
            <AvatarFallback className="text-xs font-medium bg-blue-100 text-blue-700">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="absolute inset-0 rounded-full animate-pulse-ring" />
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

export function HumanPresenceBanner({ viewers }: { viewers: PresenceViewer[] }) {
  const { user } = useAuth();
  const prevViewersRef = useRef<Set<string>>(new Set());
  const [newViewers, setNewViewers] = useState<Set<string>>(new Set());

  const otherViewers = viewers.filter(v => v.userEmail !== user?.email);
  const { mounted, animating } = useAnimatedVisibility(otherViewers.length > 0);

  useEffect(() => {
    const currentEmails = new Set(otherViewers.map(v => v.userEmail));
    const prevEmails = prevViewersRef.current;
    const justJoined = new Set<string>();
    currentEmails.forEach(email => {
      if (!prevEmails.has(email)) justJoined.add(email);
    });
    if (justJoined.size > 0) {
      setNewViewers(justJoined);
      const timer = setTimeout(() => setNewViewers(new Set()), 2000);
      prevViewersRef.current = currentEmails;
      return () => clearTimeout(timer);
    }
    prevViewersRef.current = currentEmails;
    return undefined;
  }, [otherViewers.map(v => v.userEmail).join(",")]);

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
          {nameList} {otherViewers.length === 1 ? "is" : "are"} also viewing this claim
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400">
          {otherViewers.length === 1 && otherViewers[0].lastHeartbeat
            ? `Viewing since ${timeAgo(otherViewers[0].lastHeartbeat)} — coordinate before making changes`
            : "Also viewing this claim — coordinate before making changes"}
        </p>
      </div>
      <div className="flex -space-x-2 shrink-0">
        {otherViewers.map(v => (
          <ViewerAvatar key={v.userEmail} viewer={v} isNew={newViewers.has(v.userEmail)} />
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

  if (otherViewers.length === 0) return null;

  return (
    <div className="flex -space-x-2 mr-2">
      {otherViewers.map(v => (
        <ViewerAvatar key={v.userEmail} viewer={v} isNew={false} />
      ))}
    </div>
  );
}
