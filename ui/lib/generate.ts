import { queryDataMart } from './api';
import { aggLabel } from './compile';
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
 * "No `aggregations` ⇒ no GROUP BY ⇒ raw rows" (spec + compile.ts's table case): with ZERO
 * aggregations there is no grouping at all, so projecting the dimension alone would return raw,
 * duplicate-laden rows — that counts TOTAL ROWS, not distinct values. Instead we ask the server
 * directly for the distinct count via an aggregated `COUNT_DISTINCT` read from `totals`, which per
 * the spec is "a separate ungrouped query over all matching rows, ignoring `limit`" — exactly a
 * cardinality probe. `aggLabel` mirrors the backend's alias exactly; reading `totals` by a wrong
 * key would silently yield `undefined`.
 *
 * Governance applies to probes too: a dimension whose `allowedAggregations` does not include
 * `COUNT_DISTINCT` must never be probed with it — it falls back to Infinity (prefer a bar).
 *
 * The probes run concurrently via `Promise.all`, each one individually try/caught, so one
 * dimension's failure/rejection can never affect another's result — `Promise.all` rejecting on
 * the FIRST rejection would be wrong here, which is exactly why each mapped promise catches
 * internally before `Promise.all` ever sees a rejection.
 */
export async function probeCardinality(
  martId: string,
  dimensions: MartField[]
): Promise<Record<string, number>> {
  const entries = await Promise.all(dimensions.map(async (dim): Promise<[string, number]> => {
    if (!dim.allowedAggregations.includes('COUNT_DISTINCT')) {
      return [dim.name, Number.POSITIVE_INFINITY];   // not allowed to probe -> treat as high, prefer a bar
    }
    try {
      const res = await queryDataMart(martId, {
        fields: [dim.name],
        aggregationConfig: [{ column: dim.name, function: 'COUNT_DISTINCT' }],
        limit: 1,
      });
      return [dim.name, Number(res.totals?.[aggLabel(dim.name, 'COUNT_DISTINCT')] ?? Number.POSITIVE_INFINITY)];
    } catch {
      return [dim.name, Number.POSITIVE_INFINITY];   // unknown -> treat as high, prefer a bar
    }
  }));
  return Object.fromEntries(entries);
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

  // 7. Detail table. `QueryRequest.fields` is required with min length 1, so a table with zero
  // columns would compile into a request the service rejects — omit it entirely rather than emit
  // an uncompilable component.
  if (fields.length > 0) {
    add({
      type: 'table', title: 'Details', width: 5, height: 3,
      config: { columns: fields.map(f => f.name), limit: TABLE_LIMIT },
    });
  }

  d.components = components;
  d.generatedAt = new Date().toISOString();
  return d;
}
