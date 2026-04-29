import { TONE_STYLE, type Tone } from "./tone";

export type FilterStripTab<T extends string = string> = {
  key: T;
  label: string;
  count?: number | null;
};

export type FilterStripProps<T extends string = string> = {
  tabs: FilterStripTab<T>[];
  active: T;
  onChange: (key: T) => void;
  accent?: Tone;
  ariaLabel?: string;
};

export function FilterStrip<T extends string = string>({
  tabs,
  active,
  onChange,
  accent = "blue",
  ariaLabel = "Filter by status",
}: FilterStripProps<T>) {
  const tone = TONE_STYLE[accent];
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center p-1 gap-1 bg-muted rounded-md border border-border"
      data-testid="filter-strip"
    >
      {tabs.map(t => {
        const isActive = t.key === active;
        const showCount = typeof t.count === "number";
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            data-testid={`filter-tab-${t.key}`}
            className={
              "px-3 py-1.5 text-xs rounded font-medium transition-colors flex items-center gap-1.5 " +
              (isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <span>{t.label}</span>
            {showCount && (
              <span
                className="text-[10px] px-1 rounded font-bold min-w-[14px] text-center"
                style={{
                  background: isActive ? tone.bg : "transparent",
                  color: isActive ? tone.fg : "hsl(var(--muted-foreground))",
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
