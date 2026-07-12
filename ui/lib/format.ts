/**
 * Presentation only. `format.ts` is the one place in this plugin allowed to touch numbers on
 * the client, and only to render a value the server already computed — never to aggregate,
 * bucket, re-rank, or otherwise derive a new value. Every function here must be total: a
 * dashboard tile calls these on whatever the server returns, and a throw here blanks the tile.
 */

/** Presentation only. All aggregation happens server-side. */
export function formatNumber(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Period-over-period comparison for a scorecard. Both values come from the server. */
export function formatDelta(
  current: number,
  previous: number,
): { abs: number; pct: number; trend: 'up' | 'down' | 'flat' } {
  const abs = current - previous;
  // A zero baseline has no meaningful percentage, and no defensible direction: report flat
  // rather than Infinity/NaN.
  if (previous === 0) return { abs, pct: 0, trend: 'flat' };
  const pct = (abs / Math.abs(previous)) * 100;
  const trend: 'up' | 'down' | 'flat' = abs === 0 ? 'flat' : abs > 0 ? 'up' : 'down';
  return { abs, pct, trend };
}
