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
