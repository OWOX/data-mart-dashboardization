import type { ReactNode } from 'react';
import type { Component, FilterRule, QueryResult } from '../lib/types';
import { Scorecard } from './Scorecard';
import { DataTable } from './DataTable';
import { TimeSeriesChart } from './TimeSeriesChart';
import { BarChartView } from './BarChartView';
import { PieChartView } from './PieChartView';

/**
 * Single dispatch point from a component's `type` to its renderer. `DashboardView` calls this
 * once per grid cell — every renderer takes the same `(component, data)` shape so this switch is
 * the only place that needs to know the full `ComponentType` union.
 *
 * `filters` (the dashboard's current GLOBAL filters, cross-filters included) and `onSegmentFilter`
 * are only meaningful for Bar/Pie/Donut — the two renderers with a clickable, single-value
 * dimension segment. `filters` lets each of them find whether ITS OWN dimension currently has an
 * active cross-filter, so the matching segment can be highlighted (not by color alone — see
 * `BarChartView`/`PieChartView`); `onSegmentFilter` is how a click/keypress on a segment reports
 * `{ column, operator: 'eq', value }` back up to `DashboardView`, which decides add-vs-remove
 * (toggle) and applies it via `ui/lib/edit.ts`'s `addGlobalFilter`/`removeGlobalFilter`. Scorecard/
 * Table/TimeSeries ignore both — a scorecard has no segment to click, a table row is presentation
 * only (Task 13), and a trend line has no obvious single-value target (see TimeSeriesChart's
 * docstring).
 */
export function renderComponent(
  component: Component,
  data: QueryResult | null,
  filters: FilterRule[],
  onSegmentFilter: (f: FilterRule) => void,
): ReactNode {
  switch (component.type) {
    case 'scorecard': return <Scorecard component={component} data={data} />;
    case 'table': return <DataTable component={component} data={data} />;
    case 'timeseries': return <TimeSeriesChart component={component} data={data} />;
    case 'bar':
      return <BarChartView component={component} data={data} filters={filters} onSegmentFilter={onSegmentFilter} />;
    case 'pie':
    case 'donut':
      return <PieChartView component={component} data={data} filters={filters} onSegmentFilter={onSegmentFilter} />;
    default: {
      // Unreachable for a well-formed doc; a corrupt one must fail loudly rather than silently
      // render nothing where a tile was expected — mirrors `compile()`'s exhaustiveness guard.
      const unknown: never = component.type;
      throw new Error(`renderComponent: unsupported component type "${String(unknown)}"`);
    }
  }
}
