import { useMemo } from "react";
import { useLocation } from "wouter";
import { BackBar } from "@/components/back-bar";
import { useAuth } from "@workspace/replit-auth-web";
import { useAdminListUserSignIns, getAdminListUserSignInsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

function useUserIdParam(): string {
  const [location] = useLocation();
  return useMemo(() => {
    const idx = location.indexOf("?");
    if (idx === -1) return "";
    const sp = new URLSearchParams(location.slice(idx + 1));
    return sp.get("userId") || "";
  }, [location]);
}

export default function AdminUserSignInHistory() {
  const { user } = useAuth();
  const userId = useUserIdParam();

  const { data, isLoading } = useAdminListUserSignIns(userId, { limit: 50 }, {
    query: {
      queryKey: getAdminListUserSignInsQueryKey(userId, { limit: 50 }),
      enabled: !!userId && user?.role === "admin",
    },
  });

  if (user?.role !== "admin") {
    return (
      <Card>
        <CardHeader><CardTitle>Admin only</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">You need admin access to view this page.</p>
        </CardContent>
      </Card>
    );
  }

  const items = data?.items ?? [];
  const targetUser = data?.user;
  const subjectLabel = targetUser?.displayName || targetUser?.email || userId || "user";

  return (
    <div className="space-y-6">
      <BackBar
        fallbackHref="/settings"
        crumbs={[
          { label: "Settings", href: "/settings" },
          { label: "Sign-in history" },
        ]}
        testId="admin-user-signin-history-back-bar"
      />

      <div>
        <h2 className="text-2xl font-bold tracking-tight">Sign-in history</h2>
        <p className="text-muted-foreground">
          Recent sign-ins for {subjectLabel}
          {targetUser?.email && targetUser.displayName ? ` (${targetUser.email})` : ""}.
          Showing the last {data?.limit ?? 50}.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <SkeletonSwap
            loading={isLoading}
            skeleton={
              <div className="p-4 space-y-2" data-testid="admin-user-signin-history-skeleton">
                {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">When</TableHead>
                  <TableHead className="w-[180px]">IP address</TableHead>
                  <TableHead>User agent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No sign-ins recorded yet for this user.
                    </TableCell>
                  </TableRow>
                )}
                {items.map((item) => (
                  <TableRow key={item.id} data-testid={`signin-row-${item.id}`}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTime(item.loggedInAt)}</TableCell>
                    <TableCell className="text-xs font-mono">{item.ipAddress || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground break-all">{item.userAgent || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SkeletonSwap>
        </CardContent>
      </Card>
    </div>
  );
}
