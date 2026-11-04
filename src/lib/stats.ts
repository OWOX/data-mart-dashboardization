import type { DateWindow, Day, PlanShape, Status, Trend } from '../types';
import { addDays, diffDays, eachDay } from './dates';

export type DailyMap = Map<Day, number>;

export function linearFit(points: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  return { slope, intercept: (sy - slope * sx) / n };
}

const HISTORY_DAYS = 90;
const MIN_HISTORY = 14;

export function forecastFor(args: { daily: DailyMap; anchor: Day; rangeTo: Day; additive: boolean; fact: number | null }) {
  const { daily, anchor, rangeTo, additive, fact } = args;
  const start = addDays(anchor, -(HISTORY_DAYS - 1));
  const points = eachDay({ from: start, to: anchor })
    .filter((d) => daily.has(d))
    .map((d) => ({ x: diffDays(start, d), y: daily.get(d)! }));
  if (points.length < MIN_HISTORY) return null;
  const fit = linearFit(points);
  if (!fit) return null;
  const trend = (x: number) => fit.intercept + fit.slope * x;
  // The weekly pattern around the trend: the mean gap from the trend line for each weekday, centred
  // so a full week adds nothing. The forecast keeps the history's slope and its weekday rhythm,
  // instead of a straight line that reads as flat next to the history.
  const weekday = (d: Day) => new Date(`${d}T00:00:00Z`).getUTCDay();
  const gap = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  for (const p of points) {
    const g = gap[weekday(addDays(start, p.x))]!;
    g.sum += p.y - trend(p.x);
    g.n += 1;
  }
  const raw = gap.map((g) => (g.n ? g.sum / g.n : 0));
  const mean = raw.reduce((t, v) => t + v, 0) / 7;
  const season = raw.map((v) => v - mean);
  const at = (d: Day) => Math.max(0, trend(diffDays(start, d)) + season[weekday(d)]!);
  const future = rangeTo > anchor ? eachDay({ from: addDays(anchor, 1), to: rangeTo }).map((d) => ({ d, v: at(d) })) : [];
  const value = additive ? (fact ?? 0) + future.reduce((s, p) => s + p.v, 0) : at(rangeTo);
  return { value, future };
}

export function levelAt(daily: DailyMap, w: DateWindow): number | null {
  const days = eachDay(w);
  for (let i = days.length - 1; i >= 0; i--) {
    const v = daily.get(days[i]!);
    if (v !== undefined) return v;
  }
  return null;
}

export function planForRange(plan: DailyMap, range: DateWindow, shape: PlanShape): number | null {
  if (shape === 'daily') {
    const values = eachDay(range).map((d) => plan.get(d)).filter((v): v is number => v !== undefined);
    return values.length ? values.reduce((s, v) => s + v, 0) : null;
  }
  if (shape === 'level') return levelAt(plan, range);
  // cumulative plans restart (e.g. month-to-date), so sum the segments between resets
  let prev = plan.get(addDays(range.from, -1));
  let segStart = prev ?? 0;
  let total = 0;
  let seen = false;
  for (const d of eachDay(range)) {
    const v = plan.get(d);
    if (v === undefined) continue;
    if (prev !== undefined && v < prev) {
      total += prev - segStart;
      segStart = 0;
    }
    prev = v;
    seen = true;
  }
  return seen ? total + prev! - segStart : null;
}

export function statusOf(value: number | null, plan: number | null, thresholdPct: number): Status {
  if (value === null || plan === null || plan === 0) return 'neutral';
  const gap = (value - plan) / Math.abs(plan);
  if (gap > 0) return 'above';
  return gap >= -thresholdPct / 100 ? 'near' : 'below';
}

export function trendOf(daily: DailyMap, w: DateWindow): Trend {
  const points = eachDay(w)
    .filter((d) => daily.has(d))
    .map((d) => ({ x: diffDays(w.from, d), y: daily.get(d)! }));
  const fit = linearFit(points);
  const mean = points.reduce((t, p) => t + p.y, 0) / points.length;
  if (!fit || Math.abs(fit.slope) <= 1e-9 * Math.max(Math.abs(mean), 1)) return 'flat';
  return fit.slope > 0 ? 'up' : 'down';
}

export function diffPct(fact: number | null, comparison: number | null): number | null {
  if (fact === null || comparison === null || comparison === 0) return null;
  return ((fact - comparison) / Math.abs(comparison)) * 100;
}
