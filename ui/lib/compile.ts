import type {
  AggregateFunction, BarConfig, Component, FilterRule, PieConfig,
  QueryRequest, ScorecardConfig, SortRule, TableConfig, TimeSeriesConfig,
} from './types';

/**
 * The service caps a single query at 1000 rows, and there is no pagination/offset in v1.
 * A limit outside 1..1000 is REJECTED, so nothing may leave this module unclamped.
 */
const MAX_LIMIT = 1000;

/**
 * Uppercase token per aggregate function, used in the aggregated output-column alias.
 * Mirrors `REPORT_AGGREGATE_FUNCTION_TOKENS` in the backend's `dto/schemas/aggregation-labels.ts`
 * — the single source of truth for this naming. Note COUNT_DISTINCT -> COUNTUNIQUE and
 * P50 -> MEDIAN; every other token is the function name itself.
 */
const AGG_TOKEN: Record<AggregateFunction, string> = {
  SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT',
  COUNT_DISTINCT: 'COUNTUNIQUE',
  P25: 'P25', P50: 'MEDIAN', P75: 'P75', P95: 'P95',
};

/**
 * Mirrors `aggregatedColumnLabel()` in the backend's `dto/schemas/aggregation-labels.ts` — the
 * single source of truth for aggregated output-column names. This is how the plugin READS values
 * back (the scorecard looks up `totals[aggLabel(metric, agg)]`; charts key rows by it), so a
 * wrong token does not error, it silently renders a blank number. Dots are sanitized to `_`
 * because BigQuery rejects a dot in an output alias (the aggregate argument still uses the real
 * dotted/struct reference — only the output NAME is sanitized here).
 */
export function aggLabel(column: string, fn: AggregateFunction): string {
  return `${column.replace(/\./g, '_')} | ${AGG_TOKEN[fn]}`;
}

/**
 * `sortConfig.direction` comes off a stored JSON dashboard doc, which may be hand-edited or
 * written by an older schema version, so it is not provably 'asc' | 'desc' at runtime even though
 * the type says so. The server 400s on anything else, so coerce defensively — same spirit as the
 * NaN-limit fallback below.
 */
const dir = (d: unknown): 'asc' | 'desc' => (d === 'asc' ? 'asc' : 'desc');

/**
 * Force any stored limit into the 1..1000 window the service accepts. A non-finite limit
 * (missing field on an older/hand-edited doc) would serialise to `null` and be rejected, so it
 * falls back to the maximum rather than reaching the wire.
 */
const clamp = (n: number): number =>
  Number.isFinite(n) ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n))) : MAX_LIMIT;

/** Group-by keys must be unique; a repeated projection would corrupt the implied GROUP BY. */
const dedupe = (fields: string[]): string[] => [...new Set(fields)];

/**
 * Global slices are pre-join, global filters are post-join. Both are tagged and merged into the
 * single filterConfig the query carries; the server does all the filtering.
 * Rules are copied, never mutated in place, and their placement is authoritative here.
 */
function mergeFilters(filters: FilterRule[], slices: FilterRule[]): FilterRule[] | null {
  const merged = [
    ...filters.map(f => ({ ...f, placement: 'post-join' as const })),
    ...slices.map(f => ({ ...f, placement: 'pre-join' as const })),
  ];
  return merged.length ? merged : null;
}

/**
 * Compile a component into exactly ONE server-side query.
 *
 * NO CLIENT-SIDE CALCULATION: every aggregate, group-by, date bucket, filter and total below is
 * expressed in the request so the server computes it. The client only formats what comes back.
 *
 * Group-by is IMPLIED by the backend: a projected field WITH an aggregation rule is a metric; a
 * projected field WITHOUT one is a grouping key. A table therefore sends no aggregations at all.
 * Every field named in aggregationConfig/dateTruncConfig must also appear in `fields`.
 */
