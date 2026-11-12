import type { DateWindow, MetricDef, MetricResult, RangeSpec, SeriesPack } from '../types';
import { addDays, eachDay, maxDay, minDay } from '../lib/dates';
import { describeError, statusOf as httpStatus } from '../lib/errors';
import { diffPct, forecastFor, HISTORY_DAYS, levelAt, planForRange, statusOf, trendOf } from '../lib/stats';
import type { OwoxLike } from '../owox/sources';
import { queryDaily, queryTotal } from './query';

export interface ComputeOut { result: MetricResult; spark: SeriesPack | null }

const empty = (over: Partial<MetricResult> = {}): MetricResult => ({
  fact: null, compareFact: null, comparison: null, diffPct: null, plan: null, forecast: null, forecastApprox: false,
  status: 'neutral', trend: 'flat', note: null, error: null, ...over,
});

class NoData extends Error {}

const daysIn = (w: DateWindow) => eachDay(w).length;

export async function computeMetric(args: {
  owox: OwoxLike; metric: MetricDef; spec: RangeSpec; thresholdPct: number; withSpark: boolean;
}): Promise<ComputeOut> {
  const { owox, metric, spec, thresholdPct, withSpark } = args;
  const { measure, martId, dateField, kind } = metric;
  const unique = metric.isUniqueCount;
  try {
    if (!dateField) {
      const fact = await queryTotal(owox, martId, measure, null, null, unique);
      return { result: empty({ fact, note: 'no_date_field', status: statusOf(fact, null, thresholdPct) }), spark: null };
    }
    const { anchor, range, factWindow } = spec;
    const comparisonWindow = spec.comparison;
    const historyWindow: DateWindow = {
      from: minDay(minDay(addDays(anchor, -(HISTORY_DAYS - 1)), comparisonWindow?.from ?? range.from), range.from),
      to: minDay(range.to, anchor),
    };
    const daily = await queryDaily(owox, martId, measure, dateField, historyWindow, unique);

    const read = (w: DateWindow | null) =>
      !w ? Promise.resolve(null) : kind === 'flow' ? queryTotal(owox, martId, measure, dateField, w, unique) : Promise.resolve(levelAt(daily, w));
    const fact = await read(factWindow);
    const comparison = await read(comparisonWindow);
    const compareFact = comparisonWindow ? await read(spec.compareFact) : null;

    let forecast: number | null = null;
    let future: number[] = [];
    let note: MetricResult['note'] = null;
    let warning: string | null = null;
    let forecastMeasure = measure;
    let source: NonNullable<MetricResult['projection']>['source'] | null = null;
    // what a period's value means for this metric: sums and counts accumulate, a level is read at the range's end,
    // an average blends the days; a min, max, other distinct count or calculated metric has no period value to project
    const mode = kind === 'level' ? 'level' : measure.fn === 'SUM' || measure.fn === 'COUNT' || metric.isUniqueCount ? 'additive' : measure.fn === 'AVG' ? 'avg' : 'none';
    const factDays = factWindow ? daysIn(factWindow) : 0;
    const blend = (fut: number[]) => ((fact ?? 0) * (fact === null ? 0 : factDays) + fut.reduce((t, v) => t + v, 0)) / (fut.length + (fact === null ? 0 : factDays));
    if (spec.endsInFuture && mode !== 'none') {
      let sourced = false;
      if (metric.forecast) {
        const fc = metric.forecast;
        try {
          // the latest days are what matters, so the row cap must never cut them; a sparse level source
          // (month-start snapshots) needs a long lookback to find the value it carries forward
          const from = maxDay(range.from, addDays(anchor, kind === 'flow' ? -1 : -89));
          const fcDaily = await queryDaily(owox, fc.martId, fc.measure, fc.dateField, { from, to: range.to });
          if (!fcDaily.size) throw new NoData();
          const days = eachDay({ from: addDays(anchor, 1), to: range.to });
          if (kind === 'flow') {
            // the mart supplies only the days after the anchor; the days before it keep their actuals
            future = days.map((d) => fcDaily.get(d) ?? 0);
            forecast = mode === 'avg' ? blend(future) : (fact ?? 0) + future.reduce((t, v) => t + v, 0);
          } else {
            forecast = levelAt(fcDaily, range);
            if (forecast === null) throw new NoData();
            // a level carries its last value over a missing day; days before its first point take that point
            let prev = levelAt(fcDaily, { from, to: anchor });
            const carried = days.map((d) => { prev = fcDaily.get(d) ?? prev; return prev; });
            const first = carried.find((v) => v !== null) ?? forecast;
            future = carried.map((v) => v ?? first);
          }
          forecastMeasure = fc.measure;
          source = { kind: 'mart', martId: fc.martId, field: fc.measure.field };
          sourced = true;
        } catch (e) {
          warning = e instanceof NoData ? 'Forecast source has no data' : `Forecast source failed: ${describeError(e)}`;
          forecast = null;
          future = [];
        }
      }
      if (!sourced) {
        // summing daily averages or ratios means nothing, so only counts and sums accumulate; a unique count adds up
        // only because uniqueCount: [''] counts the mart's own primary key and each row has one date value (a joined alias's per-day counts wouldn't)
        const f = forecastFor({ daily, anchor, rangeTo: range.to, additive: mode === 'additive', fact });
        if (f) { forecast = mode === 'avg' ? blend(f.future.map((p) => p.v)) : f.value; future = f.future.map((p) => p.v); source = { kind: 'trend', days: HISTORY_DAYS }; } else note = 'short_history';
      }
    }

    let plan: number | null = null;
    if (metric.plan) {
      const p = metric.plan;
      // a plan that can't be read leaves the fact in place, without a plan
      try {
        const planDaily = await queryDaily(owox, p.martId, p.measure, p.dateField, { from: addDays(range.from, -1), to: range.to });
        plan = planForRange(planDaily, range, p.shape);
      } catch (e) {
        plan = null;
        // a refusal is a no-access case and stays quiet; anything else is shown
        const st = httpStatus(e);
        if (st !== 401 && st !== 403) warning = `Couldn't load the plan: ${describeError(e)}`;
      }
    }

    // a projected range is judged by its forecast over the whole period; without one, a partial total against a
    // whole period would mislead, so there is no comparison at all
    const { forecastWindow } = spec;
    const projection = forecastWindow && factWindow && forecast !== null && source ? { actual: fact, factWindow, forecastWindow, source } : null;
    const unfair = !!forecastWindow && !projection;
    const result: MetricResult = {
      fact, compareFact,
      // a cut fact window whose recount failed has no day-for-day partner, so no comparison at all
      comparison: unfair || (spec.compareFact && compareFact === null) ? null : comparison,
      diffPct: unfair ? null : diffPct(projection ? forecast : spec.compareFact ? compareFact : fact, comparison), plan, forecast, projection,
      forecastApprox: forecast !== null && (mode === 'avg' || forecastMeasure.fn === 'COUNT_DISTINCT' || forecastMeasure.fn === null),
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
