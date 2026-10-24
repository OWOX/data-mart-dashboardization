import type { DateWindow, Day, Preset, RangeSpec } from '../types';

const DAY_MS = 86_400_000;

export const toDay = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);
export const parseDay = (d: Day): number => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: Day, n: number): Day => toDay(parseDay(d) + n * DAY_MS);
export const diffDays = (a: Day, b: Day): number => Math.round((parseDay(b) - parseDay(a)) / DAY_MS);
export const minDay = (a: Day, b: Day): Day => (a < b ? a : b);
export const maxDay = (a: Day, b: Day): Day => (a > b ? a : b);

export function eachDay(w: DateWindow): Day[] {
  const out: Day[] = [];
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const anchorFor = (now: Date): Day => addDays(toDay(now.getTime()), -1);

const ymd = (y: number, m: number, d: number): Day => toDay(Date.UTC(y, m - 1, d));
const parts = (d: Day) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) });

type Unit = 'week' | 'month' | 'quarter' | 'year';

function periodOf(d: Day, unit: Unit): DateWindow {
  const { y, m } = parts(d);
  if (unit === 'week') {
    const dow = (new Date(parseDay(d)).getUTCDay() + 6) % 7;
    const from = addDays(d, -dow);
    return { from, to: addDays(from, 6) };
  }
  if (unit === 'month') return { from: ymd(y, m, 1), to: addDays(ymd(y, m + 1, 1), -1) };
  if (unit === 'quarter') {
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: ymd(y, qm, 1), to: addDays(ymd(y, qm + 3, 1), -1) };
  }
  return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) };
}

const previous = (d: Day, unit: Unit): DateWindow => periodOf(addDays(periodOf(d, unit).from, -1), unit);

function windowFor(preset: Preset, anchor: Day): DateWindow {
  const today = addDays(anchor, 1);
  switch (preset) {
    case 'yesterday': return { from: anchor, to: anchor };
    case 'last_7d': return { from: addDays(anchor, -6), to: anchor };
    case 'last_28d': return { from: addDays(anchor, -27), to: anchor };
    case 'last_week': return previous(today, 'week');
    case 'last_month': return previous(today, 'month');
    case 'last_quarter': return previous(today, 'quarter');
    case 'last_year': return previous(today, 'year');
    case 'ytd': return { from: periodOf(anchor, 'year').from, to: anchor };
    case 'this_week': return periodOf(today, 'week');
    case 'this_month': return periodOf(today, 'month');
    case 'this_quarter': return periodOf(today, 'quarter');
    case 'this_year': return periodOf(today, 'year');
  }
}

export function rangeFor(preset: Preset, now: Date): RangeSpec {
  const anchor = anchorFor(now);
  const range = windowFor(preset, anchor);
  const days = diffDays(range.from, range.to) + 1;
  const factWindow = range.from > anchor ? null : { from: range.from, to: minDay(range.to, anchor) };
  const comparison = factWindow
    ? { from: addDays(factWindow.from, -days), to: addDays(factWindow.to, -days) }
    : null;
  return { preset, anchor, range, days, factWindow, comparison, endsInFuture: range.to > anchor };
}
