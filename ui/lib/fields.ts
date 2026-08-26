import { BAR_LIMIT, PIE_MAX_CATEGORIES, isDate, fieldLabel, pick, uniqueCountMetric } from './generate';
import type { BarConfig, Component, Dashboard, MartField, PieConfig, ScorecardConfig, TimeSeriesConfig } from './types';

/**
 * The Fields menu's model: which of a mart's fields the dashboard currently uses, and what
 * toggling one on or off does to the document.
 *
 * A field "owns" what it produced: a date field owns its global date range, a metric owns its
 * scorecard and any chart measuring it, a dimension owns the bar or pie grouping by it. Toggling
 * off removes exactly that and nothing else, so a dashboard someone has resized, renamed and added
 * to survives a field being unchecked — which is what separates this from re-running the generator.
 */

const uid = () => crypto.randomUUID();

export type FieldGroups = {
  /** Date/datetime/timestamp columns — each can carry one global relative-date range. */
  dates: MartField[];
  /** Numeric metrics, led by "Unique Count" when the mart has a primary key. */
  metrics: MartField[];
  /** Everything groupable. The primary key is excluded: one group per row is not a chart. */
  dimensions: MartField[];
};

/** One Data Mart's contribution to the picker: its own three columns of fields. */
export type SourceGroup = {
  /** '' for the dashboard's own Data Mart, the join alias path for a joined one. */
  aliasPath: string;
  title: string;
  groups: FieldGroups;
  /** How many of this source's fields are currently on the dashboard. */
  selectedCount: number;
};

/**
 * The picker's full shape: the mart's own fields first, then each joined source that contributes
 * at least one field, alphabetically. A large mart joins 60+ sources, so the panel groups rather
 * than listing 600 checkboxes flat.
 */
export function groupBySource(fields: MartField[], selected: ReadonlySet<string>): SourceGroup[] {
  const bySource = new Map<string, { title: string; fields: MartField[] }>();
  for (const field of fields) {
    const key = field.source?.aliasPath ?? '';
    const title = field.source?.title ?? '';
    const bucket = bySource.get(key) ?? { title, fields: [] };
    bucket.fields.push(field);
    bySource.set(key, bucket);
  }

  const own = bySource.get('');
  bySource.delete('');
  const joined = [...bySource.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title));

  return [
    ...(own ? [['', own] as const] : []),
    ...joined,
  ].map(([aliasPath, bucket]) => ({
    aliasPath,
    title: bucket.title,
    groups: groupFields(bucket.fields),
    selectedCount: bucket.fields.filter(f => selected.has(f.name)).length,
  }));
}

/** The three sections the menu renders, in the order it renders them. */
export function groupFields(fields: MartField[]): FieldGroups {
  return {
    dates: fields.filter(isDate),
    metrics: [
      ...uniqueCountMetric(fields.filter(f => !f.source)),
      ...fields.filter(f => f.role === 'metric' && f.allowedAggregations.length > 0),
    ],
    dimensions: fields.filter(f => f.role === 'dimension' && !isDate(f) && !f.isPrimaryKey),
  };
}

/** Every column the dashboard references, by role — what the menu shows as checked. */
export function usedFields(d: Dashboard): Set<string> {
  const used = new Set<string>(d.slices.map(s => s.column));
  // A hidden component is off the dashboard as far as the picker is concerned: its checkbox is
  // clear, and ticking it again un-hides the very same tile (see `applySelection`).
  for (const c of d.components.filter(c => !c.hidden)) {
    const config = c.config as Partial<ScorecardConfig & TimeSeriesConfig & BarConfig & PieConfig>;
    if (config.metric) used.add(config.metric);
    if (config.dimension) used.add(config.dimension);
    if (config.dateField) used.add(config.dateField);
  }
  return used;
}

/**
 * The metric a newly checked dimension should chart. The dashboard's own primary metric wins so a
 * new bar matches the ones beside it; a mart with no metric in play falls back to Unique Count.
 */
function primaryMetric(d: Dashboard, fields: MartField[]): MartField | undefined {
  for (const c of d.components) {
    const name = (c.config as Partial<ScorecardConfig>).metric;
    const field = name && fields.find(f => f.name === name);
    if (field) return field.isPrimaryKey ? { ...field, allowedAggregations: ['COUNT_DISTINCT'] } : field;
  }
  return groupFields(fields).metrics[0];
}

