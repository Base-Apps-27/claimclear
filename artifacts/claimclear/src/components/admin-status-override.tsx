// Task #681 — admin-only status override dropdown ported from
// `invoice-group-detail-v2.tsx` so the queue page (the sole place
// operators process invoices) keeps the same backwards-transition
// escape hatch admins relied on for stuck invoices.
//
// Lives in its own file (instead of inline in
// `inline-group-workspace-mini.tsx`) to keep its surface small enough
// to render in a behavior test without importing the entire queue
// workspace. Gated by both an `isAdmin` early return and the
// `HideForClerk` wrapper so a misconfigured role context still can't
// surface the trigger to a clerk.
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoiceGroupValidTransitions,
  useUpdateInvoiceGroupStatus,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { partitionTransitions } from "@/lib/transitions-partition";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HideForClerk } from "@/lib/role";
import { useToast, successToast } from "@/hooks/use-toast";

export function AdminStatusOverride({
  groupId,
  currentStatus,
}: {
  groupId: number;
  currentStatus: string | null;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: validTransitions } = useGetInvoiceGroupValidTransitions(groupId);
  const updateStatusMutation = useUpdateInvoiceGroupStatus();

  if (!isAdmin) return null;

  const allowed = validTransitions?.validStatuses ?? [];
  const { overrideStatuses } = partitionTransitions(currentStatus, allowed, isAdmin);
  if (overrideStatuses.length === 0) return null;

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
    });
    qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  }

  return (
    <HideForClerk>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              data-testid="mini-admin-status-override-trigger"
            >
              Admin: status override
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuLabel>Status overrides (admin)</DropdownMenuLabel>
            {overrideStatuses.map((s) => (
              <DropdownMenuItem
                key={s}
                disabled={updateStatusMutation.isPending}
                onSelect={() =>
                  updateStatusMutation.mutate(
                    { id: groupId, data: { status: s } },
                    {
                      onSuccess: () => {
                        invalidate();
                        successToast({
                          title: "Done",
                          description: `Status changed to ${s}.`,
                        });
                      },
                      onError: (e: unknown) =>
                        toast({
                          title: "Status override failed",
                          description: e instanceof Error ? e.message : String(e),
                          variant: "destructive",
                        }),
                    },
                  )
                }
                data-testid={`mini-admin-status-override-${s}`}
              >
                {s}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </HideForClerk>
  );
}
