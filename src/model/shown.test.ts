import { shownModel } from './shown';
import type { ClassNode, MetricDef, Model } from '../types';

const mt = (id: string, shown: boolean): MetricDef => ({ id, martId: 'a', alias: id, measure: { field: id, fn: 'SUM' }, kind: 'flow', dateField: null, role: 'critical', source: 'project', isUniqueCount: false, plan: null, shown, forecast: null });
const cl = (id: string, shown: boolean, metricIds: string[] = [], keyMetricId: string | null = metricIds[0] ?? null): ClassNode => ({ id, martId: id, title: id, contexts: [], depth: 0, keyMetricId, metricIds, shown });
const model = (classes: ClassNode[], metrics: MetricDef[]): Model => ({
  version: 2, inputHash: 'h', builtAt: 'b', builtBy: 'u', editedAt: null,
  goal: { classId: 'g', metricId: null, goalMartId: 'g', viaFallback: false }, classes, edges: [], metrics,
});

test('a hidden key metric falls back to the first shown one', () => {
  const m = shownModel(model([cl('g', true, ['k', 'x', 'y'])], [mt('k', false), mt('x', true), mt('y', true)]));
  expect(m.classes[0]!.keyMetricId).toBe('x');
  expect(m.classes[0]!.metricIds).toEqual(['x', 'y']);
});

test('with no metric shown the key is null', () => {
  const m = shownModel(model([cl('g', true, ['k'])], [mt('k', false)]));
  expect(m.classes[0]!.keyMetricId).toBeNull();
  expect(m.classes[0]!.metricIds).toEqual([]);
});

test('a hidden class is dropped; a hidden goal class is kept', () => {
  const m = shownModel(model([cl('g', false), cl('a', false), cl('b', true)], []));
  expect(m.classes.map((c) => c.id)).toEqual(['g', 'b']);
});

test('an all-shown model is returned as is', () => {
  const m = model([cl('g', true, ['k'])], [mt('k', true)]);
  expect(shownModel(m)).toBe(m);
});
