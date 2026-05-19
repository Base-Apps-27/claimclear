import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListErrorTypeVersions,
  useRestoreErrorTypeVersion,
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
import { History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// HistoryDrawer — Task #779
//
// Side drawer (shadcn Sheet) opened from the editor's toolbar. Lists
// every saved snapshot of the current error type newest-first via
// useListErrorTypeVersions. Clicking a row shows a read-only METADATA
// summary on the right: saved-at timestamp, author, node count, and
// optional comment. The right pane intentionally does NOT render the
// snapshot's tree contents (root question / node questions /
// outcomes) — the list endpoint deliberately omits the snapshot blob
// to keep responses small, and the task guardrails forbid modifying
// the backend or generated client. Follow-up task #789 covers adding
// a per-version GET so older versions can show full structural
// contents.
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

function VersionSummary({
  version,
}: {
  version: ErrorTypeVersionSummary;
}) {
  // The list endpoint intentionally omits the snapshot blob to keep
  // responses small (see backend comment on /error-types/:id/versions).
  // Surface only the metadata we actually have for the selected row so
  // we never display contents that may belong to a different version.
  return (
    <div className="p-3 space-y-3" data-testid="history-version-summary">
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Saved
        </div>
        <div className="text-xs font-medium">
          {formatTimestamp(version.createdAt)}
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Author
        </div>
        <div className="text-xs">{version.createdBy || "—"}</div>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Nodes
        </div>
        <div className="text-xs">{version.treeNodeCount}</div>
      </div>
      {version.comment ? (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Comment
          </div>
          <div className="text-xs italic">{version.comment}</div>
        </div>
      ) : null}
      <p className="text-[10px] text-muted-foreground italic">
        Restore to load this snapshot's full contents into the editor.
      </p>
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
          className="w-[640px] sm:max-w-[640px] p-0 flex flex-col"
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
                  <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading
                    versions…
                  </div>
                ) : isError ? (
                  <div className="p-4 text-xs text-destructive">
                    Couldn't load version history.
                  </div>
                ) : versions.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground">
                    No saved versions yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-border" data-testid="history-version-list">
                    {versions.map((v) => (
                      <li
                        key={v.id}
                        className={`p-2 text-xs cursor-pointer hover:bg-muted/60 ${
                          selectedVersionId === v.id
                            ? "bg-blue-50 ring-1 ring-blue-200"
                            : ""
                        }`}
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
                <VersionSummary version={selectedVersion} />
              ) : (
                <div className="p-4 text-xs text-muted-foreground">
                  Select a version on the left to preview its summary.
                </div>
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
