import { generate, PIE_MAX_CATEGORIES } from './generate';
import type {
  AggregateFunction, BarConfig, Component, ComponentConfig, ComponentType, Dashboard,
  MartField, PieConfig, ScorecardConfig, TableConfig, TimeSeriesConfig,
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
 * `prefer`'s own aggregation, if it has one, is always already valid for whatever field it names
 * — carrying it forward across a retype (e.g. scorecard -> pie) never introduces an aggregation a
 * field doesn't allow, because the field/aggregation pairing itself is unchanged. There is no safe
 * governance-blind default when the source has none (e.g. table -> bar): 'COUNT' mirrors the same
 * last-resort token `generate.ts`'s `pick()` uses, on the understanding that `ComponentEditor`
 * (which DOES have `MartField.allowedAggregations`) is where the user corrects a governance
 * mismatch this function cannot see.
 */
function bestAggregation(prefer?: Component): AggregateFunction {
  return (prefer && getAggregation(prefer)) || 'COUNT';
}

/** Builds a config for `type`, borrowing values from `source` (if retyping) and the rest of `d`. */
function buildConfig(type: ComponentType, d: Dashboard, source?: Component): ComponentConfig {
  const metric = bestMetric(d, source);
  const dimension = bestDimension(d, source) || metric;
  const aggregation = bestAggregation(source);

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

const configsEqual = (a: ComponentConfig, b: ComponentConfig): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * General-purpose patch, used by `ComponentEditor` for every field it exposes. This is where the
 * configVersion boundary is enforced for arbitrary edits: bump ONLY when the patch actually
 * changes `type` or `config` (i.e. what the server must compute) — never for `title`,
 * `description`, `width` or `height` alone, and never when a `config`/`type` patch happens to be
 * a no-op (identical to the current value).
 */
export function updateComponent(d: Dashboard, id: string, patch: Partial<Component>): Dashboard {
  const idx = d.components.findIndex(c => c.id === id);
  if (idx === -1) return d;
  const target = d.components[idx];
  const next: Component = { ...target, ...patch };

  const typeChanged = patch.type !== undefined && patch.type !== target.type;
  const configChanged = patch.config !== undefined && !configsEqual(patch.config, target.config);
  const queryAffected = typeChanged || configChanged;

  const components = d.components.map((c, i) => (i === idx ? next : c));
  return { ...d, components, configVersion: queryAffected ? d.configVersion + 1 : d.configVersion };
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
