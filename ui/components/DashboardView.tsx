import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getDashboard, saveDashboard } from '../lib/dashboards';
import { queryDataMart } from '../lib/api';
import { compile } from '../lib/compile';
import { useLayerData } from '../lib/freshness';
import { Grid } from './Grid';
import { ComponentCard } from './ComponentCard';
import { FilterBar } from './FilterBar';
import type { Component, Dashboard, FilterRule, QueryResult } from '../lib/types';

/**
 * One component = one server-side query. Refetch is keyed on the doc's `configVersion` (bumped by
 * every filter change and every save), so a filter edit refetches EVERY component's data — filters
 * are global, there are no per-component overrides.
 */
export function useComponentData(dashboard: Dashboard, component: Component) {
  const fetcher = useCallback(
    () => queryDataMart(dashboard.$entity.id, compile(component, dashboard.filters, dashboard.slices)),
    [dashboard, component],
  );
  return useLayerData(dashboard.configVersion, true, fetcher);
}

/**
 * Placeholder body for a component's data. Task 13 (`renderComponent`) replaces this with the
 * real scorecard/chart/table renderers; this task only owns the frame they render inside. Still
 * surfaces the server's `truncated` flag per spec — that must never be silently dropped, even by
 * a placeholder.
 */
function ComponentBody({ component, data }: { component: Component; data: QueryResult | null }) {
  if (!data) return <p className="text-xs text-muted-foreground">No data yet.</p>;
  return (
    <div className="text-xs text-muted-foreground">
      <p>{component.type}</p>
      <p>
        {data.rows.length} row{data.rows.length === 1 ? '' : 's'}
        {data.truncated && <span> · truncated</span>}
      </p>
    </div>
  );
}

function Cell({ dashboard, component }: { dashboard: Dashboard; component: Component }) {
  const { data, status, error, refresh } = useComponentData(dashboard, component);
  return (
    <ComponentCard title={component.title} status={status} error={error} onRefresh={refresh}>
      <ComponentBody component={component} data={data} />
    </ComponentCard>
  );
}

/** Loads the dashboard doc, owns global filter state, and renders the grid inside the mandatory page chrome. */
export function DashboardView() {
  const { id } = useParams<{ id: string }>();
  // undefined = still loading, null = not found — kept distinct so the two states read differently.
  const [dashboard, setDashboard] = useState<Dashboard | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    setDashboard(undefined);
    void getDashboard(id).then(setDashboard);
  }, [id]);

  // A filter change bumps configVersion, which refetches EVERY component. Filters are global.
  const applyFilters = (filters: FilterRule[], slices: FilterRule[]) => {
    setDashboard(d => (d ? { ...d, filters, slices, configVersion: d.configVersion + 1 } : d));
  };

  if (dashboard === undefined) {
    return (
      <div className="dm-page text-foreground">
        <header className="dm-page-header">
          <h1 className="dm-page-header-title">Dashboard</h1>
        </header>
        <div className="dm-page-content">
          <div className="dm-card p-6 text-sm">Loading…</div>
        </div>
      </div>
    );
  }

  if (dashboard === null) {
    return (
      <div className="dm-page text-foreground">
        <header className="dm-page-header">
          <h1 className="dm-page-header-title">Dashboard</h1>
        </header>
        <div className="dm-page-content">
          <div className="dm-card p-6 text-sm">Dashboard not found.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dm-page text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">{dashboard.name}</h1>
      </header>
      <div className="dm-page-content space-y-4">
        <FilterBar dashboard={dashboard} onChange={applyFilters} />
        <Grid dashboard={dashboard}>
          {c => <Cell key={c.id} dashboard={dashboard} component={c} />}
        </Grid>
        <button
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => void saveDashboard(dashboard).then(setDashboard)}
        >
          Save
        </button>
      </div>
    </div>
  );
}
