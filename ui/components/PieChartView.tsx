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
 *
 * Cross-filtering (Task 16): same contract as `BarChartView` — clicking a slice reports
 * `{ column: c.dimension, operator: 'eq', value: <clicked category> }` up to `onSegmentFilter`;
 * `DashboardView` decides add-vs-toggle-off and pushes it into `compile()` for a SERVER-side
 * refetch. No slice is ever re-derived client-side from an already-fetched result.
 *
 * A11Y: recharts' `Pie` hard-codes `tabIndex: -1` on every rendered sector (verified against the
 * installed `recharts` — see `renderSectorsStatically` in `polar/Pie.js`) and manages focus itself
 * via its own Left/Right-arrow navigation between slices; a per-slice `tabIndex`/`onKeyDown` set
 * through `<Cell>` is silently overridden and never fires. Rather than fight (and become fragile
 * against) that internal model, every category also gets a REAL `<button>` "chip" below the chart —
 * natively Tab-reachable and announced by any screen reader, with `aria-pressed` conveying the
 * active-filter state. The active slice is additionally marked on the chart itself with a stroke
 * ring (never color alone) and its siblings are dimmed once a filter is active on this dimension.
 */
export function PieChartView({
  component, data, filters = [], onSegmentFilter,
}: {
  component: Component; data: QueryResult | null;
  filters?: FilterRule[];
  onSegmentFilter?: (f: FilterRule) => void;
}) {
  const c = component.config as PieConfig;
  if (!data) return null;
  const points = toPoints(data, c.dimension, aggLabel(c.metric, c.aggregation));
  const donut = component.type === 'donut';

  const activeFilter = filters.find(f => f.column === c.dimension && f.operator === 'eq');
  const activeValue = activeFilter ? String(activeFilter.value) : undefined;

  const emit = (label: string) => onSegmentFilter?.({ column: c.dimension, operator: 'eq', value: label });

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
            onClick={(p: { label?: string }) => p?.label !== undefined && emit(p.label)}
          >
            {points.map((p, i) => {
              const isActive = activeValue !== undefined && activeValue === p.label;
              return (
                <Cell
                  key={i}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={activeValue !== undefined && !isActive ? 0.4 : 1}
                  stroke={isActive ? 'var(--foreground)' : undefined}
                  strokeWidth={isActive ? 2 : undefined}
                  style={{ cursor: onSegmentFilter ? 'pointer' : undefined }}
                />
              );
            })}
          </Pie>
        </PieChart>
      </ChartContainer>
      {onSegmentFilter && points.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Filter by ${c.dimension}`}>
          <span className="text-xs text-muted-foreground">Filter by {c.dimension}:</span>
          {points.map(p => {
            const isActive = activeValue !== undefined && activeValue === p.label;
            return (
              <button
                key={p.label}
                type="button"
                className={`rounded border px-2 py-0.5 text-xs ${isActive ? 'border-foreground font-semibold underline' : ''}`}
                aria-pressed={isActive}
                onClick={() => emit(p.label)}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
      {data.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing first {points.length} of possibly more — results truncated.
        </p>
      )}
    </div>
  );
}
