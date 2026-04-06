import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListErrorTypes, getListErrorTypesQueryKey,
  useCreateErrorType, useUpdateErrorType, useDeleteErrorType,
  useAnalyzeSOPText,
} from "@workspace/api-client-react";
import type { ErrorTypeResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Edit2, Trash2, TreeDeciduous, FileText,
  BookOpen, X, ChevronDown, ChevronRight, Sparkles, Loader2,
  MessageSquare, Wand2, Copy, Send, ArrowRight, Ban
} from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  TreeEditor, TreePreview, TreePlayer,
  type DecisionTree, type LegacyTreeNode,
  legacyToTree, generateNodeId,
} from "@/components/decision-tree";

interface DisputeReason {
  key: string;
  label: string;
  description: string;
}

interface EvidenceRequirement {
  key: string;
  label: string;
  required: boolean;
}

function DisputeReasonsEditor({
  reasons,
  onChange,
}: {
  reasons: DisputeReason[];
  onChange: (reasons: DisputeReason[]) => void;
}) {
  const addReason = () => {
    onChange([...reasons, { key: `reason_${Date.now()}`, label: "", description: "" }]);
  };

  const updateReason = (index: number, field: keyof DisputeReason, value: string) => {
    const updated = [...reasons];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removeReason = (index: number) => {
    onChange(reasons.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium flex items-center gap-1.5">
          Dispute Reasons
          <InfoTooltip content="Pre-defined reasons staff can select when filing a dispute. Each reason includes a label (shown to staff) and a description with talking points for the dispute." />
        </Label>
        <Button type="button" variant="outline" size="sm" onClick={addReason}>
          <Plus className="h-3 w-3 mr-1" /> Add Reason
        </Button>
      </div>
      {reasons.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No dispute reasons defined yet.</p>
      ) : (
        <div className="space-y-2">
          {reasons.map((reason, i) => (
            <div key={reason.key} className="border rounded-md p-3 space-y-2 bg-muted/30">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Input
                    value={reason.label}
                    onChange={(e) => updateReason(i, "label", e.target.value)}
                    placeholder="Reason name (e.g., GPS data confirms trip)"
                    className="text-sm"
                  />
                  <Input
                    value={reason.description}
                    onChange={(e) => updateReason(i, "description", e.target.value)}
                    placeholder="Description or talking points"
                    className="text-sm"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive shrink-0"
                  onClick={() => removeReason(i)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceRequirementsEditor({
  requirements,
  onChange,
}: {
  requirements: EvidenceRequirement[];
  onChange: (requirements: EvidenceRequirement[]) => void;
}) {
  const addRequirement = () => {
    onChange([...requirements, { key: `ev_${Date.now()}`, label: "", required: true }]);
  };

  const updateRequirement = (index: number, field: keyof EvidenceRequirement, value: string | boolean) => {
    const updated = [...requirements];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removeRequirement = (index: number) => {
    onChange(requirements.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium flex items-center gap-1.5">
          Evidence Requirements
          <InfoTooltip content="Documents and data staff must collect before a dispute can proceed. Mark items as 'Required' to enforce they are checked off in the evidence gathering step." />
        </Label>
        <Button type="button" variant="outline" size="sm" onClick={addRequirement}>
          <Plus className="h-3 w-3 mr-1" /> Add Requirement
        </Button>
      </div>
      {requirements.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No evidence requirements defined yet.</p>
      ) : (
        <div className="space-y-2">
          {requirements.map((req, i) => (
            <div key={req.key} className="border rounded-md p-3 bg-muted/30 flex items-center gap-3">
              <label className="flex items-center gap-2 shrink-0">
                <input
                  type="checkbox"
                  checked={req.required}
                  onChange={(e) => updateRequirement(i, "required", e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-muted-foreground">Required</span>
              </label>
              <Input
                value={req.label}
                onChange={(e) => updateRequirement(i, "label", e.target.value)}
                placeholder="Evidence item (e.g., GPS breadcrumb log)"
                className="text-sm flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive shrink-0"
                onClick={() => removeRequirement(i)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationalWizard({
  onComplete,
}: {
  onComplete: (tree: DecisionTree) => void;
}) {
  const [messages, setMessages] = useState<Array<{ role: "system" | "user"; text: string }>>([
    { role: "system", text: "Let's build a decision tree step by step. What's the first question staff should answer when handling this claim type?" },
  ]);
  const [input, setInput] = useState("");
  const [tree, setTree] = useState<DecisionTree | null>(null);
  const [wizardState, setWizardState] = useState<"question" | "options" | "option_action" | "sub_question" | "done">("question");
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [pendingOptions, setPendingOptions] = useState<string[]>([]);
  const [currentOptionIdx, setCurrentOptionIdx] = useState(0);

  const addMessage = (role: "system" | "user", text: string) => {
    setMessages(prev => [...prev, { role, text }]);
  };

  const handleSubmit = () => {
    if (!input.trim()) return;
    const userText = input.trim();
    addMessage("user", userText);
    setInput("");

    if (wizardState === "question") {
      const nodeId = generateNodeId();
      const newNode = { id: nodeId, question: userText, options: [] };
      if (!tree) {
        setTree({ rootId: nodeId, nodes: [newNode] });
      } else {
        setTree({ ...tree, nodes: [...tree.nodes, newNode] });
      }
      setCurrentNodeId(nodeId);
      setWizardState("options");
      addMessage("system", `Great question: "${userText}"\n\nWhat are the possible answers? Enter them separated by commas (e.g., "Yes, GPS confirmed", "No GPS data", "Partial data")`);
    } else if (wizardState === "options") {
      const opts = userText.split(",").map(s => s.trim()).filter(Boolean);
      if (opts.length < 2) {
        addMessage("system", "Please provide at least 2 options, separated by commas.");
        return;
      }
      setPendingOptions(opts);
      setCurrentOptionIdx(0);
      setWizardState("option_action");
      addMessage("system", `Got ${opts.length} options. For "${opts[0]}" — choose what happens next:`);
    }
  };

  const applyOutcome = (outcomeType: "portal_dispute" | "hold" | "internal" | "dispute") => {
    if (!tree || !currentNodeId) return;
    const optionLabel = pendingOptions[currentOptionIdx];
    const labels = { portal_dispute: "Submit Portal Dispute", hold: "Place on Hold", internal: "Resolve Internally", dispute: "Send Dispute Email" };
    const updatedTree = { ...tree, nodes: [...tree.nodes] };
    const nodeIdx = updatedTree.nodes.findIndex(n => n.id === currentNodeId);
    if (nodeIdx < 0) return;
    const node = { ...updatedTree.nodes[nodeIdx] };
    node.options = [...node.options, { label: optionLabel, outcomeType, outcomeLabel: labels[outcomeType] }];
    updatedTree.nodes[nodeIdx] = node;
    setTree(updatedTree);
    addMessage("user", `${optionLabel} → ${labels[outcomeType]}`);
    advanceToNextOption(updatedTree);
  };

  const applySubQuestion = () => {
    setWizardState("sub_question");
    addMessage("system", `What follow-up question should staff answer for "${pendingOptions[currentOptionIdx]}"?`);
  };

  const advanceToNextOption = (updatedTree: DecisionTree) => {
    const nextOptIdx = currentOptionIdx + 1;
    if (nextOptIdx < pendingOptions.length) {
      setCurrentOptionIdx(nextOptIdx);
      setWizardState("option_action");
      addMessage("system", `For "${pendingOptions[nextOptIdx]}" — choose what happens next:`);
    } else {
      const incompleteNodes = updatedTree.nodes.filter(n => n.options.length === 0);
      if (incompleteNodes.length > 0) {
        const next = incompleteNodes[0];
        setCurrentNodeId(next.id);
        setWizardState("options");
        addMessage("system", `Now let's handle: "${next.question}"\n\nWhat are the possible answers? (comma separated)`);
      } else {
        setWizardState("done");
        addMessage("system", "The tree is complete! Review it below and click 'Use This Tree' to save it.");
      }
    }
  };

  const handleSubQuestion = () => {
    if (!input.trim() || !tree || !currentNodeId) return;
    const question = input.trim();
    setInput("");
    addMessage("user", question);
    const childId = generateNodeId();
    const childNode = { id: childId, question, options: [] as import("@/components/decision-tree/types").TreeOption[] };
    const optionLabel = pendingOptions[currentOptionIdx];
    const updatedTree = { ...tree, nodes: [...tree.nodes] };
    const nodeIdx = updatedTree.nodes.findIndex(n => n.id === currentNodeId);
    if (nodeIdx < 0) return;
    const node = { ...updatedTree.nodes[nodeIdx] };
    node.options = [...node.options, { label: optionLabel, childId }];
    updatedTree.nodes[nodeIdx] = node;
    updatedTree.nodes.push(childNode);
    setTree(updatedTree);
    advanceToNextOption(updatedTree);
  };

  return (
    <div className="space-y-3">
      <div className="bg-muted/30 rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
        {messages.map((msg, i) => (
          <div key={i} className={`text-xs ${msg.role === "system" ? "text-muted-foreground" : "text-foreground font-medium"}`}>
            <span className="font-semibold">{msg.role === "system" ? "Builder: " : "You: "}</span>
            <span className="whitespace-pre-line">{msg.text}</span>
          </div>
        ))}
      </div>

      {wizardState === "question" && (
        <div className="flex gap-2">
          <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Type your question..." onKeyDown={e => e.key === "Enter" && handleSubmit()} className="text-sm" />
          <Button size="sm" onClick={handleSubmit} className="gap-1"><Send className="h-3 w-3" />Send</Button>
        </div>
      )}

      {wizardState === "options" && (
        <div className="flex gap-2">
          <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Options separated by commas..." onKeyDown={e => e.key === "Enter" && handleSubmit()} className="text-sm" />
          <Button size="sm" onClick={handleSubmit} className="gap-1"><Send className="h-3 w-3" />Send</Button>
        </div>
      )}

      {wizardState === "option_action" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">For "<span className="font-medium">{pendingOptions[currentOptionIdx]}</span>" — what happens?</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="outline" className="text-xs justify-start text-green-700" onClick={() => applyOutcome("portal_dispute")}>
              <Send className="h-3 w-3 mr-1" />Portal Dispute
            </Button>
            <Button size="sm" variant="outline" className="text-xs justify-start text-amber-700" onClick={() => applyOutcome("hold")}>
              <span className="mr-1">⏸</span>Place on Hold
            </Button>
            <Button size="sm" variant="outline" className="text-xs justify-start text-red-700" onClick={() => applyOutcome("internal")}>
              <Ban className="h-3 w-3 mr-1" />Resolve Internally
            </Button>
            <Button size="sm" variant="outline" className="text-xs justify-start text-blue-700" onClick={() => applyOutcome("dispute")}>
              <span className="mr-1">📧</span>Email Dispute
            </Button>
          </div>
          <Button size="sm" variant="default" className="w-full text-xs gap-1" onClick={applySubQuestion}>
            <ArrowRight className="h-3 w-3" />Add a Follow-up Question
          </Button>
        </div>
      )}

      {wizardState === "sub_question" && (
        <div className="flex gap-2">
          <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Type the follow-up question..." onKeyDown={e => e.key === "Enter" && handleSubQuestion()} className="text-sm" />
          <Button size="sm" onClick={handleSubQuestion} className="gap-1"><Send className="h-3 w-3" />Send</Button>
        </div>
      )}

      {tree && tree.nodes.length > 0 && (
        <div className="space-y-2">
          <TreePreview tree={tree} />
          {wizardState === "done" && (
            <Button onClick={() => onComplete(tree)} className="w-full gap-1">
              <ArrowRight className="h-4 w-4" />Use This Tree
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function NaturalLanguageBuilder({
  errorTypeName,
  onComplete,
}: {
  errorTypeName?: string;
  onComplete: (tree: DecisionTree) => void;
}) {
  const [description, setDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DecisionTree | null>(null);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/error-types/build-tree-from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, errorTypeName }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }
      const data = await res.json();
      if (data.decisionTree) {
        const converted = legacyToTree(data.decisionTree as LegacyTreeNode);
        setPreview(converted);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate tree");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={6}
        placeholder={"Describe the workflow in plain English...\n\nExample:\nFirst check if GPS data is available. If yes, verify the breadcrumbs match the pickup and dropoff locations. If they match, submit a portal dispute. If not, check if there's a reasonable explanation like a detour. If yes, still dispute. If no explanation, deny internally. If no GPS data at all, ask for a driver attestation. If available, dispute. If not, place on hold."}
        className="text-sm"
      />
      <Button
        onClick={handleGenerate}
        disabled={isGenerating || !description.trim()}
        className="gap-2"
      >
        {isGenerating ? (
          <><Loader2 className="h-4 w-4 animate-spin" />Generating Tree...</>
        ) : (
          <><Wand2 className="h-4 w-4" />Generate Decision Tree</>
        )}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {preview && (
        <div className="space-y-2">
          <TreePreview tree={preview} />
          <div className="flex gap-2">
            <Button onClick={() => onComplete(preview)} className="flex-1 gap-1">
              <ArrowRight className="h-4 w-4" />Use This Tree
            </Button>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Try Again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseReasons(raw: Record<string, unknown> | null | undefined): DisputeReason[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item: Record<string, unknown>, i: number) => ({
      key: (item.key as string) || `reason_${i}`,
      label: (item.label as string) || "",
      description: (item.description as string) || "",
    }));
  }
  return Object.entries(raw).map(([key, val]) => ({
    key,
    label: typeof val === "object" && val ? ((val as Record<string, unknown>).label as string) || key : typeof val === "string" ? val : key,
    description: typeof val === "object" && val ? ((val as Record<string, unknown>).description as string) || "" : "",
  }));
}

function parseRequirements(raw: Record<string, unknown> | null | undefined): EvidenceRequirement[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item: Record<string, unknown>, i: number) => ({
      key: (item.key as string) || `ev_${i}`,
      label: (item.label as string) || "",
      required: item.required !== false,
    }));
  }
  return Object.entries(raw).map(([key, val]) => ({
    key,
    label: typeof val === "object" && val ? ((val as Record<string, unknown>).label as string) || key : typeof val === "string" ? val : key,
    required: typeof val === "object" && val ? ((val as Record<string, unknown>).required as boolean) !== false : true,
  }));
}

function serializeReasons(reasons: DisputeReason[]): Record<string, unknown> {
  return Object.fromEntries(
    reasons.filter((r) => r.label).map((r) => [r.key, { label: r.label, description: r.description }])
  );
}

function serializeRequirements(reqs: EvidenceRequirement[]): Record<string, unknown> {
  return Object.fromEntries(
    reqs.filter((r) => r.label).map((r) => [r.key, { label: r.label, required: r.required }])
  );
}

interface ErrorTypeFormState {
  name: string;
  category: string;
  description: string;
  guidance: string;
  recommendedActions: string;
  emailTemplate: string;
  reasons: DisputeReason[];
  requirements: EvidenceRequirement[];
  decisionTree: DecisionTree | null;
}

export default function ErrorTypes() {
  const queryClient = useQueryClient();
  const { data: errorTypes, isLoading } = useListErrorTypes();
  const createErrorType = useCreateErrorType();
  const updateErrorType = useUpdateErrorType();
  const deleteErrorType = useDeleteErrorType();

  const analyzeSOP = useAnalyzeSOPText();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [sopText, setSopText] = useState("");
  const [sopAnalyzing, setSopAnalyzing] = useState(false);
  const [sopError, setSopError] = useState<string | null>(null);
  const [testTree, setTestTree] = useState<DecisionTree | null>(null);

  const emptyForm: ErrorTypeFormState = {
    name: "", category: "", description: "", guidance: "",
    recommendedActions: "", emailTemplate: "",
    reasons: [], requirements: [], decisionTree: null,
  };

  const [form, setForm] = useState<ErrorTypeFormState>(emptyForm);

  const handleAnalyzeSOP = async () => {
    if (!sopText.trim()) return;
    setSopAnalyzing(true);
    setSopError(null);
    try {
      const result = await analyzeSOP.mutateAsync({
        data: { sopText, errorTypeName: form.name || undefined },
      });
      const legacyTree = result.decisionTree as unknown as LegacyTreeNode | null;
      setForm({
        name: result.name || form.name || "",
        category: result.category || "",
        description: result.description || "",
        guidance: result.guidance || "",
        recommendedActions: result.recommendedActions || "",
        emailTemplate: form.emailTemplate,
        reasons: parseReasons(result.disputeReasonsLibrary as Record<string, unknown> | null),
        requirements: parseRequirements(result.evidenceRequirements as Record<string, unknown> | null),
        decisionTree: legacyTree ? legacyToTree(legacyTree) : null,
      });
    } catch (err: unknown) {
      setSopError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setSopAnalyzing(false);
    }
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListErrorTypesQueryKey() });

  const openEdit = (et: ErrorTypeResponse) => {
    const rawTree = et.decisionTree as Record<string, unknown> | null;
    let convertedTree: DecisionTree | null = null;
    if (rawTree) {
      if ("nodes" in rawTree && "rootId" in rawTree) {
        convertedTree = rawTree as unknown as DecisionTree;
      } else if ("question" in rawTree) {
        convertedTree = legacyToTree(rawTree as unknown as LegacyTreeNode);
      }
    }
    setForm({
      name: et.name || "",
      category: et.category || "",
      description: et.description || "",
      guidance: et.guidance || "",
      recommendedActions: et.recommendedActions || "",
      emailTemplate: et.emailTemplate || "",
      reasons: parseReasons(et.disputeReasonsLibrary as Record<string, unknown> | null),
      requirements: parseRequirements(et.evidenceRequirements as Record<string, unknown> | null),
      decisionTree: convertedTree,
    });
    setEditingId(et.id);
  };

  const handleSave = async () => {
    const payload = {
      name: form.name,
      category: form.category,
      description: form.description,
      guidance: form.guidance,
      recommendedActions: form.recommendedActions,
      emailTemplate: form.emailTemplate,
      disputeReasonsLibrary: serializeReasons(form.reasons),
      evidenceRequirements: serializeRequirements(form.requirements),
      decisionTree: form.decisionTree
        ? (JSON.parse(JSON.stringify(form.decisionTree)) as unknown as Record<string, unknown>)
        : undefined,
    };

    if (editingId) {
      await updateErrorType.mutateAsync({ id: editingId, data: payload });
    } else {
      await createErrorType.mutateAsync({ data: payload });
    }
    setEditingId(null);
    setShowCreate(false);
    setForm(emptyForm);
    invalidate();
  };

  const handleDelete = async (id: number) => {
    await deleteErrorType.mutateAsync({ id });
    invalidate();
  };

  const isDialogOpen = showCreate || editingId !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Error Types & SOPs</h2>
          <p className="text-muted-foreground">Configure error classifications, evidence requirements, and decision workflows</p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }}>
          <Plus className="h-4 w-4 mr-1" />Add Error Type
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
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
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(et)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(et.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                {et.description && <p className="line-clamp-2">{et.description}</p>}
                {et.guidance && (
                  <div className="bg-blue-50 text-blue-800 text-xs p-2 rounded">
                    <span className="font-medium">SOP:</span> {et.guidance.substring(0, 100)}{et.guidance.length > 100 ? "..." : ""}
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {et.disputeReasonsLibrary && Object.keys(et.disputeReasonsLibrary).length > 0 && (
                    <Badge variant="secondary"><BookOpen className="h-3 w-3 mr-1" />{Object.keys(et.disputeReasonsLibrary).length} reasons</Badge>
                  )}
                  {et.evidenceRequirements && Object.keys(et.evidenceRequirements).length > 0 && (
                    <Badge variant="secondary"><FileText className="h-3 w-3 mr-1" />{Object.keys(et.evidenceRequirements).length} requirements</Badge>
                  )}
                  {et.decisionTree && (
                    <Badge variant="secondary"><TreeDeciduous className="h-3 w-3 mr-1" />Decision Tree</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) { setEditingId(null); setShowCreate(false); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Error Type" : "Create Error Type"}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="ai-analyzer">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="ai-analyzer" className="gap-1"><Sparkles className="h-3 w-3" />AI Analyzer</TabsTrigger>
              <TabsTrigger value="basics">Basics</TabsTrigger>
              <TabsTrigger value="sop">SOP & Guidance</TabsTrigger>
              <TabsTrigger value="evidence">Evidence & Reasons</TabsTrigger>
              <TabsTrigger value="workflow">Decision Tree</TabsTrigger>
            </TabsList>

            <TabsContent value="ai-analyzer" className="space-y-4 mt-4">
              <Tabs defaultValue="sop-analyzer">
                <TabsList className="w-full grid grid-cols-3">
                  <TabsTrigger value="sop-analyzer" className="text-xs gap-1"><Sparkles className="h-3 w-3" />SOP Analyzer</TabsTrigger>
                  <TabsTrigger value="nl-builder" className="text-xs gap-1"><Wand2 className="h-3 w-3" />Describe Workflow</TabsTrigger>
                  <TabsTrigger value="wizard" className="text-xs gap-1"><MessageSquare className="h-3 w-3" />Guided Builder</TabsTrigger>
                </TabsList>

                <TabsContent value="sop-analyzer" className="mt-3">
                  <div className="bg-gradient-to-r from-violet-50 to-blue-50 dark:from-violet-950/30 dark:to-blue-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-4 space-y-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      Paste your Standard Operating Procedure text and the AI will generate all fields: name, category, description, guidance, dispute reasons, evidence requirements, and a decision tree.
                      <InfoTooltip content="The SOP Analyzer uses AI to parse your procedure document and automatically fill in all error type fields. Paste the full SOP text — the more detail you provide, the better the generated output." />
                    </p>
                    <Textarea
                      value={sopText}
                      onChange={e => setSopText(e.target.value)}
                      rows={8}
                      placeholder="Paste your SOP text here..."
                      className="font-mono text-xs bg-white dark:bg-background"
                    />
                    <div className="flex items-center gap-3">
                      <Button
                        onClick={handleAnalyzeSOP}
                        disabled={sopAnalyzing || !sopText.trim()}
                        className="gap-2"
                      >
                        {sopAnalyzing ? (
                          <><Loader2 className="h-4 w-4 animate-spin" />Analyzing...</>
                        ) : (
                          <><Sparkles className="h-4 w-4" />Analyze & Generate All Fields</>
                        )}
                      </Button>
                      {sopAnalyzing && <span className="text-xs text-muted-foreground">This may take 10-20 seconds...</span>}
                    </div>
                    {sopError && <p className="text-sm text-red-600">{sopError}</p>}
                    {form.name && sopText && !sopAnalyzing && (
                      <p className="text-xs text-green-600">Analysis complete. Review the generated fields in the other tabs, then save.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="nl-builder" className="mt-3">
                  <div className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-950/30 dark:to-green-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      Describe the decision workflow in plain English and the AI will build a decision tree for you.
                      <InfoTooltip content="Write out the decision workflow as you would explain it to a new employee. Describe the questions, possible answers, and what action to take for each scenario." />
                    </p>
                    <NaturalLanguageBuilder
                      errorTypeName={form.name}
                      onComplete={(tree) => setForm({ ...form, decisionTree: tree })}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="wizard" className="mt-3">
                  <div className="bg-gradient-to-r from-green-50 to-amber-50 dark:from-green-950/30 dark:to-amber-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      Build a tree step-by-step through a guided conversation. Answer questions and the tree builds itself.
                      <InfoTooltip content="The guided builder walks you through creating a decision tree interactively. You provide questions and answer options, and choose what action to take for each branch." />
                    </p>
                    <ConversationalWizard
                      onComplete={(tree) => setForm({ ...form, decisionTree: tree })}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="basics" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="flex items-center gap-1">
                    Name *
                    <InfoTooltip content="A short, recognizable name for this error type (e.g., 'No-Show — GPS Confirmed'). This is how staff will identify the error in claim lists and queues." />
                  </Label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <Label className="flex items-center gap-1">
                    Category
                    <InfoTooltip content="Group related error types together (e.g., 'GPS Issues', 'Scheduling'). Categories help staff filter and find relevant SOPs faster." />
                  </Label>
                  <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g., GPS Issues, Scheduling" />
                </div>
              </div>
              <div>
                <Label className="flex items-center gap-1">
                  Description
                  <InfoTooltip content="Explain when this error type applies and what circumstances trigger it. This description is shown to staff when reviewing claims." />
                </Label>
                <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Describe when this error type applies..." />
              </div>
            </TabsContent>

            <TabsContent value="sop" className="space-y-4 mt-4">
              <div>
                <Label>Staff Guidance (SOP)</Label>
                <p className="text-xs text-muted-foreground mb-1">Step-by-step instructions for staff handling this error type</p>
                <Textarea
                  value={form.guidance}
                  onChange={e => setForm({ ...form, guidance: e.target.value })}
                  rows={6}
                  placeholder="1. Review claim details and error code&#10;2. Check GPS breadcrumb data&#10;3. Verify trip log against scheduled trip&#10;4. If data confirms trip, proceed to dispute..."
                />
              </div>
              <div>
                <Label>Recommended Actions</Label>
                <Textarea value={form.recommendedActions} onChange={e => setForm({ ...form, recommendedActions: e.target.value })} rows={3} placeholder="Actions staff should take..." />
              </div>
              <div>
                <Label className="flex items-center gap-1">
                  Email Template
                  <InfoTooltip content="The email template used when generating dispute emails for this error type. Use {{confNumber}}, {{date}}, and {{amount}} as placeholders that will be filled in automatically." />
                </Label>
                <p className="text-xs text-muted-foreground mb-1">Template for dispute emails. Use {"{{confNumber}}"}, {"{{date}}"}, {"{{amount}}"} as placeholders.</p>
                <Textarea value={form.emailTemplate} onChange={e => setForm({ ...form, emailTemplate: e.target.value })} rows={6} className="font-mono text-xs" placeholder="Dear MAS Support,&#10;&#10;We are writing to dispute the rejection of trip {{confNumber}}..." />
              </div>
            </TabsContent>

            <TabsContent value="evidence" className="space-y-6 mt-4">
              <EvidenceRequirementsEditor
                requirements={form.requirements}
                onChange={(requirements) => setForm({ ...form, requirements })}
              />
              <Separator />
              <DisputeReasonsEditor
                reasons={form.reasons}
                onChange={(reasons) => setForm({ ...form, reasons })}
              />
            </TabsContent>

            <TabsContent value="workflow" className="space-y-4 mt-4 min-w-0 overflow-x-auto">
              <TreeEditor
                tree={form.decisionTree}
                onChange={(tree) => setForm({ ...form, decisionTree: tree })}
                onTest={(tree) => setTestTree(tree)}
              />
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => { setEditingId(null); setShowCreate(false); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name}>{editingId ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!testTree} onOpenChange={(open) => { if (!open) setTestTree(null); }}>
        <DialogContent className="max-w-lg overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Test Decision Tree</DialogTitle>
          </DialogHeader>
          {testTree && (
            <TreePlayer
              tree={testTree}
              onOutcome={() => {}}
              isTestMode
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
