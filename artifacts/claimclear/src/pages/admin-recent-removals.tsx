import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

interface RemovalItem {
  kind: "claim_withdrawn" | "claim_removed_offline" | "group_withdrawn" | "group_draft_discarded";
  id: string;
  refId: number;
  ref: string;
  type: string;
  removedAt: string;
  expiresAt: string;
  actorEmail: string | null;
  actorName: string | null;
  reasonNote: string | null;
  auditLogId: number | null;
  label: string;
  detail: string | null;
}

interface RemovalsResponse {
  items: RemovalItem[];
  retentionDays: number;
}

function formatRelative(iso: string, now: Date): string {
  const target = new Date(iso).getTime();
  const diffMs = target - now.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays > 0) return `in ${diffDays}d`;
  if (diffDays < 0) return `${Math.abs(diffDays)}d ago`;
  const diffHours = Math.round(diffMs / (60 * 60 * 1000));
  if (diffHours === 0) return "moments";
  return diffHours > 0 ? `in ${diffHours}h` : `${Math.abs(diffHours)}h ago`;
}

export default function AdminRecentRemovals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = useMemo(() => new Date(), []);

  const { data, isLoading, error, refetch } = useQuery<RemovalsResponse>({
    queryKey: ["/api/admin/removals"],
    queryFn: () =>
      customFetch<RemovalsResponse>("/api/admin/removals", { method: "GET" }),
  });

  const restore = useMutation({
    mutationFn: async ({ kind, refId }: { kind: RemovalItem["kind"]; refId: number }) => {
      return customFetch<{ ok: boolean }>(
        `/api/admin/removals/${encodeURIComponent(kind)}/${refId}/restore`,
        { method: "POST" },
      );
    },
    onSuccess: (_res, vars) => {
      toast({ title: "Restored", description: `${vars.kind} has been restored.` });
      qc.invalidateQueries({ queryKey: ["/api/admin/removals"] });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Restore failed", description: message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Recent removals</h1>
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Recent removals</h1>
        <p className="text-red-600">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
        <Button className="mt-3" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const items = data?.items ?? [];
  const retentionDays = data?.retentionDays ?? 30;

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-semibold mb-2">Recent removals</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Withdrawn claims, withdrawn invoice groups, claims marked handled-offline, and
        discarded dispute drafts can be restored within {retentionDays} days. After that the
        nightly purge clears them permanently.
      </p>

      {items.length === 0 ? (
        <div className="rounded border bg-muted/30 p-6 text-center text-muted-foreground">
          Nothing to restore — no removals in the last {retentionDays} days.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse" data-testid="table-recent-removals">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-3">Reference</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2 pr-3">Removed</th>
                <th className="py-2 pr-3">Reason note</th>
                <th className="py-2 pr-3">Auto-purge</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b align-top" data-testid={`row-removal-${item.id}`}>
                  <td className="py-2 pr-3 font-medium">
                    <div data-testid={`text-ref-${item.id}`}>{item.ref}</div>
                    <div className="text-xs text-muted-foreground">{item.detail ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-3" data-testid={`text-type-${item.id}`}>{item.type}</td>
                  <td className="py-2 pr-3" data-testid={`text-actor-${item.id}`}>
                    {item.actorName || item.actorEmail || (
                      <span className="text-muted-foreground italic">unknown</span>
                    )}
                    {item.actorName && item.actorEmail ? (
                      <div className="text-xs text-muted-foreground">{item.actorEmail}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3" title={item.removedAt}>{formatRelative(item.removedAt, now)}</td>
                  <td className="py-2 pr-3 max-w-xs" data-testid={`text-reason-${item.id}`}>
                    {item.reasonNote ? (
                      <span className="text-muted-foreground" title={item.reasonNote}>
                        {item.reasonNote.length > 120 ? `${item.reasonNote.slice(0, 120)}…` : item.reasonNote}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">none</span>
                    )}
                  </td>
                  <td className="py-2 pr-3" title={item.expiresAt}>{formatRelative(item.expiresAt, now)}</td>
                  <td className="py-2 pr-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`button-restore-${item.id}`}
                      disabled={restore.isPending}
                      onClick={() => restore.mutate({ kind: item.kind, refId: item.refId })}
                    >
                      Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
