import { useState, useCallback, useRef } from "react";
import { useImportClaims, useLookupErrorDetailMappings, useSaveErrorDetailMappings, useListErrorTypes, getListClaimsQueryKey } from "@workspace/api-client-react";
import type { ImportSummary, ErrorTypeResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload, AlertCircle, FileSpreadsheet, FileText, X,
  Loader2, CheckCircle2, AlertTriangle, RotateCcw, Tag, ArrowRight,
} from "lucide-react";
import { InfoTooltip, WrapTooltip } from "@/components/info-tooltip";
import * as XLSX from "xlsx";

type UploadStage = "idle" | "reading" | "parsing" | "ready" | "classifying" | "importing" | "complete" | "error";

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

export default function Import() {
  const queryClient = useQueryClient();
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

  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];

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
        mappings = res.mappings;
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

  const [mappingSaveError, setMappingSaveError] = useState("");

  const handleConfirmClassification = async () => {
    setMappingSaveError("");
    const mappingsToSave = classifyGroups
      .filter(g => g.selectedErrorTypeId)
      .map(g => ({
        originalText: g.errorDetails,
        errorTypeId: Number(g.selectedErrorTypeId),
        errorTypeName: g.selectedErrorTypeName,
      }));

    if (mappingsToSave.length > 0) {
      try {
        await saveMappings.mutateAsync({ data: { mappings: mappingsToSave } });
      } catch (err) {
        setMappingSaveError("Failed to save mappings for future use, but proceeding with import.");
      }
    }

    const classifyMap = new Map(
      classifyGroups
        .filter(g => g.selectedErrorTypeId)
        .map(g => [g.errorDetails, { id: g.selectedErrorTypeId, name: g.selectedErrorTypeName }])
    );

    const updatedRows = rows.map(row => {
      const match = classifyMap.get(row.errorDetails);
      if (match) {
        return { ...row, errorTypeId: match.id, errorTypeName: match.name };
      }
      return row;
    });

    setRows(updatedRows);
    handleImport(updatedRows);
  };

  const handleImport = async (importRows?: ParsedRow[]) => {
    setStage("importing");
    try {
      const rowsToImport = importRows ?? rows;
      const res = await importClaims.mutateAsync({ data: { rows: rowsToImport, duplicateAction } });
      setResult(res);
      setStage("complete");
      queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
    } catch (err) {
      setStage("error");
      setErrorMessage(err instanceof Error ? err.message : "Import failed");
    }
  };

  const handleSkipClassification = () => {
    handleImport();
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const totalAmount = rows.reduce((s, r) => s + (r.claimAmount || 0), 0);

  const isProcessing = stage === "reading" || stage === "parsing";

  const matchedCount = classifyGroups.filter(g => g.matched).length;
  const unmatchedCount = classifyGroups.filter(g => !g.matched && !g.isMultiError).length;
  const multiErrorCount = classifyGroups.filter(g => g.isMultiError).length;
  const assignedCount = classifyGroups.filter(g => g.selectedErrorTypeId).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Import Claims</h2>
        <p className="text-muted-foreground">Upload a Job Claim Status report</p>
      </div>

      {isProcessing && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6 pb-5">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">
                    {stage === "reading" ? "Reading file..." : `Parsing ${fileType === "excel" ? "Excel" : "CSV"} data...`}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {getFileIcon(fileName)}
                    <span>{fileName}</span>
                    <span>({formatFileSize(fileSize)})</span>
                  </div>
                </div>
                <Progress value={stage === "reading" ? 30 : 70} className="h-1.5" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "error" && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-red-800">Failed to process file</p>
                <p className="text-sm text-red-600 mt-1">{errorMessage}</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="h-3 w-3 mr-1" /> Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(stage === "idle" || stage === "error") && (
        <Card>
          <CardContent className="pt-6">
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <Upload className={`h-12 w-12 mx-auto mb-4 ${dragOver ? "text-primary" : "text-muted-foreground/50"}`} />
              <p className="text-lg font-medium mb-1">
                {dragOver ? "Drop file here" : "Drag and drop your file here"}
              </p>
              <p className="text-sm text-muted-foreground mb-2">or click to browse</p>
              <p className="text-xs text-muted-foreground mb-4">Upload a Job Claim Status report. The system will auto-detect columns like Conf #, Date, Ref #, Client #, Car #, Error Details, and Amount.</p>
              <label className="cursor-pointer">
                <Button variant="outline" asChild>
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    Choose File
                  </span>
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5 text-blue-500" />
                  <span>CSV</span>
                </div>
                <div className="flex items-center gap-1">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-green-500" />
                  <span>Excel (.xlsx, .xls)</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "ready" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                {rows.length} Claims Ready to Import
              </CardTitle>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {getFileIcon(fileName)}
                  <span>{fileName}</span>
                  <span>({formatFileSize(fileSize)})</span>
                </div>
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {sheetInfos.length > 1 && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <FileSpreadsheet className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium text-blue-800">
                    {sheetInfos.filter(s => s.used).length} of {sheetInfos.length} sheet{sheetInfos.length !== 1 ? "s" : ""} detected with claim data
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sheetInfos.map((s, i) => (
                    <WrapTooltip key={i} content={s.used ? `${s.rowCount} row${s.rowCount !== 1 ? "s" : ""} imported` : s.reason || "Skipped"}>
                      <Badge
                        variant={s.used ? "default" : "outline"}
                        className={`text-xs ${s.used ? "bg-blue-600" : "text-muted-foreground"}`}
                      >
                        {s.name}{s.used ? ` (${s.rowCount})` : ""}
                        {!s.used && <X className="h-3 w-3 ml-1 opacity-50" />}
                      </Badge>
                    </WrapTooltip>
                  ))}
                </div>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-800">{warnings.length} Warning{warnings.length !== 1 ? "s" : ""}</span>
                </div>
                <ul className="text-xs text-amber-700 space-y-0.5 ml-6 list-disc">
                  {warnings.slice(0, 5).map((w, i) => (
                    <li key={i}>{w.row > 0 ? `Row ${w.row}: ` : ""}{w.message}</li>
                  ))}
                  {warnings.length > 5 && (
                    <li>...and {warnings.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/50 rounded-md p-3 text-center">
                <p className="text-xl font-bold">{rows.length}</p>
                <p className="text-xs text-muted-foreground">Claims</p>
              </div>
              <div className="bg-muted/50 rounded-md p-3 text-center">
                <p className="text-xl font-bold">${totalAmount.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Total Amount</p>
              </div>
              <div className="bg-muted/50 rounded-md p-3 text-center">
                <p className="text-xl font-bold">${(totalAmount * 1.7).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Est. Exposure (~1.7x)</p>
              </div>
            </div>

            <div className="max-h-[300px] overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">#</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">Conf #</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">Date</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">Ref #</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">Client #</th>
                    <th className="text-left p-2 text-xs font-medium text-muted-foreground">Error</th>
                    <th className="text-right p-2 text-xs font-medium text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="p-2 text-muted-foreground text-xs">{i + 1}</td>
                      <td className="p-2 font-mono text-xs">{r.confNumber}</td>
                      <td className="p-2 text-xs">{r.date}</td>
                      <td className="p-2 text-xs">{r.refNumber}</td>
                      <td className="p-2 text-xs">{r.clientNumber}</td>
                      <td className="p-2 truncate max-w-[200px] text-xs">{r.errorDetails}</td>
                      <td className="p-2 text-right text-xs">${(r.claimAmount || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 50 && (
                <div className="text-center py-2 text-xs text-muted-foreground bg-muted/20">
                  Showing first 50 of {rows.length} rows
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm flex items-center gap-1">
                  Duplicates:
                  <InfoTooltip content="How to handle claims with a confirmation number that already exists in the system. 'Skip' leaves existing claims untouched, 'Update' overwrites them with the new data." />
                </Label>
                <Select value={duplicateAction} onValueChange={setDuplicateAction}>
                  <SelectTrigger className="w-[130px] h-8 text-sm">
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
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => handleImport()} disabled={classifyLoading}>
                  Skip Classification
                </Button>
                <Button onClick={handleStartClassify} disabled={classifyLoading}>
                  {classifyLoading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Looking up...</>
                  ) : (
                    <><Tag className="h-4 w-4 mr-2" /> Classify & Import</>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "classifying" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="h-5 w-5 text-primary" />
                Classify Error Types
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {assignedCount}/{classifyGroups.length} assigned
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => setStage("ready")}>
                  <ArrowRight className="h-3 w-3 mr-1 rotate-180" /> Back
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              {matchedCount > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-md px-3 py-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-800">{matchedCount} known match{matchedCount !== 1 ? "es" : ""}</span>
                </div>
              )}
              {unmatchedCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm text-amber-800">{unmatchedCount} unrecognized</span>
                </div>
              )}
              {multiErrorCount > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-blue-800">{multiErrorCount} multi-error (manual assignment)</span>
                </div>
              )}
            </div>

            <div className="max-h-[400px] overflow-auto border rounded-md divide-y">
              {classifyGroups.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No error details found in the imported claims.
                </div>
              ) : (
                classifyGroups.map((group, index) => (
                  <div key={index} className={`p-3 ${group.matched ? "bg-green-50/50" : group.isMultiError ? "bg-blue-50/50" : ""}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {group.isMultiError ? (
                            <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700 border-blue-300">Multiple</Badge>
                          ) : group.matched ? (
                            <Badge variant="outline" className="text-xs bg-green-100 text-green-700 border-green-300">Known</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs bg-amber-100 text-amber-700 border-amber-300">New</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">{group.count} claim{group.count !== 1 ? "s" : ""}</span>
                        </div>
                        {group.isMultiError ? (
                          <div>
                            <ul className="text-sm space-y-0.5 ml-1">
                              {group.errorDetails.split(";").map((part, i) => (
                                <li key={i} className="flex items-start gap-1.5">
                                  <span className="text-blue-400 mt-0.5 text-xs">&#x2022;</span>
                                  <span>{part.trim()}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="text-sm truncate" title={group.errorDetails}>{group.errorDetails}</p>
                        )}
                      </div>
                      <div className="w-[220px] flex-shrink-0">
                        {group.isMultiError ? (
                          <div className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5 text-center">
                            Skipped — user will assign on claim
                          </div>
                        ) : (
                          <Select
                            value={group.selectedErrorTypeId}
                            onValueChange={(val) => handleGroupErrorTypeChange(index, val)}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder="Select error type..." />
                            </SelectTrigger>
                            <SelectContent>
                              {errorTypes.map((et) => (
                                <SelectItem key={et.id} value={String(et.id)}>{et.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {mappingSaveError && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                <span className="text-sm text-amber-800">{mappingSaveError}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Assigned error types will be saved for future imports.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleSkipClassification}>
                  Skip & Import
                </Button>
                <Button onClick={handleConfirmClassification} disabled={saveMappings.isPending || importClaims.isPending}>
                  {saveMappings.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><CheckCircle2 className="h-4 w-4 mr-2" /> Confirm & Import</>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "importing" && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center py-8">
              <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
              <p className="text-lg font-medium">Importing {rows.length} claims...</p>
              <p className="text-sm text-muted-foreground mt-1">This may take a moment for large files</p>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "complete" && result && (
        <Card className="border-green-200">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                <span className="text-lg font-semibold">Import Complete</span>
              </div>
              <Button variant="outline" onClick={handleReset}>
                <Upload className="h-4 w-4 mr-2" /> Import Another File
              </Button>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-green-600">{result.created}</p>
                <p className="text-xs text-green-700 font-medium mt-1">Created</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-blue-600">{result.updated}</p>
                <p className="text-xs text-blue-700 font-medium mt-1">Updated</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-amber-600">{result.skipped}</p>
                <p className="text-xs text-amber-700 font-medium mt-1">Skipped</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold">{result.total}</p>
                <p className="text-xs text-muted-foreground font-medium mt-1">Total Rows</p>
              </div>
            </div>

            {result.created > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-800">
                {result.created} new claim{result.created !== 1 ? "s" : ""} added to your tracker. They will appear in the Claims list with status "New".
              </div>
            )}

            <p className="text-xs text-muted-foreground">Batch ID: <code className="bg-muted px-1 rounded">{result.batchId}</code></p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
