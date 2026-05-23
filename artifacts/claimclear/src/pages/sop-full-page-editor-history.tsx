import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListErrorTypeVersions,
  useRestoreErrorTypeVersion,
  useGetErrorTypeVersion,
  useGetErrorType,
  getListErrorTypesQueryKey,
  getListErrorTypeVersionsQueryKey,
  type ErrorTypeVersionSummary,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { History, Loader2, RotateCcw, Inbox } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  diffSopSnapshots,
  formatDiffSummary,
  type DiffSegment,
  type NodeDiff,
} from "@/lib/sop-diff";

// ---------------------------------------------------------------------------
// HistoryDrawer — Task #779 (list + restore) + Task #847 (diff highlight)
//
// Side drawer (shadcn Sheet) opened from the editor's toolbar. Lists
// every saved snapshot of the current error type newest-first via
// useListErrorTypeVersions. Clicking a row fetches the full snapshot
// (Task #847) and renders a side-by-side diff against the live
// error-type draft so the actual change between then and now is
// obvious — added nodes in green, removed nodes in red strikethrough,
// edited node text with character-level diff.
//
// A Restore button per row opens a confirmation (warning explicitly
// when there are unsaved tree OR settings changes vs the loaded
// snapshot) and calls useRestoreErrorTypeVersion; on success it
// invalidates error-type queries so the editor reloads from the new
// server state.
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Render diff segments inline. "added" -> green; "removed" -> red
// with strikethrough; "equal" -> neutral. Whitespace is preserved
// (the parent block uses whitespace-pre-wrap) so multi-line option
// strings render readably.
function DiffSegments({ segments }: { segments: ReadonlyArray<DiffSegment> }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.op === "added") {
          return (
            <span
              key={i}
              className="bg-green-100 text-green-800 rounded-sm px-0.5"
              data-testid="diff-added"
            >
              {s.text}
            </span>
          );
        }
        if (s.op === "removed") {
          return (
            <span
              key={i}
              className="bg-red-100 text-red-800 line-through rounded-sm px-0.5"
              data-testid="diff-removed"
            >
              {s.text}
            </span>
          );
        }
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

