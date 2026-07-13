import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getDashboard, saveDashboard } from '../lib/dashboards';
import { queryDataMart, getMartFields } from '../lib/api';
import { compile } from '../lib/compile';
import { useLayerData } from '../lib/freshness';
import { addComponent, restoreGenerated } from '../lib/edit';
import { probeCardinality } from '../lib/generate';
import { Grid } from './Grid';
import { ComponentCard } from './ComponentCard';
import { FilterBar } from './FilterBar';
import { renderComponent } from './renderComponent';
import { AddComponentButton } from './editors/AddComponentButton';
import { ComponentEditor } from './editors/ComponentEditor';
import type { Component, ComponentType, Dashboard, FilterRule, MartField } from '../lib/types';

const isDateField = (f: MartField) => /^(DATE|DATETIME|TIMESTAMP)$/i.test(f.type);

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

function Cell({
  dashboard, component, onEdit,
}: {
  dashboard: Dashboard; component: Component; onEdit: (id: string) => void;
}) {
  const { data, status, error, refresh } = useComponentData(dashboard, component);
  return (
    <ComponentCard
      title={component.title} status={status} error={error} onRefresh={refresh}
      actions={
        <button
          type="button"
          className="rounded px-1.5 text-sm text-muted-foreground hover:bg-black/5"
          aria-label={`Edit ${component.title}`}
          onClick={() => onEdit(component.id)}
        >
          ⋯
        </button>
      }
    >
      {renderComponent(component, data)}
    </ComponentCard>
  );
}

/** Loads the dashboard doc, owns global filter state, and renders the grid inside the mandatory page chrome. */
export function DashboardView() {
  const { id } = useParams<{ id: string }>();
  // undefined = still loading, null = not found — kept distinct so the two states read differently.
  const [dashboard, setDashboard] = useState<Dashboard | null | undefined>(undefined);
  // The mart's schema, fetched once per dashboard — needed by ComponentEditor (aggregation
  // choices restricted to each field's `allowedAggregations`) and by "Restore generated layout".
  const [fields, setFields] = useState<MartField[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!id) return;
    setDashboard(undefined);
    setFields([]);
    void getDashboard(id).then(d => {
      setDashboard(d);
      if (d) void getMartFields(d.$entity.id).then(setFields).catch(() => setFields([]));
    });
  }, [id]);

  // A filter change bumps configVersion, which refetches EVERY component. Filters are global.
  const applyFilters = (filters: FilterRule[], slices: FilterRule[]) => {
    setDashboard(d => (d ? { ...d, filters, slices, configVersion: d.configVersion + 1 } : d));
  };

  const addNewComponent = (type: ComponentType) => {
    setDashboard(d => (d ? addComponent(d, type) : d));
  };

  /** Step 5: re-runs `generate()` for this dashboard's mart, keeping its `id`/`name`/`$entity`. */
  const restore = async () => {
    if (!dashboard) return;
    setRestoring(true);
    try {
      const freshFields = await getMartFields(dashboard.$entity.id);
      const dims = freshFields.filter(f => f.role === 'dimension' && !isDateField(f));
      const cardinality = await probeCardinality(dashboard.$entity.id, dims);
      setFields(freshFields);
      setDashboard(restoreGenerated(dashboard, freshFields, cardinality));
    } finally {
      setRestoring(false);
    }
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterBar dashboard={dashboard} onChange={applyFilters} />
          <div className="flex gap-2">
            <AddComponentButton onAdd={addNewComponent} />
            <button className="rounded border px-3 py-1.5 text-sm" disabled={restoring} onClick={() => void restore()}>
              {restoring ? 'Restoring…' : 'Restore generated layout'}
            </button>
          </div>
        </div>
        <Grid dashboard={dashboard}>
          {c => <Cell key={c.id} dashboard={dashboard} component={c} onEdit={setEditingId} />}
        </Grid>
        <button
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => void saveDashboard(dashboard).then(setDashboard)}
        >
          Save
        </button>
      </div>
      {editingId && (
        <ComponentEditor
          dashboard={dashboard}
          componentId={editingId}
          fields={fields}
          onChange={setDashboard}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
