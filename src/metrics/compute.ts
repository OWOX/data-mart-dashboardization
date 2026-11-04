import type { DateWindow, MetricDef, MetricResult, RangeSpec, SeriesPack } from '../types';
import { addDays, eachDay, minDay } from '../lib/dates';
import { describeError } from '../lib/errors';
import { diffPct, forecastFor, levelAt, planForRange, statusOf, trendOf } from '../lib/stats';
import type { OwoxLike } from '../owox/sources';
import { queryDaily, queryTotal } from './query';

export interface ComputeOut { result: MetricResult; spark: SeriesPack | null }

const empty = (over: Partial<MetricResult> = {}): MetricResult => ({
  fact: null, compareFact: null, comparison: null, diffPct: null, plan: null, forecast: null, forecastApprox: false,
  status: 'neutral', trend: 'flat', note: null, error: null, ...over,
});

const daysIn = (w: DateWindow) => eachDay(w).length;

export async function computeMetric(args: {
  owox: OwoxLike; metric: MetricDef; spec: RangeSpec; thresholdPct: number; withSpark: boolean;
}): Promise<ComputeOut> {
  const { owox, metric, spec, thresholdPct, withSpark } = args;
  const { measure, martId, dateField, kind } = metric;
  try {
    if (!dateField) {
      const fact = await queryTotal(owox, martId, measure, null, null);
      return { result: empty({ fact, note: 'no_date_field', status: statusOf(fact, null, thresholdPct) }), spark: null };
    }
    const { anchor, range, factWindow } = spec;
    const comparisonWindow = spec.comparison;
    const historyWindow: DateWindow = {
      from: minDay(minDay(addDays(anchor, -89), comparisonWindow?.from ?? range.from), range.from),
      to: minDay(range.to, anchor),
    };
    const daily = await queryDaily(owox, martId, measure, dateField, historyWindow);

    const read = (w: DateWindow | null) =>
      !w ? Promise.resolve(null) : kind === 'flow' ? queryTotal(owox, martId, measure, dateField, w) : Promise.resolve(levelAt(daily, w));
    const fact = await read(factWindow);
    const comparison = await read(comparisonWindow);
    const compareFact = comparisonWindow ? await read(spec.compareFact) : null;

    let forecast: number | null = null;
    let future: number[] = [];
    let note: MetricResult['note'] = null;
    let warning: string | null = null;
    let forecastMeasure = measure;
    if (spec.endsInFuture) {
      let sourced = false;
      if (metric.forecast) {
        const fc = metric.forecast;
        try {
          const fcDaily = await queryDaily(owox, fc.martId, fc.measure, fc.dateField, range);
          forecast = kind === 'flow' ? await queryTotal(owox, fc.martId, fc.measure, fc.dateField, range) : levelAt(fcDaily, range);
          // a level carries its last value over a missing day, a flow counts none
          let prev = kind === 'flow' ? 0 : levelAt(fcDaily, { from: range.from, to: anchor }) ?? 0;
          future = eachDay({ from: addDays(anchor, 1), to: range.to }).map((d) => {
            const v = fcDaily.get(d);
            if (v !== undefined) prev = v;
            return kind === 'flow' ? v ?? 0 : prev;
          });
          forecastMeasure = fc.measure;
          sourced = true;
        } catch (e) {
          warning = `Forecast source failed: ${describeError(e)}`;
          forecast = null;
          future = [];
        }
      }
      if (!sourced) {
        // summing daily averages or ratios means nothing, so only counts and sums accumulate
        const additive = kind === 'flow' && (measure.fn === 'SUM' || measure.fn === 'COUNT' || metric.isUniqueCount);
        const f = forecastFor({ daily, anchor, rangeTo: range.to, additive, fact });
        if (f) { forecast = f.value; future = f.future.map((p) => p.v); } else note = 'short_history';
      }
    }

    let plan: number | null = null;
    if (metric.plan) {
      const p = metric.plan;
      const planDaily = await queryDaily(owox, p.martId, p.measure, p.dateField, { from: addDays(range.from, -1), to: range.to });
      plan = planForRange(planDaily, range, p.shape);
    }

    const result: MetricResult = {
      fact, compareFact,
      // a cut fact window whose recount failed has no day-for-day partner, so no comparison at all
      comparison: spec.compareFact && compareFact === null ? null : comparison,
      diffPct: diffPct(spec.compareFact ? compareFact : fact, comparison), plan, forecast,
      forecastApprox: forecast !== null && (forecastMeasure.fn === 'COUNT_DISTINCT' || forecastMeasure.fn === null),
      // a range still running is judged by its forecast; without one there is nothing fair to judge yet
      status: statusOf(spec.endsInFuture ? forecast : fact, plan, thresholdPct),
      trend: trendOf(daily, factWindow ?? historyWindow),
      note, error: null, ...(warning ? { warning } : {}),
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