function NodeDiffCard({ node }: { node: NodeDiff }) {
  const isAdded = node.status === "added";
  const isRemoved = node.status === "removed";
  const isEdited = node.status === "edited";
  const tone = isAdded
    ? "border-green-300 bg-green-50/60"
    : isRemoved
    ? "border-red-300 bg-red-50/60"
    : isEdited
    ? "border-amber-300 bg-amber-50/40"
    : "border-border bg-background";
  const badge = isAdded
    ? { label: "Added", cls: "bg-green-100 text-green-800" }
    : isRemoved
    ? { label: "Removed", cls: "bg-red-100 text-red-800" }
    : isEdited
    ? { label: "Edited", cls: "bg-amber-100 text-amber-800" }
    : { label: "Unchanged", cls: "bg-muted text-muted-foreground" };

  return (
    <div
      className={`border rounded-md p-2.5 ${tone}`}
      data-testid={`diff-node-${node.id}`}
      data-status={node.status}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div
          className={`text-xs font-medium truncate ${
            isRemoved ? "line-through text-red-800" : ""
          }`}
          title={node.label}
        >
          {node.label}
        </div>
        <span
          className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 shrink-0 ${badge.cls}`}
        >
          {badge.label}
        </span>
      </div>
      {node.fields.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">
          No field-level changes.
        </div>
      ) : (
        <div className="space-y-1.5">
          {node.fields.map((f) => (
            <div key={f.field}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                {f.field}
              </div>
              <div className="text-xs whitespace-pre-wrap break-words leading-snug">
                <DiffSegments segments={f.segments} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VersionDiffView({
  errorTypeId,
  versionId,
}: {
  errorTypeId: number;
  versionId: number;
}) {
  const versionQ = useGetErrorTypeVersion(errorTypeId, versionId);
  const liveQ = useGetErrorType(errorTypeId);
  const [hideUnchanged, setHideUnchanged] = useState(true);

  const diff = useMemo(() => {
    if (!versionQ.data || !liveQ.data) return null;
    const before =
      (versionQ.data.snapshot as { decisionTree?: unknown } | null | undefined)
        ?.decisionTree ?? null;
    const after = liveQ.data.decisionTree ?? null;
    return diffSopSnapshots(before, after);
  }, [versionQ.data, liveQ.data]);

  if (versionQ.isLoading || liveQ.isLoading) {
    return (
      <div className="p-3 space-y-2" data-testid="diff-loading">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (versionQ.isError || liveQ.isError || !diff) {
    return (
      <div className="p-4 text-xs text-destructive">
        Couldn't load this version's snapshot.
      </div>
    );
  }

  const visibleNodes = hideUnchanged
    ? diff.nodes.filter((n) => n.status !== "unchanged")
    : diff.nodes;
  const unchangedCount = diff.nodes.filter((n) => n.status === "unchanged")
    .length;

  return (
    <div className="p-3 space-y-3" data-testid="history-version-diff">
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Changes vs. current draft
        </div>
        <div
          className="text-xs font-medium"
          data-testid="diff-summary"
        >
          {formatDiffSummary(diff.summary)}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Switch
            id="hide-unchanged-toggle"
            checked={hideUnchanged}
            onCheckedChange={setHideUnchanged}
            data-testid="diff-hide-unchanged-toggle"
          />
          <label
            htmlFor="hide-unchanged-toggle"
            className="text-[11px] text-muted-foreground cursor-pointer"
          >
            Hide unchanged sections
            {unchangedCount > 0 ? ` (${unchangedCount})` : ""}
          </label>
        </div>
      </div>
      {visibleNodes.length === 0 ? (
        <div
          className="text-xs text-muted-foreground italic border border-dashed border-border rounded-md p-3 text-center"
          data-testid="diff-no-changes"
        >
          {diff.nodes.length === 0
            ? "This snapshot has no decision-tree nodes to compare."
            : "No node-level differences — the snapshot matches the current draft."}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleNodes.map((n) => (
            <NodeDiffCard key={n.id} node={n} />
          ))}
        </div>
      )}
    </div>
  );
}

function VersionMetadata({
  version,
}: {
  version: ErrorTypeVersionSummary;
}) {
  return (
    <div
      className="p-3 border-b border-border space-y-2"
      data-testid="history-version-summary"
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Saved
          </div>
          <div className="text-xs font-medium">
            {formatTimestamp(version.createdAt)}
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Author
          </div>
          <div className="text-xs truncate">{version.createdBy || "—"}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Nodes
          </div>
          <div className="text-xs">{version.treeNodeCount}</div>
        </div>
      </div>
      {version.comment ? (
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Comment
          </div>
          <div className="text-xs italic">{version.comment}</div>
        </div>
      ) : null}
    </div>
  );
}

export function HistoryDrawer({
  isOpen,
  onClose,
  errorTypeId,
  hasUnsavedChanges,
}: {
  isOpen: boolean;
  onClose: () => void;
  errorTypeId: number;
  hasUnsavedChanges: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useListErrorTypeVersions(errorTypeId, {
    query: {
      enabled: isOpen && errorTypeId > 0,
      queryKey: getListErrorTypeVersionsQueryKey(errorTypeId),
    },
  });
  const restoreMutation = useRestoreErrorTypeVersion();

  const versions = useMemo<ErrorTypeVersionSummary[]>(
    () =>
      (data || [])
        .slice()
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [data],
  );

  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(
    null,
  );
  const [pendingRestoreId, setPendingRestoreId] = useState<number | null>(null);
  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) || null,
    [versions, selectedVersionId],
  );

  const confirmRestore = (versionId: number) => {
    setPendingRestoreId(versionId);
  };

  const handleRestore = async () => {
    if (pendingRestoreId == null) return;
    try {
      await restoreMutation.mutateAsync({
        id: errorTypeId,
        versionId: pendingRestoreId,
      });
      await queryClient.invalidateQueries({
        queryKey: getListErrorTypesQueryKey(),
      });
      await queryClient.invalidateQueries({
        queryKey: getListErrorTypeVersionsQueryKey(errorTypeId),
      });
      setPendingRestoreId(null);
      onClose();
      toast({
        title: "Version restored",
        description: "The editor now reflects the restored snapshot.",
      });
    } catch (e) {
      toast({
        title: "Restore failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent
          side="right"
          className="w-[760px] sm:max-w-[760px] p-0 flex flex-col"
          data-testid="history-drawer"
        >
          <SheetHeader className="px-4 pt-4 pb-2 border-b border-border">
            <SheetTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" /> Version History
            </SheetTitle>
            <SheetDescription className="text-xs">
              Browse prior snapshots of this SOP and restore one. Restoring
              replaces the current draft.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 flex">
            <div className="w-[300px] border-r border-border flex flex-col">
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="p-3 space-y-2" data-testid="history-loading">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : isError ? (
                  <div className="p-4 text-xs text-destructive">
                    Couldn't load version history.
                  </div>
                ) : versions.length === 0 ? (
                  <EmptyState
                    icon={Inbox}
                    title="No saved versions yet"
                    description="Each time you save the SOP, a snapshot is captured here so you can restore it later."
                  />
                ) : (
                  <ul className="divide-y divide-border" data-testid="history-version-list">
                    {versions.map((v) => (
                      <li
                        key={v.id}
                        className={`p-2 text-xs cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selectedVersionId === v.id ? "font-medium" : ""
                        }`}
                        style={
                          selectedVersionId === v.id
                            ? {
                                background: "hsl(var(--cc-blue-bg))",
                                boxShadow: "inset 0 0 0 1px hsl(var(--cc-blue-border))",
                              }
                            : undefined
                        }
                        onClick={() => setSelectedVersionId(v.id)}
                        data-testid={`history-version-row-${v.id}`}
                      >
                        <div className="font-medium">
                          {formatTimestamp(v.createdAt)}
                        </div>
                        <div className="text-muted-foreground flex items-center justify-between mt-0.5">
                          <span className="truncate">
                            {v.createdBy || "—"}
                          </span>
                          <span className="shrink-0 ml-2">
                            {v.treeNodeCount} nodes
                          </span>
                        </div>
                        <div className="flex justify-end mt-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedVersionId(v.id);
                              confirmRestore(v.id);
                            }}
                            data-testid={`history-restore-${v.id}`}
                            disabled={restoreMutation.isPending}
                          >
                            <RotateCcw className="w-3 h-3 mr-1" /> Restore
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {selectedVersion ? (
                <>
                  <VersionMetadata version={selectedVersion} />
                  <VersionDiffView
                    errorTypeId={errorTypeId}
                    versionId={selectedVersion.id}
                  />
                </>
              ) : (
                <EmptyState
                  icon={History}
                  title="Select a version"
                  description="Pick a snapshot on the left to see what changed since then."
                />
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={pendingRestoreId !== null}
        onOpenChange={(o) => {
          if (!o && !restoreMutation.isPending) setPendingRestoreId(null);
        }}
      >
        <AlertDialogContent data-testid="history-restore-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              Replace the current draft with this version? Unsaved changes
              will be lost.
              {hasUnsavedChanges && (
                <span
                  className="block mt-2 text-destructive font-medium"
                  data-testid="history-restore-unsaved-warning"
                >
                  You have unsaved edits to the current draft. Restoring
                  will discard them.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleRestore();
              }}
              disabled={restoreMutation.isPending}
              data-testid="history-restore-confirm-button"
            >
              {restoreMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Restoring…
                </>
              ) : (
                "Restore"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
