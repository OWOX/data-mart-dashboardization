import { Cell, Pie, PieChart } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { aggLabel } from '../lib/compile';
import { toPoints } from '../lib/rows';
import type { Component, FilterRule, PieConfig, QueryResult } from '../lib/types';

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

/**
 * Covers both `pie` and `donut` — `donut` just sets `innerRadius`. Slice angles are recharts'
 * own computation from the raw `value`s (rendering, not a client-side aggregate); the percentage
 * shown in the tooltip is recharts deriving a ratio for display, never a client-computed sum. The
 * metric lookup key MUST be `aggLabel(c.metric, c.aggregation)` — see `compile.ts`. `maxCategories`
 * (server-side top-N via `sortConfig` + `limit` in `compile()`) already capped slice count; a
 * category count beyond the 5-color palette still cycles it rather than crashing.
 */
export function PieChartView({
  component, data, onSegmentFilter,
}: {
  component: Component; data: QueryResult | null;
  onSegmentFilter?: (f: FilterRule) => void;
}) {
  const c = component.config as PieConfig;
  if (!data) return null;
  const points = toPoints(data, c.dimension, aggLabel(c.metric, c.aggregation));
  const donut = component.type === 'donut';

  return (
    <div className="flex h-full flex-col gap-1">
      <ChartContainer config={{ value: { label: c.metric, color: COLORS[0] } }} className="h-full w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
          <Pie
            data={points}
            dataKey="value"
            nameKey="label"
            innerRadius={donut ? '55%' : 0}
            outerRadius="80%"
            // Same reasoning as Bar/Line — a tile can refetch on every filter change, and
            // re-animating slices in from zero on each refresh reads as flicker, not motion.
            isAnimationActive={false}
            onClick={(p: { label?: string }) =>
              p?.label !== undefined && onSegmentFilter?.({ column: c.dimension, operator: 'eq', value: p.label })}
          >
            {points.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
        </PieChart>
      </ChartContainer>
      {data.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing first {points.length} of possibly more — results truncated.
        </p>
      )}
    </div>
  );
}
