import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { aggLabel } from '../lib/compile';
import { toPoints } from '../lib/rows';
import type { BarConfig, Component, FilterRule, QueryResult } from '../lib/types';

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

/**
 * Renders `data` as bars, one per server row — `toPoints` only remaps columns, the server already
 * grouped/aggregated/ordered/limited via `compile()`'s `sortConfig` + `limit` (Top N). The metric
 * lookup key MUST be `aggLabel(c.metric, c.aggregation)`, never a hand-rolled string — see
 * `compile.ts`'s docstring on why a wrong key silently blanks the chart instead of throwing.
 * A category count beyond the 5-color palette cycles it (`i % COLORS.length`) rather than crashing
 * or running out of colors.
 */
export function BarChartView({
  component, data, onSegmentFilter,
}: {
  component: Component; data: QueryResult | null;
  onSegmentFilter?: (f: FilterRule) => void;
}) {
  const c = component.config as BarConfig;
  if (!data) return null;
  const points = toPoints(data, c.dimension, aggLabel(c.metric, c.aggregation));
  const horizontal = c.orientation === 'horizontal';

  return (
    <div className="flex h-full flex-col gap-1">
      <ChartContainer config={{ value: { label: c.metric, color: COLORS[0] } }} className="h-full w-full">
        <BarChart data={points} layout={horizontal ? 'vertical' : 'horizontal'}>
          <CartesianGrid strokeDasharray="3 3" />
          {horizontal
            ? (<><XAxis type="number" /><YAxis type="category" dataKey="label" width={90} /></>)
            : (<><XAxis dataKey="label" /><YAxis /></>)}
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar
            dataKey="value"
            // A dashboard tile can refetch on every filter change (`ComponentCard`'s preload
            // states) — animating the bars in from zero on each refresh reads as flicker, not
            // motion, so keep it off.
            isAnimationActive={false}
            onClick={(p: { label?: string }) =>
              p?.label !== undefined && onSegmentFilter?.({ column: c.dimension, operator: 'eq', value: p.label })}
          >
            {points.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
      {data.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing first {points.length} of possibly more — results truncated.
        </p>
      )}
    </div>
  );
}
