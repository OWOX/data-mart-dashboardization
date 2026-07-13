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
 *
 * Cross-filtering (Task 16): clicking a bar reports `{ column: c.dimension, operator: 'eq', value:
 * <the clicked category> }` up to `onSegmentFilter` — `DashboardView` decides add-vs-toggle-off and
 * pushes it into `compile(component, filters, slices)` for a SERVER-side refetch of every tile.
 * Nothing here filters, sorts or re-aggregates `points` — nothing CAN, without recomputing an
 * aggregate from an already-aggregated top-N subset, which is exactly what this plugin forbids.
 *
 * A11Y: recharts' bar shapes are plain SVG `<path>`s with no native keyboard semantics, and — more
 * importantly — hand-rolling `tabIndex`/`onKeyDown` per bar is fragile (recharts' sibling `Pie`
 * hard-codes `tabIndex: -1` on every sector internally and manages its own focus via arrow keys, so
 * the "same trick" silently does nothing there; see `PieChartView`). Instead, every category also
 * gets a REAL `<button>` "chip" below the chart: natively Tab-reachable, natively announces
 * role=button, and `aria-pressed` conveys the active-filter state to assistive tech without relying
 * on any chart library's internal focus model. The active segment is additionally marked on the
 * chart itself with a stroke ring (never color alone) and its siblings are dimmed once a filter is
 * active on this dimension, so a sighted mouse user gets the same non-color cue.
 */
export function BarChartView({
  component, data, filters = [], onSegmentFilter,
}: {
  component: Component; data: QueryResult | null;
  filters?: FilterRule[];
  onSegmentFilter?: (f: FilterRule) => void;
}) {
  const c = component.config as BarConfig;
  if (!data) return null;
  const points = toPoints(data, c.dimension, aggLabel(c.metric, c.aggregation));
  const horizontal = c.orientation === 'horizontal';

  const activeFilter = filters.find(f => f.column === c.dimension && f.operator === 'eq');
  const activeValue = activeFilter ? String(activeFilter.value) : undefined;

  const emit = (label: string) => onSegmentFilter?.({ column: c.dimension, operator: 'eq', value: label });

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
          </Bar>
        </BarChart>
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
