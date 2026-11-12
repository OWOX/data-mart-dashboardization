import { contextsOf, layoutFor, ontologyLayout } from './layout';
import type { ClassNode, Model } from '../types';

const c = (id: string, depth: number, ctx: string[] = []): ClassNode => ({ id, martId: id, title: id.toUpperCase(), depth, keyMetricId: null, metricIds: [], shown: true, core: false, inbound: 0, contexts: ctx.map((x) => ({ id: x, name: x })) });
const model = {
  goal: { classId: 'm' },
  classes: [c('m', 0), c('a', 1, ['growth']), c('b', 2, ['sales']), c('z', 1, ['sales'])],
  edges: [{ from: 'm', to: 'a' }, { from: 'a', to: 'b' }, { from: 'm', to: 'z' }],
} as unknown as Model;

const ids = (l: ReturnType<typeof layoutFor>) => [l.main?.id ?? null, l.drivers.map((x) => x.id)];

test('main alone on top, every other class in one band below', () => {
  const l = layoutFor(model, new Set());
  expect(ids(l)).toEqual(['m', ['a', 'z', 'b']]);
  expect(l.connectors).toEqual([
    { from: 'a', to: 'b', dashed: false, join: true, fields: [] },
    { from: 'm', to: 'a', dashed: false, join: false, fields: [] },
    { from: 'm', to: 'z', dashed: false, join: false, fields: [] },
  ]);
});

test('filter keeps main and bridges hidden classes with dashed connectors', () => {
  const l = layoutFor(model, new Set(['sales']));
  expect(ids(l)).toEqual(['m', ['z', 'b']]);
  expect(l.connectors).toEqual([
    { from: 'm', to: 'b', dashed: true, join: false, fields: [] },
    { from: 'm', to: 'z', dashed: false, join: false, fields: [] },
  ]);
});

test('contexts are unique and sorted', () => {
  expect(contextsOf(model).map((x) => x.id)).toEqual(['growth', 'sales']);
});

test('links between drivers and back into main are kept; a pair linked both ways is one line', () => {
  const m2 = {
    goal: { classId: 'm' },
    classes: [c('m', 0), c('a', 1), c('z', 1)],
    edges: [{ from: 'm', to: 'a' }, { from: 'a', to: 'z' }, { from: 'z', to: 'a' }, { from: 'z', to: 'm' }],
  } as unknown as Model;
  expect(layoutFor(m2, new Set()).connectors).toEqual([
    { from: 'a', to: 'z', dashed: false, join: true, fields: [] },
    { from: 'm', to: 'a', dashed: false, join: false, fields: [] },
    { from: 'z', to: 'm', dashed: false, join: false, fields: [] },
  ]);
});

test('solid wins over a dashed path to the same pair', () => {
  const m3 = {
    goal: { classId: 'm' },
    classes: [c('m', 0), c('h', 1, ['x']), c('a', 2, ['y'])],
    edges: [{ from: 'm', to: 'a' }, { from: 'm', to: 'h' }, { from: 'h', to: 'a' }],
  } as unknown as Model;
  expect(layoutFor(m3, new Set(['y'])).connectors).toEqual([{ from: 'm', to: 'a', dashed: false, join: false, fields: [] }]);
});

test('a direct line carries the calculated fields it stands for; a bridged one carries none', () => {
  const m4 = {
    goal: { classId: 'm' },
    classes: [c('m', 0), c('h', 1, ['x']), c('a', 1, ['y'])],
    edges: [{ from: 'm', to: 'h', fields: ['ltv'] }, { from: 'h', to: 'a', fields: ['cac'] }],
  } as unknown as Model;
  expect(layoutFor(m4, new Set()).connectors.map((x) => x.fields)).toEqual([['cac'], ['ltv']]);
  expect(layoutFor(m4, new Set(['y'])).connectors).toEqual([{ from: 'm', to: 'a', dashed: true, join: false, fields: [] }]);
});

const oc = (id: string, over: Partial<ClassNode> = {}): ClassNode => ({ ...c(id, 1), ...over });

test('ontology layout has the goal, the core classes by inbound, and lines among them only', () => {
  const m = {
    goal: { classId: 'g' },
    classes: [oc('g', { depth: 0 }), oc('a', { core: true, inbound: 1 }), oc('b', { core: true, inbound: 5 }), oc('x')],
    edges: [{ from: 'g', to: 'a' }, { from: 'g', to: 'b' }, { from: 'a', to: 'b' }, { from: 'g', to: 'x' }],
  } as unknown as Model;
  const l = ontologyLayout(m, new Set());
  expect(l.goal?.id).toBe('g');
  expect(l.core.map((x) => x.id)).toEqual(['b', 'a']);
  expect(l.connectors.map((x) => `${x.from}>${x.to}`).sort()).toEqual(['a>b', 'g>a', 'g>b']);
  expect(l.connectors.every((x) => !x.dashed)).toBe(true);
});

test('ontology ties on inbound break by title; chips filter core classes but the goal stays', () => {
  const m = {
    goal: { classId: 'g' },
    classes: [oc('g', { depth: 0 }), oc('b', { core: true, contexts: [{ id: 's', name: 's' }] }), oc('a', { core: true })],
    edges: [],
  } as unknown as Model;
  expect(ontologyLayout(m, new Set()).core.map((x) => x.id)).toEqual(['a', 'b']);
  const l = ontologyLayout(m, new Set(['s']));
  expect(l.goal?.id).toBe('g');
  expect(l.core.map((x) => x.id)).toEqual(['b']);
});
