import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Download } from "lucide-react";
import { useState } from "react";

interface ExportCsvControlProps {
  /** Builds the download URL given the current "all fields" toggle. */
  buildUrl: (allFields: boolean) => string;
  /** Builds the download filename given the current "all fields" toggle. */
  buildFilename: (allFields: boolean) => string;
  /** Stable prefix for `data-testid="export-csv-…"` hooks. */
  testIdPrefix: string;
}

/**
 * Task #848 — shared "Export CSV" control used by Queue, Responses
 * Awaiting Review and the Attestation Queue. Renders a single button
 * that opens a small popover with the "Include all fields" toggle and
 * the download link. The download link's `href` + `download` attrs
 * are re-derived from the parent's filter state on every render, so
 * the export always matches what the operator is currently looking at.
 */
export function ExportCsvControl({
  buildUrl,
  buildFilename,
  testIdPrefix,
}: ExportCsvControlProps) {
  const [allFields, setAllFields] = useState(false);
  const url = buildUrl(allFields);
  const filename = buildFilename(allFields);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          data-testid={`${testIdPrefix}-trigger`}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold">Export current view</div>
          <p className="text-xs text-muted-foreground">
            Exports every row matching the active filters and sort. The
            filename includes a short filter signature so repeat
            downloads stay distinguishable.
          </p>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label
              htmlFor={`${testIdPrefix}-all-fields`}
              className="text-xs font-medium"
            >
              Include all fields
            </Label>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Off: a short, human-readable column set. On: every column
              from the raw row (useful for audits / pivots).
            </p>
          </div>
          <Switch
            id={`${testIdPrefix}-all-fields`}
            checked={allFields}
            onCheckedChange={setAllFields}
            data-testid={`${testIdPrefix}-all-fields`}
          />
        </div>
        <div className="text-[11px] text-muted-foreground break-all">
          <span className="font-medium text-foreground">File: </span>
          <span data-testid={`${testIdPrefix}-filename`}>{filename}</span>
        </div>
        <Button asChild size="sm" className="w-full">
          <a
            href={url}
            download={filename}
            data-testid={`${testIdPrefix}-download`}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download CSV
          </a>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
