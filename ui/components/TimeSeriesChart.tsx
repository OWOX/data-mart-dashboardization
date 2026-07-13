import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { aggLabel } from '../lib/compile';
import { toPoints, toSeries } from '../lib/rows';
import type { Component, FilterRule, QueryResult, TimeSeriesConfig } from '../lib/types';

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

/**
 * Renders `data` as a trend line over the bucketed date field, which the server returns under its
 * original name (`c.dateField`) — not `aggLabel`'d, only the metric is. `toPoints` does the same
 * "same-shape-as-Bar" positional remap when there is no `breakdown`.
 *
 * With a `breakdown`, the query groups by `(dateField, breakdown)` (see `compile.ts`), so one row
 * per date can become several — `toSeries` PIVOTS those already-final rows into recharts' wide
 * multi-series shape (one `<Line>` per distinct breakdown value); it does not sum or re-bucket.
 * A breakdown with more distinct values than the 5-color palette cycles it (`i % COLORS.length`)
 * rather than crashing or running out of colors. `data.truncated` is surfaced explicitly because a
 * breakdown multiplies row count and can hit the server's row cap well before a single-series chart
 * would, silently dropping trailing dates/series if not called out.
 *
 * Unlike Bar/Pie, clicking a point on a trend line doesn't map to an obvious single-value filter,
 * so no click handling is wired here — `onSegmentFilter` is accepted only for a consistent
 * component signature across all three chart renderers.
 */
export function TimeSeriesChart({
  component, data,
}: {
  component: Component; data: QueryResult | null;
  onSegmentFilter?: (f: FilterRule) => void;
}) {
  const c = component.config as TimeSeriesConfig;
  if (!data) return null;
  const valueColumn = aggLabel(c.metric, c.aggregation);

  if (c.breakdown) {
    const { rows, seriesKeys } = toSeries(data, c.dateField, c.breakdown, valueColumn);
    return (
      <div className="flex h-full flex-col gap-1">
        <ChartContainer
          config={Object.fromEntries(seriesKeys.map((k, i) => [k, { label: k, color: COLORS[i % COLORS.length] }]))}
          className="h-full w-full"
        >
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" />
            <YAxis />
            <ChartTooltip content={<ChartTooltipContent />} />
            {seriesKeys.map((key, i) => (
              <Line
                key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]} dot={false}
                // Same reasoning as Bar/Pie — a tile can refetch on every filter change, and
                // re-animating the line in on each refresh reads as flicker, not motion.
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
        {data.truncated && (
          <p className="text-xs text-muted-foreground">
            Showing first {data.rows.length} row{data.rows.length === 1 ? '' : 's'} — results truncated.
          </p>
        )}
      </div>
    );
  }

  const points = toPoints(data, c.dateField, valueColumn);
  return (
    <div className="flex h-full flex-col gap-1">
      <ChartContainer config={{ value: { label: c.metric, color: COLORS[0] } }} className="h-full w-full">
        <LineChart data={points}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line type="monotone" dataKey="value" stroke={COLORS[0]} dot={false} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
      {data.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing first {points.length} point{points.length === 1 ? '' : 's'} — results truncated.
        </p>
      )}
    </div>
  );
}
