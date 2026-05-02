import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useImportClaims,
  useLookupErrorDetailMappings,
  useSaveErrorDetailMappings,
  useListErrorTypes,
  useListInvoiceGroups,
  useTriageInvoiceGroup,
  useMarkInvoiceGroupMasEligible,
  getListClaimsQueryKey,
} from "@workspace/api-client-react";
import type { ImportSummary, ErrorTypeResponse, InvoiceGroupResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload, AlertCircle, FileSpreadsheet, FileText, X,
  Loader2, CheckCircle2, AlertTriangle, RotateCcw, Tag, ArrowRight, ArrowLeft,
  Sparkles, Layers, Info, Eye, Save, Play,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { InfoTooltip, WrapTooltip } from "@/components/info-tooltip";
import {
  PageHeader, Section, StatusPill, TONE_STYLE, ToneButton, type Tone,
} from "@/components/cohesion";
import { StageStepper, type Stage } from "@/components/stage-stepper";
import {
  ActionsRail, ActionsRailRecommended, ActionGroup, ActionRow,
} from "@/components/actions-rail";
import * as XLSX from "xlsx";

type UploadStage = "idle" | "reading" | "parsing" | "ready" | "classifying" | "confirming" | "importing" | "complete" | "error";

type StepKey = "upload" | "map" | "classify" | "confirm";

const RESUME_STORAGE_KEY = "claimclear:import:resume";

interface ResumeState {
  rows: ParsedRow[];
  classifyGroups: ClassifyGroup[];
  duplicateAction: string;
  fileName: string;
  fileSize: number;
  fileType: "csv" | "excel";
  savedAt: number;
}

const STEPS: Stage[] = [
  { key: "upload", label: "Upload", desc: "Pick your file" },
  { key: "map", label: "Map columns", desc: "Confirm the parse" },
  { key: "classify", label: "Classify errors", desc: "Tag each group" },
  { key: "confirm", label: "Confirm import", desc: "Save to ClaimClear" },
];

function getStepKey(stage: UploadStage): StepKey {
  switch (stage) {
    case "idle":
    case "reading":
    case "parsing":
    case "error":
      return "upload";
    case "ready":
      return "map";
    case "classifying":
      return "classify";
    case "confirming":
    case "importing":
    case "complete":
    default:
      return "confirm";
  }
}

interface ParsedRow {
  confNumber: string;
  date: string;
  refNumber: string;
  clientNumber: string;
  carNumber: string;
  errorDetails: string;
  claimAmount: number;
  errorTypeId?: string;
  errorTypeName?: string;
}

interface ParseWarning {
  row: number;
  message: string;
}

interface SheetInfo {
  name: string;
  rowCount: number;
  used: boolean;
  reason?: string;
}

interface ClassifyGroup {
  errorDetails: string;
  count: number;
  matched: boolean;
  errorTypeId: number | null;
  errorTypeName: string | null;
  selectedErrorTypeId: string;
  selectedErrorTypeName: string;
  isMultiError?: boolean;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        current.push(field);
        field = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        current.push(field);
        field = "";
        if (current.some(c => c.trim())) rows.push(current);
        current = [];
        if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") i++;
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  if (field || current.length > 0) {
    current.push(field);
    if (current.some(c => c.trim())) rows.push(current);
  }

  return rows;
}

const MAX_FILE_SIZE_MB = 8;
const MAX_ROWS = 5000;

const CLAIM_HEADER_PATTERNS = [
  /conf/i, /date/i, /ref/i, /client/i, /car/i, /detail/i, /error/i, /amount/i, /claim/i,
];

function sheetHasClaimHeaders(headers: string[]): boolean {
  let matchCount = 0;
  for (const h of headers) {
    const normalized = h.trim();
    if (!normalized) continue;
    if (CLAIM_HEADER_PATTERNS.some(p => p.test(normalized))) matchCount++;
  }
  return matchCount >= 2;
}

function parseExcel(data: ArrayBuffer): { records: string[][]; sheets: SheetInfo[] } {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const allRecords: string[][] = [];
  const sheets: SheetInfo[] = [];
  let headerRow: string[] | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, dateNF: "mm/dd/yyyy" });
    const rows = jsonData.map(row => row.map(cell => String(cell ?? "")));

    if (rows.length < 2) {
      sheets.push({ name: sheetName, rowCount: 0, used: false, reason: "Empty or header-only" });
      continue;
    }

    const candidateHeaders = rows[0];
    if (!sheetHasClaimHeaders(candidateHeaders)) {
      sheets.push({ name: sheetName, rowCount: rows.length - 1, used: false, reason: "No matching claim headers" });
      continue;
    }

    if (!headerRow) {
      headerRow = candidateHeaders;
      allRecords.push(candidateHeaders);
    }

    const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));
    sheets.push({ name: sheetName, rowCount: dataRows.length, used: true });
    allRecords.push(...dataRows);
  }

  if (allRecords.length === 0 && workbook.SheetNames.length > 0) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, dateNF: "mm/dd/yyyy" });
    const rows = jsonData.map(row => row.map(cell => String(cell ?? "")));
    sheets[0] = { ...sheets[0], used: true, reason: undefined };
    return { records: rows, sheets };
  }

  return { records: allRecords, sheets };
}

function mapRowsToData(records: string[][]): { rows: ParsedRow[]; warnings: ParseWarning[]; skippedEmpty: number } {
  if (records.length < 2) return { rows: [], warnings: [], skippedEmpty: 0 };

  const headers = records[0].map(h => h.trim());
  const parsed: ParsedRow[] = [];
  const warnings: ParseWarning[] = [];
  let skippedEmpty = 0;

  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    if (!values.some(v => v.trim())) {
      skippedEmpty++;
      continue;
    }

    const row: Partial<ParsedRow> = {};
    headers.forEach((h, idx) => {
      const val = (values[idx] || "").trim();
      const key = h.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (key.includes("conf")) row.confNumber = val;
      else if (key === "date") row.date = val;
      else if (key.includes("ref")) row.refNumber = val;
      else if (key.includes("client")) row.clientNumber = val;
      else if (key.includes("car")) row.carNumber = val;
      else if (key.includes("detail") || key.includes("error")) row.errorDetails = val;
      else if (key.includes("amount") || key.includes("claim")) {
        const num = parseFloat(val.replace(/[$,]/g, ""));
        if (!isNaN(num)) row.claimAmount = num;
      }
    });

    if (!row.confNumber || !row.confNumber.trim()) {
      warnings.push({ row: i + 1, message: "Missing confirmation number — skipped" });
      continue;
    }

    parsed.push(row as ParsedRow);
  }

  return { rows: parsed, warnings, skippedEmpty };
}

const ACCEPTED_TYPES = ".csv,.xlsx,.xls";

function isExcelFile(name: string) {
  return /\.(xlsx|xls)$/i.test(name);
}

