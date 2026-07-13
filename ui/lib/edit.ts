import { generate, PIE_MAX_CATEGORIES } from './generate';
import type {
  AggregateFunction, BarConfig, Component, ComponentConfig, ComponentType, Dashboard,
  FilterRule, MartField, PieConfig, ScorecardConfig, TableConfig, TimeSeriesConfig,
} from './types';

const uid = () => crypto.randomUUID();

/**
 * Default footprint per type (Step 3 of the brief), clamped to the dashboard's actual
 * `gridColumns` so a narrower grid never gets an out-of-range default width.
 */
const DEFAULT_SIZE: Record<ComponentType, { width: number; height: number }> = {
  scorecard: { width: 1, height: 1 },
  bar: { width: 3, height: 2 },
  pie: { width: 2, height: 2 },
  donut: { width: 2, height: 2 },
  timeseries: { width: 5, height: 2 },
  table: { width: 5, height: 3 },
};

const DEFAULT_TITLE: Record<ComponentType, string> = {
  scorecard: 'New scorecard',
  timeseries: 'New time series',
  bar: 'New bar chart',
  pie: 'New pie chart',
  donut: 'New donut chart',
  table: 'New table',
};

/**
 * A non-finite `width`/`height` (e.g. `Number('')` from a cleared editor input) would otherwise
 * poison every `Math.max`/`Math.min` call with `NaN` — same defensive spirit as `compile.ts`'s
 * `clamp()`. Falls back to the minimum (1) rather than silently propagating `NaN` into the doc.
 */
const clampWidth = (width: number, gridColumns: number): number => {
  const cols = Math.max(1, Math.trunc(gridColumns));
  if (!Number.isFinite(width)) return 1;
  return Math.min(Math.max(1, Math.trunc(width)), cols);
};
const clampHeight = (height: number): number => (Number.isFinite(height) ? Math.max(1, Math.trunc(height)) : 1);

// ---------- Config-shape extraction, used by addComponent/retypeComponent to build a valid
// config for a target type without any field-schema access (neither function receives `fields`
// per the brief's interface). Values are borrowed from the source component being retyped (if
// any) and, failing that, from any OTHER component already on the dashboard — so a dashboard
// that already has real field names (the common case: everything starts from `generate()`)
// produces a genuinely queryable config on retype/add, not just a structurally-shaped one. ----------

function getMetric(c: Component): string {
  switch (c.type) {
    case 'scorecard': return (c.config as ScorecardConfig).metric;
    case 'timeseries': return (c.config as TimeSeriesConfig).metric;
    case 'bar': return (c.config as BarConfig).metric;
    case 'pie':
    case 'donut': return (c.config as PieConfig).metric;
    case 'table': return (c.config as TableConfig).columns[0] ?? '';
    default: return '';
  }
}

function getDimension(c: Component): string {
  switch (c.type) {
    case 'bar': return (c.config as BarConfig).dimension;
    case 'pie':
    case 'donut': return (c.config as PieConfig).dimension;
    case 'timeseries': return (c.config as TimeSeriesConfig).dateField;
    case 'table': {
      const cols = (c.config as TableConfig).columns;
      const metric = getMetric(c);
      return cols.find(col => col !== metric) ?? cols[0] ?? '';
    }
    default: return '';
  }
}

function getAggregation(c: Component): AggregateFunction | undefined {
  switch (c.type) {
    case 'scorecard': return (c.config as ScorecardConfig).aggregation;
    case 'timeseries': return (c.config as TimeSeriesConfig).aggregation;
    case 'bar': return (c.config as BarConfig).aggregation;
    case 'pie':
    case 'donut': return (c.config as PieConfig).aggregation;
    default: return undefined;
  }
}

const firstNonEmpty = (values: string[]): string => values.find(v => v) ?? '';

function bestMetric(d: Dashboard, prefer?: Component): string {
  const rest = d.components.filter(c => c.id !== prefer?.id).map(getMetric);
  return firstNonEmpty([...(prefer ? [getMetric(prefer)] : []), ...rest]);
}
function bestDimension(d: Dashboard, prefer?: Component): string {
  const rest = d.components.filter(c => c.id !== prefer?.id).map(getDimension);
  return firstNonEmpty([...(prefer ? [getDimension(prefer)] : []), ...rest]);
}
/**
 * Mirrors `bestMetric`/`bestDimension`: `prefer`'s own aggregation wins if it has one, otherwise
 * scan the REST of the dashboard the same way those two do, rather than stopping at `prefer` alone.
 * `prefer`'s own aggregation is always already valid for whatever field it names — carrying it
 * forward across a retype (e.g. scorecard -> pie) never introduces an aggregation a field doesn't
 * allow, because the field/aggregation pairing itself is unchanged. A borrowed sibling aggregation
 * carries the same caveat `bestMetric`/`bestDimension`'s borrowed values already carry: it is a
 * best-effort default that COULD pair with a metric that disallows it, on the understanding that
 * `ComponentEditor` (which DOES have `MartField.allowedAggregations`) is where the user corrects a
 * governance mismatch this function cannot see. 'COUNT' (mirroring the same last-resort token
 * `generate.ts`'s `pick()` uses) is the true final fallback, reached only when NOTHING on the
 * dashboard — `prefer` included — has an aggregation at all (e.g. every component is a table).
 */
