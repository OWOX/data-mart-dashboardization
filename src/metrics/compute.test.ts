import { computeMetric } from './compute';
import { fakeOwox } from '../owox/fake';
import { rangeFor } from '../lib/dates';
import { addDays } from '../lib/dates';
import type { MetricDef } from '../types';

const metric: MetricDef = {
  id: 'm:revenue:SUM', martId: 'm', alias: 'Revenue', measure: { field: 'revenue', fn: 'SUM' }, kind: 'flow',
  dateField: 'date', role: 'critical', source: 'project', isUniqueCount: false,
  plan: { martId: 'p', measure: { field: 'revenue', fn: 'SUM' }, dateField: 'date', shape: 'daily' },
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
