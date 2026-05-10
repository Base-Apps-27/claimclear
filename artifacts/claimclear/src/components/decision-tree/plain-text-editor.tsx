import { useMemo, useState, useRef, useEffect } from "react";
import type { DecisionTree, TreeNode } from "./types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sparkles, Save, Undo2, Loader2, Check, X, Pencil,
  CheckCheck, XCircle, FileText, AlertCircle,
} from "lucide-react";

type FieldKind =
  | "question"
  | "helpText"
  | "instructionText"
  | "instructionLinkLabel"
  | "optionLabel"
  | "outcomeLabel"
  | "evidenceLabel";

interface FlatField {
  id: string;
  nodeId: string;
  nodeNumber: number;
  kind: FieldKind;
  fieldLabel: string;
  breadcrumb: string;
  original: string;
  multiline: boolean;
  shortLabel: boolean;
  optionIndex?: number;
  evidenceIndex?: number;
}

interface SuggestionState {
  text: string;
  status: "pending" | "accepted" | "rejected";
}

const FIELD_LABELS: Record<FieldKind, string> = {
  question: "Question",
  helpText: "Help text",
  instructionText: "Instructions",
  instructionLinkLabel: "Link label",
  optionLabel: "Option label",
  outcomeLabel: "Outcome label",
  evidenceLabel: "Evidence label",
};

