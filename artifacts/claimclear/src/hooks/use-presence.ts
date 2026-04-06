import { useEffect } from "react";
import { usePresenceHeartbeat, usePresenceLeave, useGetPresence, getGetPresenceQueryKey } from "@workspace/api-client-react";

export function usePresence(claimId: number | undefined) {
  const heartbeat = usePresenceHeartbeat();
  const leave = usePresenceLeave();
  
  const { data } = useGetPresence(claimId || 0, {
    query: {
      queryKey: getGetPresenceQueryKey(claimId || 0),
      enabled: !!claimId,
      refetchInterval: 10000,
    }
  });

  const viewers = data?.viewers ?? [];
  const botActivity = data?.botActivity ?? [];

  useEffect(() => {
    if (!claimId) return;

    heartbeat.mutate({ data: { claimId } });

    const interval = setInterval(() => {
      heartbeat.mutate({ data: { claimId } });
    }, 15000);

    return () => {
      clearInterval(interval);
      leave.mutate({ data: { claimId } });
    };
  }, [claimId, heartbeat.mutate, leave.mutate]);

  return { viewers, botActivity };
}
