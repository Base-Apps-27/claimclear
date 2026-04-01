import { useTriggerDailyBrief, useListBotInstances } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Mail, Bot, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";

export default function Settings() {
  const { user } = useAuth();
  const triggerBrief = useTriggerDailyBrief();
  const { data: botInstances } = useListBotInstances();
  const [briefResult, setBriefResult] = useState<string | null>(null);

  const handleTriggerBrief = async () => {
    const result = await triggerBrief.mutateAsync();
    setBriefResult(result.message);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
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
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not logged in</p>
          )}
        </CardContent>
      </Card>

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
