import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ColumnDef {
  key: string;
  label: string;
  hideable?: boolean;
}

interface ColumnVisibilityMenuProps {
  columns: ColumnDef[];
  visibleColumns: Set<string>;
  onToggle: (key: string) => void;
}

export function ColumnVisibilityMenu({ columns, visibleColumns, onToggle }: ColumnVisibilityMenuProps) {
  const hideableColumns = columns.filter(c => c.hideable !== false);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="mr-2 h-4 w-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-3 space-y-1" align="end">
        <p className="text-xs font-medium text-muted-foreground pb-1">Toggle columns</p>
        {hideableColumns.map(col => (
          <div key={col.key} className="flex items-center gap-2 py-0.5">
            <Checkbox
              id={`col-${col.key}`}
              checked={visibleColumns.has(col.key)}
              onCheckedChange={() => onToggle(col.key)}
            />
            <Label htmlFor={`col-${col.key}`} className="text-sm font-normal cursor-pointer">
              {col.label}
            </Label>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
