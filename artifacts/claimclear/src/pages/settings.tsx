import { useTriggerDailyBrief, useListBotInstances, useGetAppSettings, useUpdateAppSettings } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, Bot, Settings as SettingsIcon, Users, CheckCircle, XCircle, Shield, FileText, Globe } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { InfoTooltip, WrapTooltip } from "@/components/info-tooltip";

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
  const { data: appSettings } = useGetAppSettings();
  const updateAppSettings = useUpdateAppSettings();
  const [briefResult, setBriefResult] = useState<string | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [disputeInstructions, setDisputeInstructions] = useState("");
  const [disputeInstructionsSaved, setDisputeInstructionsSaved] = useState(false);
  const [disputeInstructionsLoaded, setDisputeInstructionsLoaded] = useState(false);
  const [portalProviderName, setPortalProviderName] = useState("");
  const [portalContactEmail, setPortalContactEmail] = useState("");
  const [portalContactPhone, setPortalContactPhone] = useState("");
  const [portalDefaultGps, setPortalDefaultGps] = useState("");
  const [portalSettingsSaved, setPortalSettingsSaved] = useState(false);
  const [portalSettingsLoaded, setPortalSettingsLoaded] = useState(false);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (appSettings && !disputeInstructionsLoaded) {
      setDisputeInstructions(appSettings.default_dispute_instructions || "");
      setDisputeInstructionsLoaded(true);
    }
  }, [appSettings, disputeInstructionsLoaded]);

  useEffect(() => {
    if (appSettings && !portalSettingsLoaded) {
      setPortalProviderName(appSettings.portal_provider_name || "");
      setPortalContactEmail(appSettings.portal_contact_email || "");
      setPortalContactPhone(appSettings.portal_contact_phone || "");
      setPortalDefaultGps(appSettings.portal_default_gps_breadcrumbs || "");
      setPortalSettingsLoaded(true);
    }
  }, [appSettings, portalSettingsLoaded]);

  const handleSaveDisputeInstructions = async () => {
    await updateAppSettings.mutateAsync({
      data: { default_dispute_instructions: disputeInstructions || null },
    });
    setDisputeInstructionsSaved(true);
    setTimeout(() => setDisputeInstructionsSaved(false), 3000);
  };

  const handleSavePortalSettings = async () => {
    await updateAppSettings.mutateAsync({
      data: {
        portal_provider_name: portalProviderName || null,
        portal_contact_email: portalContactEmail || null,
        portal_contact_phone: portalContactPhone || null,
        portal_default_gps_breadcrumbs: portalDefaultGps || null,
      },
    });
    setPortalSettingsSaved(true);
    setTimeout(() => setPortalSettingsSaved(false), 3000);
  };

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
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Role</span>
                <div className="flex items-center gap-1.5">
                  <WrapTooltip content={user.role === "admin" ? "Admins can manage users, trigger daily briefs, and access all platform features." : "Standard users can view and process claims but cannot manage other users."}>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"} className="cursor-help">{user.role}</Badge>
                  </WrapTooltip>
                </div>
              </div>
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
              <InfoTooltip content="Manage platform access. Approve new users, assign admin roles, or revoke access. Only admins can see this section." />
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
                          <WrapTooltip content="Grant this user access to the ClaimClear platform. They will be able to view and process claims.">
                            <Button
                              size="sm"
                              onClick={() => handleApprove(u.id)}
                              disabled={actionLoading === u.id}
                              className="gap-1"
                            >
                              <CheckCircle className="h-4 w-4" />
                              Approve
                            </Button>
                          </WrapTooltip>
                          <WrapTooltip content="Deny this user's access request. They will see a 'denied' message when trying to log in.">
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
                          </WrapTooltip>
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
                          <WrapTooltip content={u.role === "admin" ? "This user has admin privileges: user management, daily briefs, and full platform access." : "Standard user with access to claim processing features."}>
                            <Badge variant={u.role === "admin" ? "default" : "outline"} className="cursor-help">{u.role}</Badge>
                          </WrapTooltip>
                        </div>
                        <div className="flex items-center gap-2">
                          {u.id !== user?.id && (
                            <>
                              <WrapTooltip content={u.role === "admin" ? "Downgrade this user to a standard role. They will lose access to user management and admin features." : "Promote this user to admin. They will be able to manage users, trigger daily briefs, and access all features."}>
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
                              </WrapTooltip>
                              <WrapTooltip content="Revoke this user's access to the platform. They will no longer be able to log in.">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeny(u.id)}
                                  disabled={actionLoading === u.id}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  Revoke
                                </Button>
                              </WrapTooltip>
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
                        <WrapTooltip content="Re-approve this previously denied user, granting them access to the platform.">
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
                        </WrapTooltip>
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

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Portal Configuration
              <InfoTooltip content="Set your company details that are automatically filled into every MAS portal submission. These values stay the same across all disputes." />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider-name">Transportation Provider Name</Label>
              <Input
                id="provider-name"
                value={portalProviderName}
                onChange={e => setPortalProviderName(e.target.value)}
                placeholder="Agape Transportation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Requester Email Address</Label>
              <Input
                id="contact-email"
                type="email"
                value={portalContactEmail}
                onChange={e => setPortalContactEmail(e.target.value)}
                placeholder="disputes@agapeny.app"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Phone Number</Label>
              <Input
                id="contact-phone"
                type="tel"
                value={portalContactPhone}
                onChange={e => setPortalContactPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gps-default">Default GPS Breadcrumbs Answer</Label>
              <Select value={portalDefaultGps || "none"} onValueChange={v => setPortalDefaultGps(v === "none" ? "" : v)}>
                <SelectTrigger id="gps-default"><SelectValue placeholder="Choose default..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSavePortalSettings} disabled={updateAppSettings.isPending}>
                {updateAppSettings.isPending ? "Saving..." : "Save Portal Settings"}
              </Button>
              {portalSettingsSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved successfully</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Default Dispute Instructions
              <InfoTooltip content="Set default instructions that the AI uses when generating dispute notes for portal submissions and emails. These apply to all error types unless an error type has its own custom instructions." />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              These instructions guide the AI when writing dispute notes. They apply to all error types by default. Individual error types can override these with their own instructions.
            </p>
            <Textarea
              value={disputeInstructions}
              onChange={e => setDisputeInstructions(e.target.value)}
              rows={6}
              className="text-sm"
              placeholder="Always reference GPS breadcrumb data when available.&#10;Emphasize that the trip was completed as scheduled.&#10;Keep tone professional but assertive.&#10;Mention specific evidence documents by name."
            />
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSaveDisputeInstructions}
                disabled={updateAppSettings.isPending}
              >
                {updateAppSettings.isPending ? "Saving..." : "Save Instructions"}
              </Button>
              {disputeInstructionsSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved successfully</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Daily Brief
            <InfoTooltip content="Sends a summary email with the current state of the claims pipeline, upcoming expirations, portal submission stats, and key metrics." />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Trigger a daily brief summary of claims pipeline, expirations, and portal submission status.</p>
          <WrapTooltip content="Immediately generate and send the daily brief email to all configured recipients.">
            <Button onClick={handleTriggerBrief} disabled={triggerBrief.isPending}>
              {triggerBrief.isPending ? "Sending..." : "Send Daily Brief"}
            </Button>
          </WrapTooltip>
          {briefResult && (
            <p className="text-sm text-green-600 dark:text-green-400">{briefResult}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Bot Instances
            <InfoTooltip content="Automation bots that handle portal submissions. Each bot has its own browser session and processes claims from the queue. A valid session is required for submissions to succeed." />
          </CardTitle>
        </CardHeader>
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
                    <WrapTooltip content={bot.status === "running" ? "Bot is online and processing submissions from the queue." : "Bot is currently offline and not processing submissions."}>
                      <Badge variant={bot.status === "running" ? "default" : "secondary"} className="cursor-help">{bot.status}</Badge>
                    </WrapTooltip>
                    {bot.sessionValid ? (
                      <WrapTooltip content="The bot's browser session with the MAS portal is active and authenticated. Submissions can proceed.">
                        <Badge variant="outline" className="text-green-600 cursor-help">Session Valid</Badge>
                      </WrapTooltip>
                    ) : (
                      <WrapTooltip content="The bot's portal session has expired or is invalid. The bot needs to re-authenticate before it can process submissions.">
                        <Badge variant="outline" className="text-red-600 cursor-help">Session Invalid</Badge>
                      </WrapTooltip>
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
