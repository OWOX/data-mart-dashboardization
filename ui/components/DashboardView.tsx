import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteDashboard, duplicateDashboard, getDashboard, saveDashboard } from '../lib/dashboards';
import { fetchRunSql, getAllFields, getMartFields, queryDataMart } from '../lib/api';
import { compile } from '../lib/compile';
import { useLayerData } from '../lib/freshness';
import { resetFilters, restoreGenerated, setComponentHidden } from '../lib/edit';
import { toggleValue } from '../lib/filterOps';
import { probeCardinality } from '../lib/generate';
import { applySelection } from '../lib/fields';
import { dataMartPath, openHostPage } from '../lib/hostLinks';
import { getPluginContext } from '../lib/plugin-runtime';
import { Grid } from './Grid';
import { ComponentCard } from './ComponentCard';
import { FilterBar } from './FilterBar';
import { renderComponent } from './renderComponent';
import { DashboardMenu } from './DashboardMenu';
import { ComponentMenu } from './ComponentMenu';
import { FieldsPanel } from './FieldsPanel';
import { ComponentEditor } from './editors/ComponentEditor';
import type { Component, Dashboard, FilterRule, MartField } from '../lib/types';

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
  dashboard, component, fields, onEdit, onHide, onSegmentFilter,
}: {
  dashboard: Dashboard; component: Component; fields: MartField[];
  onEdit: (id: string) => void;
  onHide: (id: string) => void;
  onSegmentFilter: (f: FilterRule) => void;
}) {
  const { data, status, error, refresh } = useComponentData(dashboard, component);
  // The run id travels with the data, so "Copy SQL" costs a request only when it is clicked.
  const copySql = async () => {
    const sql = data?.runId ? await fetchRunSql(dashboard.$entity.id, data.runId) : null;
    await navigator.clipboard?.writeText(sql ?? '').catch(() => undefined);
  };
  return (
    <ComponentCard
      title={component.title} status={status} error={error} onRefresh={refresh}
      actions={
        <ComponentMenu
          title={component.title}
          onConfigure={() => onEdit(component.id)}
          onRefresh={refresh}
          onCopySql={() => void copySql()}
          onHide={() => onHide(component.id)}
        />
      }
    >
      {renderComponent(component, data, dashboard.filters, onSegmentFilter, fields)}
    </ComponentCard>
  );
}

