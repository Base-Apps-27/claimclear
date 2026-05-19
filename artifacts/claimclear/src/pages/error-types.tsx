import { useState } from "react";
import { Link as WouterLink, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListErrorTypes, getListErrorTypesQueryKey,
  useCreateErrorType, useDeleteErrorType,
  useGetAppSettings,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Trash2, TreeDeciduous, FileText,
  AlertTriangle, MapPin, Mail,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";

export default function ErrorTypes() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: errorTypes, isLoading } = useListErrorTypes();
  const { data: appSettings } = useGetAppSettings();
  const defaultDisputeInstructions = appSettings?.default_dispute_instructions || "";
  const createErrorType = useCreateErrorType();
  const deleteErrorType = useDeleteErrorType();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListErrorTypesQueryKey() });

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await createErrorType.mutateAsync({ data: { name } });
      invalidate();
      setShowCreate(false);
      setNewName("");
      setLocation(`/admin/sops/${created.id}/edit`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteErrorType.mutateAsync({ id });
    invalidate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Error Types & SOPs</h2>
          <p className="text-muted-foreground">Configure error classifications, evidence requirements, and decision workflows</p>
        </div>
        <Button onClick={() => { setNewName(""); setShowCreate(true); }}>
          <Plus className="h-4 w-4 mr-1" />Add Error Type
        </Button>
      </div>

      <SkeletonSwap
        loading={isLoading}
        skeleton={
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="error-types-skeleton">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        }
      >
      {(errorTypes || []).length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={TreeDeciduous}
              title="No error types defined yet"
              description="Error types classify denials and drive the dispute workflow. Create one to get started."
              primaryAction={{
                label: "Add error type",
                onClick: () => { setNewName(""); setShowCreate(true); },
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(errorTypes || []).map(et => (
            <Card key={et.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{et.name}</CardTitle>
                    {et.category && <Badge variant="outline" className="mt-1">{et.category}</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <WouterLink href={`/admin/sops/${et.id}/edit`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        data-testid={`open-full-page-editor-${et.id}`}
                        title="Open the full-page SOP editor"
                      >
                        Edit SOP →
                      </Button>
                    </WouterLink>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(et.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                {et.description && <p className="line-clamp-2">{et.description}</p>}
                <div className="flex gap-2 flex-wrap">
                  {et.decisionTree ? (
                    <Badge variant="secondary" className="text-green-700"><TreeDeciduous className="h-3 w-3 mr-1" />Workflow Tree</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-xs"><AlertTriangle className="h-3 w-3 mr-1" />No Workflow</Badge>
                  )}
                  {et.useDirectEmail ? (
                    <Badge variant="secondary" className="text-purple-700"><Mail className="h-3 w-3 mr-1" />Direct Email</Badge>
                  ) : et.useGpsControlDeviation ? (
                    <Badge variant="secondary" className="text-blue-700"><MapPin className="h-3 w-3 mr-1" />GPS Control Deviation</Badge>
                  ) : null}
                  {et.disputeInstructions ? (
                    <Badge variant="secondary"><FileText className="h-3 w-3 mr-1" />Custom Dispute Instructions</Badge>
                  ) : defaultDisputeInstructions ? (
                    <Badge variant="outline" className="text-muted-foreground"><FileText className="h-3 w-3 mr-1" />Using Default Instructions</Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </SkeletonSwap>

      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); setNewName(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Error Type</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-error-type-name">Name</Label>
            <Input
              id="new-error-type-name"
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newName.trim() && !creating) handleCreate(); }}
              placeholder="e.g., No-Show — GPS Confirmed"
            />
            <p className="text-xs text-muted-foreground">
              You'll land in the full-page SOP editor next, where you can fill in the details, submission path, and workflow tree.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setNewName(""); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? "Creating…" : "Create & open editor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
