import { computeMetric } from './compute';
import { fakeOwox } from '../owox/fake';
import { rangeFor } from '../lib/dates';
import { addDays } from '../lib/dates';
import type { MetricDef } from '../types';

const metric: MetricDef = {
  id: 'm:revenue:SUM', martId: 'm', alias: 'Revenue', measure: { field: 'revenue', fn: 'SUM' }, kind: 'flow',
  dateField: 'date', role: 'critical', source: 'project', isUniqueCount: false,
  plan: { martId: 'p', measure: { field: 'revenue', fn: 'SUM' }, dateField: 'date', shape: 'daily' },
  shown: true, forecast: null,
};

// 10/day of fact for every day queried; plan 12/day.
const owox = fakeOwox({
  projectDescription: null, contexts: [], marts: [], details: {}, blendables: {},
  rows: (id, o) => {
    const f = o.filter as { value: string }[];
    const from = f[0]!.value, to = addDays(f[1]!.value, -1);
    const per = id === 'p' ? 12 : 10;
    if (o.dateTrunc) {
      const out = [];
      for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, 'revenue | SUM': String(per) });
      return out;
    }
    let days = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) days++;
    return [{ 'revenue | SUM': per * days }];
  },
});

test('this quarter: fact to date, forecast, plan, near status, spark', async () => {
  const spec = rangeFor('this_quarter', new Date('2026-10-24T10:00:00Z'));
  const { result, spark } = await computeMetric({ owox, metric, spec, thresholdPct: 20, withSpark: true });
  expect(result.fact).toBe(230);
  expect(result.comparison).toBe(230);
  expect(result.diffPct).toBe(0);
  expect(result.forecast).toBeCloseTo(920);
  expect(result.plan).toBe(12 * 92);
  expect(result.status).toBe('near');           // 920 vs 1104 is −16.7%
  expect(result.trend).toBe('flat');
  expect(spark!.values).toHaveLength(23);
  expect(spark!.forecast).toHaveLength(69);
});

test('range after the anchor: no fact, no comparison, forecast only', async () => {
  const spec = rangeFor('this_week', new Date('2026-10-26T08:00:00Z'));
  const { result } = await computeMetric({ owox, metric: { ...metric, plan: null }, spec, thresholdPct: 20, withSpark: false });
  expect(result.fact).toBeNull();
  expect(result.diffPct).toBeNull();
  expect(result.forecast).toBeCloseTo(70);
});

test('a failing query fails only this metric', async () => {
  const broken = { ...owox, dataMarts: { ...owox.dataMarts, traverseData: async () => { throw new Error('TIMEOUT'); } } };
  const { result } = await computeMetric({ owox: broken, metric, spec: { ...rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), comparison: null, compareFact: null }, thresholdPct: 20, withSpark: true });
  expect(result.error).toBe('TIMEOUT');
  expect(result.fact).toBeNull();
});

test('an AVG flow metric forecasts its level, not a sum of daily averages', async () => {
  const avg: MetricDef = { ...metric, id: 'm:revenue:AVG', measure: { field: 'revenue', fn: 'AVG' }, plan: null };
  const avgOwox = fakeOwox({
    projectDescription: null, contexts: [], marts: [], details: {}, blendables: {},
    rows: (_id, o) => {
      const f = o.filter as { value: string }[];
      if (!o.dateTrunc) return [{ 'revenue | AVG': 10 }];
      const out = [];
      for (let d = f[0]!.value; d < f[1]!.value; d = addDays(d, 1)) out.push({ date: d, 'revenue | AVG': 10 });
      return out;
    },
  });
  const spec = rangeFor('this_quarter', new Date('2026-10-24T10:00:00Z'));
  const { result } = await computeMetric({ owox: avgOwox, metric: avg, spec: { ...spec, comparison: null }, thresholdPct: 20, withSpark: false });
  expect(result.fact).toBe(10);
  expect(result.forecast).toBeCloseTo(10);
});

test('compareFact: the diff is measured from the recounted value, fact stays whole', async () => {
  const spec = { ...rangeFor('this_quarter', new Date('2026-10-24T10:00:00Z')), compareFact: { from: '2026-10-01', to: '2026-10-10' }, comparison: { from: '2026-07-01', to: '2026-07-10' } };
  const { result } = await computeMetric({ owox, metric, spec, thresholdPct: 20, withSpark: false });
  expect(result.fact).toBe(230);
  expect(result.compareFact).toBe(100);
  expect(result.comparison).toBe(100);
  expect(result.diffPct).toBe(0);
});

