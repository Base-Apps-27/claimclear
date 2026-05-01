import { useGetFeatureFlags, getGetFeatureFlagsQueryKey } from "@workspace/api-client-react";

export function useFeatureFlags(): {
  perInvoiceTransitionEnabled: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useGetFeatureFlags({
    query: {
      queryKey: getGetFeatureFlagsQueryKey(),
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  return {
    perInvoiceTransitionEnabled: data?.perInvoiceTransitionEnabled ?? false,
    isLoading,
  };
}
