import { queryDataMart } from './api';
import { aggLabel } from './compile';
import { emptyDashboard } from './types';
import type { AggregateFunction, Component, Dashboard, MartField } from './types';

/** A pie is only readable up to this many slices; above it, a ranked bar wins. */
export const PIE_MAX_CATEGORIES = 8;
const MAX_SCORECARDS = 5;
export const BAR_LIMIT = 10;
const TABLE_LIMIT = 100;

export const isDate = (f: MartField) => /^(DATE|DATETIME|TIMESTAMP)$/i.test(f.type);
/**
 * Picks the first preferred aggregation the field actually allows, else the field's own first
 * allowed aggregation. `pick` is only ever called on fields already filtered to have at least one
 * allowed aggregation (see `metrics` below), so the `?? 'COUNT'` is an unreachable safety net, not
 * a real fallback — it must never fire and hand out an aggregation the field doesn't allow.
 */
export const pick = (f: MartField, ...prefer: AggregateFunction[]): AggregateFunction =>
  prefer.find(p => f.allowedAggregations.includes(p)) ?? f.allowedAggregations[0] ?? 'COUNT';

const uid = () => crypto.randomUUID();

/**
 * How a column is named on screen: the mart's own alias when it has one, the raw column name only
 * as a fallback — `firstLogInDateTime` is a query identifier, "First LogIn Date Time" is what the
 * product calls it everywhere else. A primary key reads as its product name, "Unique Count".
 *
 * Display only. Every query, config key and filter rule keeps using `name`.
 */
export const fieldLabel = (f: MartField) => (f.isPrimaryKey ? 'Unique Count' : (f.alias ?? f.name));

/** Label for a bare column name, when only the schema list is at hand. */
export const columnLabel = (fields: MartField[], column: string) => {
  const field = fields.find(f => f.name === column);
  return field ? fieldLabel(field) : column;
};


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
/**
 * The mart's primary key as a metric: "Unique Count", counted by the backend with COUNT_DISTINCT.
 * Returned as an array so callers can splat it — a mart without a primary key contributes nothing.
 */
export function uniqueCountMetric(fields: MartField[]): MartField[] {
  const key = fields.find(f => f.isPrimaryKey);
  return key ? [{ ...key, role: 'metric', allowedAggregations: ['COUNT_DISTINCT'] }] : [];
}

export function generate(
  martId: string,
  martTitle: string,
  fields: MartField[],
  cardinality: Record<string, number>
): Dashboard {
  const d = emptyDashboard(uid(), martId, martTitle);
  const dates = fields.filter(isDate);
  const primaryDate = dates[0];
  // "Unique Count" — the product's own name for how many records a mart holds, counted by its
  // primary key. The number is computed by the BACKEND, never here: the reporting endpoint has no
  // selectable `Unique Count` column (probed live: `column=Unique Count` → 400 Unknown column, the
  // pseudo-column exists on the report path only), and its one way to ask for that figure is an
  // aggregation rule. `COUNT_DISTINCT` over the key is the same SQL the host renders for its own
  // Unique Count — `renderCountDistinctPrimaryKey(...) AS "Unique Count"` — so this asks for that
  // calculation rather than reproducing it.
  //
  // It LEADS the metric list: how many records there are is the headline figure of any mart that
  // has a primary key, so it takes the first scorecard, the time series and the bar/pie value.
  const uniqueCount = uniqueCountMetric(fields);
  // A metric with an empty `allowedAggregations` cannot be aggregated at all — there is no legal
  // AggregateFunction to send. Excluding it here (rather than falling back to some default) is
  // what keeps every generated scorecard/timeseries/bar/pie inside the field's declared
  // governance; it still shows up as a raw column in the detail table below, which never
  // aggregates anything.
  const metrics = [
    ...uniqueCount,
    ...fields.filter(f => f.role === 'metric' && f.allowedAggregations.length > 0),
  ];
  // The primary key is excluded as a DIMENSION: it is unique per row by definition, so grouping by
  // it yields one group per row — a "top 10" of arbitrary ids. It stays a raw column in the table.
  const dims = fields.filter(f => f.role === 'dimension' && !isDate(f) && !f.isPrimaryKey);

  // 2. Global date slice (pre-join) — the FIRST date field only.
  //
  // One slice per date field ANDs them together, and on a mart whose dates mark different events
  // (created / first login / first paid …) that intersection is empty: every row must satisfy all
  // of them at once, and a NULL fails a range filter outright. Measured on 🥈 User | Entity: 95,986
  // rows, 153 with `created` in the last 30 days, 0 with all eight of its date columns sliced.
  // The remaining date fields stay available as filters the user can add deliberately.
  d.slices = primaryDate
    ? [{ column: primaryDate.name, operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }]
    : [];

  const components: Component[] = [];
  const add = (c: Omit<Component, 'id'>) => components.push({ ...c, id: uid() });

  // 3. Up to five scorecards.
  for (const m of metrics.slice(0, MAX_SCORECARDS)) {
    add({
      type: 'scorecard', title: fieldLabel(m), width: 1, height: 1,
      config: { metric: m.name, aggregation: pick(m, 'SUM', 'AVG', 'COUNT') },
    });
  }

  // 4. Time series over the primary date field.
  const primaryMetric = metrics[0];
  if (primaryDate && primaryMetric) {
    add({
      type: 'timeseries', title: `${fieldLabel(primaryMetric)} over time`, width: 5, height: 2,
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
        type: 'bar', title: `${fieldLabel(primaryMetric)} by ${fieldLabel(dim)}`, width: 3, height: 2,
        config: {
          dimension: dim.name, metric: primaryMetric.name, aggregation: agg,
          orientation: 'vertical', limit: BAR_LIMIT, sort: 'desc',
        },
      });
    }
    for (const dim of dims.filter(x => (cardinality[x.name] ?? Infinity) <= PIE_MAX_CATEGORIES)) {
      add({
        type: 'pie', title: `${fieldLabel(primaryMetric)} by ${fieldLabel(dim)}`, width: 2, height: 2,
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
