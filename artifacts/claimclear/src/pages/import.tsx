import { useState, useCallback } from "react";
import { useImportClaims, getListClaimsQueryKey } from "@workspace/api-client-react";
import type { ImportSummary } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Upload, Check, AlertCircle } from "lucide-react";

interface ParsedRow {
  confNumber: string;
  date: string;
  refNumber: string;
  clientNumber: string;
  carNumber: string;
  errorDetails: string;
  claimAmount: number;
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

export default function Import() {
  const queryClient = useQueryClient();
  const importClaims = useImportClaims();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [duplicateAction, setDuplicateAction] = useState("skip");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [fileName, setFileName] = useState("");

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const records = parseCsv(text);
      if (records.length < 2) return;

      const headers = records[0].map(h => h.trim());
      const parsed: ParsedRow[] = [];

      for (let i = 1; i < records.length; i++) {
        const values = records[i];
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
        if (row.confNumber) parsed.push(row as ParsedRow);
      }
      setRows(parsed);
    };
    reader.readAsText(file);
  }, []);

  const handleImport = async () => {
    const res = await importClaims.mutateAsync({ data: { rows, duplicateAction } });
    setResult(res);
    queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Import Claims</h2>
        <p className="text-muted-foreground">Upload a Job Claim Status report (CSV format)</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <label className="cursor-pointer">
              <span className="text-primary font-medium hover:underline">Choose a CSV file</span>
              <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
            </label>
            {fileName && <p className="text-sm text-muted-foreground mt-2">{fileName}</p>}
          </div>

          {rows.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{rows.length} claims parsed</p>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Duplicates:</Label>
                  <Select value={duplicateAction} onValueChange={setDuplicateAction}>
                    <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Skip</SelectItem>
                      <SelectItem value="update">Update</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="max-h-[300px] overflow-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card border-b">
                    <tr>
                      <th className="text-left p-2">Conf #</th>
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">Ref #</th>
                      <th className="text-left p-2">Client #</th>
                      <th className="text-left p-2">Error</th>
                      <th className="text-right p-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2 font-mono">{r.confNumber}</td>
                        <td className="p-2">{r.date}</td>
                        <td className="p-2">{r.refNumber}</td>
                        <td className="p-2">{r.clientNumber}</td>
                        <td className="p-2 truncate max-w-[200px]">{r.errorDetails}</td>
                        <td className="p-2 text-right">${(r.claimAmount || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button onClick={handleImport} disabled={importClaims.isPending} className="w-full">
                {importClaims.isPending ? "Importing..." : `Import ${rows.length} Claims`}
              </Button>
            </>
          )}

          {result && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Check className="h-5 w-5 text-green-500" />
                  <span className="font-medium">Import Complete</span>
                </div>
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-green-600">{result.created}</p>
                    <p className="text-xs text-muted-foreground">Created</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-600">{result.updated}</p>
                    <p className="text-xs text-muted-foreground">Updated</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-amber-600">{result.skipped}</p>
                    <p className="text-xs text-muted-foreground">Skipped</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{result.total}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Batch ID: {result.batchId}</p>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
