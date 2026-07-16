// Translates a compiled QueryRequest into an OWOX HTTP Data API call and maps the NDJSON reply
// back to a QueryResult. This is the ONE place that knows the wire shape of the deployed
// `GET /api/external/http-data/data-marts/:id.ndjson` endpoint (aggregation, sort, filter,
// dateTrunc, limit — all server-side), plus the run's grand-totals summary. Pure functions only;
// the SDK call itself lives in api.ts. Kept separate so it can be unit-tested without the SDK.
import type { AggregateFunction, QueryRequest, QueryResult } from './types';

/**
 * The endpoint names an aggregated output column `<column> | <TOKEN>` (dots -> `_`), and the run's
 * `totals` object uses the same keys — identical to compile.ts's `aggLabel` and the backend's
 * aggregation-labels.ts. Kept here too so this module needs nothing from compile.ts.
 */
const AGG_TOKEN: Record<AggregateFunction, string> = {
  SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT',
  COUNT_DISTINCT: 'COUNTUNIQUE',
  P25: 'P25', P50: 'MEDIAN', P75: 'P75', P95: 'P95',
};

export function aggLabel(column: string, fn: AggregateFunction): string {
  return `${column.replace(/\./g, '_')} | ${AGG_TOKEN[fn]}`;
}

const ROW_COUNT_KEY = 'Row Count'; // grouping metadata the endpoint appends; not a plugin column

function b64url(value: unknown): string {
  // btoa over a JSON string, made URL-safe. Configs are ASCII JSON, so no unicode handling needed.
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * QueryRequest -> the endpoint's query string. `overLimit` is the row cap actually sent: we
 * over-read by one (like the backend query service) so `rowsToQueryResult` can detect truncation.
 * The four config arrays are compile.ts output verbatim — the endpoint's domain schemas use the
 * same `column`/`function`/`unit`/`direction`/`operator` field names, so no renaming.
 */
export function buildHttpDataQuery(body: QueryRequest, overLimit?: number): string {
  const p = new URLSearchParams();
  for (const f of body.fields ?? []) p.append('column', f);
  if (body.filterConfig?.length) p.set('filter', b64url(body.filterConfig));
  if (body.aggregationConfig?.length) p.set('aggregation', b64url(body.aggregationConfig));
  if (body.dateTruncConfig?.length) p.set('dateTrunc', b64url(body.dateTruncConfig));
  if (body.sortConfig?.length) p.set('sort', b64url(body.sortConfig));
  if (overLimit != null) p.set('limit', String(overLimit));
  return p.toString();
}

export function parseNdjson(text: string): Record<string, unknown>[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
}

/** The output column names the plugin expects, in projection order — used when the result is empty. */
export function expectedColumns(body: QueryRequest): string[] {
  const agg = new Map((body.aggregationConfig ?? []).map(a => [a.column, a.function]));
  return (body.fields ?? []).map(f => (agg.has(f) ? aggLabel(f, agg.get(f)!) : f));
}

/** A scorecard compiles to an aggregation with no grouping dimension; only then does it read totals. */
export function needsGrandTotal(body: QueryRequest): boolean {
  if (!body.aggregationConfig?.length) return false;
  const aggCols = new Set(body.aggregationConfig.map(a => a.column));
  return (body.fields ?? []).every(f => aggCols.has(f));
}

/** Fallback grand total: a no-grouping aggregate stream returns a single row that IS the total. */
export function grandTotalFromRow(rowObjects: Record<string, unknown>[], body: QueryRequest): QueryResult['totals'] {
  if (!needsGrandTotal(body) || !rowObjects.length) return null;
  const totals: Record<string, number | string | boolean | null> = {};
  for (const [k, v] of Object.entries(rowObjects[0])) {
    if (k !== ROW_COUNT_KEY) totals[k] = v as number | string | boolean | null;
  }
  return totals;
}

/** NDJSON row objects -> QueryResult. Over-read by one, so more rows than `askedLimit` => truncated. */
export function rowsToQueryResult(
  rowObjects: Record<string, unknown>[],
  body: QueryRequest,
  askedLimit: number,
  totals: QueryResult['totals'] = null,
): QueryResult {
  const truncated = rowObjects.length > askedLimit;
  const kept = truncated ? rowObjects.slice(0, askedLimit) : rowObjects;
  const columns = kept.length
    ? Object.keys(kept[0]).filter(k => k !== ROW_COUNT_KEY)
    : expectedColumns(body);
  const rows = kept.map(o => columns.map(c => (o[c] ?? null)));
  return { columns, rows, truncated, totals };
}

const NON_TERMINAL_RUN_STATUS = new Set(['PENDING', 'RUNNING']);
/** Keep polling the run only while it is still working. SUCCESS/FAILED/CANCELLED/… are terminal. */
export function shouldKeepPolling(status: unknown): boolean {
  return typeof status === 'string' && NON_TERMINAL_RUN_STATUS.has(status);
}
