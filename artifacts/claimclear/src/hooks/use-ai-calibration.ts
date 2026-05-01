import { useQueries } from "@tanstack/react-query";
import {
  getGetAiCalibrationQueryKey,
  getAiCalibration,
  type AiCalibrationResponse,
} from "@workspace/api-client-react";

const CALIBRATION_QUERY_OPTIONS = {
  staleTime: Infinity,
  gcTime: 60 * 60 * 1000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function useAiCalibrations(
  errorTypeIds: ReadonlyArray<string | null | undefined>,
): {
  calibrationByErrorType: Map<string, AiCalibrationResponse>;
  isLoading: boolean;
} {
  const uniqueIds = Array.from(
    new Set(
      errorTypeIds.filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: getGetAiCalibrationQueryKey({ errorTypeId: id }),
      queryFn: () => getAiCalibration({ errorTypeId: id }),
      ...CALIBRATION_QUERY_OPTIONS,
    })),
  });

  const map = new Map<string, AiCalibrationResponse>();
  let isLoading = false;
  uniqueIds.forEach((id, idx) => {
    const r = results[idx];
    if (r?.data) map.set(id, r.data);
    if (r?.isLoading) isLoading = true;
  });

  return { calibrationByErrorType: map, isLoading };
}
