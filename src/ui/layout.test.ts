import { contextsOf, layoutFor } from './layout';
import type { ClassNode, Model } from '../types';

const c = (id: string, depth: number, ctx: string[] = []): ClassNode => ({ id, martId: id, title: id.toUpperCase(), depth, keyMetricId: null, metricIds: [], contexts: ctx.map((x) => ({ id: x, name: x })) });
const model = {
  goal: { classId: 'm' },
  classes: [c('m', 0), c('a', 1, ['growth']), c('b', 2, ['sales']), c('z', 1, ['sales'])],
  edges: [{ from: 'm', to: 'a' }, { from: 'a', to: 'b' }, { from: 'm', to: 'z' }],
} as unknown as Model;

test('all classes by depth', () => {
  const l = layoutFor(model, new Set());
  expect(l.rows.map((r) => r.map((x) => x.id))).toEqual([['m'], ['a', 'z'], ['b']]);
  expect(l.connectors).toEqual([
    { from: 'a', to: 'b', dashed: false }, { from: 'm', to: 'a', dashed: false }, { from: 'm', to: 'z', dashed: false },
  ]);
});

test('filter keeps main and bridges hidden classes with dashed connectors', () => {
  const l = layoutFor(model, new Set(['sales']));
  expect(l.rows.map((r) => r.map((x) => x.id))).toEqual([['m'], ['z'], ['b']]);
  expect(l.connectors).toEqual([{ from: 'm', to: 'b', dashed: true }, { from: 'm', to: 'z', dashed: false }]);
});

test('contexts are unique and sorted', () => {
  expect(contextsOf(model).map((x) => x.id)).toEqual(['growth', 'sales']);
});
