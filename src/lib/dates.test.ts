import { addDays, anchorFor, diffDays, eachDay, rangeFor } from './dates';

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
  ['this_week', '2026-10-19', '2026-10-25'],
  ['this_month', '2026-10-01', '2026-10-31'],
  ['this_quarter', '2026-10-01', '2026-12-31'],
  ['this_year', '2026-01-01', '2026-12-31'],
] as const)('%s on Sat 2026-10-24', (preset, from, to) => {
  const r = rangeFor(preset, at('2026-10-24T10:00:00Z'));
  expect(r.anchor).toBe('2026-10-23');
  expect(r.range).toEqual({ from, to });
});

test('this quarter: fact clipped to anchor, comparison shifted by range length', () => {
  const r = rangeFor('this_quarter', at('2026-10-24T10:00:00Z'));
  expect(r.days).toBe(92);
  expect(r.factWindow).toEqual({ from: '2026-10-01', to: '2026-10-23' });
  expect(r.comparison).toEqual({ from: '2026-07-01', to: '2026-07-23' });
  expect(r.endsInFuture).toBe(true);
});

test('past range: comparison is the previous same-length window', () => {
  const r = rangeFor('last_7d', at('2026-10-24T10:00:00Z'));
  expect(r.comparison).toEqual({ from: '2026-10-10', to: '2026-10-16' });
  expect(r.endsInFuture).toBe(false);
});

test('this week on a Monday starts after the anchor', () => {
  const r = rangeFor('this_week', at('2026-10-26T08:00:00Z'));
  expect(r.range).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  expect(r.factWindow).toBeNull();
  expect(r.comparison).toBeNull();
});

test('ytd on Jan 1 covers the previous year', () => {
  expect(rangeFor('ytd', at('2027-01-01T08:00:00Z')).range).toEqual({ from: '2026-01-01', to: '2026-12-31' });
});

test.each([
  ['this_month', '2026-10-24T10:00:00Z', '2026-09-01', '2026-09-23'],
  ['last_month', '2026-10-24T10:00:00Z', '2026-08-01', '2026-08-30'],
  ['ytd', '2026-10-24T10:00:00Z', '2025-01-01', '2025-10-23'],
  ['this_month', '2026-03-05T10:00:00Z', '2026-02-01', '2026-02-04'],
  ['this_month', '2026-03-31T10:00:00Z', '2026-02-01', '2026-02-28'],
] as const)('calendar comparison aligns to previous period: %s at %s', (preset, now, from, to) => {
  expect(rangeFor(preset, at(now)).comparison).toEqual({ from, to });
});
