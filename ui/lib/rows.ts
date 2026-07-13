import type { QueryResult } from './types';

/**
 * Reshape server rows into recharts points. This is a POSITIONAL REMAP ONLY — no summing, no
 * sorting, no bucketing. The server already grouped, aggregated, ordered and limited the result;
 * re-doing any of it here would be a client-side calculation and would disagree with `totals`.
 */
export function toPoints(
  data: QueryResult,
  labelColumn: string,
  valueColumn: string
): { label: string; value: number }[] {
  const li = data.columns.indexOf(labelColumn);
  const vi = data.columns.indexOf(valueColumn);
  if (li === -1 || vi === -1) return [];
  return data.rows.map(r => ({
    label: String(r[li] ?? ''),
    value: Number(r[vi] ?? 0) || 0,
  }));
}

/**
 * Pivot long-format server rows into recharts' wide multi-series shape, for a time series with a
 * `breakdown` column: `[{ x, [seriesA]: v, [seriesB]: v, ... }]` plus the ordered list of distinct
 * series keys (so the chart knows how many `<Line>`s to draw and can cycle a fixed palette across
 * them). Still no math — `compile()` already grouped by `(xColumn, seriesColumn)` server-side, so
 * at most one row exists per `(x, series)` pair; this only relocates each already-final value into
 * its cell. `x` order follows first-seen row order (server order), never re-sorted; series-key
 * order likewise follows first-seen order, not any ranking.
 */
export function toSeries(
  data: QueryResult,
  xColumn: string,
  seriesColumn: string,
  valueColumn: string
): { rows: Record<string, number | string>[]; seriesKeys: string[] } {
  const xi = data.columns.indexOf(xColumn);
  const si = data.columns.indexOf(seriesColumn);
  const vi = data.columns.indexOf(valueColumn);
  if (xi === -1 || si === -1 || vi === -1) return { rows: [], seriesKeys: [] };

  const seriesKeys: string[] = [];
  const byX = new Map<string, Record<string, number | string>>();
  for (const r of data.rows) {
    const x = String(r[xi] ?? '');
    const series = String(r[si] ?? '');
    const value = Number(r[vi] ?? 0) || 0;
    if (!seriesKeys.includes(series)) seriesKeys.push(series);
    if (!byX.has(x)) byX.set(x, { x });
    byX.get(x)![series] = value;
  }
  return { rows: [...byX.values()], seriesKeys };
}
