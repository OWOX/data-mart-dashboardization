import { COMPARE_LABELS, PRESET_LABELS, type CompareChoice, type ComparePreset, type DateWindow, type Day, type Preset, type RangeChoice, type RangeSpec, type WeekStart } from '../types';
import { formatWindow } from './format';

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

/** 0 for the first day of the week (Monday or Sunday), 6 for the last. */
export const weekdayIndex = (d: Day, ws: WeekStart = 'monday'): number => (new Date(parseDay(d)).getUTCDay() + (ws === 'monday' ? 6 : 0)) % 7;

type Unit = 'week' | 'month' | 'quarter' | 'year';

function periodOf(d: Day, unit: Unit, ws: WeekStart = 'monday'): DateWindow {
  const { y, m } = parts(d);
  if (unit === 'week') {
    const dow = weekdayIndex(d, ws);
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

const previous = (d: Day, unit: Unit, ws: WeekStart): DateWindow => periodOf(addDays(periodOf(d, unit, ws).from, -1), unit, ws);

function windowFor(preset: Preset, anchor: Day, ws: WeekStart): DateWindow {
  const today = addDays(anchor, 1);
  switch (preset) {
    case 'yesterday': return { from: anchor, to: anchor };
    case 'last_7d': return { from: addDays(anchor, -6), to: anchor };
    case 'last_28d': return { from: addDays(anchor, -27), to: anchor };
    case 'last_week': return previous(today, 'week', ws);
    case 'last_month': return previous(today, 'month', ws);
    case 'last_quarter': return previous(today, 'quarter', ws);
    case 'last_year': return previous(today, 'year', ws);
    case 'ytd': return { from: periodOf(anchor, 'year').from, to: anchor };
    case 'qtd': return { from: periodOf(anchor, 'quarter').from, to: anchor };
    case 'mtd': return { from: periodOf(anchor, 'month').from, to: anchor };
    case 'wtd': return { from: periodOf(anchor, 'week', ws).from, to: anchor };
    case 'cur_week': return periodOf(today, 'week', ws);
    case 'cur_month': return periodOf(today, 'month');
    case 'cur_quarter': return periodOf(today, 'quarter');
    case 'cur_year': return periodOf(today, 'year');
  }
}

const CALENDAR_UNIT: Partial<Record<Preset, Unit>> = {
  last_week: 'week', cur_week: 'week', wtd: 'week',
  last_month: 'month', cur_month: 'month', mtd: 'month',
  last_quarter: 'quarter', cur_quarter: 'quarter', qtd: 'quarter',
  last_year: 'year', cur_year: 'year', ytd: 'year',
};

export function rangeFor(preset: Preset, now: Date, ws: WeekStart = 'monday'): RangeSpec {
  const anchor = anchorFor(now);
  const range = windowFor(preset, anchor, ws);
  const days = diffDays(range.from, range.to) + 1;
  const factWindow = range.from > anchor ? null : { from: range.from, to: minDay(range.to, anchor) };
  const unit = CALENDAR_UNIT[preset];
  let comparison: DateWindow | null = null;
  const projected = !!factWindow && range.to > anchor;
  if (projected && unit) {
    // the whole range is projected, so it is set against the whole previous period
    comparison = periodOf(addDays(range.from, -1), unit, ws);
  } else if (projected) {
    comparison = { from: addDays(range.from, -days), to: addDays(range.from, -1) };
  } else if (factWindow && unit) {
    const prev = periodOf(addDays(range.from, -1), unit, ws);
    const len = diffDays(factWindow.from, factWindow.to) + 1;
    comparison = { from: prev.from, to: minDay(prev.to, addDays(prev.from, len - 1)) };
  } else if (factWindow) {
    comparison = { from: addDays(factWindow.from, -days), to: addDays(factWindow.to, -days) };
  }
  return { label: PRESET_LABELS[preset], anchor, range, days, factWindow, comparison, compareFact: null, endsInFuture: range.to > anchor, forecastWindow: projected ? { from: addDays(anchor, 1), to: range.to } : null };
}

/**
 * Both windows from their own start, cut to the shorter one's length, so a sum is never compared
 * with a sum over more days.
 */
export function matchedWindows(fact: DateWindow, other: DateWindow): { fact: DateWindow; other: DateWindow } {
  const n = Math.min(eachDay(fact).length, eachDay(other).length);
  return { fact: { from: fact.from, to: addDays(fact.from, n - 1) }, other: { from: other.from, to: addDays(other.from, n - 1) } };
}

const lengthOf = (w: DateWindow) => diffDays(w.from, w.to) + 1;
const precedingDays = (fact: DateWindow): DateWindow => {
  const n = lengthOf(fact);
  return { from: addDays(fact.from, -n), to: addDays(fact.from, -1) };
};
const clipTo = (w: DateWindow, anchor: Day): DateWindow | null => (w.from > anchor ? null : { from: w.from, to: minDay(w.to, anchor) });

/** The fact window one calendar year back (Feb 29 becomes Feb 28), keeping its length. */
function yearBefore(fact: DateWindow): DateWindow {
  const back = (d: Day): Day => {
    const y = Number(d.slice(0, 4)) - 1;
    return d.slice(5) === '02-29' ? `${y}-02-28` : `${y}${d.slice(4)}`;
  };
  const from = back(fact.from);
  return { from, to: addDays(from, lengthOf(fact) - 1) };
}

function baseSpec(range: RangeChoice, now: Date, ws: WeekStart): RangeSpec {
  if (range.kind === 'preset') return rangeFor(range.preset, now, ws);
  const anchor = anchorFor(now);
  const w = range.window;
  const factWindow = clipTo(w, anchor);
  const projected = !!factWindow && w.to > anchor;
  return {
    label: rangeLabel(range), anchor, range: w, days: lengthOf(w), factWindow,
    comparison: factWindow ? precedingDays(projected ? w : factWindow) : null, compareFact: null, endsInFuture: w.to > anchor,
    forecastWindow: projected ? { from: addDays(anchor, 1), to: w.to } : null,
  };
}

export function resolveRange(range: RangeChoice, compare: CompareChoice, now: Date, ws: WeekStart = 'monday'): RangeSpec {
  const base = baseSpec(range, now, ws);
  const fact = base.factWindow;
  if (compare.kind === 'off' || !fact) return { ...base, comparison: null, compareFact: null };
  if (compare.kind === 'preset') {
    // a projected range is compared over its whole length, not the part so far
    const whole = base.forecastWindow ? base.range : fact;
    if (compare.preset === 'previous_period') {
      if (base.forecastWindow) return { ...base, compareFact: null };
      // a calendar period can be shorter than the range so far (Feb vs a 31-day March): cut both to the shorter
      const m = matchedWindows(fact, base.comparison!);
      return { ...base, comparison: m.other, compareFact: m.fact.to !== fact.to ? m.fact : null };
    }
    const w = compare.preset === 'preceding_days' ? precedingDays(whole) : clipTo(yearBefore(whole), base.anchor);
    return { ...base, comparison: w, compareFact: null };
  }
  const picked = clipTo(compare.window, base.anchor);
  if (!picked) return { ...base, comparison: null, compareFact: null };
  if (base.forecastWindow) return { ...base, comparison: picked, compareFact: null };
  const m = matchedWindows(fact, picked);
  return { ...base, comparison: m.other, compareFact: m.fact.to !== fact.to ? m.fact : null };
}

function compareName(range: RangeChoice, preset: ComparePreset, now: Date, ws: WeekStart): string {
  if (preset === 'year_before') return 'Same Period Last Year';
  if (preset === 'previous_period' && range.kind === 'preset') return COMPARE_LABELS[range.preset];
  const base = baseSpec(range, now, ws);
  return `Previous ${lengthOf(base.forecastWindow ? base.range : base.factWindow ?? base.range)} Days`;
}

/** The comparison presets that make sense for this range, each with its window, all the same length as the fact window (the whole range when it is projected). */
export function compareOptions(range: RangeChoice, now: Date, ws: WeekStart = 'monday'): { preset: ComparePreset; label: string; window: DateWindow }[] {
  const base = baseSpec(range, now, ws);
  const fact = base.factWindow;
  if (!fact) return [];
  const out: { preset: ComparePreset; label: string; window: DateWindow }[] = [];
  const prev = base.comparison!;
  out.push({ preset: 'previous_period', label: compareName(range, 'previous_period', now, ws), window: prev });
  const whole = base.forecastWindow ? base.range : fact;
  const preceding = precedingDays(whole);
  if (preceding.from !== prev.from || preceding.to !== prev.to) {
    out.push({ preset: 'preceding_days', label: compareName(range, 'preceding_days', now, ws), window: preceding });
  }
  const year = clipTo(yearBefore(whole), base.anchor);
  if (year) out.push({ preset: 'year_before', label: compareName(range, 'year_before', now, ws), window: year });
  return out;
}

export const rangeLabel = (range: RangeChoice): string => (range.kind === 'preset' ? PRESET_LABELS[range.preset] : formatWindow(range.window));

/** The text after "vs" on cards; null when comparison is off. `now` matters only for the day count of a "Previous N Days" label. */
export function compareLabel(range: RangeChoice, compare: CompareChoice, now: Date, ws: WeekStart = 'monday'): string | null {
  if (compare.kind === 'off') return null;
  if (compare.kind === 'custom') return formatWindow(resolveRange(range, compare, now, ws).comparison ?? compare.window);
  return compareName(range, compare.preset, now, ws);
}

/** The closed control's text: 'This quarter vs previous', 'This quarter vs last year', 'This quarter'. */
export function controlLabel(range: RangeChoice | null, compare: CompareChoice): string {
  if (!range) return 'Select date range';
  const r = rangeLabel(range);
  if (compare.kind === 'off') return r;
  if (compare.kind === 'custom') return `${r} vs ${formatWindow(compare.window)}`;
  return `${r} vs ${compare.preset === 'year_before' ? 'last year' : compare.preset === 'preceding_days' ? 'preceding days' : 'previous'}`;
}

export const rangeKey = (range: RangeChoice): string => (range.kind === 'preset' ? range.preset : `c:${range.window.from}_${range.window.to}`);
export const compareKey = (compare: CompareChoice): string =>
  compare.kind === 'off' ? 'off' : compare.kind === 'preset' ? compare.preset : `c:${compare.window.from}_${compare.window.to}`;
