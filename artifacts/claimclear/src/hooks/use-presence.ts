import { useEffect } from "react";
import { usePresenceHeartbeat, usePresenceLeave, useGetPresence, getGetPresenceQueryKey } from "@workspace/api-client-react";

export function usePresence(claimId: number | undefined) {
  const heartbeat = usePresenceHeartbeat();
  const leave = usePresenceLeave();
  
  const { data: viewers = [] } = useGetPresence(claimId || 0, {
    query: {
      queryKey: getGetPresenceQueryKey(claimId || 0),
      enabled: !!claimId,
      refetchInterval: 10000,
    }
  });

  useEffect(() => {
    if (!claimId) return;

    // Initial heartbeat
    heartbeat.mutate({ data: { claimId } });

    // Set up interval for continuous heartbeats
    const interval = setInterval(() => {
      heartbeat.mutate({ data: { claimId } });
    }, 15000); // 15s

    return () => {
      clearInterval(interval);
      leave.mutate({ data: { claimId } });
    };
  }, [claimId, heartbeat.mutate, leave.mutate]);

  return { viewers };
}