/** Loads the dashboard doc, owns global filter state, and renders the grid inside the mandatory page chrome. */
export function DashboardView() {
  const { id } = useParams<{ id: string }>();
  // undefined = still loading, null = not found — kept distinct so the two states read differently.
  const [dashboard, setDashboard] = useState<Dashboard | null | undefined>(undefined);
  // The mart's schema, fetched once per dashboard — needed by ComponentEditor (aggregation
  // choices restricted to each field's `allowedAggregations`), by the ⋯ menu's Fields picker and
  // date-range controls, and by "Restore layout".
  const [fields, setFields] = useState<MartField[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'fields' | 'slicers' | null>(null);
  const [editingLayout, setEditingLayout] = useState(false);
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
  // "Refresh" re-runs every component's query without changing the document. It rides the same
  // synthetic-version channel as cross-filters: `useLayerData` refetches when its key changes, and
  // the key is `effectiveDashboard.configVersion`.
  const [refreshVersion, setRefreshVersion] = useState(0);
  // Cardinality from the last probe, so a dimension ticked in the Fields menu can choose pie vs bar
  // the same way the generator did instead of re-probing on every click.
  const [cardinality, setCardinality] = useState<Record<string, number>>({});
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    setDashboard(undefined);
    setFields([]);
    setCrossFilters([]);
    setCrossFilterVersion(0);
    void getDashboard(id).then(d => {
      setDashboard(d);
      if (d) void getAllFields(d.$entity.id).then(setFields).catch(() => setFields([]));
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
    configVersion: dashboard.configVersion + crossFilterVersion + refreshVersion,
  };

  // A filter change bumps configVersion, which refetches EVERY component. Filters are global.
  const applyFilters = (filters: FilterRule[], slices: FilterRule[]) => {
    setDashboard(d => (d ? { ...d, filters, slices, configVersion: d.configVersion + 1 } : d));
  };

  /**
   * Cross-filtering (Task 16; ephemeral as of Task 20/M7; multi-select since `in` became supported):
   * a click/keypress on a bar/pie segment reports `{ column, value }` here and toggles that value
   * within the column's selection — clicking a second segment WIDENS the filter to `in (a, b)`
   * rather than replacing the first, and clicking an active one removes just that value (back to
   * `eq`, then to no rule at all). `toggleValue` owns every one of those transitions, including
   * never emitting the `in []` the endpoint rejects.
   *
   * It operates on `crossFilters` — NOT `dashboard` — so a cross-filter click can never be picked
   * up by `saveDashboard(dashboard)`. `crossFilterVersion` is bumped alongside so
   * `effectiveDashboard.configVersion` changes and every component's `useLayerData` refetches.
   */
  const onSegmentFilter = (f: FilterRule) => {
    setCrossFilters(prev => toggleValue(prev, f.column, f.value));
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

  /** Fields menu: one settled selection becomes one document edit, hence one refetch wave. */
  const applyFieldSelection = (selected: Set<string>) => {
    setDashboard(d => (d ? applySelection(d, selected, fields, cardinality) : d));
  };

  const hideComponent = (componentId: string) => {
    setDashboard(d => (d ? setComponentHidden(d, componentId, true) : d));
  };

  const duplicate = async () => {
    if (!dashboard) return;
    const copy = await duplicateDashboard(dashboard);
    navigate(`/d/${copy.id}`);
  };

  const remove = async () => {
    if (!dashboard) return;
    await deleteDashboard(dashboard.id);
    navigate('/');
  };

  const openDataMart = async () => {
    if (!dashboard) return;
    const ctx = await getPluginContext();
    await openHostPage(dataMartPath(ctx.projectId, dashboard.$entity.id));
  };

  /** Step 5: re-runs `generate()` for this dashboard's mart, keeping its `id`/`name`/`$entity`. */
  const restore = async () => {
    if (!dashboard) return;
    setRestoring(true);
    try {
      const freshFields = await getMartFields(dashboard.$entity.id);
      const dims = freshFields.filter(f => f.role === 'dimension' && !isDateField(f));
      const probed = await probeCardinality(dashboard.$entity.id, dims);
      setFields(freshFields);
      setCardinality(probed);
      setDashboard(restoreGenerated(dashboard, freshFields, probed));
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
      <header className="dm-page-header flex items-start justify-between gap-2">
        <h1 className="dm-page-header-title">{dashboard.name}</h1>
        <DashboardMenu
          dashboard={dashboard}
          busy={restoring}
          onOpenFields={() => setPanel('fields')}
          onOpenSlicers={() => setPanel('slicers')}
          onRefresh={() => setRefreshVersion(v => v + 1)}
          onDuplicate={() => void duplicate()}
          onRestoreLayout={() => void restore()}
          onEditLayout={() => setEditingLayout(e => !e)}
          onDelete={() => void remove()}
          onOpenDataMart={() => void openDataMart()}
        />
      </header>
      <div className="dm-page-content space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterBar
            dashboard={dashboard} fields={fields} filters={effectiveDashboard.filters}
            onChange={applyFilters} onResetAll={resetAllFilters}
          />
        </div>
        <Grid dashboard={{ ...effectiveDashboard, components: effectiveDashboard.components.filter(c => !c.hidden) }}>
          {c => (
            <Cell
              key={c.id} dashboard={effectiveDashboard} component={c} fields={fields}
              onEdit={setEditingId} onHide={hideComponent}
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
      {panel === 'fields' && (
        <FieldsPanel
          dashboard={dashboard} fields={fields}
          onApply={applyFieldSelection} onClose={() => setPanel(null)}
        />
      )}
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
