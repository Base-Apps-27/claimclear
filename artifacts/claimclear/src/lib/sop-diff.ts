// Task #847 — small dependency-free diff helpers for the SOP version
// history drawer. Produces:
//   - per-character diffs (`diffChars`) for tweaking node question /
//     instruction text and the simple scalar fields.
//   - node-level diff (`diffSopSnapshots`) over a decision tree so the
//     UI can color added / removed / edited nodes and render a
//     summary line.
//
// Algorithms are intentionally small (LCS-based) and operate on tiny
// inputs (one SOP at a time, dozens of nodes, a few thousand
// characters of text per field). Pulling in a heavier library would
// dwarf this code for no gain.

export type DiffOp = "equal" | "added" | "removed";

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

// Longest-common-subsequence table for two arrays of tokens. Used by
// both the character diff and the node-field text diff.
function lcsTable<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): number[][] {
  const m = a.length;
  const n = b.length;
  const t: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) t[i][j] = t[i + 1][j + 1] + 1;
      else t[i][j] = Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  return t;
}

function diffTokens<T>(
  a: ReadonlyArray<T>,
  b: ReadonlyArray<T>,
  toText: (t: T) => string,
): DiffSegment[] {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return [{ op: "added", text: b.map(toText).join("") }];
  if (b.length === 0) return [{ op: "removed", text: a.map(toText).join("") }];
  const t = lcsTable(a, b);
  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  // Coalesce neighbouring ops into runs to keep the rendered output
  // tight (one <span> per run, not per character).
  const push = (op: DiffOp, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("equal", toText(a[i]));
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) {
      push("removed", toText(a[i]));
      i++;
    } else {
      push("added", toText(b[j]));
      j++;
    }
  }
  while (i < a.length) {
    push("removed", toText(a[i]));
    i++;
  }
  while (j < b.length) {
    push("added", toText(b[j]));
    j++;
  }
  return out;
}

// Character-level diff for short labels and free-form text fields.
// Splits on Unicode code points so emoji/accents don't get torn.
export function diffChars(a: string, b: string): DiffSegment[] {
  const aArr = Array.from(a);
  const bArr = Array.from(b);
  return diffTokens(aArr, bArr, (c) => c);
}

// Convenience: is anything in this segment list a real change?
export function hasChange(segs: ReadonlyArray<DiffSegment>): boolean {
  return segs.some((s) => s.op !== "equal");
}

// ---------------------------------------------------------------------------
// Node-level decision-tree diff
// ---------------------------------------------------------------------------

export interface DiffTreeNodeShape {
  id: string;
  question?: string;
  helpText?: string;
  instructionText?: string;
  options?: Array<{
    label?: string;
    childId?: string;
    outcomeType?: string;
    outcomeLabel?: string;
  }>;
}

export interface DiffTreeShape {
  rootId?: string;
  nodes?: ReadonlyArray<DiffTreeNodeShape>;
}

export type NodeDiffStatus = "added" | "removed" | "edited" | "unchanged";

export interface NodeFieldDiff {
  field: string;
  before: string;
  after: string;
  segments: DiffSegment[];
}

export interface NodeDiff {
  id: string;
  status: NodeDiffStatus;
  // The "representative" question for headers — uses the after-side
  // when present, falls back to the before-side for removed nodes.
  label: string;
  beforeNode: DiffTreeNodeShape | null;
  afterNode: DiffTreeNodeShape | null;
  fields: NodeFieldDiff[];
}

export interface SopDiffSummary {
  added: number;
  removed: number;
  edited: number;
}

export interface SopDiff {
  nodes: NodeDiff[];
  summary: SopDiffSummary;
}

function asTree(raw: unknown): DiffTreeShape {
  if (!raw || typeof raw !== "object") return { nodes: [] };
  const t = raw as DiffTreeShape;
  return { rootId: t.rootId, nodes: Array.isArray(t.nodes) ? t.nodes : [] };
}

function nodeLabel(n: DiffTreeNodeShape | null): string {
  if (!n) return "(missing)";
  const q = (n.question ?? "").trim();
  return q || `Node ${n.id}`;
}

