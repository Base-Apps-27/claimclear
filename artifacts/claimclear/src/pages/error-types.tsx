import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListErrorTypes, getListErrorTypesQueryKey,
  useCreateErrorType, useUpdateErrorType, useDeleteErrorType,
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
  BookOpen, X, ChevronDown, ChevronRight, GripVertical
} from "lucide-react";

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

interface DecisionTreeNode {
  question: string;
  yesLabel?: string;
  noLabel?: string;
  yesAction?: string;
  noAction?: string;
  yesChild?: DecisionTreeNode;
  noChild?: DecisionTreeNode;
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
        <Label className="text-sm font-medium">Dispute Reasons</Label>
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
        <Label className="text-sm font-medium">Evidence Requirements</Label>
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

function DecisionTreeEditor({
  node,
  onChange,
  depth = 0,
}: {
  node: DecisionTreeNode | null;
  onChange: (node: DecisionTreeNode | null) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (!node) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full border-dashed"
        onClick={() =>
          onChange({ question: "", yesLabel: "Yes", noLabel: "No" })
        }
      >
        <Plus className="h-3 w-3 mr-1" /> Add Decision Node
      </Button>
    );
  }

  const borderColors = [
    "border-blue-300",
    "border-green-300",
    "border-amber-300",
    "border-purple-300",
  ];

  return (
    <div
      className={`border-l-4 ${borderColors[depth % borderColors.length]} pl-3 space-y-2`}
    >
      <div className="flex items-start gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 mt-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
        <Input
          value={node.question}
          onChange={(e) => onChange({ ...node, question: e.target.value })}
          placeholder="Decision question (e.g., Does GPS data confirm the trip?)"
          className="text-sm flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive shrink-0"
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {expanded && (
        <div className="grid grid-cols-1 gap-3 ml-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs">
                YES →
              </Badge>
              <Input
                value={node.yesLabel || ""}
                onChange={(e) => onChange({ ...node, yesLabel: e.target.value })}
                placeholder="Button label"
                className="text-xs h-7 w-32"
              />
              {!node.yesChild && (
                <Input
                  value={node.yesAction || ""}
                  onChange={(e) => onChange({ ...node, yesAction: e.target.value })}
                  placeholder="Action (e.g., Submit Dispute, Mark Resolved)"
                  className="text-xs h-7 flex-1"
                />
              )}
            </div>
            {depth < 3 && (
              <DecisionTreeEditor
                node={node.yesChild ?? null}
                onChange={(child) =>
                  onChange({ ...node, yesChild: child ?? undefined })
                }
                depth={depth + 1}
              />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-red-100 text-red-800 text-xs">
                NO →
              </Badge>
              <Input
                value={node.noLabel || ""}
                onChange={(e) => onChange({ ...node, noLabel: e.target.value })}
                placeholder="Button label"
                className="text-xs h-7 w-32"
              />
              {!node.noChild && (
                <Input
                  value={node.noAction || ""}
                  onChange={(e) => onChange({ ...node, noAction: e.target.value })}
                  placeholder="Action (e.g., Deny Claim, Place on Hold)"
                  className="text-xs h-7 flex-1"
                />
              )}
            </div>
            {depth < 3 && (
              <DecisionTreeEditor
                node={node.noChild ?? null}
                onChange={(child) =>
                  onChange({ ...node, noChild: child ?? undefined })
                }
                depth={depth + 1}
              />
            )}
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
    label: typeof val === "string" ? val : key,
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
    label: typeof val === "string" ? val : key,
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
  decisionTree: DecisionTreeNode | null;
}

export default function ErrorTypes() {
  const queryClient = useQueryClient();
  const { data: errorTypes, isLoading } = useListErrorTypes();
  const createErrorType = useCreateErrorType();
  const updateErrorType = useUpdateErrorType();
  const deleteErrorType = useDeleteErrorType();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const emptyForm: ErrorTypeFormState = {
    name: "", category: "", description: "", guidance: "",
    recommendedActions: "", emailTemplate: "",
    reasons: [], requirements: [], decisionTree: null,
  };

  const [form, setForm] = useState<ErrorTypeFormState>(emptyForm);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListErrorTypesQueryKey() });

  const openEdit = (et: ErrorTypeResponse) => {
    setForm({
      name: et.name || "",
      category: et.category || "",
      description: et.description || "",
      guidance: et.guidance || "",
      recommendedActions: et.recommendedActions || "",
      emailTemplate: et.emailTemplate || "",
      reasons: parseReasons(et.disputeReasonsLibrary as Record<string, unknown> | null),
      requirements: parseRequirements(et.evidenceRequirements as Record<string, unknown> | null),
      decisionTree: (et.decisionTree as DecisionTreeNode | null) ?? null,
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
        ? (JSON.parse(JSON.stringify(form.decisionTree)) as Record<string, unknown>)
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
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Error Type" : "Create Error Type"}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="basics">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basics">Basics</TabsTrigger>
              <TabsTrigger value="sop">SOP & Guidance</TabsTrigger>
              <TabsTrigger value="evidence">Evidence & Reasons</TabsTrigger>
              <TabsTrigger value="workflow">Decision Tree</TabsTrigger>
            </TabsList>

            <TabsContent value="basics" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Name *</Label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <Label>Category</Label>
                  <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g., GPS Issues, Scheduling" />
                </div>
              </div>
              <div>
                <Label>Description</Label>
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
                <Label>Email Template</Label>
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

            <TabsContent value="workflow" className="space-y-4 mt-4">
              <div>
                <Label className="text-sm font-medium">Decision Tree</Label>
                <p className="text-xs text-muted-foreground mb-3">
                  Build a decision tree to guide staff through the dispute process.
                  Each node asks a yes/no question and routes to the next step or a final action.
                </p>
                <DecisionTreeEditor
                  node={form.decisionTree}
                  onChange={(node) => setForm({ ...form, decisionTree: node })}
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => { setEditingId(null); setShowCreate(false); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name}>{editingId ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
