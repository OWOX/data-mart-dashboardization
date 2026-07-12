import { queryDataMart } from './api';
import { emptyDashboard } from './types';
import type { AggregateFunction, Component, Dashboard, MartField } from './types';

/** A pie is only readable up to this many slices; above it, a ranked bar wins. */
export const PIE_MAX_CATEGORIES = 8;
const MAX_SCORECARDS = 5;
const BAR_LIMIT = 10;
const TABLE_LIMIT = 100;

const isDate = (f: MartField) => /^(DATE|DATETIME|TIMESTAMP)$/i.test(f.type);
/**
 * Picks the first preferred aggregation the field actually allows, else the field's own first
 * allowed aggregation. `pick` is only ever called on fields already filtered to have at least one
 * allowed aggregation (see `metrics` below), so the `?? 'COUNT'` is an unreachable safety net, not
 * a real fallback — it must never fire and hand out an aggregation the field doesn't allow.
 */
const pick = (f: MartField, ...prefer: AggregateFunction[]): AggregateFunction =>
  prefer.find(p => f.allowedAggregations.includes(p)) ?? f.allowedAggregations[0] ?? 'COUNT';

const uid = () => crypto.randomUUID();

/**
 * Distinct-count each candidate dimension, server-side, to decide pie-vs-bar. This is the spec's
 * "data sampling" step — it is an aggregated query, not a client-side calculation.
 *
 * A field WITHOUT an aggregation rule is a grouping key (see compile.ts), so projecting the
 * dimension alone with `aggregationConfig: null` and a limit of PIE_MAX_CATEGORIES + 1 yields at
 * most that many distinct-value rows. If the server had to cut more rows than we asked for
 * (`truncated`), there were MORE distinct values than the pie threshold, so the dimension is
 * high-cardinality without ever counting a single row in JS.
 */
export async function probeCardinality(
  martId: string,
  dimensions: MartField[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const dim of dimensions) {
    try {
      const res = await queryDataMart(martId, {
        fields: [dim.name],
        aggregationConfig: null,   // project the dimension alone; grouping is implied
        limit: PIE_MAX_CATEGORIES + 1,
      });
      // `truncated` means there were MORE groups than we asked for -> high cardinality.
      out[dim.name] = res.truncated ? Number.POSITIVE_INFINITY : res.rows.length;
    } catch {
      out[dim.name] = Number.POSITIVE_INFINITY;   // unknown -> treat as high, prefer a bar
    }
  }
  return out;
}

/**
 * Turn a mart's schema (+ cardinality probes) into a starting dashboard. Deterministic.
 * Order follows the spec: date filters, scorecards, time series, bars, pie, table.
 */
export function generate(
  martId: string,
  martTitle: string,
  fields: MartField[],
  cardinality: Record<string, number>
): Dashboard {
  const d = emptyDashboard(uid(), martId, martTitle);
  const dates = fields.filter(isDate);
  // A metric with an empty `allowedAggregations` cannot be aggregated at all — there is no legal
  // AggregateFunction to send. Excluding it here (rather than falling back to some default) is
  // what keeps every generated scorecard/timeseries/bar/pie inside the field's declared
  // governance; it still shows up as a raw column in the detail table below, which never
  // aggregates anything.
  const metrics = fields.filter(f => f.role === 'metric' && f.allowedAggregations.length > 0);
  const dims = fields.filter(f => f.role === 'dimension' && !isDate(f));

  // 2. Global date slice (pre-join) for each date field.
  d.slices = dates.map(f => ({
    column: f.name,
    operator: 'relative_date',
    value: { kind: 'last_n_days', n: 30 },
  }));

  const components: Component[] = [];
  const add = (c: Omit<Component, 'id'>) => components.push({ ...c, id: uid() });

  // 3. Up to five scorecards.
  for (const m of metrics.slice(0, MAX_SCORECARDS)) {
    add({
      type: 'scorecard', title: m.name, width: 1, height: 1,
      config: { metric: m.name, aggregation: pick(m, 'SUM', 'AVG', 'COUNT') },
    });
  }

  // 4. Time series over the primary date field.
  const primaryDate = dates[0];
  const primaryMetric = metrics[0];
  if (primaryDate && primaryMetric) {
    add({
      type: 'timeseries', title: `${primaryMetric.name} over time`, width: 5, height: 2,
      config: {
        dateField: primaryDate.name, metric: primaryMetric.name,
        aggregation: pick(primaryMetric, 'SUM', 'AVG'), unit: 'DAY',
      },
    });
  }

  // 5. Bars for high-cardinality dimensions; 6. pies only for genuinely low-cardinality ones.
  if (primaryMetric) {
    const agg = pick(primaryMetric, 'SUM', 'AVG');
    for (const dim of dims.filter(x => (cardinality[x.name] ?? Infinity) > PIE_MAX_CATEGORIES)) {
      add({
        type: 'bar', title: `${primaryMetric.name} by ${dim.name}`, width: 3, height: 2,
        config: {
          dimension: dim.name, metric: primaryMetric.name, aggregation: agg,
          orientation: 'vertical', limit: BAR_LIMIT, sort: 'desc',
        },
      });
    }
    for (const dim of dims.filter(x => (cardinality[x.name] ?? Infinity) <= PIE_MAX_CATEGORIES)) {
      add({
        type: 'pie', title: `${primaryMetric.name} by ${dim.name}`, width: 2, height: 2,
        config: {
          dimension: dim.name, metric: primaryMetric.name, aggregation: agg,
          maxCategories: PIE_MAX_CATEGORIES,
        },
      });
    }
  }

  // 7. Detail table.
  add({
    type: 'table', title: 'Details', width: 5, height: 3,
    config: { columns: fields.map(f => f.name), limit: TABLE_LIMIT },
  });

  d.components = components;
  d.generatedAt = new Date().toISOString();
  return d;
}
