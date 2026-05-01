import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSetGroupContext,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";

// Group-level narrative + per-leg context roll-up, extracted from
// invoice-group-detail-v2 so the inline queue workspace renders the same
// thing without duplicating the form state / mutation plumbing. The detail
// page and the inline panel both mount this component with identical props.
interface Props {
  group: InvoiceGroupDetailResponse;
  groupId: number;
  // Optional lock — when present, all mutating controls are disabled
  // and the message surfaces as the disabled-reason hint.
  lockReason?: string | null;
}

export function GroupAggregateContextPanel({ group, groupId, lockReason }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const setContextMutation = useSetGroupContext();

  const [groupContext, setGroupContext] = useState("");
  useEffect(() => {
    setGroupContext(group?.groupContext ?? "");
  }, [group?.groupContext]);

  const allRides: ClaimResponse[] = group?.rides ?? [];
  const isPreSubmit = group?.status === "New" || group?.status === "Needs Evidence";

  function invalidateGroup() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: ["invoice-groups"] });
  }

  function onSaveGroupContext() {
    setContextMutation.mutate(
      { id: groupId, data: { context: groupContext } },
      {
        onSuccess: () => {
          toast({ title: "Group context saved" });
          invalidateGroup();
        },
        onError: (e: unknown) => toast({ title: "Save failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" /> Aggregate context
        </CardTitle>
        <CardDescription>
          Group-level narrative plus a roll-up of every leg's per-leg
          context. Edit per-leg context on each leg's investigation page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Group context</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={onSaveGroupContext}
              disabled={
                !isPreSubmit ||
                !!lockReason ||
                setContextMutation.isPending ||
                groupContext === (group.groupContext ?? "")
              }
              title={lockReason ?? undefined}
              data-testid="group-context-save"
            >
              {setContextMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              Save
            </Button>
          </div>
          <Textarea
            value={groupContext}
            onChange={(e) => setGroupContext(e.target.value)}
            rows={4}
            disabled={!isPreSubmit || !!lockReason}
            placeholder="Group-level narrative the dispute write-up will pick up. Pre-submit only — saving clears any prior understanding readback."
            data-testid="group-context-input"
          />
          {lockReason && (
            <p className="text-xs text-muted-foreground" data-testid="group-context-lock-reason">
              {lockReason}
            </p>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Per-leg context roll-up</h3>
          {allRides.filter((r) => r.perLegContext).length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No per-leg context recorded yet. Open each leg's investigation
              surface to record one.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {allRides
                .filter((r) => r.perLegContext)
                .map((r) => (
                  <li
                    key={r.id}
                    className="rounded-md border bg-muted/30 p-2.5"
                    data-testid={`leg-context-roll-${r.id}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Link
                        href={`/claims/${r.id}`}
                        className="text-xs font-medium hover:underline"
                      >
                        Leg #{r.id} · {r.confNumber || "—"}
                      </Link>
                      <LegSubStatusPill leg={r} />
                    </div>
                    <p className="text-xs whitespace-pre-line">{r.perLegContext}</p>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