function describeOptions(n: DiffTreeNodeShape | null): string {
  if (!n || !n.options || n.options.length === 0) return "";
  return n.options
    .map((o) => {
      const parts = [o.label ?? ""];
      if (o.outcomeType) parts.push(`→ ${o.outcomeType}`);
      else if (o.childId) parts.push(`→ ${o.childId}`);
      return parts.filter(Boolean).join(" ");
    })
    .join("\n");
}

function fieldDiffs(
  before: DiffTreeNodeShape | null,
  after: DiffTreeNodeShape | null,
): NodeFieldDiff[] {
  const pairs: Array<{ field: string; b: string; a: string }> = [
    { field: "Question", b: before?.question ?? "", a: after?.question ?? "" },
    { field: "Help text", b: before?.helpText ?? "", a: after?.helpText ?? "" },
    {
      field: "Instructions",
      b: before?.instructionText ?? "",
      a: after?.instructionText ?? "",
    },
    { field: "Options", b: describeOptions(before), a: describeOptions(after) },
  ];
  const out: NodeFieldDiff[] = [];
  for (const p of pairs) {
    if (p.b === p.a) continue;
    out.push({
      field: p.field,
      before: p.b,
      after: p.a,
      segments: diffChars(p.b, p.a),
    });
  }
  return out;
}

// Compare two SOP snapshots' decision trees node-by-node, matched by
// stable id. Nodes only in the after-snapshot are "added"; only in
// the before-snapshot are "removed"; matched ids with any field
// change are "edited"; otherwise "unchanged".
//
// Ordering: edited / added / removed first (most relevant), then
// unchanged. Within a group, sorted by node id for determinism.
export function diffSopSnapshots(beforeRaw: unknown, afterRaw: unknown): SopDiff {
  const before = asTree(beforeRaw);
  const after = asTree(afterRaw);
  const beforeById = new Map<string, DiffTreeNodeShape>();
  for (const n of before.nodes ?? []) if (n && n.id) beforeById.set(n.id, n);
  const afterById = new Map<string, DiffTreeNodeShape>();
  for (const n of after.nodes ?? []) if (n && n.id) afterById.set(n.id, n);
  const ids = new Set<string>([...beforeById.keys(), ...afterById.keys()]);

  const nodes: NodeDiff[] = [];
  let added = 0;
  let removed = 0;
  let edited = 0;
  for (const id of ids) {
    const b = beforeById.get(id) ?? null;
    const a = afterById.get(id) ?? null;
    if (a && !b) {
      added++;
      nodes.push({
        id,
        status: "added",
        label: nodeLabel(a),
        beforeNode: null,
        afterNode: a,
        fields: fieldDiffs(null, a),
      });
      continue;
    }
    if (b && !a) {
      removed++;
      nodes.push({
        id,
        status: "removed",
        label: nodeLabel(b),
        beforeNode: b,
        afterNode: null,
        fields: fieldDiffs(b, null),
      });
      continue;
    }
    const fields = fieldDiffs(b, a);
    if (fields.length === 0) {
      nodes.push({
        id,
        status: "unchanged",
        label: nodeLabel(a),
        beforeNode: b,
        afterNode: a,
        fields: [],
      });
    } else {
      edited++;
      nodes.push({
        id,
        status: "edited",
        label: nodeLabel(a),
        beforeNode: b,
        afterNode: a,
        fields,
      });
    }
  }

  const order: Record<NodeDiffStatus, number> = {
    edited: 0,
    added: 1,
    removed: 2,
    unchanged: 3,
  };
  nodes.sort((x, y) => {
    if (order[x.status] !== order[y.status]) return order[x.status] - order[y.status];
    return x.id.localeCompare(y.id);
  });

  return { nodes, summary: { added, removed, edited } };
}

export function formatDiffSummary(s: SopDiffSummary): string {
  const parts: string[] = [];
  parts.push(`${s.added} ${s.added === 1 ? "node" : "nodes"} added`);
  parts.push(`${s.removed} removed`);
  parts.push(`${s.edited} edited`);
  return parts.join(", ");
}
