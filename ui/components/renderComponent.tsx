import type { ReactNode } from 'react';
import type { Component, QueryResult } from '../lib/types';
import { Scorecard } from './Scorecard';
import { DataTable } from './DataTable';
import { TimeSeriesChart } from './TimeSeriesChart';
import { BarChartView } from './BarChartView';
import { PieChartView } from './PieChartView';

/**
 * Single dispatch point from a component's `type` to its renderer. `DashboardView` calls this
 * once per grid cell — every renderer takes the same `(component, data)` shape so this switch is
 * the only place that needs to know the full `ComponentType` union.
 */
export function renderComponent(component: Component, data: QueryResult | null): ReactNode {
  switch (component.type) {
    case 'scorecard': return <Scorecard component={component} data={data} />;
    case 'table': return <DataTable component={component} data={data} />;
    case 'timeseries': return <TimeSeriesChart component={component} data={data} />;
    case 'bar': return <BarChartView component={component} data={data} />;
    case 'pie':
    case 'donut': return <PieChartView component={component} data={data} />;
    default: {
      // Unreachable for a well-formed doc; a corrupt one must fail loudly rather than silently
      // render nothing where a tile was expected — mirrors `compile()`'s exhaustiveness guard.
      const unknown: never = component.type;
      throw new Error(`renderComponent: unsupported component type "${String(unknown)}"`);
    }
  }
}
