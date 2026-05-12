import { useEffect } from "react";
import { useLintPortalSubmission, type LintResult } from "@workspace/api-client-react";
import { CheckCircle, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface QualityCheckPanelProps {
  submissionId: number;
  refreshKey?: unknown;
  onResults?: (results: LintResult[]) => void;
}

export function QualityCheckPanel({ submissionId, refreshKey, onResults }: QualityCheckPanelProps) {
  const lint = useLintPortalSubmission();
  const mutate = lint.mutateAsync;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const results = await mutate({ id: submissionId });
        if (!cancelled) onResults?.(results);
      } catch {
        if (!cancelled) onResults?.([]);
      }
    })();
    return () => { cancelled = true; };
  }, [submissionId, refreshKey, mutate, onResults]);

  const results = (lint.data ?? []) as LintResult[];
  const failures = results.filter(r => r.severity === "fail");
  const warnings = results.filter(r => r.severity === "warn");
  const infos = results.filter(r => r.severity === "info");

  return (
    <Card className="border-muted">
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Quality check</div>
          {lint.isPending ? (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Running…
            </span>
          ) : results.length === 0 ? (
            <span className="text-xs inline-flex items-center gap-1 text-green-700">
              <CheckCircle className="h-3.5 w-3.5" /> All checks passed
            </span>
          ) : (
            <span className="text-xs inline-flex items-center gap-2">
              {failures.length > 0 && (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <XCircle className="h-3.5 w-3.5" /> {failures.length} blocking
                </span>
              )}
              {warnings.length > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                </span>
              )}
              {infos.length > 0 && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" /> {infos.length} advisory
                </span>
              )}
            </span>
          )}
        </div>
        {!lint.isPending && results.length > 0 && (
          <ul className="space-y-1">
            {results.map((r) => (
              <li
                key={r.ruleKey}
                className={`text-xs flex items-start gap-2 rounded px-2 py-1 ${
                  r.severity === "fail"
                    ? "bg-red-50 text-red-800 border border-red-200"
                    : r.severity === "warn"
                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                      : "bg-muted/40 text-muted-foreground border border-muted"
                }`}
              >
                {r.severity === "fail" ? (
                  <XCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                )}
                <span>{r.message}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
