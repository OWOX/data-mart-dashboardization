import type { AggFn, DateWindow, Day, Measure } from '../types';
import { addDays } from '../lib/dates';
import type { OwoxLike } from '../owox/sources';

const TOKEN: Record<AggFn, string> = { SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT', COUNT_DISTINCT: 'COUNTUNIQUE' };

export const valueKey = (m: Measure): string => (m.fn ? `${m.field.replace(/\./g, '_')} | ${TOKEN[m.fn]}` : m.field);

const dateFilter = (dateField: string, w: DateWindow) => [
  { column: dateField, operator: 'gte', value: w.from },
  { column: dateField, operator: 'lt', value: addDays(w.to, 1) },
];
const aggregation = (m: Measure) => (m.fn ? [{ column: m.field, function: m.fn }] : null);

export const totalOptions = (m: Measure, dateField: string | null, w: DateWindow | null): Record<string, unknown> => ({
  column: [m.field],
  aggregation: aggregation(m),
  filter: dateField && w ? dateFilter(dateField, w) : null,
  limit: 1,
});

export const dailyOptions = (m: Measure, dateField: string, w: DateWindow): Record<string, unknown> => ({
  column: [dateField, m.field],
  aggregation: aggregation(m),
  dateTrunc: [{ column: dateField, unit: 'DAY' }],
  filter: dateFilter(dateField, w),
  sort: [{ column: dateField, direction: 'asc' }],
  limit: 1000,
});

export function toNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function readRows(owox: OwoxLike, martId: string, options: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const t = await owox.dataMarts.traverseData(martId, options);
  const rows: Record<string, unknown>[] = [];
  for await (const chunk of t.rowChunks()) rows.push(...chunk);
  return rows;
}

export async function queryTotal(owox: OwoxLike, martId: string, m: Measure, dateField: string | null, w: DateWindow | null): Promise<number | null> {
  const rows = await readRows(owox, martId, totalOptions(m, dateField, w));
  return toNumber(rows[0]?.[valueKey(m)]);
}

export async function queryDaily(owox: OwoxLike, martId: string, m: Measure, dateField: string, w: DateWindow): Promise<Map<Day, number>> {
  const out = new Map<Day, number>();
  const rows = await readRows(owox, martId, dailyOptions(m, dateField, w));
  for (const row of rows) {
    const v = toNumber(row[valueKey(m)]);
    const d = row[dateField];
    if (v !== null && d != null) out.set(String(d).slice(0, 10), v);
  }
  return out;
}
