import { useGetSystemHealthRollup, getGetSystemHealthRollupQueryKey } from "@workspace/api-client-react";
import { AlertTriangle, AlertCircle } from "lucide-react";

interface Props {
  variant?: "compact" | "full";
}

export function WorkerHealthBanner({ variant = "compact" }: Props) {
  const { data, isError } = useGetSystemHealthRollup({
    query: {
      queryKey: getGetSystemHealthRollupQueryKey(),
      refetchInterval: 30000,
      retry: false,
    },
  });

  if (isError || !data) return null;
  if (data.overall === "ok") return null;

  const isFailed = data.overall === "failed";
  const Icon = isFailed ? AlertCircle : AlertTriangle;
  const color = isFailed
    ? "border-red-500 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100"
    : "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100";

  const failingComponents = data.components.filter(
    (c) => c.status === "failed" || c.status === "degraded"
  );

  return (
    <div className={`rounded-md border-l-4 p-3 ${color}`} role="status">
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1 text-sm">
          <p className="font-semibold">
            {isFailed ? "System health: failed" : "System health: degraded"}
          </p>
          {variant === "full" && failingComponents.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs">
              {failingComponents.slice(0, 6).map((c) => (
                <li key={c.name}>
                  <span className="font-mono">{c.name}</span>
                  {c.detail ? <> — {c.detail}</> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs mt-0.5">
              {data.overdueCount > 0
                ? `${data.overdueCount} pending submission(s) overdue (>${data.overdueThresholdMinutes} min). `
                : null}
              {failingComponents.length} component(s) need attention.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