function bestAggregation(d: Dashboard, prefer?: Component): AggregateFunction {
  const rest = d.components.filter(c => c.id !== prefer?.id).map(getAggregation);
  const candidates = [...(prefer ? [getAggregation(prefer)] : []), ...rest];
  return candidates.find((a): a is AggregateFunction => a !== undefined) ?? 'COUNT';
}

/** Builds a config for `type`, borrowing values from `source` (if retyping) and the rest of `d`. */
function buildConfig(type: ComponentType, d: Dashboard, source?: Component): ComponentConfig {
  const metric = bestMetric(d, source);
  const dimension = bestDimension(d, source);
  const aggregation = bestAggregation(d, source);

  switch (type) {
    case 'scorecard':
      return { metric, aggregation };

    case 'timeseries': {
      const dateField = source?.type === 'timeseries' ? (source.config as TimeSeriesConfig).dateField : dimension;
      const unit = source?.type === 'timeseries' ? (source.config as TimeSeriesConfig).unit : 'DAY';
      const breakdown = source?.type === 'timeseries' ? (source.config as TimeSeriesConfig).breakdown : undefined;
      return { dateField, metric, aggregation, unit, ...(breakdown ? { breakdown } : {}) };
    }

    case 'bar': {
      const src = source?.type === 'bar' ? (source.config as BarConfig) : undefined;
      return {
        dimension, metric, aggregation,
        orientation: src?.orientation ?? 'vertical',
        limit: src?.limit ?? 10,
        sort: src?.sort ?? 'desc',
      };
    }

    case 'pie':
    case 'donut': {
      const src = source && (source.type === 'pie' || source.type === 'donut')
        ? (source.config as PieConfig) : undefined;
      return { dimension, metric, aggregation, maxCategories: src?.maxCategories ?? PIE_MAX_CATEGORIES };
    }

    case 'table': {
      if (source?.type === 'table') return { ...(source.config as TableConfig) };
      const columns = [...new Set([dimension, metric].filter(Boolean))];
      return { columns: columns.length ? columns : [''], limit: 100 };
    }

    default: {
      const unknown: never = type;
      throw new Error(`edit: unsupported component type "${String(unknown)}"`);
    }
  }
}

// ---------- Public transforms — every one clones, never mutates `d` or its nested arrays. ----------

/**
 * Appends a component of `type` at the end, with a sane per-type default size (clamped to the
 * grid) and a best-effort config borrowed from the rest of the dashboard (see `buildConfig`).
 * A brand-new query is being introduced, so this bumps `configVersion`.
 */
export function addComponent(d: Dashboard, type: ComponentType): Dashboard {
  const size = DEFAULT_SIZE[type];
  const component: Component = {
    id: uid(),
    type,
    title: DEFAULT_TITLE[type],
    width: clampWidth(size.width, d.gridColumns),
    height: clampHeight(size.height),
    config: buildConfig(type, d),
  };
  return { ...d, components: [...d.components, component], configVersion: d.configVersion + 1 };
}

/** Drops the target component (including the last remaining one, leaving an empty grid). */
export function removeComponent(d: Dashboard, id: string): Dashboard {
  if (!d.components.some(c => c.id === id)) return d;
  return { ...d, components: d.components.filter(c => c.id !== id), configVersion: d.configVersion + 1 };
}

/** Inserts a deep copy of the target, with a fresh id, immediately after the source. */
export function duplicateComponent(d: Dashboard, id: string): Dashboard {
  const idx = d.components.findIndex(c => c.id === id);
  if (idx === -1) return d;
  const source = d.components[idx];
  const copy: Component = {
    ...source,
    id: uid(),
    title: `${source.title} (copy)`,
    config: JSON.parse(JSON.stringify(source.config)) as ComponentConfig,
  };
  const components = [...d.components.slice(0, idx + 1), copy, ...d.components.slice(idx + 1)];
  return { ...d, components, configVersion: d.configVersion + 1 };
}

