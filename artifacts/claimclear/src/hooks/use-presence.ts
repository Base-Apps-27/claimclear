import { useEffect } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { usePresenceHeartbeat, usePresenceLeave, useGetPresence, getGetPresenceQueryKey } from "@workspace/api-client-react";

export type PresenceResourceType = "claim" | "invoice_group";

export function usePresence(resourceType: PresenceResourceType, resourceId: number | undefined) {
  const heartbeat = usePresenceHeartbeat();
  const leave = usePresenceLeave();
  const { user } = useAuth();

  const safeId = resourceId || 0;

  const { data } = useGetPresence(resourceType, safeId, {
    query: {
      queryKey: getGetPresenceQueryKey(resourceType, safeId),
      enabled: !!resourceId,
      refetchInterval: 10000,
    }
  });

  const viewers = data?.viewers ?? [];
  const botActivity = data?.botActivity ?? [];
  const otherViewers = user?.email
    ? viewers.filter(v => v.userEmail !== user.email)
    : viewers;
  const othersPresent = otherViewers.length > 0;

  useEffect(() => {
    if (!resourceId) return;

    heartbeat.mutate({ data: { resourceType, resourceId } });

    const interval = setInterval(() => {
      heartbeat.mutate({ data: { resourceType, resourceId } });
    }, 15000);

    return () => {
      clearInterval(interval);
      leave.mutate({ data: { resourceType, resourceId } });
    };
  }, [resourceType, resourceId, heartbeat.mutate, leave.mutate]);

  return { viewers, botActivity, otherViewers, othersPresent };
}
