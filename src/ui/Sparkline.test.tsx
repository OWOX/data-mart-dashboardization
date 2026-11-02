import { smooth } from './Sparkline';

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
