import { useTriggerDailyBrief, useGetAppSettings, useUpdateAppSettings, getAdminExportAuditLogsCsvUrl, useGetUserNotificationPreferences, useUpdateUserNotificationPreferences } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@workspace/replit-auth-web";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, Settings as SettingsIcon, Users, CheckCircle, XCircle, Shield, FileText, Globe, Activity, Download, ArrowUpDown } from "lucide-react";
import { formatRelative } from "@/lib/time";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
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
  lastLoginAt: string | null;
}

const DORMANT_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

type ApprovedSortKey = "name" | "lastLogin";
type SortDirection = "asc" | "desc";

function lastLoginSortValue(u: ManagedUser, direction: SortDirection): number {
  // Never-logged-in users sort to the bottom regardless of direction so
  // they're consistently grouped together rather than flipping with the
  // sort toggle. Latest first when direction is "desc".
  if (!u.lastLoginAt) return direction === "desc" ? -Infinity : Infinity;
  return new Date(u.lastLoginAt).getTime();
}

function NotificationTogglesRow({ userId }: { userId: string }) {
  const { data, refetch, isLoading } = useGetUserNotificationPreferences(userId);
  const update = useUpdateUserNotificationPreferences();

  const handleToggle = async (field: "dailyBrief" | "weeklyDigest", value: boolean) => {
    await update.mutateAsync({ userId, data: { [field]: value } });
    await refetch();
  };

  return (
    <SkeletonSwap
      loading={isLoading || !data}
      className="inline-flex"
      skeleton={
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
        </div>
      }
    >
      {data ? (
    <div className="flex items-center gap-3 text-xs">
      <WrapTooltip content="When off, this user will not receive the daily brief email.">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <Switch
            checked={data.dailyBrief}
            disabled={update.isPending}
            onCheckedChange={(v) => handleToggle("dailyBrief", v)}
          />
          <span>Daily brief</span>
        </label>
      </WrapTooltip>
      <WrapTooltip content="When off, this user will not receive the Monday weekly digest section.">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <Switch
            checked={data.weeklyDigest}
            disabled={update.isPending}
            onCheckedChange={(v) => handleToggle("weeklyDigest", v)}
          />
          <span>Weekly digest</span>
        </label>
      </WrapTooltip>
    </div>
      ) : null}
    </SkeletonSwap>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const triggerBrief = useTriggerDailyBrief();
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
  const [directEmailRecipient, setDirectEmailRecipient] = useState("");
  const [directEmailCc, setDirectEmailCc] = useState("");
  const [directEmailSaved, setDirectEmailSaved] = useState(false);
  const [directEmailLoaded, setDirectEmailLoaded] = useState(false);

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

  useEffect(() => {
    if (appSettings && !directEmailLoaded) {
      setDirectEmailRecipient(appSettings.direct_email_recipient || "");
      setDirectEmailCc(appSettings.direct_email_cc || "");
      setDirectEmailLoaded(true);
    }
  }, [appSettings, directEmailLoaded]);

  const handleSaveDirectEmail = async () => {
    await updateAppSettings.mutateAsync({
      data: {
        direct_email_recipient: directEmailRecipient || null,
        direct_email_cc: directEmailCc || null,
      },
    });
    setDirectEmailSaved(true);
    setTimeout(() => setDirectEmailSaved(false), 3000);
  };

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

  // The old binary "Make Admin / Remove Admin" toggle was replaced by
  // a Select with all three values so admins can promote/demote users
  // through every supported role transition without leaving the page.
  const handleSetRole = async (userId: string, newRole: string) => {
    if (!["admin", "user", "clerk"].includes(newRole)) return;
    setActionLoading(userId);
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

  const [approvedSortKey, setApprovedSortKey] = useState<ApprovedSortKey>("name");
  const [approvedSortDir, setApprovedSortDir] = useState<SortDirection>("desc");

  const pendingUsers = users.filter(u => u.status === "pending");
  const deniedUsers = users.filter(u => u.status === "denied");
  const approvedUsers = users
    .filter(u => u.status === "approved")
    .slice()
    .sort((a, b) => {
      if (approvedSortKey === "lastLogin") {
        const av = lastLoginSortValue(a, approvedSortDir);
        const bv = lastLoginSortValue(b, approvedSortDir);
        if (av === bv) return 0;
        return approvedSortDir === "desc" ? bv - av : av - bv;
      }
      const aName = [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email || "";
      const bName = [b.firstName, b.lastName].filter(Boolean).join(" ") || b.email || "";
      const cmp = aName.localeCompare(bName, undefined, { sensitivity: "base" });
      return approvedSortDir === "desc" ? -cmp : cmp;
    });

  const toggleApprovedSort = (key: ApprovedSortKey) => {
    if (approvedSortKey === key) {
      setApprovedSortDir(d => (d === "desc" ? "asc" : "desc"));
    } else {
      setApprovedSortKey(key);
      setApprovedSortDir(key === "lastLogin" ? "desc" : "asc");
    }
  };

  const now = Date.now();
  const isDormant = (u: ManagedUser): boolean => {
    if (!u.lastLoginAt) return true;
    return now - new Date(u.lastLoginAt).getTime() > DORMANT_THRESHOLD_MS;
  };

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
              <div className="ml-auto flex items-center gap-2">
                <WrapTooltip content="Download a CSV of audit log entries across all users.">
                  <Button asChild size="sm" variant="outline" className="gap-1">
                    <a href={getAdminExportAuditLogsCsvUrl()}>
                      <Download className="h-3 w-3" />
                      Export all activity
                    </a>
                  </Button>
                </WrapTooltip>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SkeletonSwap
              loading={loadingUsers}
              skeleton={
                <div className="space-y-2" data-testid="settings-users-skeleton">
                  {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              }
            >
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
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h4 className="text-sm font-semibold text-green-600">Approved Users</h4>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span>Sort:</span>
                        <Button
                          size="sm"
                          variant={approvedSortKey === "name" ? "secondary" : "ghost"}
                          className="h-7 px-2 gap-1"
                          onClick={() => toggleApprovedSort("name")}
                          data-testid="sort-users-by-name"
                        >
                          Name
                          {approvedSortKey === "name" && (
                            <ArrowUpDown className="h-3 w-3" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant={approvedSortKey === "lastLogin" ? "secondary" : "ghost"}
                          className="h-7 px-2 gap-1"
                          onClick={() => toggleApprovedSort("lastLogin")}
                          data-testid="sort-users-by-last-login"
                        >
                          Last login
                          {approvedSortKey === "lastLogin" && (
                            <ArrowUpDown className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                    {approvedUsers.map(u => (
                      <div key={u.id} className="flex flex-col gap-2 p-3 border rounded-lg sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3 flex-wrap">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={u.profileImageUrl || undefined} />
                            <AvatarFallback>{getUserDisplayName(u).charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{getUserDisplayName(u)}</p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                            <p className="text-xs text-muted-foreground mt-0.5" data-testid={`last-login-${u.id}`}>
                              Last login: {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "Never"}
                            </p>
                          </div>
                          <WrapTooltip content={
                            u.role === "admin"
                              ? "Admin: user management, daily briefs, and full platform access."
                              : u.role === "clerk"
                                ? "Clerk: per-claim work only. No money values, no setup pages, no bulk actions."
                                : "Standard user: claim processing, bulk actions, and money visibility."
                          }>
                            <Badge variant={u.role === "admin" ? "default" : "outline"} className="cursor-help">{u.role}</Badge>
                          </WrapTooltip>
                          {isDormant(u) && (
                            <WrapTooltip content={u.lastLoginAt
                              ? "This user has not signed in for more than 30 days. Consider reviewing their access."
                              : "This user has never signed in."
                            }>
                              <Badge variant="outline" className="cursor-help border-amber-300 text-amber-700 dark:text-amber-400" data-testid={`dormant-badge-${u.id}`}>
                                Dormant
                              </Badge>
                            </WrapTooltip>
                          )}
                          <NotificationTogglesRow userId={u.id} />
                        </div>
                        <div className="flex items-center gap-2">
                          {u.email && (
                            <>
                              <WrapTooltip content="View this user's audit log activity, with filters and CSV export.">
                                <Button asChild size="sm" variant="outline" className="gap-1">
                                  <Link href={`/admin/users/activity?email=${encodeURIComponent(u.email)}`}>
                                    <Activity className="h-3 w-3" />
                                    Activity
                                  </Link>
                                </Button>
                              </WrapTooltip>
                              <WrapTooltip content="View this user's recent sign-ins (timestamp, IP, user agent).">
                                <Button asChild size="sm" variant="outline" className="gap-1" data-testid={`button-signins-${u.id}`}>
                                  <Link href={`/admin/users/sign-ins?userId=${encodeURIComponent(u.id)}`}>
                                    <Shield className="h-3 w-3" />
                                    Sign-ins
                                  </Link>
                                </Button>
                              </WrapTooltip>
                              <WrapTooltip content="Download a CSV of this user's audit log entries.">
                                <Button asChild size="sm" variant="outline" className="gap-1">
                                  <a href={getAdminExportAuditLogsCsvUrl({ userEmail: u.email })}>
                                    <Download className="h-3 w-3" />
                                    Export
                                  </a>
                                </Button>
                              </WrapTooltip>
                            </>
                          )}
                          {u.id !== user?.id && (
                            <>
                              <WrapTooltip content="Set this user's role. Admin = full access. User = claims + bulk + money. Clerk = per-claim work only, no money or setup.">
                                <div className="flex items-center gap-1">
                                  <Shield className="h-3 w-3 text-muted-foreground" />
                                  <Select
                                    value={u.role}
                                    onValueChange={(v) => handleSetRole(u.id, v)}
                                    disabled={actionLoading === u.id}
                                  >
                                    <SelectTrigger className="h-8 w-[110px]" data-testid={`select-role-${u.id}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="admin">Admin</SelectItem>
                                      <SelectItem value="user">User</SelectItem>
                                      <SelectItem value="clerk">Clerk</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
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
            </SkeletonSwap>
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
              <Mail className="h-5 w-5" />
              Direct Email
              <InfoTooltip content="Where dispute emails go for error types whose Submission Path is set to 'Direct Email'. The batch processor sends these on the same schedule as portal submissions, with evidence attached." />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Used when an error type's Submission Path is set to <strong>Direct Email</strong>.
              Dispute emails are sent from your connected Outlook account via the same batch schedule
              as portal submissions, with evidence files attached.
            </p>
            <div className="space-y-2">
              <Label htmlFor="direct-email-to">Recipient (To)</Label>
              <Input
                id="direct-email-to"
                type="email"
                value={directEmailRecipient}
                onChange={e => setDirectEmailRecipient(e.target.value)}
                placeholder="tripinvresolution@medanswering.com"
              />
              <p className="text-xs text-muted-foreground">
                The single address all Direct Email disputes are sent to.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="direct-email-cc">CC (optional)</Label>
              <Input
                id="direct-email-cc"
                value={directEmailCc}
                onChange={e => setDirectEmailCc(e.target.value)}
                placeholder="billing@yourcompany.com"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated list of additional recipients to copy on every Direct Email dispute.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSaveDirectEmail} disabled={updateAppSettings.isPending}>
                {updateAppSettings.isPending ? "Saving..." : "Save Direct Email Settings"}
              </Button>
              {directEmailSaved && (
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

    </div>
  );
}
