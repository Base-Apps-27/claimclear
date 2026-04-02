import { useTriggerDailyBrief, useListBotInstances } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Mail, Bot, Settings as SettingsIcon, Users, CheckCircle, XCircle, Shield } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface ManagedUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string;
  status: string;
  createdAt: string;
}

export default function Settings() {
  const { user } = useAuth();
  const triggerBrief = useTriggerDailyBrief();
  const { data: botInstances } = useListBotInstances();
  const [briefResult, setBriefResult] = useState<string | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingUsers(true);
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {
    } finally {
      setLoadingUsers(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleTriggerBrief = async () => {
    const result = await triggerBrief.mutateAsync();
    setBriefResult(result.message);
  };

  const handleApprove = async (userId: string) => {
    setActionLoading(userId);
    try {
      await fetch(`/api/admin/users/${userId}/approve`, { method: "PATCH", credentials: "include" });
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeny = async (userId: string) => {
    setActionLoading(userId);
    try {
      await fetch(`/api/admin/users/${userId}/deny`, { method: "PATCH", credentials: "include" });
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleRole = async (userId: string, currentRole: string) => {
    setActionLoading(userId);
    const newRole = currentRole === "admin" ? "user" : "admin";
    try {
      await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const pendingUsers = users.filter(u => u.status === "pending");
  const approvedUsers = users.filter(u => u.status === "approved");
  const deniedUsers = users.filter(u => u.status === "denied");

  const getUserDisplayName = (u: ManagedUser) => {
    return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown";
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Configuration and tools</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><SettingsIcon className="h-5 w-5" />Account</CardTitle></CardHeader>
        <CardContent>
          {user ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{user.email}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{user.displayName || "-"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Role</span><Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge></div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not logged in</p>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Management
              {pendingUsers.length > 0 && (
                <Badge variant="destructive" className="ml-2">{pendingUsers.length} pending</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingUsers ? (
              <p className="text-sm text-muted-foreground">Loading users...</p>
            ) : (
              <>
                {pendingUsers.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-amber-600">Pending Approval</h4>
                    {pendingUsers.map(u => (
                      <div key={u.id} className="flex items-center justify-between p-3 border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={u.profileImageUrl || undefined} />
                            <AvatarFallback>{getUserDisplayName(u).charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{getUserDisplayName(u)}</p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleApprove(u.id)}
                            disabled={actionLoading === u.id}
                            className="gap-1"
                          >
                            <CheckCircle className="h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeny(u.id)}
                            disabled={actionLoading === u.id}
                            className="gap-1"
                          >
                            <XCircle className="h-4 w-4" />
                            Deny
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {approvedUsers.length > 0 && (
                  <div className="space-y-3">
                    {pendingUsers.length > 0 && <Separator />}
                    <h4 className="text-sm font-semibold text-green-600">Approved Users</h4>
                    {approvedUsers.map(u => (
                      <div key={u.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={u.profileImageUrl || undefined} />
                            <AvatarFallback>{getUserDisplayName(u).charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{getUserDisplayName(u)}</p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                          <Badge variant={u.role === "admin" ? "default" : "outline"}>{u.role}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {u.id !== user?.id && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleToggleRole(u.id, u.role)}
                                disabled={actionLoading === u.id}
                                className="gap-1"
                              >
                                <Shield className="h-3 w-3" />
                                {u.role === "admin" ? "Remove Admin" : "Make Admin"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeny(u.id)}
                                disabled={actionLoading === u.id}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                Revoke
                              </Button>
                            </>
                          )}
                          {u.id === user?.id && (
                            <span className="text-xs text-muted-foreground">You</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {deniedUsers.length > 0 && (
                  <div className="space-y-3">
                    <Separator />
                    <h4 className="text-sm font-semibold text-red-600">Denied Users</h4>
                    {deniedUsers.map(u => (
                      <div key={u.id} className="flex items-center justify-between p-3 border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={u.profileImageUrl || undefined} />
                            <AvatarFallback>{getUserDisplayName(u).charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{getUserDisplayName(u)}</p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleApprove(u.id)}
                          disabled={actionLoading === u.id}
                          className="gap-1"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Approve
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {users.length === 0 && (
                  <p className="text-sm text-muted-foreground">No users found.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Daily Brief</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Trigger a daily brief summary of claims pipeline, expirations, and portal submission status.</p>
          <Button onClick={handleTriggerBrief} disabled={triggerBrief.isPending}>
            {triggerBrief.isPending ? "Sending..." : "Send Daily Brief"}
          </Button>
          {briefResult && (
            <p className="text-sm text-green-600 dark:text-green-400">{briefResult}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Bot Instances</CardTitle></CardHeader>
        <CardContent>
          {botInstances && botInstances.length > 0 ? (
            <div className="space-y-3">
              {botInstances.map(bot => (
                <div key={bot.id} className="flex items-center justify-between p-3 border rounded-md">
                  <div>
                    <p className="font-medium text-sm">{bot.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {bot.successCount} success / {bot.failCount} failed / {bot.submissionsToday} today
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={bot.status === "running" ? "default" : "secondary"}>{bot.status}</Badge>
                    {bot.sessionValid ? (
                      <Badge variant="outline" className="text-green-600">Session Valid</Badge>
                    ) : (
                      <Badge variant="outline" className="text-red-600">Session Invalid</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active bot instances.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