test('compareFact whose recount is null gives no diff rather than a mismatched one', async () => {
  const gap = fakeOwox({
    projectDescription: null, contexts: [], marts: [], details: {}, blendables: {},
    rows: (id, o) => {
      const f = o.filter as { value: string }[];
      if (!o.dateTrunc && f[1]!.value === '2026-10-11') return [];
      return base(id, o);
    },
  });
  function base(id: string, o: Record<string, unknown>) {
    const f = o.filter as { value: string }[];
    const from = f[0]!.value, to = addDays(f[1]!.value, -1);
    const per = id === 'p' ? 12 : 10;
    if (o.dateTrunc) {
      const out = [];
      for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, 'revenue | SUM': String(per) });
      return out;
    }
    let days = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) days++;
    return [{ 'revenue | SUM': per * days }];
  }
  const spec = { ...rangeFor('this_quarter', new Date('2026-10-24T10:00:00Z')), compareFact: { from: '2026-10-01', to: '2026-10-10' }, comparison: { from: '2026-07-01', to: '2026-07-10' } };
  const { result } = await computeMetric({ owox: gap, metric, spec, thresholdPct: 20, withSpark: false });
  expect(result.fact).toBe(230);
  expect(result.compareFact).toBeNull();
  expect(result.comparison).toBeNull();
  expect(result.diffPct).toBeNull();
});

test('a running range with too little history to forecast is not judged against the whole-range plan', async () => {
  // only the last 5 days have daily rows, so there is no forecast; the fact to date is far below the quarter's plan
  const young = fakeOwox({
    projectDescription: null, contexts: [], marts: [], details: {}, blendables: {},
    rows: (id, o) => {
      const f = o.filter as { value: string }[];
      const from = f[0]!.value, to = addDays(f[1]!.value, -1);
      const per = id === 'p' ? 12 : 10;
      if (o.dateTrunc) {
        const out = [];
        for (let d = from; d <= to; d = addDays(d, 1)) if (id === 'p' || d >= '2026-10-19') out.push({ date: d, 'revenue | SUM': String(per) });
        return out;
      }
      return [{ 'revenue | SUM': 50 }];
    },
  });
  const spec = rangeFor('this_quarter', new Date('2026-10-24T10:00:00Z'));
  const { result } = await computeMetric({ owox: young, metric, spec, thresholdPct: 20, withSpark: false });
  expect(result.note).toBe('short_history');
  expect(result.forecast).toBeNull();
  expect(result.plan).toBe(12 * 92);
  expect(result.status).toBe('neutral');
});

