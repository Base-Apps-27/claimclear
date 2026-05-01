import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export type FacetDateRangeValue = {
  from?: string;
  to?: string;
};

export type FacetDatePreset = {
  label: string;
  // Resolves to a {from, to} pair when the preset is clicked. The page owns
  // the calendar math so quirks like "weekend deadlines shift to Friday"
  // stay in one place.
  resolve: () => FacetDateRangeValue;
};

export type FacetDateRangeProps = {
  value: FacetDateRangeValue;
  onChange: (value: FacetDateRangeValue) => void;
  presets?: FacetDatePreset[];
  fromLabel?: string;
  toLabel?: string;
  testIdPrefix?: string;
};

function isPresetActive(value: FacetDateRangeValue, preset: FacetDateRangeValue) {
  return (value.from || "") === (preset.from || "") &&
    (value.to || "") === (preset.to || "");
}

export function FacetDateRange({
  value,
  onChange,
  presets,
  fromLabel = "Start date",
  toLabel = "End date",
  testIdPrefix,
}: FacetDateRangeProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b shrink-0">
        <h4 className="text-sm font-medium">Custom range</h4>
      </div>
      <div className="p-4 space-y-4">
        {presets && presets.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Quick presets
            </Label>
            <div className="flex flex-wrap gap-2">
              {presets.map(preset => {
                const resolved = preset.resolve();
                const active = isPresetActive(value, resolved);
                return (
                  <Badge
                    key={preset.label}
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer font-normal rounded-sm select-none"
                    onClick={() => onChange(resolved)}
                    data-testid={
                      testIdPrefix
                        ? `${testIdPrefix}-preset-${preset.label
                            .toLowerCase()
                            .replace(/\s+/g, "-")}`
                        : undefined
                    }
                  >
                    {preset.label}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        <div
          className={
            presets && presets.length > 0
              ? "grid grid-cols-2 gap-4 pt-4 border-t"
              : "grid grid-cols-2 gap-4"
          }
        >
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{fromLabel}</Label>
            <Input
              type="date"
              value={value.from ?? ""}
              onChange={e => onChange({ ...value, from: e.target.value })}
              data-testid={testIdPrefix ? `${testIdPrefix}-from` : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{toLabel}</Label>
            <Input
              type="date"
              value={value.to ?? ""}
              onChange={e => onChange({ ...value, to: e.target.value })}
              data-testid={testIdPrefix ? `${testIdPrefix}-to` : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
