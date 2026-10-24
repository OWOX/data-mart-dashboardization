import { cacheKey, refreshCanvas } from './refresh';
import { fakeOwox } from '../owox/fake';
import { rangeFor } from '../lib/dates';
import type { Model } from '../types';

test('refresh fills every card and reports progress', async () => {
  const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'id | COUNTUNIQUE': 5, date: '2026-10-20' }] });
  const model: Model = {
    version: 1, inputHash: 'h1', builtAt: '', builtBy: 'u',
    goal: { classId: 'a', metricId: null, goalMartId: 'a', viaFallback: false },
    classes: [
      { id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: 'a:id:COUNT_DISTINCT', metricIds: ['a:id:COUNT_DISTINCT'] },
      { id: 'b', martId: 'b', title: 'B', contexts: [], depth: 1, keyMetricId: null, metricIds: [] },
    ],
    edges: [{ from: 'a', to: 'b' }],
    metrics: [{ id: 'a:id:COUNT_DISTINCT', martId: 'a', alias: 'A', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, plan: null }],
  };
  const progress: number[] = [];
  const doc = await refreshCanvas({ owox, model, spec: rangeFor('last_7d', new Date('2026-10-24T10:00:00Z')), comparisonOn: true, thresholdPct: 20, onProgress: (d) => progress.push(d) });
  expect(doc.modelHash).toBe('h1');
  expect(doc.anchor).toBe('2026-10-23');
  expect(doc.cards.a!.metrics['a:id:COUNT_DISTINCT']!.fact).toBe(5);
  expect(doc.cards.b).toEqual({ metrics: {}, spark: null });
  expect(progress).toEqual([1]);
  expect(cacheKey('last_7d', true)).toBe('last_7d:cmp');
});
