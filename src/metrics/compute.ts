import type { DateWindow, MetricDef, MetricResult, RangeSpec, SeriesPack } from '../types';
import { addDays, eachDay, minDay } from '../lib/dates';
import { describeError } from '../lib/errors';
import { diffPct, forecastFor, levelAt, planForRange, statusOf, trendOf } from '../lib/stats';
import type { OwoxLike } from '../owox/sources';
import { queryDaily, queryTotal } from './query';

export interface ComputeOut { result: MetricResult; spark: SeriesPack | null }

const empty = (over: Partial<MetricResult> = {}): MetricResult => ({
  fact: null, comparison: null, diffPct: null, plan: null, forecast: null, forecastApprox: false,
  status: 'neutral', trend: 'flat', note: null, error: null, ...over,
});

const daysIn = (w: DateWindow) => eachDay(w).length;

export async function computeMetric(args: {
  owox: OwoxLike; metric: MetricDef; spec: RangeSpec; comparisonOn: boolean; thresholdPct: number; withSpark: boolean;
}): Promise<ComputeOut> {
  const { owox, metric, spec, comparisonOn, thresholdPct, withSpark } = args;
  const { measure, martId, dateField, kind } = metric;
  try {
    if (!dateField) {
      const fact = await queryTotal(owox, martId, measure, null, null);
      return { result: empty({ fact, note: 'no_date_field', status: statusOf(fact, null, thresholdPct) }), spark: null };
    }
    const { anchor, range, factWindow } = spec;
    const comparisonWindow = comparisonOn ? spec.comparison : null;
    const historyWindow: DateWindow = {
      from: minDay(minDay(addDays(anchor, -89), comparisonWindow?.from ?? range.from), range.from),
      to: minDay(range.to, anchor),
    };
    const daily = await queryDaily(owox, martId, measure, dateField, historyWindow);

    const read = (w: DateWindow | null) =>
      !w ? Promise.resolve(null) : kind === 'flow' ? queryTotal(owox, martId, measure, dateField, w) : Promise.resolve(levelAt(daily, w));
    const fact = await read(factWindow);
    const comparison = await read(comparisonWindow);

    let forecast: number | null = null;
    let future: number[] = [];
    let note: MetricResult['note'] = null;
    if (spec.endsInFuture) {
      const f = forecastFor({ daily, anchor, rangeTo: range.to, kind, fact });
      if (f) { forecast = f.value; future = f.future.map((p) => p.v); } else note = 'short_history';
    }

    let plan: number | null = null;
    if (metric.plan) {
      const p = metric.plan;
      const planDaily = await queryDaily(owox, p.martId, p.measure, p.dateField, { from: addDays(range.from, -1), to: range.to });
      plan = planForRange(planDaily, range, p.shape);
    }

    const result: MetricResult = {
      fact, comparison, diffPct: diffPct(fact, comparison), plan, forecast,
      forecastApprox: forecast !== null && (measure.fn === 'COUNT_DISTINCT' || measure.fn === null),
      status: statusOf(forecast ?? fact, plan, thresholdPct),
      trend: trendOf(daily, factWindow ?? historyWindow),
      note, error: null,
    };

    let spark: SeriesPack | null = null;
    if (withSpark) {
      const w = factWindow && daysIn(factWindow) >= 7 ? factWindow : { from: addDays(anchor, -27), to: anchor };
      spark = {
        start: w.from,
        values: eachDay(w).map((d) => daily.get(d) ?? null),
        forecastStart: future.length ? addDays(anchor, 1) : null,
        forecast: future,
      };
    }
    return { result, spark };
  } catch (e) {
    return { result: empty({ error: describeError(e) }), spark: null };
  }
}
