import type { RangeChoice } from '../types';
import { formatWindow } from './format';
import { PRESET_LABELS } from '../types';
import { addDays, anchorFor, compareLabel, compareOptions, controlLabel, diffDays, eachDay, matchedWindows, rangeFor, resolveRange } from './dates';

const at = (iso: string) => new Date(iso);

test('day arithmetic is UTC', () => {
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  expect(diffDays('2026-10-01', '2026-10-23')).toBe(22);
  expect(eachDay({ from: '2026-10-30', to: '2026-11-01' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  expect(anchorFor(at('2026-10-24T00:30:00Z'))).toBe('2026-10-23');
});

test.each([
  ['yesterday', '2026-10-23', '2026-10-23'],
  ['last_7d', '2026-10-17', '2026-10-23'],
  ['last_28d', '2026-09-26', '2026-10-23'],
  ['last_week', '2026-10-12', '2026-10-18'],
  ['last_month', '2026-09-01', '2026-09-30'],
  ['last_quarter', '2026-07-01', '2026-09-30'],
  ['last_year', '2025-01-01', '2025-12-31'],
  ['ytd', '2026-01-01', '2026-10-23'],
  ['cur_week', '2026-10-19', '2026-10-25'],
  ['cur_month', '2026-10-01', '2026-10-31'],
  ['cur_quarter', '2026-10-01', '2026-12-31'],
  ['cur_year', '2026-01-01', '2026-12-31'],
  ['qtd', '2026-10-01', '2026-10-23'],
  ['mtd', '2026-10-01', '2026-10-23'],
  ['wtd', '2026-10-19', '2026-10-23'],
] as const)('%s on Sat 2026-10-24', (preset, from, to) => {
  const r = rangeFor(preset, at('2026-10-24T10:00:00Z'));
  expect(r.anchor).toBe('2026-10-23');
  expect(r.range).toEqual({ from, to });
});

test('this quarter to date: comparison is the same days of the previous quarter', () => {
  const r = rangeFor('qtd', at('2026-10-24T10:00:00Z'));
  expect(r.days).toBe(23);
  expect(r.factWindow).toEqual({ from: '2026-10-01', to: '2026-10-23' });
  expect(r.comparison).toEqual({ from: '2026-07-01', to: '2026-07-23' });
  expect(r.endsInFuture).toBe(false);
  expect(r.forecastWindow).toBeNull();
});

test('this quarter: fact clipped to anchor, forecast for the rest, comparison is the whole previous quarter', () => {
  const r = rangeFor('cur_quarter', at('2026-10-24T10:00:00Z'));
  expect(r.days).toBe(92);
  expect(r.factWindow).toEqual({ from: '2026-10-01', to: '2026-10-23' });
  expect(r.forecastWindow).toEqual({ from: '2026-10-24', to: '2026-12-31' });
  expect(r.comparison).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  expect(r.endsInFuture).toBe(true);
});

const NOV = at('2026-11-05T10:00:00Z'); // anchor Nov 4

test('a projected month is compared as a whole, in every way', () => {
  const r = rangeFor('cur_month', NOV);
  expect(r.range).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  expect(r.factWindow).toEqual({ from: '2026-11-01', to: '2026-11-04' });
  expect(r.forecastWindow).toEqual({ from: '2026-11-05', to: '2026-11-30' });
  const spec = (c: Parameters<typeof resolveRange>[1]) => resolveRange(P('cur_month'), c, NOV);
  expect(spec(PREV)).toMatchObject({ comparison: { from: '2026-10-01', to: '2026-10-31' }, compareFact: null });
  expect(spec({ kind: 'preset', preset: 'preceding_days' })).toMatchObject({ comparison: { from: '2026-10-02', to: '2026-10-31' }, compareFact: null });
  expect(spec({ kind: 'preset', preset: 'year_before' })).toMatchObject({ comparison: { from: '2025-11-01', to: '2025-11-30' }, compareFact: null });
  expect(spec({ kind: 'custom', window: { from: '2026-09-01', to: '2026-09-10' } })).toMatchObject({ comparison: { from: '2026-09-01', to: '2026-09-10' }, compareFact: null });
  expect(compareOptions(P('cur_month'), NOV).map((o) => [o.preset, o.label])).toEqual([
    ['previous_period', 'Last Month'], ['preceding_days', 'Previous 30 Days'], ['year_before', 'Same Period Last Year'],
  ]);
});

test('a month to date is compared with the same days of the last month', () => {
  const r = resolveRange(P('mtd'), PREV, NOV);
  expect(r.range).toEqual({ from: '2026-11-01', to: '2026-11-04' });
  expect(r.comparison).toEqual({ from: '2026-10-01', to: '2026-10-04' });
  expect(r.forecastWindow).toBeNull();
  expect(compareLabel(P('mtd'), PREV, NOV)).toBe('Last Month to Date');
  // on the 1st the anchor is in October, so the month to date is all of October
  expect(rangeFor('mtd', at('2026-11-01T10:00:00Z')).range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
});

test('a projected year is compared with the whole last year', () => {
  expect(resolveRange(P('cur_year'), PREV, NOV).comparison).toEqual({ from: '2025-01-01', to: '2025-12-31' });
});

test('a custom range past the anchor is compared with the days before it', () => {
  const r = resolveRange({ kind: 'custom', window: { from: '2026-11-01', to: '2026-11-10' } }, PREV, NOV);
  expect(r.comparison).toEqual({ from: '2026-10-22', to: '2026-10-31' });
  expect(r.forecastWindow).toEqual({ from: '2026-11-05', to: '2026-11-10' });
});

test('past range: comparison is the previous same-length window', () => {
  const r = rangeFor('last_7d', at('2026-10-24T10:00:00Z'));
  expect(r.comparison).toEqual({ from: '2026-10-10', to: '2026-10-16' });
  expect(r.endsInFuture).toBe(false);
});

test('this week on a Monday starts after the anchor', () => {
  const r = rangeFor('cur_week', at('2026-10-26T08:00:00Z'));
  expect(r.range).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  expect(r.factWindow).toBeNull();
  expect(r.comparison).toBeNull();
});

test('ytd on Jan 1 covers the previous year', () => {
  expect(rangeFor('ytd', at('2027-01-01T08:00:00Z')).range).toEqual({ from: '2026-01-01', to: '2026-12-31' });
});

test.each([
  ['mtd', '2026-10-24T10:00:00Z', '2026-09-01', '2026-09-23'],
  ['last_month', '2026-10-24T10:00:00Z', '2026-08-01', '2026-08-30'],
  ['ytd', '2026-10-24T10:00:00Z', '2025-01-01', '2025-10-23'],
  ['mtd', '2026-03-05T10:00:00Z', '2026-02-01', '2026-02-04'],
  ['mtd', '2026-03-31T10:00:00Z', '2026-02-01', '2026-02-28'],
] as const)('calendar comparison aligns to previous period: %s at %s', (preset, now, from, to) => {
  expect(rangeFor(preset, at(now)).comparison).toEqual({ from, to });
});

const NOW = at('2026-11-03T10:00:00Z'); // anchor Nov 2
const P = (preset: Parameters<typeof rangeFor>[0]) => ({ kind: 'preset', preset }) as const;
const PREV = { kind: 'preset', preset: 'previous_period' } as const;
const OFF = { kind: 'off' } as const;

test.each(['cur_quarter', 'last_28d', 'yesterday'] as const)('resolveRange %s with previous_period equals rangeFor', (preset) => {
  const r = resolveRange(P(preset), PREV, NOW);
  const { label: _l, ...want } = rangeFor(preset, NOW);
  expect(r).toMatchObject(want);
  expect(r.label).toBe(PRESET_LABELS[preset]);
  expect(r.compareFact).toBeNull();
});

test('matchedWindows cuts both windows to the shorter length from their starts', () => {
  expect(matchedWindows({ from: '2026-10-01', to: '2026-11-01' }, { from: '2025-01-01', to: '2025-12-31' }))
    .toEqual({ fact: { from: '2026-10-01', to: '2026-11-01' }, other: { from: '2025-01-01', to: '2025-02-01' } });
  expect(matchedWindows({ from: '2026-10-01', to: '2026-11-01' }, { from: '2026-11-01', to: '2026-11-01' }))
    .toEqual({ fact: { from: '2026-10-01', to: '2026-10-01' }, other: { from: '2026-11-01', to: '2026-11-01' } });
});

test('custom range ending in the future is clipped; one starting after the anchor has no fact or comparison', () => {
  const r = resolveRange({ kind: 'custom', window: { from: '2026-10-20', to: '2026-11-30' } }, PREV, NOW);
  expect(r.factWindow).toEqual({ from: '2026-10-20', to: '2026-11-02' });
  expect(r.endsInFuture).toBe(true);
  expect(r.days).toBe(42);
  expect(r.comparison).toEqual({ from: '2026-09-08', to: '2026-10-19' }); // the 42 days before the range
  expect(r.label).toBe('Oct 20 – Nov 30, 2026');
  const later = resolveRange({ kind: 'custom', window: { from: '2026-11-03', to: '2026-11-10' } }, PREV, NOW);
  expect(later.factWindow).toBeNull();
  expect(later.comparison).toBeNull();
});

test('year_before maps Feb 29 to Feb 28 and keeps the length', () => {
  const r = resolveRange({ kind: 'custom', window: { from: '2024-02-29', to: '2024-02-29' } }, { kind: 'preset', preset: 'year_before' }, NOW);
  expect(r.comparison).toEqual({ from: '2023-02-28', to: '2023-02-28' });
  const span = resolveRange({ kind: 'custom', window: { from: '2024-01-01', to: '2024-03-01' } }, { kind: 'preset', preset: 'year_before' }, NOW);
  expect(span.comparison).toEqual({ from: '2023-01-01', to: '2023-03-02' });
});

test('compareOptions: preceding_days only when it differs from previous_period', () => {
  expect(compareOptions(P('last_7d'), NOW).map((o) => o.preset)).toEqual(['previous_period', 'year_before']);
  const month = compareOptions(P('cur_month'), NOW);
  expect(month.map((o) => o.preset)).toEqual(['previous_period', 'preceding_days', 'year_before']);
  expect(month[1]).toMatchObject({ label: 'Previous 30 Days', window: { from: '2026-10-02', to: '2026-10-31' } });
  expect(compareOptions({ kind: 'custom', window: { from: '2026-11-03', to: '2026-11-04' } }, NOW)).toEqual([]);
});

test('custom comparison is matched to the fact window; compareFact is set only when the fact is cut', () => {
  const range = { kind: 'custom', window: { from: '2026-10-01', to: '2026-11-02' } } as const; // 33 days
  const short = resolveRange(range, { kind: 'custom', window: { from: '2026-07-01', to: '2026-07-10' } }, NOW);
  expect(short.comparison).toEqual({ from: '2026-07-01', to: '2026-07-10' });
  expect(short.compareFact).toEqual({ from: '2026-10-01', to: '2026-10-10' });
  const long = resolveRange(range, { kind: 'custom', window: { from: '2026-06-01', to: '2026-07-10' } }, NOW); // 40 days
  expect(eachDay(long.comparison!)).toHaveLength(33);
  expect(long.compareFact).toBeNull();
});

test('a comparison window never ends after the anchor', () => {
  const ranges = [P('cur_quarter'), P('cur_week'), P('yesterday'), P('last_28d'), P('ytd'),
    { kind: 'custom', window: { from: '2026-10-25', to: '2026-12-31' } } as const];
  const cmps = [PREV, { kind: 'preset', preset: 'preceding_days' } as const, { kind: 'preset', preset: 'year_before' } as const,
    { kind: 'custom', window: { from: '2026-10-30', to: '2026-12-31' } } as const];
  for (const r of ranges) for (const c of cmps) {
    const s = resolveRange(r, c, NOW);
    if (s.comparison) expect(s.comparison.to <= s.anchor).toBe(true);
  }
});

test('labels', () => {
  expect(controlLabel(P('cur_quarter'), PREV)).toBe('This quarter vs previous');
  expect(controlLabel(P('cur_quarter'), OFF)).toBe('This quarter');
  expect(controlLabel(P('cur_quarter'), { kind: 'preset', preset: 'year_before' })).toBe('This quarter vs last year');
  expect(controlLabel(P('cur_quarter'), { kind: 'custom', window: { from: '2026-07-01', to: '2026-08-02' } })).toBe('This quarter vs Jul 1 – Aug 2, 2026');
  expect(controlLabel({ kind: 'custom', window: { from: '2026-10-01', to: '2026-11-02' } }, OFF)).toBe('Oct 1 – Nov 2, 2026');
  expect(compareLabel(P('cur_quarter'), PREV, NOW)).toBe('Last Quarter');
  expect(compareLabel({ kind: 'custom', window: { from: '2026-10-01', to: '2026-11-02' } }, PREV, NOW)).toBe('Previous 33 Days');
  expect(compareLabel(P('cur_quarter'), { kind: 'preset', preset: 'year_before' }, NOW)).toBe('Same Period Last Year');
  expect(compareLabel(P('cur_quarter'), OFF, NOW)).toBeNull();
});

test('previous_period on a calendar preset is matched day for day: March 1-30 vs February', () => {
  const r = resolveRange(P('mtd'), PREV, at('2026-03-31T10:00:00Z')); // anchor Mar 30
  expect(r.factWindow).toEqual({ from: '2026-03-01', to: '2026-03-30' });
  expect(r.comparison).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  expect(r.compareFact).toEqual({ from: '2026-03-01', to: '2026-03-28' });
});

test('a custom comparison label shows the resolved window, not the raw pick', () => {
  const r: RangeChoice = { kind: 'custom', window: { from: '2026-10-01', to: '2026-10-10' } };
  expect(compareLabel(r, { kind: 'custom', window: { from: '2026-07-01', to: '2026-07-31' } }, NOW)).toBe(formatWindow({ from: '2026-07-01', to: '2026-07-10' }));
});

test('week presets follow the week start; Monday is the default', () => {
  const now = at('2026-10-24T10:00:00Z'); // Saturday
  expect(rangeFor('cur_week', now).range).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  expect(rangeFor('cur_week', now, 'sunday').range).toEqual({ from: '2026-10-18', to: '2026-10-24' });
  expect(rangeFor('last_week', now, 'sunday').range).toEqual({ from: '2026-10-11', to: '2026-10-17' });
  expect(rangeFor('last_week', now, 'sunday').label).toBe('Last week');
});

test('resolveRange and compareOptions pass the week start through', () => {
  const now = at('2026-10-24T10:00:00Z');
  const w = { kind: 'preset', preset: 'wtd' } as const;
  const spec = resolveRange(w, { kind: 'preset', preset: 'previous_period' }, now, 'sunday');
  expect(spec.range).toEqual({ from: '2026-10-18', to: '2026-10-23' });
  // the fact window ends yesterday (Oct 23), so the comparison is cut to the same six days
  expect(spec.comparison).toEqual({ from: '2026-10-11', to: '2026-10-16' });
  expect(compareOptions(w, now, 'sunday')[0]!.window).toEqual({ from: '2026-10-11', to: '2026-10-16' });
});
