import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSopLibraryItems,
  useCreateSopLibraryItem,
  getListSopLibraryItemsQueryKey,
  SopLibraryItemResponseKind,
  type SopLibraryItemResponse,
  type CreateSopLibraryItemBody,
} from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, FileText, ListTree, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type {
  DecisionTree,
  EvidenceReq,
} from "@/components/decision-tree/types";
import {
  addEvidenceReq,
  cloneSubTreeWithFreshIds,
  setEvidenceReq,
} from "./sop-full-page-editor-helpers";

// ---------------------------------------------------------------------------
// LibraryDrawer — task #778.
//
// Side drawer (shadcn Sheet) opened from the editor's toolbar. Lets
// authors browse evidence requirements and sub-trees saved to the
// shared library, filter by a text search, and Insert items into the
// SOP they're editing. Inserts:
//   - evidence_requirement: appends a copy of the EvidenceReq payload to
//     the currently selected node's evidenceRequirements (or toasts if
//     no node is selected).
//   - sub_tree: deep-clones the sub-tree (fresh ids — see
//     `cloneSubTreeWithFreshIds`) and inserts the cloned root as a new
//     option/child of the currently selected node.
//
// All library mutations go through the existing `/api/sop-library-items`
// hooks. Inserting into the editor only updates the in-memory tree; the
// user must still press Save to persist.
// ---------------------------------------------------------------------------

function matchesSearch(item: SopLibraryItemResponse, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (item.label.toLowerCase().includes(needle)) return true;
  if ((item.description || "").toLowerCase().includes(needle)) return true;
  return false;
}

