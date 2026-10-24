import type { DateWindow, Day, MetricKind, PlanShape, Status, Trend } from '../types';
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

export function forecastFor(args: { daily: DailyMap; anchor: Day; rangeTo: Day; kind: MetricKind; fact: number | null }) {
  const { daily, anchor, rangeTo, kind, fact } = args;
  const start = addDays(anchor, -(HISTORY_DAYS - 1));
  const points = eachDay({ from: start, to: anchor })
    .filter((d) => daily.has(d))
    .map((d) => ({ x: diffDays(start, d), y: daily.get(d)! }));
  if (points.length < MIN_HISTORY) return null;
  const fit = linearFit(points);
  if (!fit) return null;
  const at = (d: Day) => Math.max(0, fit.intercept + fit.slope * diffDays(start, d));
  const future = rangeTo > anchor ? eachDay({ from: addDays(anchor, 1), to: rangeTo }).map((d) => ({ d, v: at(d) })) : [];
  const value = kind === 'level' ? at(rangeTo) : (fact ?? 0) + future.reduce((s, p) => s + p.v, 0);
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
  const end = levelAt(plan, range);
  if (shape === 'level' || end === null) return end;
  const base = plan.get(addDays(range.from, -1));
  const first = plan.get(range.from);
  if (base === undefined || (first !== undefined && base > first)) return end;
  return end - base;
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
  if (!fit || fit.slope === 0) return 'flat';
  return fit.slope > 0 ? 'up' : 'down';
}

export function diffPct(fact: number | null, comparison: number | null): number | null {
  if (fact === null || comparison === null || comparison === 0) return null;
  return ((fact - comparison) / Math.abs(comparison)) * 100;
}
