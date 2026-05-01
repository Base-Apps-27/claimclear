import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type FacetNumericRangeValue = {
  min?: string;
  max?: string;
};

export type FacetNumericRangeProps = {
  value: FacetNumericRangeValue;
  onChange: (value: FacetNumericRangeValue) => void;
  heading?: string;
  minLabel?: string;
  maxLabel?: string;
  minPlaceholder?: string;
  maxPlaceholder?: string;
  step?: string;
  prefix?: string;
  testIdPrefix?: string;
};

export function FacetNumericRange({
  value,
  onChange,
  heading = "Range",
  minLabel = "Min",
  maxLabel = "Max",
  minPlaceholder = "0",
  maxPlaceholder = "No limit",
  step = "0.01",
  prefix,
  testIdPrefix,
}: FacetNumericRangeProps) {
  const renderLabel = (base: string) =>
    prefix ? `${base} (${prefix})` : base;
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b shrink-0">
        <h4 className="text-sm font-medium">{heading}</h4>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {renderLabel(minLabel)}
            </Label>
            <Input
              type="number"
              min="0"
              step={step}
              placeholder={minPlaceholder}
              value={value.min ?? ""}
              onChange={e => onChange({ ...value, min: e.target.value })}
              data-testid={testIdPrefix ? `${testIdPrefix}-min` : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {renderLabel(maxLabel)}
            </Label>
            <Input
              type="number"
              min="0"
              step={step}
              placeholder={maxPlaceholder}
              value={value.max ?? ""}
              onChange={e => onChange({ ...value, max: e.target.value })}
              data-testid={testIdPrefix ? `${testIdPrefix}-max` : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