/**
 * Swaps the target with its neighbor `delta` slots away (`-1` left, `1` right). A no-op at either
 * edge. Pure reordering — no query changes, so `configVersion` is deliberately NOT bumped.
 */
export function moveComponent(d: Dashboard, id: string, delta: -1 | 1): Dashboard {
  const idx = d.components.findIndex(c => c.id === id);
  if (idx === -1) return d;
  const target = idx + delta;
  if (target < 0 || target >= d.components.length) return d;
  const components = [...d.components];
  [components[idx], components[target]] = [components[target], components[idx]];
  return { ...d, components };
}

/**
 * Clamps `width` to `1..gridColumns` and `height` to `>= 1`. Purely cosmetic — the query is
 * unaffected by a resize, so `configVersion` is deliberately NOT bumped.
 */
export function resizeComponent(d: Dashboard, id: string, width: number, height: number): Dashboard {
  const idx = d.components.findIndex(c => c.id === id);
  if (idx === -1) return d;
  const w = clampWidth(width, d.gridColumns);
  const h = clampHeight(height);
  const components = d.components.map((c, i) => (i === idx ? { ...c, width: w, height: h } : c));
  return { ...d, components };
}

/**
 * Changes a component's `type` and rebuilds its `config` into a shape valid for the NEW type
 * (see `buildConfig`) — never leaves a stale/half-migrated config of the old type's shape behind.
 * Retyping to the SAME type is a no-op. Otherwise this always changes what the server must
 * compute, so it always bumps `configVersion`.
 */
export function retypeComponent(d: Dashboard, id: string, type: ComponentType): Dashboard {
  const idx = d.components.findIndex(c => c.id === id);
  if (idx === -1) return d;
  const source = d.components[idx];
  if (source.type === type) return d;
  const next: Component = { ...source, type, config: buildConfig(type, d, source) };
  const components = d.components.map((c, i) => (i === idx ? next : c));
  return { ...d, components, configVersion: d.configVersion + 1 };
}

/**
 * Per type, exactly the config keys `compile.ts` reads to build the server-side query — see the
 * `case` for each type there. Anything NOT listed here is, by construction, purely cosmetic (e.g.
 * `bar`'s `orientation`: vertical-vs-horizontal is a rendering choice, `compile.ts` never looks at
 * it). `updateComponent` bumps `configVersion` iff a patch changes one of THESE keys — never the
 * whole config object — so a cosmetic-only edit doesn't force a pointless refetch, while every
 * field that actually changes what the server computes still does.
 *
 * If `compile.ts` starts reading a new config field, add it here too, or `configVersion` will
 * silently stop bumping for edits to it and components will render stale data from the old query.
 */
const QUERY_AFFECTING_CONFIG_KEYS: Record<ComponentType, readonly string[]> = {
  scorecard: ['metric', 'aggregation'],
  timeseries: ['dateField', 'metric', 'aggregation', 'unit', 'breakdown'],
  bar: ['dimension', 'metric', 'aggregation', 'limit', 'sort'],
  pie: ['dimension', 'metric', 'aggregation', 'maxCategories'],
  donut: ['dimension', 'metric', 'aggregation', 'maxCategories'],
  table: ['columns', 'sort', 'limit'],
};

/**
 * `true` iff `a` and `b` differ on at least one query-affecting key for `type` (see
 * `QUERY_AFFECTING_CONFIG_KEYS`). Projecting to a fixed key order before stringifying also makes
 * this robust to two configs that are equal but were built with their keys in a different order —
 * unlike a raw `JSON.stringify(a) === JSON.stringify(b)` over the whole object would be.
 */
function queryAffectingConfigChanged(type: ComponentType, a: ComponentConfig, b: ComponentConfig): boolean {
  const keys = QUERY_AFFECTING_CONFIG_KEYS[type];
  const project = (c: ComponentConfig) => {
    const obj = c as unknown as Record<string, unknown>;
    return keys.map(k => obj[k]);
  };
  return JSON.stringify(project(a)) !== JSON.stringify(project(b));
}

/**
 * General-purpose patch, used by `ComponentEditor` for every field it exposes.
 *
 * A `type` change is routed through `retypeComponent` — the same validated `buildConfig()` path
 * `retypeComponent` itself uses — rather than duplicating that logic here. Any `config` supplied
 * in the SAME patch is intentionally dropped in that case: it was shaped for the OLD type and
 * cannot be trusted to be valid for the new one, so honoring it verbatim could leave `type` and
 * `config` disagreeing (a component whose compiled query the server either rejects, or accepts
 * with the wrong meaning). Any other fields in the patch (title, width, ...) are applied on top via
 * a recursive call, once the type/config pair is already consistent.
 *
 * When `type` is unchanged, this is where the configVersion boundary is enforced for arbitrary
 * edits: bump ONLY when the patch changes a QUERY-AFFECTING config key (see
 * `QUERY_AFFECTING_CONFIG_KEYS`) — never for `title`, `description`, `width`, `height`, or a
 * cosmetic config key (e.g. bar's `orientation`) alone.
 */