export function LibraryDrawer({
  isOpen,
  onClose,
  selectedNodeId,
  tree,
  onTreeChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedNodeId: string | null;
  tree: DecisionTree;
  onTreeChange: (next: DecisionTree) => void;
}) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListSopLibraryItems({
    query: { enabled: isOpen, queryKey: getListSopLibraryItemsQueryKey() },
  });

  const { evidenceItems, subTreeItems } = useMemo(() => {
    const items = data || [];
    return {
      evidenceItems: items.filter(
        (i) => i.kind === SopLibraryItemResponseKind.evidence_requirement,
      ),
      subTreeItems: items.filter(
        (i) => i.kind === SopLibraryItemResponseKind.sub_tree,
      ),
    };
  }, [data]);

  const filteredEvidence = useMemo(
    () => evidenceItems.filter((i) => matchesSearch(i, search)),
    [evidenceItems, search],
  );
  const filteredSubTrees = useMemo(
    () => subTreeItems.filter((i) => matchesSearch(i, search)),
    [subTreeItems, search],
  );

  const ensureSelection = (): boolean => {
    if (selectedNodeId) return true;
    toast({
      title: "Pick a step first",
      description: "Click a question node in the canvas, then insert.",
      variant: "destructive",
    });
    return false;
  };

  const handleInsertEvidence = (item: SopLibraryItemResponse) => {
    if (!ensureSelection()) return;
    const nodeId = selectedNodeId!;
    // Append a default row, then overwrite its label/required/type/etc
    // from the library payload. Keeps the synthetic key fresh so list
    // keys don't collide with anything already on the node.
    const node = tree.nodes.find((n) => n.id === nodeId);
    const nextIdx = node?.evidenceRequirements?.length ?? 0;
    const withRow = addEvidenceReq(tree, nodeId);
    const payload = item.payload as Partial<EvidenceReq>;
    const patch: Partial<EvidenceReq> = {
      label: typeof payload.label === "string" ? payload.label : item.label,
      required: payload.required !== false,
    };
    if (typeof payload.evidenceTypeId === "number") patch.evidenceTypeId = payload.evidenceTypeId;
    if (typeof payload.acceptsImage === "boolean") patch.acceptsImage = payload.acceptsImage;
    if (typeof payload.acceptsText === "boolean") patch.acceptsText = payload.acceptsText;
    if (typeof payload.filenameTemplate === "string") patch.filenameTemplate = payload.filenameTemplate;
    onTreeChange(setEvidenceReq(withRow, nodeId, nextIdx, patch));
    toast({
      title: "Evidence inserted",
      description: `Added "${patch.label}" to the selected step.`,
    });
  };

  const handleInsertSubTree = (item: SopLibraryItemResponse) => {
    if (!ensureSelection()) return;
    const nodeId = selectedNodeId!;
    // The payload is a DecisionTree shape. Defensive about the wire
    // format: bail with a destructive toast rather than corrupting
    // the editor's tree.
    const payload = item.payload as Partial<DecisionTree>;
    if (!payload || typeof payload.rootId !== "string" || !Array.isArray(payload.nodes)) {
      toast({
        title: "Couldn't insert — saved tree is invalid",
        description: "The library item's payload is malformed.",
        variant: "destructive",
      });
      return;
    }
    const sourceTree = payload as DecisionTree;
    const { nodes: clonedNodes, rootId: clonedRoot } = cloneSubTreeWithFreshIds(
      sourceTree,
      sourceTree.rootId,
    );
    const nextTree: DecisionTree = {
      ...tree,
      nodes: [
        ...tree.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                options: [
                  ...n.options,
                  { label: item.label || "From library", childId: clonedRoot },
                ],
              }
            : n,
        ),
        ...clonedNodes,
      ],
    };
    onTreeChange(nextTree);
    toast({
      title: "Sub-tree inserted",
      description: `Added "${item.label}" as a new branch on the selected step.`,
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-[420px] p-0 flex flex-col"
        data-testid="library-drawer"
      >
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border">
          <SheetTitle className="text-base">SOP Library</SheetTitle>
          <SheetDescription className="text-xs">
            Insert saved evidence or sub-trees into the currently selected step.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search library…"
              className="pl-7 h-8 text-xs"
              data-testid="library-search"
            />
          </div>
        </div>
        <Tabs defaultValue="evidence" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 mt-2 grid grid-cols-2 h-8">
            <TabsTrigger value="evidence" className="text-xs" data-testid="library-tab-evidence">
              <FileText className="w-3 h-3 mr-1" /> Evidence ({filteredEvidence.length})
            </TabsTrigger>
            <TabsTrigger value="sub_trees" className="text-xs" data-testid="library-tab-sub-trees">
              <ListTree className="w-3 h-3 mr-1" /> Sub-trees ({filteredSubTrees.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="evidence" className="flex-1 overflow-y-auto px-4 py-2 mt-0">
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </div>
            ) : filteredEvidence.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4">
                {evidenceItems.length === 0
                  ? "No evidence items saved yet. Use \"Save evidence to library\" on any evidence row."
                  : "No items match your search."}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredEvidence.map((item) => (
                  <LibraryRow
                    key={item.id}
                    item={item}
                    onInsert={() => handleInsertEvidence(item)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="sub_trees" className="flex-1 overflow-y-auto px-4 py-2 mt-0">
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </div>
            ) : filteredSubTrees.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4">
                {subTreeItems.length === 0
                  ? "No sub-trees saved yet. Use \"Save sub-tree to library\" on any question node."
                  : "No items match your search."}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredSubTrees.map((item) => {
                  const nodeCount = Array.isArray((item.payload as { nodes?: unknown[] }).nodes)
                    ? ((item.payload as { nodes: unknown[] }).nodes.length)
                    : 0;
                  return (
                    <LibraryRow
                      key={item.id}
                      item={item}
                      meta={`${nodeCount} node${nodeCount === 1 ? "" : "s"}`}
                      onInsert={() => handleInsertSubTree(item)}
                    />
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function LibraryRow({
  item,
  meta,
  onInsert,
}: {
  item: SopLibraryItemResponse;
  meta?: string;
  onInsert: () => void;
}) {
  return (
    <div
      className="border border-border rounded p-2 bg-background flex items-start gap-2"
      data-testid={`library-item-${item.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{item.label}</div>
        {item.description && (
          <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
            {item.description}
          </div>
        )}
        {meta && (
          <div className="text-[10px] text-muted-foreground mt-0.5">{meta}</div>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs shrink-0"
        onClick={onInsert}
        data-testid={`library-insert-${item.id}`}
      >
        Insert
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SaveToLibraryDialog — shared dialog for both "Save evidence to library"
// and "Save sub-tree to library". Asks for a label + optional
// description, then calls the create hook with the right kind+payload.
// After a successful save, invalidates the list query key so the
// LibraryDrawer's list refreshes the next time it opens (or, if
// already open, in real time).
// ---------------------------------------------------------------------------

export function SaveToLibraryDialog({
  open,
  onOpenChange,
  kind,
  payload,
  defaultLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "evidence_requirement" | "sub_tree";
  // The payload to persist as-is. Caller is responsible for shape
  // (EvidenceReq minus id for evidence; DecisionTree for sub-tree).
  payload: Record<string, unknown> | null;
  defaultLabel?: string;
}) {
  const [label, setLabel] = useState(defaultLabel || "");
  const [description, setDescription] = useState("");
  const queryClient = useQueryClient();
  const createMutation = useCreateSopLibraryItem({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: getListSopLibraryItemsQueryKey(),
        });
      },
    },
  });

  // Reset the form whenever the dialog is opened with a new payload.
  // (Keeping local state outside an effect keeps the test surface
  // simple — react-query covers the mutation lifecycle.)
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setLabel(defaultLabel || "");
      setDescription("");
      createMutation.reset();
    }
    onOpenChange(next);
  };

  const handleSave = () => {
    if (!payload) return;
    const trimmed = label.trim();
    if (!trimmed) {
      toast({
        title: "Label required",
        description: "Give this library item a short name.",
        variant: "destructive",
      });
      return;
    }
    const body: CreateSopLibraryItemBody = {
      kind,
      label: trimmed,
      payload,
    };
    const trimmedDescription = description.trim();
    if (trimmedDescription) body.description = trimmedDescription;
    createMutation.mutate(
      { data: body },
      {
        onSuccess: () => {
          toast({
            title: "Saved to library",
            description: `"${trimmed}" is now available to every SOP.`,
          });
          handleOpenChange(false);
        },
        onError: (e) => {
          toast({
            title: "Save failed",
            description: e instanceof Error ? e.message : "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  };

  const title =
    kind === "evidence_requirement"
      ? "Save evidence to library"
      : "Save sub-tree to library";
  const desc =
    kind === "evidence_requirement"
      ? "Other authors will be able to insert this evidence requirement into any SOP."
      : "Other authors will be able to insert this sub-tree as a branch in any SOP.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="save-to-library-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">
              Label <span className="text-destructive">*</span>
            </Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Short, human-readable name"
              className="mt-1 h-8 text-xs"
              autoFocus
              data-testid="save-to-library-label"
            />
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What is this for? When should it be used?"
              className="mt-1 text-xs"
              data-testid="save-to-library-description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={createMutation.isPending || !label.trim()}
            data-testid="save-to-library-confirm"
          >
            {createMutation.isPending ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Saving…</>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
