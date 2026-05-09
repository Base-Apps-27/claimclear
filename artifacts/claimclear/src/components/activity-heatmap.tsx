import { useMemo } from "react";
import CalendarHeatmap from "react-calendar-heatmap";
import "react-calendar-heatmap/dist/styles.css";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatChartTick, formatWeekday } from "@/lib/time";

// 5-bucket color ramp themed to match the rest of the app. The empty
// (zero-count) cell uses a low-contrast neutral so it reads as
// "background" in both themes; the four populated tiers ramp up the
// emerald used by the streak pip itself so the avatar and the hover
// card feel like the same surface. Verified in light + dark themes
// against the popover background.
const RAMP_CLASS_BY_BUCKET: Record<number, string> = {
  0: "fill-muted/60 stroke-border/40",
  1: "fill-emerald-500/25 stroke-emerald-500/30",
  2: "fill-emerald-500/45 stroke-emerald-500/40",
  3: "fill-emerald-500/70 stroke-emerald-500/60",
  4: "fill-emerald-500 stroke-emerald-600",
};

function bucketFor(count: number): number {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

// Tooltip label for a heatmap cell. `date` is a calendar `YYYY-MM-DD`
// so we route through the shared time module's calendar-day path —
// the displayed weekday + month/day always matches the day stored on
// the wire, in any operator timezone (#562).
function formatPretty(date: string): string {
  return `${formatWeekday(date)} ${formatChartTick(date)}`;
}

export interface ActivityHeatmapDay {
  date: string;
  count: number;
}

interface ActivityHeatmapProps {
  dailyCounts: ActivityHeatmapDay[];
}

// GitHub-style 12-week activity heatmap. Pure presentational —
// `dailyCounts` must already cover every day in the window with
// `count: 0` entries for empty days (the server endpoint densifies).
// Renders a Less → More legend matching the bucket ramp above.
export function ActivityHeatmap({ dailyCounts }: ActivityHeatmapProps) {
  const { startDate, endDate, lookup } = useMemo(() => {
    const lookup = new Map<string, number>();
    for (const d of dailyCounts) lookup.set(d.date, d.count);
    const first = dailyCounts[0]?.date ?? null;
    const last = dailyCounts[dailyCounts.length - 1]?.date ?? null;
    function toDate(ymd: string): Date {
      const [y, m, d] = ymd.split("-").map(s => parseInt(s, 10));
      return new Date(y, m - 1, d);
    }
    return {
      startDate: first ? toDate(first) : new Date(),
      endDate: last ? toDate(last) : new Date(),
      lookup,
    };
  }, [dailyCounts]);

  const values = useMemo(
    () => dailyCounts.map(d => ({ date: d.date, count: d.count })),
    [dailyCounts],
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-2" data-testid="activity-heatmap">
        <CalendarHeatmap
          startDate={startDate}
          endDate={endDate}
          values={values}
          showWeekdayLabels={false}
          showMonthLabels={false}
          gutterSize={2}
          classForValue={(value) => {
            const c = value && typeof value.count === "number" ? value.count : 0;
            return RAMP_CLASS_BY_BUCKET[bucketFor(c)];
          }}
          transformDayElement={(rect, value, index) => {
            // `value` is the underlying datum (or undefined for cells
            // outside the data range, which won't happen here because
            // the server densifies). We wrap each cell in a Tooltip
            // so hovering surfaces "<count> action(s) on <date>".
            // Key: prefer the date string for stability across
            // re-renders; fall back to the library-supplied index for
            // the rare out-of-range cell so we never key on Math.random.
            const ymd = value?.date as string | undefined;
            const count = ymd ? (lookup.get(ymd) ?? 0) : 0;
            const label = ymd
              ? `${count} ${count === 1 ? "action" : "actions"} on ${formatPretty(ymd)}`
              : "";
            return (
              <Tooltip key={ymd ?? `cell-${index}`}>
                <TooltipTrigger asChild>{rect as React.ReactElement}</TooltipTrigger>
                {ymd ? (
                  <TooltipContent side="top" className="text-[11px]">
                    {label}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            );
          }}
        />
        <div className="flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map(b => (
            <svg
              key={b}
              width={10}
              height={10}
              viewBox="0 0 10 10"
              aria-hidden="true"
            >
              <rect
                width="10"
                height="10"
                rx="2"
                className={cn(RAMP_CLASS_BY_BUCKET[b])}
              />
            </svg>
          ))}
          <span>More</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