export function updateComponent(d: Dashboard, id: string, patch: Partial<Component>): Dashboard {
  const idx = d.components.findIndex(c => c.id === id);
  if (idx === -1) return d;
  const target = d.components[idx];

  if (patch.type !== undefined && patch.type !== target.type) {
    const { type: _type, config: _config, ...rest } = patch;
    const retyped = retypeComponent(d, id, patch.type);
    return Object.keys(rest).length > 0 ? updateComponent(retyped, id, rest) : retyped;
  }

  const next: Component = { ...target, ...patch };
  const configChanged = patch.config !== undefined
    && queryAffectingConfigChanged(target.type, target.config, patch.config);

  const components = d.components.map((c, i) => (i === idx ? next : c));
  return { ...d, components, configVersion: configChanged ? d.configVersion + 1 : d.configVersion };
}

/**
 * Re-runs `generate()` for the same mart (fresh fields/cardinality probe), discarding every manual
 * edit, but keeps the dashboard's own `id`, `name` and `$entity` — it replaces the CONTENT of an
 * existing doc, not its identity. A wholesale replacement of every component's query, so this
 * always bumps `configVersion`.
 */
export function restoreGenerated(
  d: Dashboard,
  fields: MartField[],
  cardinality: Record<string, number>,
): Dashboard {
  const fresh = generate(d.$entity.id, d.name, fields, cardinality);
  return { ...fresh, id: d.id, name: d.name, $entity: d.$entity, configVersion: d.configVersion + 1 };
}

// ---------- Cross-filtering (Task 16) ----------
//
// A "slice" (clicking a bar/pie segment) is just another entry in `d.filters` — the SAME global,
// post-join array a manually-added filter would land in (see the `Dashboard.filters` doc in
// types.ts: "GLOBAL — applied to every component. No per-component overrides by design."). There
// is deliberately no separate "cross-filter" storage: `compile()` already merges `d.filters` into
// every component's query, so putting the clicked value there is what makes the SERVER recompute
// every tile's aggregates under the filter — nothing here ever touches already-fetched rows.
//
// The operator is always `eq` (an exact match on the clicked category) — never `in`/`not_in`,
// which `filterOps.ts` documents as REJECTED by the query service.

/**
 * Cross-filter: clicking a bar/slice sets a GLOBAL filter — filters are never per-component.
 * Replaces (never stacks) any existing filter on the same column, so re-clicking a DIFFERENT
 * segment of the same dimension moves the filter rather than ANDing two values on one column
 * together (which would match zero rows for an equality filter). Always bumps `configVersion` —
 * a filter change always changes what the server must compute, so every component must refetch.
 */
export function addGlobalFilter(d: Dashboard, f: FilterRule): Dashboard {
  return {
    ...d,
    filters: [...d.filters.filter(x => x.column !== f.column), f],
    configVersion: d.configVersion + 1,
  };
}

/**
 * The other half of the click-to-toggle interaction: clicking the SAME already-active segment
 * again clears that column's filter instead of re-applying it (see `DashboardView`'s
 * `onSegmentFilter`, which decides add-vs-remove by comparing the clicked value against the
 * currently active filter for that column). A no-op (including no `configVersion` bump) when the
 * column has no active filter, mirroring `removeComponent`'s unknown-id no-op.
 */
export function removeGlobalFilter(d: Dashboard, column: string): Dashboard {
  if (!d.filters.some(f => f.column === column)) return d;
  return { ...d, filters: d.filters.filter(f => f.column !== column), configVersion: d.configVersion + 1 };
}

/**
 * Clears every global/cross filter but leaves `d.slices` (the generated date-range controls)
 * completely untouched — "reset filters" undoes ad-hoc filtering, it is not "reset the whole
 * dashboard to its generated defaults" (that is `restoreGenerated`'s job). Always bumps
 * `configVersion`: even clearing to an empty filter set changes the compiled query whenever a
 * filter was actually present, and clearing an already-empty list is a harmless extra bump (same
 * "always bump, let `configVersion` be a stamp not a diff" spirit as `addComponent`).
 */
export function resetFilters(d: Dashboard): Dashboard {
  return { ...d, filters: [], configVersion: d.configVersion + 1 };
}
