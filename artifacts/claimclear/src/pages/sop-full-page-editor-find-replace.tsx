// Task #776 — Find & Replace across all SOPs.
//
// Subcomponent of SopFullPageEditor. Lives in its own file so the page
// stays focused on the canvas and so future tweaks to the dialog don't
// keep churning the editor's diff. The pure matching/replace helpers
// live in `sop-full-page-editor-helpers.ts` and are unit-tested
// alongside the editor's other helpers.
//
// Contract recap (from the task spec):
// - Scope toggle: "This SOP" vs "All SOPs".
// - Preview pane lists every match `<error type name> › <node excerpt>
//   — …matched text…` and "Replace all" is disabled until previewed.
// - On confirm, PATCH each affected error type via the existing
//   `useUpdateErrorType` hook (one request per row, no bulk endpoint).
// - On any per-row failure, the dialog reports successes + failures
//   and does NOT roll back the successes.
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  useUpdateErrorType,
  getListErrorTypesQueryKey,
  type ErrorTypeResponse,
  type UpdateErrorTypeBodyDecisionTree,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  coerceTree,
  findMatches,
  applyReplacements,
  type FindMatch,
} from "./sop-full-page-editor-helpers";
import type { DecisionTree } from "@/components/decision-tree/types";

type Scope = "current" | "all";

interface PreviewRow {
  errorTypeId: number;
  errorTypeName: string;
  nodeId: string;
  nodeExcerpt: string;
  fieldLabel: string;
  beforeText: string;
  match: FindMatch;
}

const FIELD_LABELS: Record<FindMatch["field"], string> = {
  question: "question",
  instructions: "instructions",
  optionLabel: "branch label",
  outcomeLabel: "outcome label",
  evidenceLabel: "evidence label",
};

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

// Pull a short, human-readable excerpt of the question containing the
// matched node so the row reads `<error type> › <question excerpt>`.
function nodeExcerpt(tree: DecisionTree, nodeId: string): string {
  const n = tree.nodes.find((x) => x.id === nodeId);
  if (!n) return "(unknown step)";
  return truncate(n.question || "(untitled)", 60);
}

interface PreviewState {
  rows: PreviewRow[];
  byErrorType: Map<
    number,
    { tree: DecisionTree; matches: FindMatch[]; name: string }
  >;
  find: string;
  replace: string;
  matchCase: boolean;
  scope: Scope;
}