export function compile(component: Component, filters: FilterRule[], slices: FilterRule[]): QueryRequest {
  const filterConfig = mergeFilters(filters, slices);
  const q = (
    fields: string[],
    agg: QueryRequest['aggregationConfig'],
    limit: number,
    dateTrunc: QueryRequest['dateTruncConfig'] = null,
    sortConfig?: SortRule[],
  ): QueryRequest => ({
    fields: dedupe(fields),
    filterConfig,
    aggregationConfig: agg,
    dateTruncConfig: dateTrunc,
    limit: clamp(limit),
    // Omit the key entirely (never `null`/`[]`) when a component has no ordering, so the
    // request stays minimal — see the compile-to-sort table in Task 6 of the plan.
    ...(sortConfig ? { sortConfig } : {}),
  });

  switch (component.type) {
    case 'scorecard': {
      const c = component.config as ScorecardConfig;
      // The value is read from `totals` (computed server-side over ALL matching rows, ignoring
      // `limit`), so one row is enough — the client never sums anything. A single aggregate row
      // has nothing to order, so no sortConfig.
      return q([c.metric], [{ column: c.metric, function: c.aggregation }], 1);
    }
    case 'timeseries': {
      const c = component.config as TimeSeriesConfig;
      // The date bucket is a server-side DATE_TRUNC (DAY is the finest grain the service has —
      // there is no HOUR). The breakdown is an extra grouping key, never an aggregation.
      //
      // sortConfig IS required here, even though this is a full series and not a ranking: SQL
      // guarantees no row order without an explicit ORDER BY, and neither `rows.ts` nor the chart
      // sorts (that would be client-side computation, which this plugin forbids) — so without a
      // server-side ORDER BY the points arrive in arbitrary order and the line renders as a
      // zigzag instead of a chronological series. Sort ascending by the RAW date field (not
      // aggLabel(...)) — same rule as bar/pie above: the server's ORDER BY resolver
      // (`col => aliasByColumn.get(col) ?? quoteIdentifier(col)`) is keyed by the raw column and
      // derives the correct alias itself.
      const fields = [c.dateField, c.metric, ...(c.breakdown ? [c.breakdown] : [])];
      return q(fields, [{ column: c.metric, function: c.aggregation }], MAX_LIMIT,
        [{ column: c.dateField, unit: c.unit }],
        [{ column: c.dateField, direction: 'asc' }]);
    }
    case 'bar': {
      const c = component.config as BarConfig;
      // ORDER BY the RAW metric column, never the aggregated alias — the server's ORDER BY
      // resolver (`col => aliasByColumn.get(col) ?? quoteIdentifier(col)`) is keyed by the raw
      // column and derives the correct alias itself. `limit` alone would return an ARBITRARY N
      // rows; this is what makes "Top N" actually top N.
      return q(
        [c.dimension, c.metric], [{ column: c.metric, function: c.aggregation }], c.limit, null,
        [{ column: c.metric, direction: dir(c.sort) }],
      );
    }
    case 'pie':
    case 'donut': {
      const c = component.config as PieConfig;
      // maxCategories is a top-N: always keep the biggest slices, so direction is fixed 'desc'
      // (pie/donut have no user-facing sort control). Same RAW-column rule as bar above.
      return q(
        [c.dimension, c.metric], [{ column: c.metric, function: c.aggregation }], c.maxCategories, null,
        [{ column: c.metric, direction: 'desc' }],
      );
    }
    case 'table': {
      const c = component.config as TableConfig;
      // No aggregations => no GROUP BY => raw rows, which is what a detail table wants.
      // config.sort is already shaped as SortRule[] of raw columns; map into FRESH objects
      // (never the dashboard doc's own rules by reference — mergeFilters holds the same
      // invariant for filters) and omit the key entirely when the user set none.
      const sortConfig = c.sort?.length
        ? c.sort.map(s => ({ column: s.column, direction: dir(s.direction) }))
        : undefined;
      return q(c.columns, null, c.limit, null, sortConfig);
    }
    default: {
      // Unreachable for a well-formed doc; a corrupt one must fail loudly rather than send a
      // malformed query.
      const unknown: never = component.type;
      throw new Error(`compile: unsupported component type "${String(unknown)}"`);
    }
  }
}
