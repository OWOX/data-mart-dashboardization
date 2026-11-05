import { smooth, weekly } from './Sparkline';

const ys = (d: string) => [...d.matchAll(/[\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));

test('the smoothed curve passes through every point and never leaves their range', () => {
  const pts: [number, number][] = [[0, 10], [10, 40], [20, 5], [30, 5], [40, 30]];
  const d = smooth(pts);
  expect(d.startsWith('M0.0,10.0')).toBe(true);
  for (const [x, y] of pts.slice(1)) expect(d).toContain(`${x.toFixed(1)},${y.toFixed(1)}`);
  for (const y of ys(d)) { expect(y).toBeGreaterThanOrEqual(5); expect(y).toBeLessThanOrEqual(40); }
});

test('a flat stretch stays flat', () => {
  expect(ys(smooth([[0, 5], [10, 5], [20, 5]])).every((y) => y === 5)).toBe(true);
});

describe('weekly', () => {
  const pack = (start: string, values: (number | null)[], forecast: number[] = []) =>
    ({ start, values, forecastStart: forecast.length ? 'x' : null, forecast });

  test('a series of up to 62 days stays daily', () => {
    const s = pack('2026-01-01', Array(62).fill(1));
    expect(weekly(s)).toBe(s);
  });

  test('a longer one plots the average day of each week, part weeks included', () => {
    // 2026-01-01 is a Thursday: four days in its Monday week, then full weeks.
    const values = Array.from({ length: 63 }, (_, i) => (i < 4 ? 2 : i < 11 ? 7 : 1));
    const w = weekly(pack('2026-01-01', values));
    expect(w.start).toBe('2025-12-29');
    expect(w.values.slice(0, 3)).toEqual([2, 7, 1]);
    expect(w.values).toHaveLength(10);
  });

  test('weeks follow the week-start setting', () => {
    // 2026-01-04 is a Sunday.
    expect(weekly(pack('2026-01-04', Array(70).fill(1)), 'sunday').values).toHaveLength(10);
    expect(weekly(pack('2026-01-04', Array(70).fill(1)), 'monday').values).toHaveLength(11);
  });

  test('missing days are left out of the average; a week with none is a gap', () => {
    const values = [...Array(7).fill(null), 4, null, 8, null, null, null, null, ...Array(56).fill(1)];
    expect(weekly(pack('2026-01-05', values)).values.slice(0, 2)).toEqual([null, 6]);
  });

  test('the forecast starts at the week after the last actual day', () => {
    // Monday start; 66 actual days end on a Wednesday, so that week plots its three actual days only.
    const w = weekly(pack('2026-01-05', Array(66).fill(3), Array(25).fill(5)));
    expect(w.values).toHaveLength(10);
    expect(w.values[9]).toBe(3);
    expect(w.forecastStart).toBe('2026-03-16');
    expect(w.forecast).toEqual([5, 5, 5]);
  });
});