function getFileIcon(name: string) {
  return isExcelFile(name)
    ? <FileSpreadsheet className="h-5 w-5 text-green-600" />
    : <FileText className="h-5 w-5 text-blue-600" />;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function confidenceForGroup(g: ClassifyGroup): { tone: Tone; label: string } {
  if (g.isMultiError) return { tone: "muted", label: "Multiple" };
  if (g.matched) return { tone: "green", label: "high" };
  if (g.selectedErrorTypeId) return { tone: "amber", label: "med" };
  return { tone: "red", label: "low" };
}

export default function Import() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const importClaims = useImportClaims();
  const lookupMappings = useLookupErrorDetailMappings();
  const saveMappings = useSaveErrorDetailMappings();
  const { data: errorTypesData } = useListErrorTypes();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<UploadStage>("idle");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [warnings, setWarnings] = useState<ParseWarning[]>([]);
  const [duplicateAction, setDuplicateAction] = useState("skip");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [fileType, setFileType] = useState<"csv" | "excel">("csv");
  const [errorMessage, setErrorMessage] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [classifyGroups, setClassifyGroups] = useState<ClassifyGroup[]>([]);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [sheetInfos, setSheetInfos] = useState<SheetInfo[]>([]);
  const [mappingSaveError, setMappingSaveError] = useState("");
  const [reviewGroup, setReviewGroup] = useState<ClassifyGroup | null>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);

  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];

  // Load any saved-for-later session on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(RESUME_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ResumeState;
      if (parsed && parsed.rows && parsed.classifyGroups) setResume(parsed);
    } catch {
      // Ignore corrupt persisted state.
    }
  }, []);

  const clearResume = useCallback(() => {
    setResume(null);
    if (typeof window !== "undefined") {
      try { window.localStorage.removeItem(RESUME_STORAGE_KEY); } catch { /* noop */ }
    }
  }, []);

  const handleResume = useCallback(() => {
    if (!resume) return;
    setRows(resume.rows);
    setClassifyGroups(resume.classifyGroups);
    setDuplicateAction(resume.duplicateAction);
    setFileName(resume.fileName);
    setFileSize(resume.fileSize);
    setFileType(resume.fileType);
    setStage("classifying");
    clearResume();
  }, [resume, clearResume]);

  const processFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setFileSize(file.size);
    setFileType(isExcelFile(file.name) ? "excel" : "csv");
    setResult(null);
    setErrorMessage("");
    setWarnings([]);
    setSheetInfos([]);

    try {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setStage("error");
        setErrorMessage(`File is too large (${formatFileSize(file.size)}). Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
        return;
      }

      setStage("reading");
      let records: string[][];

      if (isExcelFile(file.name)) {
        const buffer = await file.arrayBuffer();
        setStage("parsing");
        const result = parseExcel(buffer);
        records = result.records;
        setSheetInfos(result.sheets);
      } else {
        const text = await file.text();
        setStage("parsing");
        records = parseCsv(text);
      }

      if (records.length > MAX_ROWS + 1) {
        setStage("error");
        setErrorMessage(`File has ${records.length - 1} data rows, which exceeds the maximum of ${MAX_ROWS}. Please split into smaller files.`);
        return;
      }

      const { rows: parsed, warnings: warns, skippedEmpty } = mapRowsToData(records);

      if (parsed.length === 0) {
        setStage("error");
        setErrorMessage(
          records.length < 2
            ? "File appears to be empty or has no data rows."
            : "No valid claims found. Make sure there is a column with confirmation numbers."
        );
        return;
      }

      if (skippedEmpty > 0) {
        warns.push({ row: 0, message: `${skippedEmpty} empty row(s) skipped` });
      }

      setRows(parsed);
      setWarnings(warns);
      setStage("ready");
    } catch (err) {
      setStage("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to parse file");
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const hasMultipleErrors = (detail: string) => detail.includes(";");

  const handleStartClassify = async () => {
    const uniqueDetails = [...new Set(rows.map(r => r.errorDetails).filter(d => d && d.trim()))];

    if (uniqueDetails.length === 0) {
      setStage("classifying");
      setClassifyGroups([]);
      return;
    }

    const singleErrorDetails = uniqueDetails.filter(d => !hasMultipleErrors(d));
    const multiErrorDetails = uniqueDetails.filter(d => hasMultipleErrors(d));

    setClassifyLoading(true);
    try {
      let mappings: { originalText: string; matched: boolean; errorTypeId: number | null; errorTypeName: string | null }[] = [];
      if (singleErrorDetails.length > 0) {
        const res = await lookupMappings.mutateAsync({ data: { errorDetails: singleErrorDetails } });
        mappings = res.mappings as typeof mappings;
      }

      const countMap = new Map<string, number>();
      for (const row of rows) {
        const d = row.errorDetails || "";
        countMap.set(d, (countMap.get(d) || 0) + 1);
      }

      const singleGroups: ClassifyGroup[] = singleErrorDetails.map(detail => {
        const mapping = mappings.find((m) => m.originalText === detail);
        return {
          errorDetails: detail,
          count: countMap.get(detail) || 0,
          matched: mapping?.matched ?? false,
          errorTypeId: mapping?.errorTypeId ?? null,
          errorTypeName: mapping?.errorTypeName ?? null,
          selectedErrorTypeId: mapping?.errorTypeId ? String(mapping.errorTypeId) : "",
          selectedErrorTypeName: mapping?.errorTypeName ?? "",
          isMultiError: false,
        };
      });

      const multiGroups: ClassifyGroup[] = multiErrorDetails.map(detail => ({
        errorDetails: detail,
        count: countMap.get(detail) || 0,
        matched: false,
        errorTypeId: null,
        errorTypeName: null,
        selectedErrorTypeId: "",
        selectedErrorTypeName: "",
        isMultiError: true,
      }));

      const groups = [...singleGroups, ...multiGroups];
      groups.sort((a, b) => {
        if (a.matched && !b.matched) return -1;
        if (!a.matched && b.matched) return 1;
        return b.count - a.count;
      });

      setClassifyGroups(groups);
      setStage("classifying");
    } catch (err) {
      setErrorMessage("Failed to look up error type mappings");
      setStage("error");
    } finally {
      setClassifyLoading(false);
    }
  };

  const handleGroupErrorTypeChange = (index: number, errorTypeId: string) => {
    setClassifyGroups(prev => {
      const next = [...prev];
      const et = errorTypes.find((t) => String(t.id) === errorTypeId);
      next[index] = {
        ...next[index],
        selectedErrorTypeId: errorTypeId,
        selectedErrorTypeName: et?.name ?? "",
      };
      return next;
    });
  };

  // Save mappings as coding rules and apply assigned types to rows.
  // Does NOT trigger the import — that happens in the dedicated Confirm step.
  const persistClassificationsAndApply = async (): Promise<ParsedRow[]> => {
    setMappingSaveError("");
    const mappingsToSave = classifyGroups
      .filter(g => g.selectedErrorTypeId && !g.matched)
      .map(g => ({
        originalText: g.errorDetails,
        errorTypeId: Number(g.selectedErrorTypeId),
        errorTypeName: g.selectedErrorTypeName,
      }));

    if (mappingsToSave.length > 0) {
      try {
        await saveMappings.mutateAsync({ data: { mappings: mappingsToSave } });
      } catch (err) {
        setMappingSaveError("Failed to save mappings for future use — your assignments will still be applied to this import.");
      }
    }

    const classifyMap = new Map(
      classifyGroups
        .filter(g => g.selectedErrorTypeId)
        .map(g => [g.errorDetails, { id: g.selectedErrorTypeId, name: g.selectedErrorTypeName }])
    );

    const updatedRows = rows.map(row => {
      const match = classifyMap.get(row.errorDetails);
      if (match) return { ...row, errorTypeId: match.id, errorTypeName: match.name };
      return row;
    });

    setRows(updatedRows);
    return updatedRows;
  };

  // Classify-step primary action: advance to the dedicated Confirm step (no import yet).
  const handleConfirmClassification = async () => {
    await persistClassificationsAndApply();
    setStage("confirming");
  };

  // Classify-step "Skip & import as-is" action: skip persistence, jump straight into
  // the Confirm preview so the user always sees the final review before saving.
  const handleSkipClassification = () => {
    setStage("confirming");
  };

  // Save the current in-progress import to localStorage so the user can resume later,
  // and persist any mappings they've already assigned. Then exit to the queue.
  const handleSaveAndFinishLater = async () => {
    const updatedRows = await persistClassificationsAndApply();
    if (typeof window !== "undefined") {
      try {
        const snapshot: ResumeState = {
          rows: updatedRows,
          classifyGroups,
          duplicateAction,
          fileName,
          fileSize,
          fileType,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // Storage may be unavailable or full — proceed without persistence.
      }
    }
    navigate("/queue");
  };

  // Confirm-step primary action: actually run the import.
  const handleStartImport = async () => {
    await handleImport();
  };

  const handleImport = async (importRows?: ParsedRow[]) => {
    setStage("importing");
    try {
      const rowsToImport = importRows ?? rows;
      const res = await importClaims.mutateAsync({ data: { rows: rowsToImport, duplicateAction } });
      setResult(res);
      setStage("complete");
      clearResume();
      queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
    } catch (err) {
      setStage("error");
      setErrorMessage(err instanceof Error ? err.message : "Import failed");
    }
  };

  const handleReset = () => {
    setStage("idle");
    setRows([]);
    setWarnings([]);
    setResult(null);
    setFileName("");
    setFileSize(0);
    setErrorMessage("");
    setClassifyGroups([]);
    setSheetInfos([]);
    setMappingSaveError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDiscardImport = () => {
    clearResume();
    handleReset();
  };

  const handleOpenReview = (group: ClassifyGroup) => setReviewGroup(group);
  const handleCloseReview = () => setReviewGroup(null);

  const totalAmount = rows.reduce((s, r) => s + (r.claimAmount || 0), 0);
  const isProcessing = stage === "reading" || stage === "parsing";

  const matchedCount = classifyGroups.filter(g => g.matched).length;
  const unmatchedCount = classifyGroups.filter(g => !g.matched && !g.isMultiError && !g.selectedErrorTypeId).length;
  const userAssignedCount = classifyGroups.filter(g => !g.matched && g.selectedErrorTypeId).length;
  const multiErrorCount = classifyGroups.filter(g => g.isMultiError).length;
  const assignedCount = classifyGroups.filter(g => g.selectedErrorTypeId).length;

  const stepKey = getStepKey(stage);
  const stepIdx = STEPS.findIndex(s => s.key === stepKey);

  // Header subtitle
  const headerSub = useMemo(() => {
    return `Step ${stepIdx + 1} of ${STEPS.length} · ${STEPS[stepIdx]?.desc ?? ""}`;
  }, [stepIdx]);

  // Summary banner content based on stage
  const summaryBanner = useMemo(() => {
    if (stepKey === "upload" && stage !== "error") {
      return {
        text: <>Drop a CSV or Excel file to begin. ClaimClear matches your coding rules automatically.</>,
        meta: "Up to 5,000 rows · 8 MB",
      };
    }
    if (stepKey === "upload" && stage === "error") {
      return {
        text: <><strong>Upload failed.</strong> {errorMessage}</>,
        meta: undefined,
        tone: "red" as const,
      };
    }
    if (stepKey === "map") {
      return {
        text: (
          <>
            <strong>{rows.length} claims found</strong> in <span className="font-mono">{fileName}</span>.{" "}
            {warnings.length > 0
              ? `${warnings.length} parsing warning${warnings.length === 1 ? "" : "s"} — review below.`
              : "All rows look clean."}
          </>
        ),
        meta: `$${totalAmount.toFixed(2)} total`,
      };
    }
    if (stepKey === "classify") {
      return {
        text: (
          <>
            <strong>{rows.length} claims</strong>, <strong>{classifyGroups.length} error groups</strong>.
            Coding rules matched <strong>{matchedCount}</strong> automatically.{" "}
            {unmatchedCount > 0
              ? <><strong>{unmatchedCount}</strong> need your decision.</>
              : <>You're ready to import.</>}
          </>
        ),
        meta: `$${totalAmount.toFixed(2)} total`,
      };
    }
    if (stepKey === "confirm" && stage === "confirming") {
      const assigned = classifyGroups.filter(g => g.selectedErrorTypeId).length;
      const groupCount = classifyGroups.length;
      return {
        text: (
          <>
            <strong>Ready to import.</strong> {rows.length} claim{rows.length === 1 ? "" : "s"}
            {groupCount > 0 ? <>, {assigned} of {groupCount} groups classified</> : null}.
            Review the summary on the left, then start the import.
          </>
        ),
        meta: `Duplicates: ${duplicateAction}`,
      };
    }
    if (stepKey === "confirm" && stage === "importing") {
      return {
        text: <>Importing {rows.length} claims into ClaimClear…</>,
        meta: undefined,
      };
    }
    if (stepKey === "confirm" && stage === "complete" && result) {
      return {
        text: (
          <>
            <strong>Import complete.</strong> Created {result.created}, updated {result.updated},
            skipped {result.skipped}.
          </>
        ),
        meta: `Batch ${result.batchId}`,
        tone: "green" as const,
      };
    }
    return null;
  }, [stepKey, stage, errorMessage, rows.length, fileName, warnings.length, totalAmount, classifyGroups, matchedCount, unmatchedCount, result, duplicateAction]);

  return (
    <div className="space-y-4 max-w-7xl" data-testid="page-import">
      <PageHeader
        title="Import job-status report"
        sub={headerSub}
        accent="blue"
      />

      {resume && stage === "idle" && (
        <div
          className="rounded-md border px-4 py-3 flex items-center gap-3"
          style={{
            background: TONE_STYLE.amber.bg,
            borderColor: TONE_STYLE.amber.border,
            color: TONE_STYLE.amber.fg,
          }}
          data-testid="banner-resume-import"
        >
          <Save className="h-4 w-4 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <strong>Pick up where you left off.</strong>{" "}
            You saved an import session for <span className="font-mono">{resume.fileName}</span>{" "}
            ({resume.rows.length} claim{resume.rows.length === 1 ? "" : "s"})
            {" "}on{" "}
            {new Date(resume.savedAt).toLocaleDateString()}.
          </div>
          <Button size="sm" variant="outline" onClick={handleResume} data-testid="button-resume-import">
            Resume
          </Button>
          <Button size="sm" variant="ghost" onClick={clearResume} data-testid="button-discard-resume">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <StageStepper stages={STEPS} currentKey={stepKey} variant="claim" />

      {summaryBanner && (
        <div
          className="rounded-md border px-4 py-3 flex items-center gap-3"
          style={{
            background: TONE_STYLE[summaryBanner.tone ?? "blue"].bg,
            borderColor: TONE_STYLE[summaryBanner.tone ?? "blue"].border,
            color: TONE_STYLE[summaryBanner.tone ?? "blue"].fg,
          }}
          data-testid="banner-import-summary"
        >
          <Sparkles className="h-4 w-4 flex-shrink-0" />
          <div className="flex-1 text-sm">{summaryBanner.text}</div>
          {summaryBanner.meta && (
            <span className="text-xs opacity-85">{summaryBanner.meta}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4 min-w-0">
          {stepKey === "upload" && <UploadStep
            stage={stage}
            fileName={fileName}
            fileSize={fileSize}
            fileType={fileType}
            errorMessage={errorMessage}
            dragOver={dragOver}
            setDragOver={setDragOver}
            fileInputRef={fileInputRef}
            handleFileChange={handleFileChange}
            handleDrop={handleDrop}
            handleReset={handleReset}
          />}

          {stepKey === "map" && <MapStep
            rows={rows}
            warnings={warnings}
            sheetInfos={sheetInfos}
            fileName={fileName}
            fileSize={fileSize}
            totalAmount={totalAmount}
            duplicateAction={duplicateAction}
            setDuplicateAction={setDuplicateAction}
            handleReset={handleReset}
          />}

          {stepKey === "classify" && <ClassifyStep
            classifyGroups={classifyGroups}
            errorTypes={errorTypes}
            handleGroupErrorTypeChange={handleGroupErrorTypeChange}
            mappingSaveError={mappingSaveError}
            fileName={fileName}
            fileSize={fileSize}
            handleReset={handleReset}
            onReview={handleOpenReview}
          />}

          {stepKey === "confirm" && <ConfirmStep
            stage={stage}
            rows={rows}
            classifyGroups={classifyGroups}
            duplicateAction={duplicateAction}
            totalAmount={totalAmount}
            result={result}
            handleReset={handleReset}
            navigate={navigate}
          />}
        </div>

        <aside className="xl:col-span-4 space-y-3 xl:sticky xl:top-4 self-start">
          <ActionsRail
            variant="claim"
            title="Import progress"
            meta={`Step ${stepIdx + 1} of ${STEPS.length}`}
          >
            {stepKey === "upload" && (
              <UploadRail
                stage={stage}
                isProcessing={isProcessing}
                handleReset={handleReset}
              />
            )}
            {stepKey === "map" && (
              <MapRail
                rows={rows}
                warnings={warnings}
                classifyLoading={classifyLoading}
                onClassify={handleStartClassify}
                onSkip={() => handleImport()}
                onBack={handleReset}
              />
            )}
            {stepKey === "classify" && (
              <ClassifyRail
                unmatchedCount={unmatchedCount}
                matchedCount={matchedCount}
                userAssignedCount={userAssignedCount}
                multiErrorCount={multiErrorCount}
                assignedCount={assignedCount}
                groupCount={classifyGroups.length}
                pending={saveMappings.isPending || importClaims.isPending}
                onContinue={handleConfirmClassification}
                onSaveAndFinishLater={handleSaveAndFinishLater}
                onDiscard={handleDiscardImport}
                onSkip={handleSkipClassification}
                onBack={() => setStage("ready")}
              />
            )}
            {stepKey === "confirm" && (
              <ConfirmRail
                stage={stage}
                rows={rows}
                result={result}
                pending={importClaims.isPending}
                onStartImport={handleStartImport}
                onBack={() => setStage("classifying")}
                onAnother={handleReset}
                navigate={navigate}
              />
            )}
          </ActionsRail>

          <Card>
            <CardContent className="p-3 text-xs text-muted-foreground flex items-start gap-2">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {stepKey === "classify"
                  ? <>If a code keeps showing up as <strong>Unknown</strong>, edit your <Link href="/error-types" className="underline">coding rules</Link> to map it permanently.</>
                  : stepKey === "map"
                    ? <>Existing claims are matched by <strong>confirmation #</strong>. Choose <em>Skip</em> to leave them untouched, or <em>Update</em> to overwrite with new values.</>
                    : stepKey === "upload"
                      ? <>The system auto-detects columns like <strong>Conf #</strong>, <strong>Date</strong>, <strong>Ref #</strong>, <strong>Client #</strong>, <strong>Car #</strong>, <strong>Error Details</strong>, and <strong>Amount</strong>.</>
                      : <>You can run another import from the same screen — it'll pick up new rows and skip duplicates.</>}
              </span>
            </CardContent>
          </Card>
        </aside>
      </div>

      <ReviewDialog
        group={reviewGroup}
        rows={rows}
        errorTypes={errorTypes}
        onClose={handleCloseReview}
        onAssign={(id) => {
          if (!reviewGroup) return;
          const idx = classifyGroups.findIndex(g => g.errorDetails === reviewGroup.errorDetails);
          if (idx >= 0) handleGroupErrorTypeChange(idx, id);
          handleCloseReview();
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step bodies
// ────────────────────────────────────────────────────────────────────────────

function UploadStep({
  stage, fileName, fileSize, fileType, errorMessage, dragOver, setDragOver,
  fileInputRef, handleFileChange, handleDrop, handleReset,
}: {
  stage: UploadStage; fileName: string; fileSize: number; fileType: "csv" | "excel";
  errorMessage: string; dragOver: boolean; setDragOver: (v: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleReset: () => void;
}) {
  const isProcessing = stage === "reading" || stage === "parsing";

  if (isProcessing) {
    return (
      <Section
        title="Reading file"
        icon={<Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {stage === "reading" ? "Reading file…" : `Parsing ${fileType === "excel" ? "Excel" : "CSV"} data…`}
            </span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {getFileIcon(fileName)}
              <span className="font-mono">{fileName}</span>
              <span>({formatFileSize(fileSize)})</span>
            </div>
          </div>
          <Progress value={stage === "reading" ? 30 : 70} className="h-1.5" />
        </div>
      </Section>
    );
  }

  if (stage === "error") {
    return (
      <Section
        title="Upload failed"
        icon={<AlertCircle className="h-4 w-4 text-red-600" />}
        action={
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="h-3 w-3 mr-1" /> Try again
          </Button>
        }
      >
        <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
      </Section>
    );
  }

  return (
    <Section
      title="Choose your job-status report"
      icon={<Upload className="h-4 w-4 text-muted-foreground" />}
    >
      <div
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        data-testid="dropzone-upload"
      >
        <Upload className={`h-12 w-12 mx-auto mb-4 ${dragOver ? "text-primary" : "text-muted-foreground/50"}`} />
        <p className="text-lg font-medium mb-1">
          {dragOver ? "Drop file here" : "Drag and drop your file here"}
        </p>
        <p className="text-sm text-muted-foreground mb-4">or click to browse</p>
        <label className="cursor-pointer inline-block">
          <Button variant="outline" asChild>
            <span>
              <Upload className="h-4 w-4 mr-2" />
              Choose file
            </span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={handleFileChange}
            className="hidden"
            data-testid="input-file"
          />
        </label>
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5 text-blue-500" /> CSV
          </div>
          <div className="flex items-center gap-1">
            <FileSpreadsheet className="h-3.5 w-3.5 text-green-500" /> Excel (.xlsx, .xls)
          </div>
        </div>
      </div>
    </Section>
  );
}

function MapStep({
  rows, warnings, sheetInfos, fileName, fileSize, totalAmount,
  duplicateAction, setDuplicateAction, handleReset,
}: {
  rows: ParsedRow[]; warnings: ParseWarning[]; sheetInfos: SheetInfo[];
  fileName: string; fileSize: number; totalAmount: number;
  duplicateAction: string; setDuplicateAction: (v: string) => void;
  handleReset: () => void;
}) {
  return (
    <>
      <Section
        title={`${rows.length} claims parsed`}
        icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
        action={
          <Badge variant="outline" className="text-xs">
            ${totalAmount.toFixed(2)} · est. exposure ${(totalAmount * 1.7).toFixed(2)} (~1.7×)
          </Badge>
        }
      >
        <div className="space-y-4">
          {sheetInfos.length > 1 && (
            <div className="rounded-md border px-3 py-2 text-xs flex items-center flex-wrap gap-2"
              style={{ background: TONE_STYLE.blue.bg, borderColor: TONE_STYLE.blue.border, color: TONE_STYLE.blue.fg }}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span className="font-medium">
                {sheetInfos.filter(s => s.used).length} of {sheetInfos.length} sheet{sheetInfos.length !== 1 ? "s" : ""} used:
              </span>
              {sheetInfos.map((s, i) => (
                <WrapTooltip key={i} content={s.used ? `${s.rowCount} row${s.rowCount !== 1 ? "s" : ""} imported` : s.reason || "Skipped"}>
                  <Badge variant={s.used ? "default" : "outline"} className={`text-[10px] ${s.used ? "" : "opacity-60"}`}>
                    {s.name}{s.used ? ` (${s.rowCount})` : ""}
                  </Badge>
                </WrapTooltip>
              ))}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-md border px-3 py-2"
              style={{ background: TONE_STYLE.amber.bg, borderColor: TONE_STYLE.amber.border, color: TONE_STYLE.amber.fg }}
            >
              <div className="flex items-center gap-2 mb-1 text-sm font-medium">
                <AlertTriangle className="h-4 w-4" />
                {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
              </div>
              <ul className="text-xs space-y-0.5 ml-6 list-disc">
                {warnings.slice(0, 5).map((w, i) => (
                  <li key={i}>{w.row > 0 ? `Row ${w.row}: ` : ""}{w.message}</li>
                ))}
                {warnings.length > 5 && <li>…and {warnings.length - 5} more</li>}
              </ul>
            </div>
          )}

          <div className="max-h-[360px] overflow-auto border border-border rounded-md">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-2 text-xs font-medium">#</th>
                  <th className="text-left p-2 text-xs font-medium">Conf #</th>
                  <th className="text-left p-2 text-xs font-medium">Date</th>
                  <th className="text-left p-2 text-xs font-medium">Ref #</th>
                  <th className="text-left p-2 text-xs font-medium">Client #</th>
                  <th className="text-left p-2 text-xs font-medium">Error</th>
                  <th className="text-right p-2 text-xs font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="p-2 text-muted-foreground text-xs">{i + 1}</td>
                    <td className="p-2 font-mono text-xs">{r.confNumber}</td>
                    <td className="p-2 text-xs">{r.date}</td>
                    <td className="p-2 text-xs">{r.refNumber}</td>
                    <td className="p-2 text-xs">{r.clientNumber}</td>
                    <td className="p-2 truncate max-w-[260px] text-xs">{r.errorDetails}</td>
                    <td className="p-2 text-right text-xs font-mono">${(r.claimAmount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 && (
              <div className="text-center py-2 text-xs text-muted-foreground bg-muted/30">
                Showing first 50 of {rows.length} rows
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Label className="flex items-center gap-1">
              Duplicates:
              <InfoTooltip content="How to handle claims with a confirmation number that already exists. 'Skip' leaves existing claims untouched; 'Update' overwrites them." />
            </Label>
            <Select value={duplicateAction} onValueChange={setDuplicateAction}>
              <SelectTrigger className="w-[130px] h-8 text-sm" data-testid="select-duplicate-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Skip</SelectItem>
                <SelectItem value="update">Update</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {duplicateAction === "skip" ? "Existing claims won't be changed" : "Existing claims will be updated"}
            </span>
          </div>
        </div>
      </Section>

      <SourceFileCard fileName={fileName} fileSize={fileSize} onReplace={handleReset} />
    </>
  );
}

function ClassifyStep({
  classifyGroups, errorTypes, handleGroupErrorTypeChange, mappingSaveError,
  fileName, fileSize, handleReset, onReview,
}: {
  classifyGroups: ClassifyGroup[]; errorTypes: ErrorTypeResponse[];
  handleGroupErrorTypeChange: (i: number, id: string) => void;
  mappingSaveError: string;
  fileName: string; fileSize: number;
  handleReset: () => void;
  onReview: (group: ClassifyGroup) => void;
}) {
  if (classifyGroups.length === 0) {
    return (
      <Section
        title="Nothing to classify"
        icon={<Tag className="h-4 w-4 text-muted-foreground" />}
      >
        <p className="text-sm text-muted-foreground">
          No error details were found in the imported claims. Continue to import — claims will land
          in the classification queue without an error type.
        </p>
      </Section>
    );
  }

  return (
    <>
      <Section
        title="Error groups detected"
        icon={<Tag className="h-4 w-4 text-muted-foreground" />}
        action={
          <Link href="/error-types" className="text-xs font-medium" style={{ color: TONE_STYLE.blue.fg }}>
            Edit coding rules →
          </Link>
        }
        padded={false}
      >
        <div
          className="grid items-center px-3 py-2 text-[11px] uppercase tracking-wide font-semibold text-muted-foreground border-b border-border bg-muted/40"
          style={{ gridTemplateColumns: "minmax(200px,1fr) 70px minmax(220px,1fr) 90px 80px" }}
        >
          <div>Source code</div>
          <div className="text-right">Claims</div>
          <div>Suggested error type</div>
          <div>Confidence</div>
          <div />
        </div>
        <div className="divide-y divide-border max-h-[420px] overflow-auto">
          {classifyGroups.map((group, index) => {
            const conf = confidenceForGroup(group);
            return (
              <div
                key={index}
                className="grid items-start px-3 py-2.5"
                style={{ gridTemplateColumns: "minmax(200px,1fr) 70px minmax(220px,1fr) 90px 80px" }}
                data-testid={`classify-row-${index}`}
              >
                <div className="min-w-0 pr-3">
                  {group.isMultiError ? (
                    <ul className="text-xs space-y-0.5">
                      {group.errorDetails.split(";").slice(0, 3).map((part, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-foreground">
                          <span className="text-muted-foreground mt-0.5">•</span>
                          <span className="truncate">{part.trim()}</span>
                        </li>
                      ))}
                      {group.errorDetails.split(";").length > 3 && (
                        <li className="text-[11px] text-muted-foreground ml-3">
                          +{group.errorDetails.split(";").length - 3} more
                        </li>
                      )}
                    </ul>
                  ) : (
                    <div className="text-sm truncate" title={group.errorDetails}>
                      {group.errorDetails}
                    </div>
                  )}
                </div>
                <div className="text-sm font-mono text-right pr-3">{group.count}</div>
                <div className="pr-3">
                  {group.isMultiError ? (
                    <span className="text-xs text-muted-foreground italic">
                      Assigned per claim during classification
                    </span>
                  ) : (
                    <Select
                      value={group.selectedErrorTypeId}
                      onValueChange={(val) => handleGroupErrorTypeChange(index, val)}
                    >
                      <SelectTrigger className="h-8 text-sm" data-testid={`select-error-type-${index}`}>
                        <SelectValue placeholder="Pick an error type…" />
                      </SelectTrigger>
                      <SelectContent>
                        {errorTypes.map((et) => (
                          <SelectItem key={et.id} value={String(et.id)}>{et.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <StatusPill tone={conf.tone}>{conf.label}</StatusPill>
                </div>
                <div className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onReview(group)}
                    data-testid={`button-review-${index}`}
                  >
                    <Eye className="h-3 w-3 mr-1" /> Review
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {mappingSaveError && (
        <div
          className="rounded-md border px-3 py-2 flex items-center gap-2 text-sm"
          style={{ background: TONE_STYLE.amber.bg, borderColor: TONE_STYLE.amber.border, color: TONE_STYLE.amber.fg }}
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {mappingSaveError}
        </div>
      )}

      <SourceFileCard fileName={fileName} fileSize={fileSize} onReplace={handleReset} />
    </>
  );
}

function ConfirmStep({
  stage, rows, classifyGroups, duplicateAction, totalAmount, result, handleReset, navigate,
}: {
  stage: UploadStage;
  rows: ParsedRow[];
  classifyGroups: ClassifyGroup[];
  duplicateAction: string;
  totalAmount: number;
  result: ImportSummary | null;
  handleReset: () => void;
  navigate: (path: string) => void;
}) {
  if (stage === "confirming") {
    const assigned = classifyGroups.filter(g => g.selectedErrorTypeId).length;
    const unknownGroups = classifyGroups.filter(
      g => !g.matched && !g.isMultiError && !g.selectedErrorTypeId
    );
    const multiErrorGroups = classifyGroups.filter(g => g.isMultiError);
    const groupCount = classifyGroups.length;

    return (
      <>
        <Section
          title="Review before import"
          icon={<CheckCircle2 className="h-4 w-4 text-blue-600" />}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <ResultTile label="Claims" value={rows.length} tone="blue" />
            <ResultTile label="Groups" value={groupCount} tone="muted" />
            <ResultTile label="Classified" value={assigned} tone="green" />
            <ResultTile label="Unknowns" value={unknownGroups.length} tone={unknownGroups.length > 0 ? "amber" : "muted"} />
          </div>

          <dl className="text-sm border border-border rounded-md divide-y divide-border">
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-muted-foreground">Total claim amount</dt>
              <dd className="font-mono">${totalAmount.toFixed(2)}</dd>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-muted-foreground">Duplicate handling</dt>
              <dd>{duplicateAction === "skip" ? "Skip existing claims" : "Update existing claims"}</dd>
            </div>
            {unknownGroups.length > 0 && (
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-muted-foreground">Unknown error types</dt>
                <dd className="text-amber-700 dark:text-amber-300">
                  {unknownGroups.length} group{unknownGroups.length === 1 ? "" : "s"} will land in classification without a type
                </dd>
              </div>
            )}
            {multiErrorGroups.length > 0 && (
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-muted-foreground">Multi-error rows</dt>
                <dd>{multiErrorGroups.length} group{multiErrorGroups.length === 1 ? "" : "s"} — error type assigned per claim during classification</dd>
              </div>
            )}
          </dl>

          <p className="text-xs text-muted-foreground mt-3">
            Click <strong>Start import</strong> in the side panel to save these {rows.length} claim{rows.length === 1 ? "" : "s"} to ClaimClear.
            Nothing has been saved yet.
          </p>
        </Section>
      </>
    );
  }

  if (stage === "importing") {
    return (
      <Section
        title="Importing"
        icon={<Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
      >
        <div className="flex flex-col items-center py-10">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <p className="text-base font-medium">Importing {rows.length} claims…</p>
          <p className="text-sm text-muted-foreground mt-1">This may take a moment for large files.</p>
        </div>
      </Section>
    );
  }

  if (stage === "complete" && result) {
    return (
      <>
        <Section
          title="Import complete"
          icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
        >
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            <ResultTile label="Created" value={result.created} tone="green" />
            <ResultTile label="Updated" value={result.updated} tone="blue" />
            <ResultTile label="Skipped" value={result.skipped} tone="amber" />
            {/* Task #354 — surface the per-row reject ledger as a first-
                class tile so an operator can see at a glance that some
                rows didn't land. The detailed list renders below. The
                tile is rendered unconditionally (even at zero) so the
                column count stays stable across imports — operators
                rely on the tile-row layout to scan the result quickly. */}
            <ResultTile
              label="Rejected"
              value={result.rejected.length}
              tone={result.rejected.length > 0 ? "red" : "muted"}
            />
            <ResultTile label="Total rows" value={result.total} tone="muted" />
          </div>

          {/* Task #354 — per-row reject ledger. Pre-audit, rows that
              failed strict validation (currently only `invalid_service_date`)
              were silently rolled into `skipped`, so an operator had no
              way to see which conf numbers fell out or why. The server
              now returns the full list in `result.rejected`; render it
              here so the operator can find the offending rows in their
              source spreadsheet without cross-referencing the audit log. */}
          {result.rejected.length > 0 && (
            <div
              className="rounded-md border px-3 py-2 mt-3 text-sm space-y-2"
              style={{ background: TONE_STYLE.red.bg, borderColor: TONE_STYLE.red.border, color: TONE_STYLE.red.fg }}
            >
              <p className="font-medium">
                {result.rejected.length} row{result.rejected.length !== 1 ? "s" : ""} could not be imported.
              </p>
              <p className="text-xs opacity-90">
                These rows were not added to your tracker. Fix the source
                spreadsheet (most often a service date that is missing or
                in an unrecognized format) and re-import just those rows.
              </p>
              <ul className="text-xs space-y-1 max-h-48 overflow-y-auto pr-1">
                {result.rejected.map((r, i) => (
                  <li key={`${r.confNumber}-${i}`} className="flex flex-wrap gap-x-2 gap-y-0.5">
                    <code className="font-mono bg-white/40 px-1 rounded">{r.confNumber}</code>
                    <span>
                      {r.reason === "invalid_service_date"
                        ? "invalid service date"
                        : r.reason}
                    </span>
                    <span className="opacity-80">
                      raw: <code className="font-mono">{r.rawDate === "" ? "(blank)" : r.rawDate}</code>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.created > 0 && (
            <div
              className="rounded-md border px-3 py-2 text-sm space-y-1"
              style={{ background: TONE_STYLE.green.bg, borderColor: TONE_STYLE.green.border, color: TONE_STYLE.green.fg }}
            >
              <p>{result.created} new claim{result.created !== 1 ? "s" : ""} added to your tracker.</p>
              {(result as { invoiceGroupCount?: number; groupsCreated?: number }).invoiceGroupCount && (result as { invoiceGroupCount?: number; groupsCreated?: number }).invoiceGroupCount! > 0 && (
                <p className="font-medium">
                  Organized into {(result as { invoiceGroupCount?: number; groupsCreated?: number }).invoiceGroupCount} invoice group
                  {(result as { invoiceGroupCount?: number; groupsCreated?: number }).invoiceGroupCount !== 1 ? "s" : ""}
                  {(result as { invoiceGroupCount?: number; groupsCreated?: number }).groupsCreated! > 0 && ` (${(result as { invoiceGroupCount?: number; groupsCreated?: number }).groupsCreated} new)`}.
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-3">
            Batch ID: <code className="bg-muted px-1 rounded font-mono">{result.batchId}</code>
          </p>
        </Section>

        {/* Phase 3 of the post-upload triage bridge: surface every group
            from THIS batch that landed without a source-provided error
            description, and let the operator route it inline (define
            error type from a picker, mark non-issue, or send straight
            to MAS Eligible — which auto-engages attestation via the
            cascade wired in Phase 1). The component is mounted only
            when we have a batchId so we never render an empty bridge.
        */}
        {result.batchId && <PostUploadBridge batchId={result.batchId} />}
      </>
    );
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Post-upload triage bridge (Phase 3)
//
// The bridge is the connective tissue between import and the rest of the
// claim lifecycle: every freshly-imported group whose source row had no
// error description gets one inline action (error-type picker, non-issue,
// or MAS Eligible) so the operator never has to context-switch to the
// Queue page just to clear the obvious cases.
//
// Design notes that took thought:
//   1. PICKER, NOT TEXT INPUT. Per explicit user direction: the only
//      acceptable error-type entry mode at this stage is selecting from
//      the existing `error_types` table. Free-text would re-open the
//      messy "everyone names errors slightly differently" problem the
//      taxonomy was created to fix.
//   2. PREDICATE IS errorDetails=empty (matches the user's stated rule:
//      "legs with no error_description"). But not every action SETS an
//      errorDetails value:
//        - triage(issue_found) sets errorTypeId/errorTypeName, NOT
//          errorDetails;
//        - mark-mas-eligible doesn't touch errorDetails at all;
//        - triage(non_issue) closes the group (Resolved) but again
//          doesn't set errorDetails.
//      Refetching after an action would therefore still return the
//      same row and the row would not "disappear" as the operator
//      expects. Solution: track actioned ids in component state and
//      filter them out client-side. We still invalidate the broader
//      ["listInvoiceGroups"] cache so the Queue page / dashboard
//      reflect the change immediately.
//   3. The bridge does NOT block the operator. They can ignore it
//      entirely and use the existing nav (Open Queue, Import another)
//      in the right rail — the bridge is purely additive.
// ────────────────────────────────────────────────────────────────────────────
function PostUploadBridge({ batchId }: { batchId: string }) {
  const queryClient = useQueryClient();
  // No need for an `{ enabled }` guard here: the parent (`ConfirmStep`'s
  // complete branch) only mounts <PostUploadBridge /> when `result.batchId`
  // is truthy, so this hook never fires with an empty batch id.
  const groupsQuery = useListInvoiceGroups({ importBatch: batchId, errorDetails: "empty", limit: 200 });
  const errorTypesQuery = useListErrorTypes();

  // Local state — see design note (2) above for why we don't rely on
  // refetch alone to drop actioned rows from the visible list.
  const [actioned, setActioned] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errorByGroup, setErrorByGroup] = useState<Record<number, string>>({});

  // Broad-stroke cache invalidation: every other surface that reads
  // groups (Queue, dashboard tiles, attestation pending list, etc.)
  // should reflect the new state. Cheap and safe — these queries are
  // already paginated/scoped on the consumer side.
  const invalidateGroupCaches = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["listInvoiceGroups"] });
    queryClient.invalidateQueries({ queryKey: ["listClaimsAttestationPending"] });
    queryClient.invalidateQueries({ queryKey: ["getDashboardSummary"] });
  }, [queryClient]);

  const handleSuccess = useCallback((id: number) => {
    setActioned(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setBusyId(null);
    invalidateGroupCaches();
  }, [invalidateGroupCaches]);

  const handleError = useCallback((id: number, err: unknown) => {
    const msg = err instanceof Error ? err.message : "Action failed — please try again.";
    setErrorByGroup(prev => ({ ...prev, [id]: msg }));
    setBusyId(null);
  }, []);

  // Explicit param types on the mutation callbacks: orval's generated
  // mutation hooks declare a generic `TContext` that `noImplicitAny`
  // refuses to infer through the options-object indirection. Spelling
  // the variables type out is cheaper than fighting the inference.
  const triage = useTriageInvoiceGroup({
    mutation: {
      onSuccess: (_data: unknown, vars: { id: number }) => handleSuccess(vars.id),
      onError: (err: unknown, vars: { id: number }) => handleError(vars.id, err),
    },
  });

  const markEligible = useMarkInvoiceGroupMasEligible({
    mutation: {
      onSuccess: (_data: unknown, vars: { id: number }) => handleSuccess(vars.id),
      onError: (err: unknown, vars: { id: number }) => handleError(vars.id, err),
    },
  });

  if (groupsQuery.isLoading) {
    return (
      <Section title="Quick triage" icon={<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}>
        <p className="text-sm text-muted-foreground">Looking for groups that need triage…</p>
      </Section>
    );
  }

  const allGroups = (groupsQuery.data ?? []) as InvoiceGroupResponse[];
  const visibleGroups = allGroups.filter(g => !actioned.has(g.id));
  const errorTypes = (errorTypesQuery.data ?? []) as ErrorTypeResponse[];

  if (allGroups.length === 0) {
    return (
      <Section title="Quick triage" icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}>
        <p className="text-sm text-muted-foreground">
          Every imported group already has an error description from the source. Nothing to triage here.
        </p>
      </Section>
    );
  }

  if (visibleGroups.length === 0) {
    return (
      <Section title="Quick triage" icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}>
        <p className="text-sm">
          All {allGroups.length} group{allGroups.length === 1 ? "" : "s"} routed. Open the queue to keep working.
        </p>
      </Section>
    );
  }

  return (
    <Section
      title={`Quick triage · ${visibleGroups.length} of ${allGroups.length}`}
      icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
    >
      <p className="text-xs text-muted-foreground mb-3">
        These groups landed without an error description from the source file. Pick an existing error type,
        mark them as a non-issue, or send straight to MAS Eligible — which will queue attestation automatically.
      </p>
      <div className="border border-border rounded-md divide-y divide-border" data-testid="post-upload-bridge-list">
        {visibleGroups.map(g => {
          const isBusy = busyId === g.id;
          const rowError = errorByGroup[g.id];
          return (
            <div
              key={g.id}
              className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`bridge-row-${g.id}`}
            >
              <div className="text-sm min-w-0 flex-1">
                <div className="font-mono font-medium truncate">{g.invoiceNumber || `Group #${g.id}`}</div>
                <div className="text-xs text-muted-foreground">
                  {g.rideCount} ride{g.rideCount === 1 ? "" : "s"}
                  {g.totalAmount && ` · $${parseFloat(g.totalAmount).toFixed(2)}`}
                  {g.clientNumber && ` · ${g.clientNumber}`}
                </div>
                {rowError && (
                  <div className="text-xs text-red-600 mt-1" data-testid={`bridge-row-error-${g.id}`}>
                    {rowError}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Select
                  value=""
                  disabled={isBusy || errorTypesQuery.isLoading || errorTypes.length === 0}
                  onValueChange={(value) => {
                    // Select values are strings, but ErrorTypeResponse.id
                    // is the table's serial primary key (number). Coerce
                    // for the lookup. The triage body's errorTypeId is
                    // typed as string (`text` foreign-key column on the
                    // invoice_groups side — historical schema choice),
                    // so we send the stringified id.
                    const numericId = parseInt(value, 10);
                    const et = errorTypes.find(e => e.id === numericId);
                    if (!et) return;
                    setBusyId(g.id);
                    setErrorByGroup(prev => {
                      const next = { ...prev };
                      delete next[g.id];
                      return next;
                    });
                    triage.mutate({
                      id: g.id,
                      data: { triageOutcome: "issue_found", errorTypeId: String(et.id), errorTypeName: et.name },
                    });
                  }}
                >
                  <SelectTrigger
                    className="w-[200px] h-8 text-xs"
                    data-testid={`bridge-select-error-${g.id}`}
                  >
                    <SelectValue placeholder="Define error…" />
                  </SelectTrigger>
                  <SelectContent>
                    {errorTypes.map(et => (
                      <SelectItem key={et.id} value={String(et.id)}>{et.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => {
                    setBusyId(g.id);
                    setErrorByGroup(prev => {
                      const next = { ...prev };
                      delete next[g.id];
                      return next;
                    });
                    triage.mutate({ id: g.id, data: { triageOutcome: "non_issue" } });
                  }}
                  data-testid={`bridge-btn-non-issue-${g.id}`}
                >
                  Non-issue
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => {
                    setBusyId(g.id);
                    setErrorByGroup(prev => {
                      const next = { ...prev };
                      delete next[g.id];
                      return next;
                    });
                    markEligible.mutate({ id: g.id, data: {} });
                  }}
                  data-testid={`bridge-btn-mas-eligible-${g.id}`}
                >
                  MAS Eligible
                </Button>
                {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ResultTile({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  const c = TONE_STYLE[tone];
  return (
    <div
      className="rounded-md border p-4 text-center"
      style={{ background: tone === "muted" ? undefined : c.bg, borderColor: c.border }}
    >
      <p className="text-2xl font-bold font-mono" style={{ color: tone === "muted" ? undefined : c.fg }}>{value}</p>
      <p className="text-xs font-medium mt-1" style={{ color: tone === "muted" ? "hsl(var(--muted-foreground))" : c.fg, opacity: 0.85 }}>{label}</p>
    </div>
  );
}

function SourceFileCard({ fileName, fileSize, onReplace }: { fileName: string; fileSize: number; onReplace: () => void }) {
  return (
    <Section
      title="Source file"
      icon={<FileSpreadsheet className="h-4 w-4 text-muted-foreground" />}
    >
      <div className="flex items-center gap-3 text-sm flex-wrap">
        {getFileIcon(fileName)}
        <span className="font-mono">{fileName || "—"}</span>
        {fileSize > 0 && (
          <span className="text-muted-foreground text-xs">· {formatFileSize(fileSize)}</span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onReplace} data-testid="button-replace-file">
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Replace
        </Button>
      </div>
    </Section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Right rails
// ────────────────────────────────────────────────────────────────────────────

function UploadRail({
  stage, isProcessing, handleReset,
}: {
  stage: UploadStage; isProcessing: boolean; handleReset: () => void;
}) {
  if (isProcessing) {
    return (
      <ActionsRailRecommended label="In progress" description="Hang tight while we read the file.">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading file…
        </div>
      </ActionsRailRecommended>
    );
  }

  if (stage === "error") {
    return (
      <>
        <ActionsRailRecommended
          label="Recommended"
          description="Pick a different file or fix the formatting and try again."
        >
          <div className="text-sm font-semibold mb-2">Try uploading again</div>
          <ToneButton tone="blue" onClick={handleReset} testId="rail-button-retry">
            <RotateCcw className="w-4 h-4" /> Reset and try again
          </ToneButton>
        </ActionsRailRecommended>
      </>
    );
  }

  return (
    <>
      {/*
        Upload step: the dropzone in the main panel IS the primary action,
        so the rail intentionally does NOT repeat a "Choose file" button
        here. On mobile the rail stacks directly under the dropzone and
        a second picker reads as a bug (two uploads stacked). The rail's
        job on this step is just to orient the operator and surface the
        manual one-off alternative below.
      */}
      <ActionsRailRecommended
        label="Recommended"
        description="Use the upload panel above to drop a CSV or Excel job-status report. ClaimClear will auto-detect the columns."
      >
        <div className="text-sm font-semibold">Upload your report</div>
      </ActionsRailRecommended>

      <ActionGroup label="Other ways to start">
        <ActionRow
          icon={<Layers className="w-3.5 h-3.5" />}
          label="Add a single claim"
          sub="Use the manual form for one-offs"
          onClick={() => window.location.assign("/claims/new")}
          testId="rail-action-manual-claim"
        />
      </ActionGroup>
    </>
  );
}

function MapRail({
  rows, warnings, classifyLoading, onClassify, onSkip, onBack,
}: {
  rows: ParsedRow[]; warnings: ParseWarning[]; classifyLoading: boolean;
  onClassify: () => void; onSkip: () => void; onBack: () => void;
}) {
  return (
    <>
      <ActionsRailRecommended
        label="Recommended"
        description="We'll match each error description against your coding rules so you only review the new ones."
      >
        <div className="text-sm font-semibold mb-2">
          Continue to classify {rows.length} claim{rows.length === 1 ? "" : "s"}
        </div>
        <ToneButton tone="blue" onClick={onClassify} disabled={classifyLoading} testId="rail-button-continue-classify">
          {classifyLoading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Looking up…</>
          ) : (
            <><Tag className="w-4 h-4" /> Continue to classify</>
          )}
        </ToneButton>
        {warnings.length > 0 && (
          <div className="text-xs mt-2 opacity-85">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"} below — safe to continue.
          </div>
        )}
      </ActionsRailRecommended>

      <ActionGroup label="Or">
        <ActionRow
          icon={<ArrowRight className="w-3.5 h-3.5" />}
          label="Skip classification & import"
          sub="Land everything in the classification queue without an error type"
          onClick={onSkip}
          disabled={classifyLoading}
          testId="rail-action-skip-classify"
        />
        <ActionRow
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
          label="Pick a different file"
          sub="Discard this parse"
          muted
          onClick={onBack}
          testId="rail-action-back-to-upload"
        />
      </ActionGroup>
    </>
  );
}

function ClassifyRail({
  unmatchedCount, matchedCount, userAssignedCount, multiErrorCount, assignedCount, groupCount,
  pending, onContinue, onSaveAndFinishLater, onDiscard, onSkip, onBack,
}: {
  unmatchedCount: number; matchedCount: number; userAssignedCount: number;
  multiErrorCount: number; assignedCount: number; groupCount: number;
  pending: boolean;
  onContinue: () => void;
  onSaveAndFinishLater: () => void;
  onDiscard: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const hasUnknowns = unmatchedCount > 0;
  const recommendedTitle = hasUnknowns
    ? `${unmatchedCount} unknown error${unmatchedCount === 1 ? "" : "s"} need your decision`
    : `All ${groupCount} group${groupCount === 1 ? "" : "s"} ready`;
  const recommendedDescription = hasUnknowns
    ? "Pick the right error type for each unknown — we'll save it as a coding rule for next time."
    : `${assignedCount} of ${groupCount} groups have an error type assigned.`;

  return (
    <>
      <ActionsRailRecommended label="Recommended" description={recommendedDescription}>
        <div className="text-sm font-semibold mb-2">{recommendedTitle}</div>
        {hasUnknowns ? (
          <ToneButton tone="amber" disabled testId="rail-button-resolve-unknowns">
            <Tag className="w-4 h-4" /> Resolve {unmatchedCount} unknown{unmatchedCount === 1 ? "" : "s"}
          </ToneButton>
        ) : (
          <ToneButton
            tone="blue"
            onClick={onContinue}
            disabled={pending}
            testId="rail-button-continue-to-confirm"
          >
            {pending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><ArrowRight className="w-4 h-4" /> Continue to Confirm</>}
          </ToneButton>
        )}
        {hasUnknowns && (
          <div className="text-xs mt-2 opacity-85">
            Use <strong>Review</strong> on a row to assign its type, or pick from the dropdown.
          </div>
        )}
      </ActionsRailRecommended>

      <ActionGroup label="When done">
        <ActionRow
          icon={<ArrowRight className="w-3.5 h-3.5" />}
          label="Continue to Confirm"
          sub={`${assignedCount} of ${groupCount} ready`}
          onClick={onContinue}
          disabled={pending}
          testId="rail-action-continue-to-confirm"
        />
        <ActionRow
          icon={<Save className="w-3.5 h-3.5" />}
          label="Save and finish later"
          sub="Picks up where you left off"
          onClick={onSaveAndFinishLater}
          disabled={pending}
          testId="rail-action-save-and-finish-later"
        />
      </ActionGroup>

      <ActionGroup label="Snapshot">
        <ActionRow
          icon={<CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}
          label={`${matchedCount} matched by rules`}
          sub="High confidence"
          muted
          disabled
        />
        <ActionRow
          icon={<Eye className="w-3.5 h-3.5 text-amber-600" />}
          label={`${userAssignedCount} user-assigned`}
          sub="Will be saved as new rules"
          muted
          disabled
        />
        <ActionRow
          icon={<Layers className="w-3.5 h-3.5 text-muted-foreground" />}
          label={`${multiErrorCount} multi-error`}
          sub="Assigned later, per claim"
          muted
          disabled
        />
      </ActionGroup>

      <ActionGroup label="Selection">
        <ActionRow
          icon={<ArrowRight className="w-3.5 h-3.5" />}
          label="Skip & continue without classifying"
          sub="Leave unknowns un-classified"
          onClick={onSkip}
          disabled={pending}
          testId="rail-action-skip-and-continue"
        />
        <ActionRow
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
          label="Back to map columns"
          muted
          onClick={onBack}
          disabled={pending}
          testId="rail-action-back-to-map"
        />
        <ActionRow
          icon={<X className="w-3.5 h-3.5" />}
          label="Discard import"
          sub="Throw away parsed rows and saved progress"
          muted
          onClick={onDiscard}
          disabled={pending}
          testId="rail-action-discard-import"
        />
      </ActionGroup>
    </>
  );
}

function ConfirmRail({
  stage, rows, result, pending, onStartImport, onBack, onAnother, navigate,
}: {
  stage: UploadStage;
  rows: ParsedRow[];
  result: ImportSummary | null;
  pending: boolean;
  onStartImport: () => void;
  onBack: () => void;
  onAnother: () => void;
  navigate: (path: string) => void;
}) {
  if (stage === "importing") {
    return (
      <ActionsRailRecommended label="In progress" description="Saving everything to ClaimClear.">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Importing…
        </div>
      </ActionsRailRecommended>
    );
  }

  if (stage === "confirming") {
    return (
      <>
        <ActionsRailRecommended
          label="Recommended"
          description="Save the parsed rows to ClaimClear. Existing claims follow your duplicate setting."
        >
          <div className="text-sm font-semibold mb-2">
            Start import of {rows.length} claim{rows.length === 1 ? "" : "s"}
          </div>
          <ToneButton
            tone="blue"
            onClick={onStartImport}
            disabled={pending}
            testId="rail-button-start-import"
          >
            {pending ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : <><Play className="w-4 h-4" /> Start import</>}
          </ToneButton>
          <div className="text-xs mt-2 opacity-85">
            Nothing has been saved yet — this is your last chance to step back.
          </div>
        </ActionsRailRecommended>

        <ActionGroup label="Other">
          <ActionRow
            icon={<ArrowLeft className="w-3.5 h-3.5" />}
            label="Back to classify"
            sub="Edit error type assignments"
            onClick={onBack}
            disabled={pending}
            testId="rail-action-back-to-classify"
          />
          <ActionRow
            icon={<X className="w-3.5 h-3.5" />}
            label="Cancel import"
            sub="Discard parsed rows"
            muted
            onClick={onAnother}
            disabled={pending}
            testId="rail-action-cancel-import"
          />
        </ActionGroup>
      </>
    );
  }

  return (
    <>
      <ActionsRailRecommended
        label="Recommended"
        description="The new claims are ready to classify in the queue."
      >
        <div className="text-sm font-semibold mb-2">Open the classification queue</div>
        <ToneButton tone="blue" onClick={() => navigate("/queue")} testId="rail-button-open-queue">
          <ArrowRight className="w-4 h-4" /> Open Queue
        </ToneButton>
        {result && (
          <div className="text-xs mt-2 opacity-85">
            {result.created} new claim{result.created === 1 ? "" : "s"} are waiting.
          </div>
        )}
      </ActionsRailRecommended>

      <ActionGroup label="Then">
        <ActionRow
          icon={<Upload className="w-3.5 h-3.5" />}
          label="Import another file"
          sub="Pick up where you left off"
          onClick={onAnother}
          testId="rail-action-import-another"
        />
        <ActionRow
          icon={<Layers className="w-3.5 h-3.5" />}
          label="View invoice groups"
          sub="See how rides were grouped"
          onClick={() =>
            navigate(
              result?.batchId
                ? `/invoice-groups?importBatch=${encodeURIComponent(result.batchId)}`
                : "/invoice-groups",
            )
          }
          testId="rail-action-view-groups"
        />
      </ActionGroup>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Review dialog
// ────────────────────────────────────────────────────────────────────────────

function ReviewDialog({
  group, rows, errorTypes, onClose, onAssign,
}: {
  group: ClassifyGroup | null;
  rows: ParsedRow[];
  errorTypes: ErrorTypeResponse[];
  onClose: () => void;
  onAssign: (errorTypeId: string) => void;
}) {
  const matchingRows = useMemo(() => {
    if (!group) return [];
    return rows.filter(r => r.errorDetails === group.errorDetails);
  }, [group, rows]);

  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    setSelected(group?.selectedErrorTypeId ?? "");
  }, [group]);

  if (!group) return null;

  return (
    <Dialog open={!!group} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review error group</DialogTitle>
          <DialogDescription>
            {matchingRows.length} claim{matchingRows.length === 1 ? "" : "s"} in this group.
            {group.matched
              ? " Already matched by an existing coding rule."
              : group.isMultiError
                ? " This is a multi-error row — error types are assigned per claim during classification."
                : " Pick the right type to apply it to every row in the group."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Source code</p>
            {group.isMultiError ? (
              <ul className="space-y-1 text-sm">
                {group.errorDetails.split(";").map((part, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-muted-foreground">•</span>
                    <span>{part.trim()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-sm break-words">{group.errorDetails}</p>
            )}
          </div>

          {!group.isMultiError && (
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Apply error type to all rows</Label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-review-error-type">
                  <SelectValue placeholder="Pick an error type…" />
                </SelectTrigger>
                <SelectContent>
                  {errorTypes.map(et => (
                    <SelectItem key={et.id} value={String(et.id)}>{et.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Claims in this group
            </p>
            <div className="max-h-[260px] overflow-auto border border-border rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left p-2 text-xs font-medium">Conf #</th>
                    <th className="text-left p-2 text-xs font-medium">Date</th>
                    <th className="text-left p-2 text-xs font-medium">Ref #</th>
                    <th className="text-left p-2 text-xs font-medium">Client #</th>
                    <th className="text-right p-2 text-xs font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {matchingRows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="p-2 font-mono text-xs">{r.confNumber}</td>
                      <td className="p-2 text-xs">{r.date}</td>
                      <td className="p-2 text-xs">{r.refNumber}</td>
                      <td className="p-2 text-xs">{r.clientNumber}</td>
                      <td className="p-2 text-right text-xs font-mono">${(r.claimAmount || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {matchingRows.length > 50 && (
                <div className="text-center py-2 text-xs text-muted-foreground bg-muted/30">
                  Showing first 50 of {matchingRows.length} rows
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-review-close">Close</Button>
          {!group.isMultiError && (
            <Button
              onClick={() => onAssign(selected)}
              disabled={!selected}
              data-testid="button-review-apply"
            >
              Apply to {matchingRows.length} claim{matchingRows.length === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
