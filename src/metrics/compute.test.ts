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
  const { result, spark } = await computeMetric({ owox, metric, spec, comparisonOn: true, thresholdPct: 20, withSpark: true });
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
  const { result } = await computeMetric({ owox, metric: { ...metric, plan: null }, spec, comparisonOn: true, thresholdPct: 20, withSpark: false });
  expect(result.fact).toBeNull();
  expect(result.diffPct).toBeNull();
  expect(result.forecast).toBeCloseTo(70);
});

test('a failing query fails only this metric', async () => {
  const broken = { ...owox, dataMarts: { ...owox.dataMarts, traverseData: async () => { throw new Error('TIMEOUT'); } } };
  const { result } = await computeMetric({ owox: broken, metric, spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), comparisonOn: false, thresholdPct: 20, withSpark: true });
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
  const { result } = await computeMetric({ owox: avgOwox, metric: avg, spec, comparisonOn: false, thresholdPct: 20, withSpark: false });
  expect(result.fact).toBe(10);
  expect(result.forecast).toBeCloseTo(10);
});

test('comparePicked reads the picked period over the same days; recounts the value only when cut short', async () => {
  const { comparePicked } = await import('./compute');
  const calls: string[] = [];
  const owox = { dataMarts: { traverseData: async (_id: string, o: Record<string, unknown>) => { calls.push(JSON.stringify(o)); return { async *rowChunks() { yield [{ 'amount | SUM': 42 }]; } }; } } } as never;
  const metric = { id: 'm', martId: 'mart', alias: 'Rev', measure: { field: 'amount', fn: 'SUM' }, kind: 'flow', dateField: 'date', role: 'critical', source: 'project', isUniqueCount: false, plan: null } as never;
  const now = new Date('2026-11-02T10:00:00Z'); // yesterday is Nov 1, so this quarter so far is 32 days
  const year = await comparePicked(owox, metric, 'this_quarter', 'last_year', now);
  expect(year).toMatchObject({ fact: null, comparison: 42, trimmed: false, comparisonWindow: { from: '2025-01-01', to: '2025-02-01' } });
  expect(calls).toHaveLength(1);
  const day = await comparePicked(owox, metric, 'this_quarter', 'yesterday', now);
  expect(day).toMatchObject({ fact: 42, comparison: 42, trimmed: true, factWindow: { from: '2026-10-01', to: '2026-10-01' } });
});

test('compareFact: the diff is measured from the recounted value, fact stays whole', async () => {
  const spec = { ...rangeFor('this_quarter', new Date('2026-10-24T10:00:00Z')), compareFact: { from: '2026-10-01', to: '2026-10-10' }, comparison: { from: '2026-07-01', to: '2026-07-10' } };
  const { result } = await computeMetric({ owox, metric, spec, comparisonOn: true, thresholdPct: 20, withSpark: false });
  expect(result.fact).toBe(230);
  expect(result.compareFact).toBe(100);
  expect(result.comparison).toBe(100);
  expect(result.diffPct).toBe(0);
});
