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
export function formatWindow(w: { from: string; to: string }): string {
  const a = new Date(`${w.from}T00:00:00Z`), b = new Date(`${w.to}T00:00:00Z`);
  const ya = a.getUTCFullYear(), yb = b.getUTCFullYear();
  if (w.from === w.to) return `${DAY_FMT.format(a)}, ${ya}`;
  if (ya !== yb) return `${DAY_FMT.format(a)}, ${ya} – ${DAY_FMT.format(b)}, ${yb}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${DAY_FMT.format(a)}–${b.getUTCDate()}, ${ya}`;
  return `${DAY_FMT.format(a)} – ${DAY_FMT.format(b)}, ${ya}`;
}

/** A signed compact difference: `+12.4K`, `−3`, `0`. */
export function formatDelta(d: number | null): string {
  if (d === null) return '';
  if (d === 0) return '0';
  return `${d > 0 ? '+' : '−'}${compact(Math.abs(d))}`;
}
