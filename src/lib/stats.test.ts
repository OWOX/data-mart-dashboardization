import { diffPct, forecastFor, levelAt, linearFit, planForRange, statusOf, trendOf } from './stats';
import { addDays } from './dates';

const series = (from: string, values: number[]) => new Map(values.map((v, i) => [addDays(from, i), v]));

test('linear fit', () => {
  expect(linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toEqual({ slope: 2, intercept: 1 });
  expect(linearFit([{ x: 0, y: 1 }])).toBeNull();
});

test('flow forecast adds fitted remaining days to fact', () => {
  const daily = series('2026-07-26', Array.from({ length: 90 }, () => 10)); // flat 10/day to 2026-10-23
  const f = forecastFor({ daily, anchor: '2026-10-23', rangeTo: '2026-10-31', additive: true, fact: 230 });
  expect(f!.value).toBeCloseTo(230 + 8 * 10);
  expect(f!.future).toHaveLength(8);
  expect(f!.future[0]).toEqual({ d: '2026-10-24', v: 10 });
});

test('a non-additive flow forecast is the fitted value at range end, not a sum', () => {
  const daily = series('2026-07-26', Array.from({ length: 90 }, () => 10));
  const f = forecastFor({ daily, anchor: '2026-10-23', rangeTo: '2026-10-31', additive: false, fact: 10 });
  expect(f!.value).toBeCloseTo(10);
});

test('level forecast is the fitted value on the last day', () => {
  const daily = series('2026-07-26', Array.from({ length: 90 }, (_, i) => 100 + i)); // +1/day, 189 on anchor
  const f = forecastFor({ daily, anchor: '2026-10-23', rangeTo: '2026-10-31', additive: false, fact: 189 });
  expect(f!.value).toBeCloseTo(197);
});

test('short history gives no forecast; fitted values never go negative', () => {
  expect(forecastFor({ daily: series('2026-10-15', [1, 2, 3]), anchor: '2026-10-23', rangeTo: '2026-10-31', additive: true, fact: 6 })).toBeNull();
  const falling = series('2026-07-26', Array.from({ length: 90 }, (_, i) => 90 - i));
  const f = forecastFor({ daily: falling, anchor: '2026-10-23', rangeTo: '2026-12-31', additive: true, fact: 0 });
  expect(f!.future.every((p) => p.v >= 0)).toBe(true);
});

test('plan shapes', () => {
  const range = { from: '2026-10-01', to: '2026-10-03' };
  expect(planForRange(series('2026-10-01', [5, 5, 5]), range, 'daily')).toBe(15);
  expect(planForRange(series('2026-09-30', [999, 10, 20, 30]), range, 'cumulative')).toBe(30); // restart at range start
  expect(planForRange(series('2026-09-30', [10, 20, 30, 40]), { from: '2026-10-01', to: '2026-10-02' }, 'cumulative')).toBe(20);
  expect(planForRange(series('2026-10-01', [7, 8]), range, 'level')).toBe(8);
  expect(planForRange(new Map(), range, 'daily')).toBeNull();
});

test('levelAt picks the last day with data', () => {
  expect(levelAt(series('2026-10-01', [1, 2]), { from: '2026-10-01', to: '2026-10-05' })).toBe(2);
  expect(levelAt(new Map(), { from: '2026-10-01', to: '2026-10-05' })).toBeNull();
});

test.each([
  [110, 100, 'above'], [100, 100, 'near'], [85, 100, 'near'], [80, 100, 'near'], [79, 100, 'below'],
  [50, null, 'neutral'], [50, 0, 'neutral'], [null, 100, 'neutral'],
] as const)('status %s vs %s', (value, plan, expected) => {
  expect(statusOf(value, plan, 20)).toBe(expected);
});

test('trend and diff', () => {
  const w = { from: '2026-10-01', to: '2026-10-03' };
  expect(trendOf(series('2026-10-01', [1, 2, 3]), w)).toBe('up');
  expect(trendOf(series('2026-10-01', [3, 2, 1]), w)).toBe('down');
  expect(trendOf(series('2026-10-01', [2, 2, 2]), w)).toBe('flat');
  expect(diffPct(110, 100)).toBeCloseTo(10);
  expect(diffPct(90, -100)).toBeCloseTo(190);
  expect(diffPct(1, 0)).toBeNull();
  expect(diffPct(null, 1)).toBeNull();
});

test('trend of a constant non-integer series is flat', () => {
  expect(trendOf(series('2026-10-01', Array(7).fill(0.1)), { from: '2026-10-01', to: '2026-10-07' })).toBe('flat');
  expect(trendOf(series('2026-10-01', Array(28).fill(12.34)), { from: '2026-10-01', to: '2026-10-28' })).toBe('flat');
});

test('cumulative plan sums segments across resets inside the range', () => {
  const plan = new Map([['2026-10-30', 300], ['2026-10-31', 310], ['2026-11-01', 10], ['2026-11-02', 20]]);
  expect(planForRange(plan, { from: '2026-10-30', to: '2026-11-02' }, 'cumulative')).toBe(330);
});
