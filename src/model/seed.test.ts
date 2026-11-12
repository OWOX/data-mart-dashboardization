import { seedFrom, withoutUndated } from './seed';
import type { MartDetail } from '../owox/sources';
import type { ClassNode, MetricDef, Model } from '../types';

const c = (id: string, depth: number): ClassNode => ({ id, martId: id, title: id, contexts: [], depth, keyMetricId: `${id}:k`, metricIds: [`${id}:k`], shown: true, core: false, inbound: 0 });
const m = (martId: string): MetricDef => ({ id: `${martId}:k`, martId, alias: martId, measure: { field: 'k', fn: 'SUM' }, kind: 'flow', dateField: null, role: 'critical', source: 'project', isUniqueCount: false, format: 'number', currency: null, plan: null, shown: true, forecast: null });
const project: Model = {
  version: 3, inputHash: 'h', builtAt: 'b', builtBy: 'u', editedAt: null, editedBy: null,
  goal: { classId: 'g', metricId: 'g:k', goalMartId: 'g', viaFallback: false },
  classes: [c('g', 0), c('a', 1), c('b', 1)],
  edges: [{ from: 'g', to: 'a' }, { from: 'g', to: 'b' }, { from: 'a', to: 'b' }],
  metrics: [m('g'), m('a'), m('b')],
};

test('keeps accessible classes and drops the rest with their edges and metrics', () => {
  const s = seedFrom(project, new Set(['g', 'a']));
  expect(s.classes.map((x) => x.id)).toEqual(['g', 'a']);
  expect(s.edges).toEqual([{ from: 'g', to: 'a' }]);
  expect(s.metrics.map((x) => x.martId)).toEqual(['g', 'a']);
  expect(s.inputHash).toBe('h');
});

test('the goal class stays when the member cannot access it', () => {
  const s = seedFrom(project, new Set(['b']));
  expect(s.classes.map((x) => x.id)).toEqual(['g', 'b']);
  expect(s.edges).toEqual([{ from: 'g', to: 'b' }]);
  expect(s.metrics.map((x) => x.martId)).toEqual(['g', 'b']);
});

const schema = (id: string, dated: boolean): MartDetail => ({ id, title: id, fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, ...(dated ? [{ name: 'at', type: 'timestamp', isPrimaryKey: false }] : [])] });

test('withoutUndated drops classes without a date field; the goal class and classes with no schema to hand stay', () => {
  const s = withoutUndated(project, new Map([['g', schema('g', false)], ['a', schema('a', false)]]));
  expect(s.classes.map((x) => x.id)).toEqual(['g', 'b']);
  expect(s.edges).toEqual([{ from: 'g', to: 'b' }]);
  expect(s.metrics.map((x) => x.martId)).toEqual(['g', 'b']);
  expect(withoutUndated(project, new Map([['a', schema('a', true)]]))).toBe(project);
});
