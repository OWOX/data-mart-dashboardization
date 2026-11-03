import { COMPARE_LABELS, PRESET_LABELS, type CompareChoice, type ComparePreset, type DateWindow, type Day, type Preset, type RangeChoice, type RangeSpec } from '../types';
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

const CALENDAR_UNIT: Partial<Record<Preset, Unit>> = {
  last_week: 'week', this_week: 'week',
  last_month: 'month', this_month: 'month',
  last_quarter: 'quarter', this_quarter: 'quarter',
  last_year: 'year', this_year: 'year', ytd: 'year',
};

export function rangeFor(preset: Preset, now: Date): RangeSpec {
  const anchor = anchorFor(now);
  const range = windowFor(preset, anchor);
  const days = diffDays(range.from, range.to) + 1;
  const factWindow = range.from > anchor ? null : { from: range.from, to: minDay(range.to, anchor) };
  const unit = CALENDAR_UNIT[preset];
  let comparison: DateWindow | null = null;
  if (factWindow && unit) {
    const prev = periodOf(addDays(range.from, -1), unit);
    const len = diffDays(factWindow.from, factWindow.to) + 1;
    comparison = { from: prev.from, to: minDay(prev.to, addDays(prev.from, len - 1)) };
  } else if (factWindow) {
    comparison = { from: addDays(factWindow.from, -days), to: addDays(factWindow.to, -days) };
  }
  return { label: PRESET_LABELS[preset], anchor, range, days, factWindow, comparison, compareFact: null, endsInFuture: range.to > anchor };
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

function baseSpec(range: RangeChoice, now: Date): RangeSpec {
  if (range.kind === 'preset') return rangeFor(range.preset, now);
  const anchor = anchorFor(now);
  const w = range.window;
  const factWindow = clipTo(w, anchor);
  return {
    label: rangeLabel(range), anchor, range: w, days: lengthOf(w), factWindow,
    comparison: factWindow ? precedingDays(factWindow) : null, compareFact: null, endsInFuture: w.to > anchor,
  };
}

export function resolveRange(range: RangeChoice, compare: CompareChoice, now: Date): RangeSpec {
  const base = baseSpec(range, now);
  const fact = base.factWindow;
  if (compare.kind === 'off' || !fact) return { ...base, comparison: null, compareFact: null };
  if (compare.kind === 'preset') {
    if (compare.preset === 'previous_period') return base;
    const w = compare.preset === 'preceding_days' ? precedingDays(fact) : clipTo(yearBefore(fact), base.anchor);
    return { ...base, comparison: w, compareFact: null };
  }
  const picked = clipTo(compare.window, base.anchor);
  if (!picked) return { ...base, comparison: null, compareFact: null };
  const m = matchedWindows(fact, picked);
  return { ...base, comparison: m.other, compareFact: m.fact.to !== fact.to ? m.fact : null };
}

const factLength = (range: RangeChoice, now: Date): number => {
  const spec = resolveRange(range, { kind: 'off' }, now);
  return spec.factWindow ? lengthOf(spec.factWindow) : spec.days;
};

function compareName(range: RangeChoice, preset: ComparePreset, now: Date): string {
  if (preset === 'year_before') return 'Same Period Last Year';
  if (preset === 'previous_period' && range.kind === 'preset') return COMPARE_LABELS[range.preset];
  return `Previous ${factLength(range, now)} Days`;
}

/** The comparison presets that make sense for this range, each with its window, all the same length as the fact window. */
export function compareOptions(range: RangeChoice, now: Date): { preset: ComparePreset; label: string; window: DateWindow }[] {
  const base = baseSpec(range, now);
  const fact = base.factWindow;
  if (!fact) return [];
  const out: { preset: ComparePreset; label: string; window: DateWindow }[] = [];
  const prev = base.comparison!;
  out.push({ preset: 'previous_period', label: compareName(range, 'previous_period', now), window: prev });
  const preceding = precedingDays(fact);
  if (preceding.from !== prev.from || preceding.to !== prev.to) {
    out.push({ preset: 'preceding_days', label: compareName(range, 'preceding_days', now), window: preceding });
  }
  const year = clipTo(yearBefore(fact), base.anchor);
  if (year) out.push({ preset: 'year_before', label: compareName(range, 'year_before', now), window: year });
  return out;
}

export const rangeLabel = (range: RangeChoice): string => (range.kind === 'preset' ? PRESET_LABELS[range.preset] : formatWindow(range.window));

/** The text after "vs" on cards; null when comparison is off. `now` only matters for the day count of a "Previous N Days" label. */
export function compareLabel(range: RangeChoice, compare: CompareChoice, now: Date = new Date()): string | null {
  if (compare.kind === 'off') return null;
  if (compare.kind === 'custom') return formatWindow(compare.window);
  return compareName(range, compare.preset, now);
}

/** The closed control's text: 'This quarter vs previous', 'This quarter vs last year', 'This quarter'. */
export function controlLabel(range: RangeChoice, compare: CompareChoice): string {
  const r = rangeLabel(range);
  if (compare.kind === 'off') return r;
  if (compare.kind === 'custom') return `${r} vs ${formatWindow(compare.window)}`;
  return `${r} vs ${compare.preset === 'year_before' ? 'last year' : compare.preset === 'preceding_days' ? 'preceding days' : 'previous'}`;
}

export const rangeKey = (range: RangeChoice): string => (range.kind === 'preset' ? range.preset : `c:${range.window.from}_${range.window.to}`);
export const compareKey = (compare: CompareChoice): string =>
  compare.kind === 'off' ? 'off' : compare.kind === 'preset' ? compare.preset : `c:${compare.window.from}_${compare.window.to}`;
