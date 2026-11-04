import type { MetricDef } from '../types';

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });

export const compact = (n: number | null): string => (n === null ? '—' : COMPACT.format(n));

export function formatPct(p: number | null): string {
  if (p === null) return '';
  const s = Math.abs(p).toFixed(1);
  if (s === '0.0') return '0.0%';
  return `${p > 0 ? '+' : '−'}${s}%`;
}

const DAY_FMT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** `Oct 1–7, 2026`, `Oct 1 – Nov 1, 2026`, `Dec 30, 2025 – Jan 5, 2026`; days are UTC 'YYYY-MM-DD'. */
export function formatWindow(w: { from: string; to: string }, withYear = true): string {
  const a = new Date(`${w.from}T00:00:00Z`), b = new Date(`${w.to}T00:00:00Z`);
  const ya = a.getUTCFullYear(), yb = b.getUTCFullYear();
  const y = withYear ? `, ${ya}` : '';
  if (w.from === w.to) return `${DAY_FMT.format(a)}${y}`;
  if (ya !== yb) return `${DAY_FMT.format(a)}, ${ya} – ${DAY_FMT.format(b)}, ${yb}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${DAY_FMT.format(a)}–${b.getUTCDate()}${y}`;
  return `${DAY_FMT.format(a)} – ${DAY_FMT.format(b)}${y}`;
}

/** A range and what it is compared with; when every day falls in one year, the year is written once, at the end. */
export function formatPeriod(range: { from: string; to: string }, comparison: { from: string; to: string } | null): string {
  if (!comparison) return formatWindow(range);
  const oneYear = new Set([range.from, range.to, comparison.from, comparison.to].map((d) => d.slice(0, 4))).size === 1;
  return `${formatWindow(range, !oneYear)} vs ${formatWindow(comparison)}`;
}

/** A signed compact difference: `+12.4K`, `−3`, `0`. */
export function formatDelta(d: number | null): string {
  if (d === null) return '';
  if (d === 0) return '0';
  return `${d > 0 ? '+' : '−'}${compact(Math.abs(d))}`;
}

type Fmt = Pick<MetricDef, 'format' | 'currency'>;

/** A valid ISO 4217 code in upper case, else null. */
export function normalizeCurrency(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  const code = c.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  try { new Intl.NumberFormat('en', { style: 'currency', currency: code }); return code; } catch { return null; }
}

const money = new Map<string, Intl.NumberFormat>();
function moneyFormat(code: string): Intl.NumberFormat {
  let f = money.get(code);
  if (!f) { f = new Intl.NumberFormat('en', { style: 'currency', currency: code, notation: 'compact', maximumSignificantDigits: 3 }); money.set(code, f); }
  return f;
}

const pct1 = (n: number): string => { const s = (n * 100).toFixed(1); return s === '-0.0' ? '0.0' : s; };

/** A value in the metric's format: `4.0%`, `$7.15K`, `7.15K`. */
export function formatValue(n: number | null, m: Fmt | undefined): string {
  if (n === null) return '—';
  if (m?.format === 'percent') return `${pct1(n)}%`;
  const code = m?.format === 'currency' ? normalizeCurrency(m.currency) : null;
  return code ? moneyFormat(code).format(n) : compact(n);
}

/** A signed difference in the metric's format: `+1.2 pp` for a percent, else `+12.4K` or `+$12.4K`. */
export function formatDeltaFor(d: number | null, m: Fmt | undefined): string {
  if (d === null) return '';
  if (m?.format === 'percent') {
    const s = pct1(Math.abs(d));
    return s === '0.0' ? '0.0 pp' : `${d > 0 ? '+' : '−'}${s} pp`;
  }
  if (d === 0) return '0';
  return `${d > 0 ? '+' : '−'}${formatValue(Math.abs(d), m)}`;
}
