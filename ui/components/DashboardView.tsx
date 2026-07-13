import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getDashboard, saveDashboard } from '../lib/dashboards';
import { queryDataMart, getMartFields } from '../lib/api';
import { compile } from '../lib/compile';
import { useLayerData } from '../lib/freshness';
import { addComponent, addGlobalFilter, removeGlobalFilter, resetFilters, restoreGenerated } from '../lib/edit';
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
 * are global, there are no per-component overrides. `DashboardView` always passes `effectiveDashboard`
 * here (persisted filters merged with any ephemeral cross-filter, see Task 20/M7) — this hook itself
 * is agnostic to that split, it just reads whatever `Dashboard`-shaped object it's given.
 */
export function useComponentData(dashboard: Dashboard, component: Component) {
  const fetcher = useCallback(
    () => queryDataMart(dashboard.$entity.id, compile(component, dashboard.filters, dashboard.slices)),
    [dashboard, component],
  );
  return useLayerData(dashboard.configVersion, true, fetcher);
}

function Cell({
  dashboard, component, onEdit, onSegmentFilter,
}: {
  dashboard: Dashboard; component: Component; onEdit: (id: string) => void;
  onSegmentFilter: (f: FilterRule) => void;
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
      {renderComponent(component, data, dashboard.filters, onSegmentFilter)}
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
  // Cross-filter clicks (Task 20/M7): EPHEMERAL view-state, deliberately kept OUT of `dashboard`
  // so `saveDashboard(dashboard)` (the Save button, below) can never persist an ad-hoc slice a
  // viewer only clicked to explore. Reset alongside `dashboard` on every `id` change so a fresh
  // mount/navigation — a "reload" — never carries a stale cross-filter into the new session.
  const [crossFilters, setCrossFilters] = useState<FilterRule[]>([]);
  // A synthetic refetch-trigger: `dashboard.configVersion` no longer changes when a cross-filter
  // is toggled (it never touches `dashboard` at all), so this stands in for it inside
  // `effectiveDashboard.configVersion` below. Never written back anywhere else.
  const [crossFilterVersion, setCrossFilterVersion] = useState(0);

  useEffect(() => {
    if (!id) return;
    setDashboard(undefined);
    setFields([]);
    setCrossFilters([]);
    setCrossFilterVersion(0);
    void getDashboard(id).then(d => {
      setDashboard(d);
      if (d) void getMartFields(d.$entity.id).then(setFields).catch(() => setFields([]));
    });
  }, [id]);

  /**
   * Query/render-only merged view: persisted `dashboard.filters` plus any active ephemeral
   * cross-filters (cross-filter wins by column, mirroring `addGlobalFilter`'s replace-not-stack
   * semantics), with a synthetic `configVersion` that changes whenever EITHER half changes. Never
   * used for Save, `ComponentEditor`, or any other edit/persist path — see usages below.
   */
  const effectiveDashboard: Dashboard | null | undefined = dashboard && {
    ...dashboard,
    filters: [
      ...dashboard.filters.filter(f => !crossFilters.some(cf => cf.column === f.column)),
      ...crossFilters,
    ],
    configVersion: dashboard.configVersion + crossFilterVersion,
  };

  // A filter change bumps configVersion, which refetches EVERY component. Filters are global.
  const applyFilters = (filters: FilterRule[], slices: FilterRule[]) => {
    setDashboard(d => (d ? { ...d, filters, slices, configVersion: d.configVersion + 1 } : d));
  };

  /**
   * Cross-filtering (Task 16; ephemeral as of Task 20/M7): a click/keypress on a bar/pie segment
   * reports `{ column, operator: 'eq', value }` here. Clicking the SAME already-active segment
   * again is a toggle-off (removes the filter) rather than a no-op re-apply — matched by column,
   * operator AND value so a different value on the same column always REPLACES, never toggles off,
   * the existing one. Either branch goes through the now-array-level `addGlobalFilter`/
   * `removeGlobalFilter` from `ui/lib/edit.ts`, operating on `crossFilters` — NOT `dashboard` —
   * so a cross-filter click can never be picked up by `saveDashboard(dashboard)`.
   * `crossFilterVersion` is bumped alongside so `effectiveDashboard.configVersion` changes and
   * every component's `useLayerData` key changes with it, triggering the real refetch.
   */
  const onSegmentFilter = (f: FilterRule) => {
    setCrossFilters(prev => {
      const existing = prev.find(x => x.column === f.column);
      const isToggleOff =
        existing !== undefined && existing.operator === f.operator
        && JSON.stringify(existing.value) === JSON.stringify(f.value);
      return isToggleOff ? removeGlobalFilter(prev, f.column) : addGlobalFilter(prev, f);
    });
    setCrossFilterVersion(v => v + 1);
  };

  /** "Reset filters" clears BOTH halves: the persisted `dashboard.filters` (via `resetFilters`,
   * unchanged) AND the ephemeral `crossFilters` — the FilterBar shows one merged view, so its
   * single Reset button must clear whichever combination of the two is actually active. */
  const resetAllFilters = () => {
    setCrossFilters([]);
    setCrossFilterVersion(v => v + 1);
    setDashboard(d => (d ? resetFilters(d) : d));
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

  // Unreachable given the two guards above (both narrow `dashboard`, which `effectiveDashboard`
  // is always derived from) — narrows `effectiveDashboard` itself for the compiler.
  if (!effectiveDashboard) return null;

  return (
    <div className="dm-page text-foreground">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">{dashboard.name}</h1>
      </header>
      <div className="dm-page-content space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterBar
            dashboard={dashboard} filters={effectiveDashboard.filters}
            onChange={applyFilters} onResetAll={resetAllFilters}
          />
          <div className="flex gap-2">
            <AddComponentButton onAdd={addNewComponent} />
            <button className="rounded border px-3 py-1.5 text-sm" disabled={restoring} onClick={() => void restore()}>
              {restoring ? 'Restoring…' : 'Restore generated layout'}
            </button>
          </div>
        </div>
        <Grid dashboard={effectiveDashboard}>
          {c => (
            <Cell
              key={c.id} dashboard={effectiveDashboard} component={c} onEdit={setEditingId}
              onSegmentFilter={onSegmentFilter}
            />
          )}
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