/** Components that exist only because of this field. */
function ownedBy(d: Dashboard, name: string): Set<string> {
  const owned = new Set<string>();
  for (const c of d.components) {
    const config = c.config as Partial<ScorecardConfig & TimeSeriesConfig & BarConfig & PieConfig>;
    if (config.metric === name || config.dimension === name || config.dateField === name) {
      owned.add(c.id);
    }
  }
  return owned;
}

/**
 * Toggle one field on or off. Pure: returns a new document, `configVersion` bumped so every
 * component refetches — the caller debounces, this does not.
 */
export function toggleField(
  d: Dashboard,
  field: MartField,
  on: boolean,
  fields: MartField[],
  cardinality: Record<string, number> = {},
): Dashboard {
  const next = (patch: Partial<Dashboard>): Dashboard =>
    ({ ...d, ...patch, configVersion: d.configVersion + 1 });

  if (!on) {
    const owned = ownedBy(d, field.name);
    return next({
      slices: d.slices.filter(s => s.column !== field.name),
      components: d.components.filter(c => !owned.has(c.id)),
    });
  }

  // Re-ticking a field whose component was merely hidden restores it, configuration intact.
  const hidden = d.components.filter(c => c.hidden && ownedBy(d, field.name).has(c.id));
  if (hidden.length > 0) {
    const ids = new Set(hidden.map(c => c.id));
    return next({ components: d.components.map(c => (ids.has(c.id) ? { ...c, hidden: undefined } : c)) });
  }

  if (isDate(field)) {
    if (d.slices.some(s => s.column === field.name)) return d;
    return next({
      slices: [...d.slices, {
        column: field.name, operator: 'relative_date', value: { kind: 'last_n_days', n: 30 },
      }],
    });
  }

  const add = (c: Omit<Component, 'id'>): Dashboard =>
    next({ components: [...d.components, { ...c, id: uid() }] });

  if (field.role === 'metric' || field.isPrimaryKey) {
    const metric = field.isPrimaryKey ? { ...field, allowedAggregations: ['COUNT_DISTINCT' as const] } : field;
    return add({
      type: 'scorecard', title: fieldLabel(metric), width: 1, height: 1,
      config: { metric: metric.name, aggregation: pick(metric, 'SUM', 'AVG', 'COUNT') },
    });
  }

  const metric = primaryMetric(d, fields);
  // Without any metric there is nothing to measure the dimension by, so the toggle is a no-op
  // rather than a component that cannot compile.
  if (!metric) return d;
  const agg = pick(metric, 'SUM', 'AVG');
  const title = `${fieldLabel(metric)} by ${fieldLabel(field)}`;
  // Same pie-vs-bar rule as the generator: only a genuinely small domain reads as a pie. An
  // unprobed dimension is assumed wide, which is the safe direction — a bar degrades gracefully.
  return (cardinality[field.name] ?? Infinity) <= PIE_MAX_CATEGORIES
    ? add({
        type: 'pie', title, width: 2, height: 2,
        config: { dimension: field.name, metric: metric.name, aggregation: agg, maxCategories: PIE_MAX_CATEGORIES },
      })
    : add({
        type: 'bar', title, width: 3, height: 2,
        config: {
          dimension: field.name, metric: metric.name, aggregation: agg,
          orientation: 'vertical', limit: BAR_LIMIT, sort: 'desc',
        },
      });
}

/** Apply a whole selection at once — one document, one `configVersion` bump, one refetch wave. */
export function applySelection(
  d: Dashboard,
  selected: ReadonlySet<string>,
  fields: MartField[],
  cardinality: Record<string, number> = {},
): Dashboard {
  const current = usedFields(d);
  const groups = groupFields(fields);
  const all = [...groups.dates, ...groups.metrics, ...groups.dimensions];

  let next = d;
  for (const field of all) {
    const want = selected.has(field.name);
    if (want !== current.has(field.name)) {
      next = toggleField(next, field, want, fields, cardinality);
    }
  }
  // Every toggle bumped it; collapse to a single bump so one selection is one refetch wave.
  return next === d ? d : { ...next, configVersion: d.configVersion + 1 };
}
