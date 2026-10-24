const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });

export const compact = (n: number | null): string => (n === null ? '—' : COMPACT.format(n));

export function formatPct(p: number | null): string {
  if (p === null) return '';
  const s = Math.abs(p).toFixed(1);
  if (s === '0.0') return '0.0%';
  return `${p > 0 ? '+' : '−'}${s}%`;
}

export const metricLabel = (alias: string, classTitle: string, isUniqueCount: boolean): string =>
  isUniqueCount ? classTitle : `${alias} from ${classTitle}`;