describe('forecast from a source', () => {
  const spec = () => rangeFor('this_quarter', new Date('2026-10-24T10:00:00Z'));
  // the anchor is 10-23. Forecast mart 'f' has gaps: 10-23 (the anchor), 10-25, 10-27, 12-20; every other day is missing
  const fvals: Record<string, number> = { '2026-10-23': 7, '2026-10-25': 3, '2026-10-27': 4, '2026-12-20': 9 };
  const makeF = (fvals: Record<string, number>) => fakeOwox({
    projectDescription: null, contexts: [], marts: [], details: {}, blendables: {},
    rows: (id, o) => {
      const f = o.filter as { value: string }[];
      const from = f[0]!.value, to = addDays(f[1]!.value, -1);
      if (id === 'f') {
        const hit = Object.entries(fvals).filter(([d]) => d >= from && d <= to);
        if (o.dateTrunc) return hit.map(([d, v]) => ({ date: d, 'revenue | SUM': String(v) }));
        return hit.length ? [{ 'revenue | SUM': hit.reduce((s, [, v]) => s + v, 0) }] : [{ 'revenue | SUM': null }];
      }
      const per = id === 'p' ? 12 : 10;
      if (o.dateTrunc) {
        const out = [];
        for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, 'revenue | SUM': String(per) });
        return out;
      }
      let days = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) days++;
      return [{ 'revenue | SUM': per * days }];
    },
  });
  const withF = makeF(fvals);
  const fdef = { martId: 'f', measure: { field: 'revenue', fn: 'SUM' as const }, dateField: 'date' };

  test('flow: total over the range, missing days count 0, spark starts after the anchor, status vs plan', async () => {
    const { result, spark } = await computeMetric({ owox: withF, metric: { ...metric, forecast: fdef }, spec: spec(), thresholdPct: 20, withSpark: true });
    expect(result.forecast).toBe(7 + 3 + 4 + 9);
    expect(result.warning ?? null).toBeNull();
    expect(result.plan).toBe(12 * 92);
    expect(result.status).toBe('below');
    expect(spark!.forecastStart).toBe('2026-10-24');
    expect(spark!.forecast).toHaveLength(69);
    expect(spark!.forecast.slice(0, 4)).toEqual([0, 3, 0, 4]);
    expect(spark!.forecast[addDaysIndex('2026-12-20')]).toBe(9);
    expect(spark!.forecast.at(-1)).toBe(0);
  });

  test('level: last known value on the last day, gaps carry the previous value', async () => {
    const m = { ...metric, plan: null, kind: 'level' as const, forecast: fdef };
    const { result, spark } = await computeMetric({ owox: withF, metric: m, spec: spec(), thresholdPct: 20, withSpark: true });
    expect(result.forecast).toBe(9);
    expect(spark!.forecast.slice(0, 4)).toEqual([7, 3, 3, 4]);
    expect(spark!.forecast.at(-1)).toBe(9);
  });

  const levelM = { ...metric, plan: null, kind: 'level' as const, forecast: fdef };

  test('a sparse level source: one point 20 days before the anchor carries to every day', async () => {
    const { result, spark } = await computeMetric({ owox: makeF({ '2026-10-03': 42 }), metric: levelM, spec: spec(), thresholdPct: 20, withSpark: true });
    expect(result.forecast).toBe(42);
    expect(result.warning ?? null).toBeNull();
    expect(spark!.forecast).toHaveLength(69);
    expect(spark!.forecast.every((v) => v === 42)).toBe(true);
  });

  test('a level with no value after the anchor carries the anchor value', async () => {
    const { spark } = await computeMetric({ owox: makeF({ '2026-10-23': 7 }), metric: levelM, spec: spec(), thresholdPct: 20, withSpark: true });
    expect(spark!.forecast.every((v) => v === 7)).toBe(true);
  });

  test('no data at all in the source falls back to extrapolation with a warning', async () => {
    for (const m of [{ ...metric, plan: null, forecast: fdef }, levelM]) {
      const { result } = await computeMetric({ owox: makeF({}), metric: m, spec: spec(), thresholdPct: 20, withSpark: false });
      expect(result.forecast).not.toBeNull();
      expect(result.warning).toBe('Forecast source has no data');
    }
  });

  test('a rejecting forecast query falls back to extrapolation with a warning', async () => {
    const failing = { ...withF, dataMarts: { ...withF.dataMarts, traverseData: async (id: string, o: never) => {
      if (id === 'f') throw new Error('BOOM');
      return withF.dataMarts.traverseData(id, o);
    } } } as typeof withF;
    const { result } = await computeMetric({ owox: failing, metric: { ...metric, plan: null, forecast: fdef }, spec: spec(), thresholdPct: 20, withSpark: false });
    expect(result.forecast).toBeCloseTo(920);
    expect(result.warning).toBe('Forecast source failed: BOOM');
  });

  test('a range in the past does not query the forecast mart', async () => {
    const past = { ...rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), comparison: null, compareFact: null };
    const before = withF.calls.length;
    await computeMetric({ owox: withF, metric: { ...metric, forecast: fdef }, spec: past, thresholdPct: 20, withSpark: true });
    expect(withF.calls.slice(before).some((c) => c.path === 'traverse:f')).toBe(false);
  });

  test('forecast null keeps the numbers of the previous implementation', async () => {
    // numbers are the ones the first test above asserted before forecasts came from a source
    const { result, spark } = await computeMetric({ owox, metric, spec: spec(), thresholdPct: 20, withSpark: true });
    expect(result).toEqual({
      fact: 230, compareFact: null, comparison: 230, diffPct: 0, plan: 12 * 92, forecast: expect.closeTo(920),
      forecastApprox: false, status: 'near', trend: 'flat', note: null, error: null,
    });
    expect(spark!.forecastStart).toBe('2026-10-24');
    expect(spark!.forecast).toHaveLength(69);
  });
});

const addDaysIndex = (d: string) => {
  let n = 0;
  for (let x = '2026-10-24'; x < d; x = addDays(x, 1)) n++;
  return n;
};