function countWords(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function describeWordDelta(currentWords: number, suggestedWords: number): { label: string; tone: "shorter" | "longer" | "same" } {
  const delta = suggestedWords - currentWords;
  if (delta === 0) {
    return { label: "same length, simpler", tone: "same" };
  }
  const abs = Math.abs(delta);
  const sign = delta < 0 ? "−" : "+";
  const noun = abs === 1 ? "word" : "words";
  if (currentWords > 0) {
    const pct = Math.round((abs / currentWords) * 100);
    return { label: `${sign}${abs} ${noun} / ${sign}${pct}%`, tone: delta < 0 ? "shorter" : "longer" };
  }
  return { label: `${sign}${abs} ${noun}`, tone: delta < 0 ? "shorter" : "longer" };
}

function flattenTree(tree: DecisionTree): FlatField[] {
  const fields: FlatField[] = [];
  const order: { node: TreeNode; number: number; breadcrumb: string }[] = [];
  const seen = new Set<string>();
  const numberByNode = new Map<string, number>();
  let counter = 0;

  function walk(nodeId: string, breadcrumb: string) {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    const node = tree.nodes.find(n => n.id === nodeId);
    if (!node) return;
    counter += 1;
    numberByNode.set(node.id, counter);
    const stepCrumb = breadcrumb
      ? `${breadcrumb} → Step ${counter}`
      : `Step ${counter}`;
    order.push({ node, number: counter, breadcrumb: stepCrumb });
    for (const opt of node.options) {
      if (opt.childId) {
        const optCrumb = `${stepCrumb} → "${opt.label || "(unlabeled)"}"`;
        walk(opt.childId, optCrumb);
      }
    }
  }

  walk(tree.rootId, "");

  // Include any orphan nodes not reachable from root, at the end.
  for (const node of tree.nodes) {
    if (!seen.has(node.id)) {
      counter += 1;
      numberByNode.set(node.id, counter);
      order.push({ node, number: counter, breadcrumb: `Step ${counter} (orphan)` });
    }
  }

  for (const { node, number, breadcrumb } of order) {
    fields.push({
      id: `${node.id}::question`,
      nodeId: node.id,
      nodeNumber: number,
      kind: "question",
      fieldLabel: FIELD_LABELS.question,
      breadcrumb,
      original: node.question || "",
      multiline: true,
      shortLabel: false,
    });

    if (node.helpText !== undefined) {
      fields.push({
        id: `${node.id}::helpText`,
        nodeId: node.id,
        nodeNumber: number,
        kind: "helpText",
        fieldLabel: FIELD_LABELS.helpText,
        breadcrumb,
        original: node.helpText || "",
        multiline: true,
        shortLabel: false,
      });
    }

    if (node.instructionText !== undefined) {
      fields.push({
        id: `${node.id}::instructionText`,
        nodeId: node.id,
        nodeNumber: number,
        kind: "instructionText",
        fieldLabel: FIELD_LABELS.instructionText,
        breadcrumb,
        original: node.instructionText || "",
        multiline: true,
        shortLabel: false,
      });
    }

    if (node.instructionLinkLabel !== undefined) {
      fields.push({
        id: `${node.id}::instructionLinkLabel`,
        nodeId: node.id,
        nodeNumber: number,
        kind: "instructionLinkLabel",
        fieldLabel: FIELD_LABELS.instructionLinkLabel,
        breadcrumb,
        original: node.instructionLinkLabel || "",
        multiline: false,
        shortLabel: true,
      });
    }

    node.options.forEach((opt, optIdx) => {
      fields.push({
        id: `${node.id}::option:${optIdx}:label`,
        nodeId: node.id,
        nodeNumber: number,
        kind: "optionLabel",
        fieldLabel: `Option ${optIdx + 1} label`,
        breadcrumb,
        original: opt.label || "",
        multiline: false,
        shortLabel: true,
        optionIndex: optIdx,
      });

      if (opt.outcomeLabel !== undefined && !opt.childId) {
        fields.push({
          id: `${node.id}::option:${optIdx}:outcomeLabel`,
          nodeId: node.id,
          nodeNumber: number,
          kind: "outcomeLabel",
          fieldLabel: `Option ${optIdx + 1} outcome`,
          breadcrumb,
          original: opt.outcomeLabel || "",
          multiline: false,
          shortLabel: false,
          optionIndex: optIdx,
        });
      }
    });

    (node.evidenceRequirements || []).forEach((ev, evIdx) => {
      fields.push({
        id: `${node.id}::evidence:${evIdx}:label`,
        nodeId: node.id,
        nodeNumber: number,
        kind: "evidenceLabel",
        fieldLabel: `Evidence ${evIdx + 1} label`,
        breadcrumb,
        original: ev.label || "",
        multiline: false,
        shortLabel: false,
        evidenceIndex: evIdx,
      });
    });
  }

  return fields;
}

function applyEditsToTree(
  tree: DecisionTree,
  fields: FlatField[],
  edits: Record<string, string>,
): DecisionTree {
  const nodesById = new Map(tree.nodes.map(n => [n.id, { ...n, options: n.options.map(o => ({ ...o })), evidenceRequirements: n.evidenceRequirements ? n.evidenceRequirements.map(e => ({ ...e })) : undefined } as TreeNode]));

  for (const f of fields) {
    if (!(f.id in edits)) continue;
    const value = edits[f.id];
    if (value === f.original) continue;
    const node = nodesById.get(f.nodeId);
    if (!node) continue;
    switch (f.kind) {
      case "question":
        node.question = value;
        break;
      case "helpText":
        node.helpText = value;
        break;
      case "instructionText":
        node.instructionText = value;
        break;
      case "instructionLinkLabel":
        node.instructionLinkLabel = value;
        break;
      case "optionLabel":
        if (f.optionIndex !== undefined && node.options[f.optionIndex]) {
          node.options[f.optionIndex].label = value;
        }
        break;
      case "outcomeLabel":
        if (f.optionIndex !== undefined && node.options[f.optionIndex]) {
          node.options[f.optionIndex].outcomeLabel = value;
        }
        break;
      case "evidenceLabel":
        if (f.evidenceIndex !== undefined && node.evidenceRequirements && node.evidenceRequirements[f.evidenceIndex]) {
          node.evidenceRequirements[f.evidenceIndex].label = value;
        }
        break;
    }
  }

  return {
    rootId: tree.rootId,
    nodes: tree.nodes.map(n => nodesById.get(n.id) || n),
  };
}

interface PlainTextEditorProps {
  tree: DecisionTree;
  onSave: (updated: DecisionTree) => void | Promise<void>;
}

export function PlainTextEditor({ tree, onSave }: PlainTextEditorProps) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Record<string, SuggestionState>>({});
  const [isSimplifying, setIsSimplifying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const treeKey = tree.rootId;
  const lastTreeKey = useRef<string>(treeKey);
  useEffect(() => {
    if (lastTreeKey.current !== treeKey) {
      lastTreeKey.current = treeKey;
      setEdits({});
      setSuggestions({});
      setError(null);
      setInfo(null);
    }
  }, [treeKey]);

  const fields = useMemo(() => flattenTree(tree), [tree]);

  const fieldsByNode = useMemo(() => {
    const groups: { nodeId: string; nodeNumber: number; breadcrumb: string; items: FlatField[] }[] = [];
    let current: typeof groups[0] | null = null;
    for (const f of fields) {
      if (!current || current.nodeId !== f.nodeId) {
        current = { nodeId: f.nodeId, nodeNumber: f.nodeNumber, breadcrumb: f.breadcrumb, items: [] };
        groups.push(current);
      }
      current.items.push(f);
    }
    return groups;
  }, [fields]);

  const currentValue = (f: FlatField) => (f.id in edits ? edits[f.id] : f.original);

  const pendingChangeCount = fields.reduce((acc, f) => {
    const v = currentValue(f);
    return acc + (v !== f.original ? 1 : 0);
  }, 0);

  const pendingSuggestionCount = Object.values(suggestions).filter(s => s.status === "pending").length;

  const pendingSuggestionStats = useMemo(() => {
    let count = 0;
    let totalCurrent = 0;
    let totalSuggested = 0;
    for (const [id, s] of Object.entries(suggestions)) {
      if (s.status !== "pending") continue;
      const f = fields.find(x => x.id === id);
      if (!f) continue;
      const cur = f.id in edits ? edits[f.id] : f.original;
      count += 1;
      totalCurrent += countWords(cur);
      totalSuggested += countWords(s.text);
    }
    return { count, totalCurrent, totalSuggested, wordsCut: totalCurrent - totalSuggested };
  }, [suggestions, edits, fields]);

  const handleEdit = (id: string, value: string) => {
    setEdits(prev => ({ ...prev, [id]: value }));
  };

  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const handleDiscard = () => {
    if (pendingChangeCount === 0 && pendingSuggestionCount === 0) return;
    setDiscardConfirmOpen(true);
  };

  const confirmDiscard = () => {
    setDiscardConfirmOpen(false);
    setEdits({});
    setSuggestions({});
    setInfo(null);
    setError(null);
  };

  const discardSummary = `${pendingChangeCount} text change${pendingChangeCount === 1 ? "" : "s"}${pendingSuggestionCount > 0 ? ` and ${pendingSuggestionCount} pending suggestion${pendingSuggestionCount === 1 ? "" : "s"}` : ""}`;

  const handleSaveAll = async () => {
    setIsSaving(true);
    setError(null);
    setInfo(null);
    try {
      const updated = applyEditsToTree(tree, fields, edits);
      await onSave(updated);
      setEdits({});
      setSuggestions(prev => {
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.status === "pending") next[k] = v;
        }
        return next;
      });
      setInfo("Changes saved.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSimplify = async () => {
    setIsSimplifying(true);
    setError(null);
    setInfo(null);
    try {
      // Group by step so the model sees each decision step as a coherent
      // bundle: parent question (current text, including pending edits) on
      // top, then every non-empty row underneath. The model can then keep
      // wording consistent across the question, its option labels, outcome
      // labels, and evidence labels — and reconsider every row, not just
      // the long ones.
      const steps = fieldsByNode
        .map(group => {
          const rows = group.items
            .map(f => ({
              id: f.id,
              kind: f.fieldLabel,
              text: currentValue(f),
              shortLabel: f.shortLabel,
            }))
            .filter(r => r.text.trim().length > 0);
          const questionField = group.items.find(f => f.kind === "question");
          const parentQuestion = questionField ? currentValue(questionField).trim() : "";
          return {
            stepNumber: group.nodeNumber,
            breadcrumb: group.breadcrumb,
            parentQuestion,
            rows,
          };
        })
        .filter(s => s.rows.length > 0);

      const totalRows = steps.reduce((acc, s) => acc + s.rows.length, 0);
      if (totalRows === 0) {
        setInfo("No text to simplify.");
        return;
      }

      const res = await fetch("/api/error-types/simplify-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const data: { suggestions: { id: string; text: string }[] } = await res.json();

      const next: Record<string, SuggestionState> = {};
      let kept = 0;
      for (const s of data.suggestions || []) {
        const f = fields.find(x => x.id === s.id);
        if (!f) continue;
        const cur = currentValue(f);
        if (s.text.trim() === cur.trim()) continue;
        next[s.id] = { text: s.text, status: "pending" };
        kept += 1;
      }
      setSuggestions(next);
      if (kept === 0) {
        setInfo("AI returned no suggested changes.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "AI request failed");
    } finally {
      setIsSimplifying(false);
    }
  };

  const acceptSuggestion = (id: string) => {
    const s = suggestions[id];
    if (!s) return;
    setEdits(prev => ({ ...prev, [id]: s.text }));
    setSuggestions(prev => ({ ...prev, [id]: { ...s, status: "accepted" } }));
  };

  const rejectSuggestion = (id: string) => {
    setSuggestions(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const acceptAll = () => {
    const newEdits = { ...edits };
    const newSuggestions = { ...suggestions };
    for (const [id, s] of Object.entries(suggestions)) {
      if (s.status !== "pending") continue;
      newEdits[id] = s.text;
      newSuggestions[id] = { ...s, status: "accepted" };
    }
    setEdits(newEdits);
    setSuggestions(newSuggestions);
  };

  const rejectAll = () => {
    setSuggestions(prev => {
      const next: typeof prev = {};
      for (const [id, s] of Object.entries(prev)) {
        if (s.status !== "pending") next[id] = s;
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-1 px-1 pt-1 pb-2 bg-background/95 backdrop-blur-sm border-b">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1 text-xs">
              <FileText className="h-3 w-3" />
              {fields.length} field{fields.length === 1 ? "" : "s"}
            </Badge>
            {pendingChangeCount > 0 && (
              <Badge variant="secondary" className="gap-1 text-xs bg-amber-50 text-amber-800 border-amber-200">
                <Pencil className="h-3 w-3" />
                {pendingChangeCount} unsaved
              </Badge>
            )}
            {pendingSuggestionCount > 0 && (
              <Badge variant="secondary" className="gap-1 text-xs bg-violet-50 text-violet-800 border-violet-200">
                <Sparkles className="h-3 w-3" />
                {pendingSuggestionCount} suggestion{pendingSuggestionCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {pendingSuggestionCount > 0 && (
              <>
                <Button size="sm" variant="outline" className="gap-1 h-8" onClick={acceptAll}>
                  <CheckCheck className="h-3.5 w-3.5" />Accept all
                </Button>
                <Button size="sm" variant="outline" className="gap-1 h-8 text-muted-foreground" onClick={rejectAll}>
                  <XCircle className="h-3.5 w-3.5" />Reject all
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1 h-8"
              onClick={handleSimplify}
              disabled={isSimplifying || fields.length === 0}
              title="Rewrite all text to a 6th-grade reading level for ESL readers"
            >
              {isSimplifying
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Simplifying...</>
                : <><Sparkles className="h-3.5 w-3.5" />Simplify with AI</>}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 h-8 text-muted-foreground"
              onClick={handleDiscard}
              disabled={pendingChangeCount === 0 && pendingSuggestionCount === 0}
            >
              <Undo2 className="h-3.5 w-3.5" />Discard
            </Button>
            <Button
              size="sm"
              className="gap-1 h-8"
              onClick={handleSaveAll}
              disabled={isSaving || pendingChangeCount === 0}
            >
              {isSaving
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving...</>
                : <><Save className="h-3.5 w-3.5" />Save all</>}
            </Button>
          </div>
        </div>
        {(error || info) && (
          <div className={`mt-2 text-xs flex items-center gap-1 ${error ? "text-red-600" : "text-emerald-700"}`}>
            {error ? <AlertCircle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {error || info}
          </div>
        )}
        {pendingSuggestionStats.count > 0 && (
          <div className="mt-2 text-xs flex items-center gap-1 text-violet-700">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              AI suggested rewrites for {pendingSuggestionStats.count} field
              {pendingSuggestionStats.count === 1 ? "" : "s"}
              {pendingSuggestionStats.wordsCut > 0 && (
                <>, cutting ~{pendingSuggestionStats.wordsCut} word{pendingSuggestionStats.wordsCut === 1 ? "" : "s"} total</>
              )}
              {pendingSuggestionStats.wordsCut < 0 && (
                <>, adding ~{-pendingSuggestionStats.wordsCut} word{-pendingSuggestionStats.wordsCut === 1 ? "" : "s"} total</>
              )}
              {pendingSuggestionStats.wordsCut === 0 && pendingSuggestionStats.totalCurrent > 0 && (
                <>, same total length</>
              )}
              . Review below.
            </span>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Edit any text below. Structure (steps, branches, outcomes) stays the same — only the wording is updated.
      </p>

      <div className="space-y-3">
        {fieldsByNode.map(group => (
          <Card key={group.nodeId} className="border-slate-200">
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-700">{group.breadcrumb}</p>
                <Badge variant="outline" className="font-mono text-[10px] tracking-wider text-slate-500">
                  Q{group.nodeNumber}
                </Badge>
              </div>
              <div className="space-y-3">
                {group.items.map(field => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    value={currentValue(field)}
                    suggestion={suggestions[field.id]}
                    onChange={(v) => handleEdit(field.id, v)}
                    onAccept={() => acceptSuggestion(field.id)}
                    onReject={() => rejectSuggestion(field.id)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {fields.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No editable text in this tree yet.</p>
        )}
      </div>

      <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <AlertDialogContent data-testid="plain-text-editor-discard-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard {discardSummary}?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears every unsaved edit and pending AI suggestion in the
              editor. You can&apos;t undo it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="plain-text-editor-discard-cancel">
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDiscard}
              data-testid="plain-text-editor-discard-confirm-btn"
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FieldRow({
  field,
  value,
  suggestion,
  onChange,
  onAccept,
  onReject,
}: {
  field: FlatField;
  value: string;
  suggestion?: SuggestionState;
  onChange: (v: string) => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const isChanged = value !== field.original;
  const showDiff = suggestion?.status === "pending";

  const currentWords = countWords(value);
  const suggestedWords = suggestion ? countWords(suggestion.text) : 0;
  const wordDelta = suggestion ? describeWordDelta(currentWords, suggestedWords) : null;
  const deltaClasses: Record<"shorter" | "longer" | "same", string> = {
    shorter: "bg-emerald-50 text-emerald-700 border-emerald-200",
    longer: "bg-amber-50 text-amber-800 border-amber-200",
    same: "bg-slate-50 text-slate-600 border-slate-200",
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
          {field.fieldLabel}
        </span>
        {isChanged && (
          <Badge variant="outline" className="text-[10px] py-0 h-4 bg-amber-50 text-amber-800 border-amber-200">
            edited
          </Badge>
        )}
        {field.shortLabel && (
          <Badge variant="outline" className="text-[10px] py-0 h-4 text-slate-500">
            short
          </Badge>
        )}
      </div>

      {showDiff ? (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-violet-200 bg-violet-50/40 p-2">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Current</p>
            <div className="text-xs whitespace-pre-wrap text-slate-700 bg-white border border-slate-200 rounded p-2 min-h-[2.5rem]">
              {value || <span className="text-slate-400 italic">empty</span>}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[10px] uppercase tracking-wider text-violet-700 font-medium">AI suggestion</p>
                {wordDelta && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] py-0 h-4 ${deltaClasses[wordDelta.tone]}`}
                    title={`Current: ${currentWords} word${currentWords === 1 ? "" : "s"} → Suggested: ${suggestedWords} word${suggestedWords === 1 ? "" : "s"}`}
                  >
                    {wordDelta.label}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-emerald-700 hover:bg-emerald-50" onClick={onAccept}>
                  <Check className="h-3 w-3 mr-1" />Accept
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-slate-500 hover:bg-slate-100" onClick={onReject}>
                  <X className="h-3 w-3 mr-1" />Reject
                </Button>
              </div>
            </div>
            <div className="text-xs whitespace-pre-wrap text-slate-800 bg-white border border-violet-200 rounded p-2 min-h-[2.5rem]">
              {suggestion!.text}
            </div>
          </div>
        </div>
      ) : null}

      {field.multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(8, Math.max(2, Math.ceil(value.length / 80) + 1))}
          className={`text-sm ${isChanged ? "border-amber-300 focus-visible:ring-amber-200" : ""}`}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`text-sm h-8 ${isChanged ? "border-amber-300 focus-visible:ring-amber-200" : ""}`}
        />
      )}

      {suggestion?.status === "accepted" && (
        <p className="text-[10px] text-emerald-700 flex items-center gap-1">
          <Check className="h-3 w-3" />Suggestion accepted — review and Save all to persist.
        </p>
      )}
    </div>
  );
}
