// Task #889 — admin read-out + editor for `users.responsible_roles`.
// Linked from the Admin nav for admins only. A small panel: one row
// per user, with role checkboxes that PATCH the new endpoint
// (auditable) and a side panel showing each role's current assignees.
import { useMemo, useState } from "react";
import {
  useGetResponsibleRolesReadout,
  useSetUserResponsibleRoles,
  getGetResponsibleRolesReadoutQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CLOSURE_RESPONSIBLE_ROLES,
  closureResponsibleRoleLabel,
  type ClosureResponsibleRole,
} from "@workspace/vocab";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/cohesion";
import { useToast, successToast } from "@/hooks/use-toast";

interface UserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
  status: string;
  responsibleRoles: string[];
}

export default function AdminResponsibleRolesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError } = useGetResponsibleRolesReadout({
    query: { queryKey: getGetResponsibleRolesReadoutQueryKey() },
  });
  const setRoles = useSetUserResponsibleRoles();

  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const users: UserRow[] = (data?.users ?? []) as UserRow[];

  const assignees = useMemo(() => {
    const map: Record<string, UserRow[]> = {};
    for (const r of CLOSURE_RESPONSIBLE_ROLES) map[r] = [];
    for (const u of users) {
      for (const r of u.responsibleRoles) {
        if (map[r]) map[r]!.push(u);
      }
    }
    return map;
  }, [users]);

  const handleToggle = async (user: UserRow, role: ClosureResponsibleRole, checked: boolean) => {
    setPendingUserId(user.id);
    const next = checked
      ? Array.from(new Set([...user.responsibleRoles, role]))
      : user.responsibleRoles.filter(r => r !== role);
    try {
      await setRoles.mutateAsync({ userId: user.id, data: { responsibleRoles: next as ClosureResponsibleRole[] } });
      successToast({ title: "__VERB__", description: "Roles updated" });
      queryClient.invalidateQueries({ queryKey: getGetResponsibleRolesReadoutQueryKey() });
    } catch {
      toast({ title: "Failed to update roles", variant: "destructive" });
    } finally {
      setPendingUserId(null);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <PageHeader
        title="Responsible-Party Roles"
        sub="Assign supervisors the My Closures portal access they need."
      />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All users</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {isLoading && (
              <div className="px-6 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
            {isError && <p className="px-6 text-sm text-red-600">Failed to load.</p>}
            {!isLoading && !isError && (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-6 py-2 font-medium">User</th>
                    {CLOSURE_RESPONSIBLE_ROLES.map((r) => (
                      <th key={r} className="px-2 py-2 font-medium text-center">{closureResponsibleRoleLabel(r)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/40" data-testid={`role-row-${u.id}`}>
                      <td className="px-6 py-2">
                        <div className="font-medium truncate" title={u.displayName ?? u.email ?? u.id}>
                          {u.displayName ?? u.email ?? u.id}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                      </td>
                      {CLOSURE_RESPONSIBLE_ROLES.map((r) => {
                        const checked = u.responsibleRoles.includes(r);
                        return (
                          <td key={r} className="px-2 py-2 text-center">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => handleToggle(u, r, v === true)}
                              disabled={pendingUserId === u.id}
                              aria-label={`${closureResponsibleRoleLabel(r)} for ${u.email}`}
                              data-testid={`toggle-${u.id}-${r}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {CLOSURE_RESPONSIBLE_ROLES.map((r) => (
              <div key={r}>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  {closureResponsibleRoleLabel(r)}
                </div>
                {assignees[r]?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {assignees[r]!.map((u) => (
                      <Badge key={u.id} variant="outline" className="text-xs">
                        {u.displayName ?? u.email ?? u.id}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-red-600">No one assigned — closures of this type have no follow-through owner.</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