export function FindReplaceDialog({
  open,
  onOpenChange,
  currentErrorType,
  allErrorTypes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentErrorType: ErrorTypeResponse;
  allErrorTypes: ErrorTypeResponse[];
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [scope, setScope] = useState<Scope>("current");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [running, setRunning] = useState(false);
  const [failures, setFailures] = useState<
    Array<{ name: string; error: string }>
  >([]);
  const [succeededCount, setSucceededCount] = useState(0);

  const queryClient = useQueryClient();
  const updateMutation = useUpdateErrorType();

  // Reset transient state whenever the dialog closes so a re-open
  // doesn't show stale results from the previous session.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPreview(null);
      setFailures([]);
      setSucceededCount(0);
      setRunning(false);
    }
    onOpenChange(next);
  };

  // Invalidate preview whenever inputs change — forces re-preview before
  // "Replace all" becomes available again, so the user can never apply
  // a substitution they haven't seen.
  const invalidatePreview = () => {
    if (preview) setPreview(null);
    if (failures.length) setFailures([]);
    if (succeededCount) setSucceededCount(0);
  };

  const scopedErrorTypes = useMemo(() => {
    if (scope === "current") return [currentErrorType];
    return allErrorTypes;
  }, [scope, currentErrorType, allErrorTypes]);

  const handlePreview = () => {
    if (!find) return;
    const rows: PreviewRow[] = [];
    const byErrorType = new Map<
      number,
      { tree: DecisionTree; matches: FindMatch[]; name: string }
    >();
    for (const et of scopedErrorTypes) {
      const tree = coerceTree(et.decisionTree);
      if (!tree) continue;
      const matches = findMatches(tree, et.id, find, replace, { matchCase });
      if (matches.length === 0) continue;
      byErrorType.set(et.id, { tree, matches, name: et.name });
      for (const m of matches) {
        rows.push({
          errorTypeId: et.id,
          errorTypeName: et.name,
          nodeId: m.nodeId,
          nodeExcerpt: nodeExcerpt(tree, m.nodeId),
          fieldLabel: FIELD_LABELS[m.field],
          beforeText: m.beforeText,
          match: m,
        });
      }
    }
    setPreview({ rows, byErrorType, find, replace, matchCase, scope });
    setFailures([]);
  };

  const handleReplaceAll = async () => {
    if (!preview || preview.rows.length === 0) return;
    setRunning(true);
    setFailures([]);
    setSucceededCount(0);
    const fails: Array<{ name: string; error: string }> = [];
    let succeeded = 0;
    for (const [id, info] of preview.byErrorType.entries()) {
      const nextTree = applyReplacements(
        info.tree,
        id,
        info.matches,
        preview.replace,
      );
      try {
        await updateMutation.mutateAsync({
          id,
          data: {
            decisionTree: JSON.parse(
              JSON.stringify(nextTree),
            ) as UpdateErrorTypeBodyDecisionTree,
          },
        });
        succeeded += 1;
      } catch (e) {
        fails.push({
          name: info.name,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      }
    }
    await queryClient.invalidateQueries({
      queryKey: getListErrorTypesQueryKey(),
    });
    setRunning(false);
    setSucceededCount(succeeded);
    if (fails.length === 0) {
      toast({
        title: "Replace complete",
        description:
          succeeded === 1
            ? "Updated 1 SOP."
            : `Updated ${succeeded} SOPs.`,
      });
      handleOpenChange(false);
    } else {
      setFailures(fails);
      toast({
        title: "Replace finished with errors",
        description: `${succeeded} SOP${succeeded === 1 ? "" : "s"} updated, ${fails.length} failed. Successful updates were not rolled back.`,
        variant: "destructive",
      });
    }
  };

  const canReplace =
    !!preview &&
    preview.rows.length > 0 &&
    preview.find === find &&
    preview.replace === replace &&
    preview.matchCase === matchCase &&
    preview.scope === scope &&
    !running;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-2xl"
        data-testid="find-replace-dialog"
      >
        <DialogHeader>
          <DialogTitle>Find & Replace</DialogTitle>
          <DialogDescription>
            Search across SOPs and apply the same substitution everywhere
            it matches. Preview first; replacements run one SOP at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fr-find" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Find
              </Label>
              <Input
                id="fr-find"
                value={find}
                onChange={(e) => {
                  setFind(e.target.value);
                  invalidatePreview();
                }}
                className="mt-1 h-8 text-xs"
                data-testid="find-replace-find"
                placeholder="e.g., GPS log"
              />
            </div>
            <div>
              <Label htmlFor="fr-replace" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Replace with
              </Label>
              <Input
                id="fr-replace"
                value={replace}
                onChange={(e) => {
                  setReplace(e.target.value);
                  invalidatePreview();
                }}
                className="mt-1 h-8 text-xs"
                data-testid="find-replace-replace"
                placeholder="e.g., ride log"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={matchCase}
                onCheckedChange={(v) => {
                  setMatchCase(v === true);
                  invalidatePreview();
                }}
                data-testid="find-replace-match-case"
              />
              Match case
            </label>
            <RadioGroup
              value={scope}
              onValueChange={(v) => {
                setScope(v as Scope);
                invalidatePreview();
              }}
              className="flex items-center gap-3"
            >
              <label className="flex items-center gap-1.5 text-xs">
                <RadioGroupItem value="current" data-testid="find-replace-scope-current" />
                This SOP
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <RadioGroupItem value="all" data-testid="find-replace-scope-all" />
                All SOPs
              </label>
            </RadioGroup>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handlePreview}
              disabled={!find || running}
              data-testid="find-replace-preview"
            >
              <Search className="w-3.5 h-3.5 mr-1" /> Preview
            </Button>
            {preview && (
              <span className="text-[11px] text-muted-foreground" data-testid="find-replace-count">
                {preview.rows.length === 0
                  ? "No matches."
                  : `${preview.rows.length} match${preview.rows.length === 1 ? "" : "es"} across ${preview.byErrorType.size} SOP${preview.byErrorType.size === 1 ? "" : "s"}.`}
              </span>
            )}
          </div>

          <div
            className="border border-border rounded-md max-h-72 overflow-y-auto bg-muted/20"
            data-testid="find-replace-preview-pane"
          >
            {!preview ? (
              <div className="p-4 text-[11px] text-muted-foreground italic">
                Preview to see every match before replacing.
              </div>
            ) : preview.rows.length === 0 ? (
              <div className="p-4 text-[11px] text-muted-foreground italic">
                No matches in the selected scope.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {preview.rows.map((row, i) => (
                  <li
                    key={`${row.errorTypeId}-${row.nodeId}-${row.match.field}-${row.match.index}-${i}`}
                    className="p-2 text-[11px] space-y-0.5"
                    data-testid="find-replace-preview-row"
                  >
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span className="font-medium text-foreground">{row.errorTypeName}</span>
                      <span>›</span>
                      <span className="truncate">{row.nodeExcerpt}</span>
                      <span className="ml-auto italic">{row.fieldLabel}</span>
                    </div>
                    <div className="font-mono text-[10px] leading-snug break-words">
                      {renderMatchHighlight(row.beforeText, row.match.matchSpans)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {failures.length > 0 && (
            <div
              className="border border-destructive/40 bg-destructive/5 rounded-md p-2 text-[11px] space-y-1"
              data-testid="find-replace-failures"
            >
              <div className="font-medium text-destructive" data-testid="find-replace-failures-summary">
                {succeededCount} SOP{succeededCount === 1 ? "" : "s"} succeeded · {failures.length} SOP{failures.length === 1 ? "" : "s"} failed:
              </div>
              <ul className="list-disc list-inside text-destructive/90">
                {failures.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium">{f.name}:</span> {f.error}
                  </li>
                ))}
              </ul>
              <div className="text-[10px] text-muted-foreground italic">
                Successful updates were not rolled back.
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={running}
            data-testid="find-replace-cancel"
          >
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleReplaceAll}
            disabled={!canReplace}
            data-testid="find-replace-apply"
          >
            {running ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Replacing…</>
            ) : (
              <>Replace all</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function renderMatchHighlight(
  text: string,
  spans: Array<{ start: number; end: number }>,
): React.ReactNode {
  if (spans.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) parts.push(text.slice(cursor, s.start));
    parts.push(
      <mark key={i} className="bg-yellow-200 text-foreground rounded px-0.5">
        {text.slice(s.start, s.end)}
      </mark>,
    );
    cursor = s.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
