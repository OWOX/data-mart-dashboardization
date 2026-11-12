import { upgradeModel } from './upgrade';
import { model as v3 } from '../test/fixtures';

// a real v2 doc: the v3 fixture without core, inbound and editedBy
const { editedBy: _editedBy, ...v3Rest } = v3;
const v2 = { ...v3Rest, version: 2, classes: v3.classes.map(({ core: _c, inbound: _i, ...c }) => c) };

const v1 = {
  version: 1, inputHash: 'h', builtAt: 'b', builtBy: 'u',
  goal: { classId: 'a', metricId: 'a:id:COUNT_DISTINCT', goalMartId: 'a', viaFallback: false },
  classes: [{ id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: 'a:id:COUNT_DISTINCT', metricIds: ['a:id:COUNT_DISTINCT'] }],
  edges: [{ from: 'a', to: 'a' }],
  metrics: [{ id: 'a:id:COUNT_DISTINCT', martId: 'a', alias: 'A', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, plan: null }],
};

test('v1 becomes v3 with everything shown, no forecast, never edited', () => {
  const m = upgradeModel(v1)!;
  expect(m.version).toBe(3);
  expect(m.editedAt).toBeNull();
  expect(m.classes[0]!.shown).toBe(true);
  expect(m.metrics[0]!.shown).toBe(true);
  expect(m.metrics[0]!.forecast).toBeNull();
  expect(m.metrics[0]!.alias).toBe('A');
});

test('a valid v2 upgrades to the v3 fixture', () => {
  expect(upgradeModel(v2)).toEqual(v3);
});

test('a valid v3 passes through', () => {
  expect(upgradeModel(v3)).toEqual(v3);
});

test('junk is rejected', () => {
  for (const junk of [null, undefined, 3, 'x', [], {}, { version: 3 }, { ...v1, version: 0 }, { ...v1, classes: 'no' }, { ...v1, goal: null }, { ...v1, metrics: [{}] }, { ...v2, editedAt: 5 }, { ...v3, editedAt: 5 }, { ...v3, editedBy: 7 }, { ...v3, classes: [{ ...v3.classes[0], inbound: -1 }] }, { ...v3, classes: [{ ...v3.classes[0], inbound: 1.5 }] },
    { ...v1, classes: [{ ...v1.classes[0], contexts: [{ id: 1 }] }] }, { ...v1, classes: [{ ...v1.classes[0], contexts: 'x' }] },
    { ...v1, classes: [{ ...v1.classes[0], depth: '0' }] }, { ...v1, classes: [{ ...v1.classes[0], keyMetricId: 5 }] },
    { ...v1, metrics: [{ ...v1.metrics[0], kind: 'weird' }] }, { ...v1, metrics: [{ ...v1.metrics[0], dateField: 3 }] },
    { ...v1, metrics: [{ ...v1.metrics[0], plan: 'x' }] }, { ...v1, metrics: [{ ...v1.metrics[0], plan: { martId: 'p' } }] }, { ...v2, classes: [{ ...v2.classes[0], shown: 'yes' }] }]) {
    expect(upgradeModel(junk)).toBeNull();
  }
});

test('a malformed forecast source becomes null and the model stays', () => {
  const metric = { ...v1.metrics[0], shown: true };
  const withForecast = (forecast: unknown) => ({ ...v2, metrics: [{ ...metric, forecast }] });
  for (const bad of [{}, 'x', { martId: 'f' }, { martId: 'f', dateField: 'd', measure: { field: 'v', fn: 'MEDIAN' } }, { martId: 'f', dateField: 'd', measure: { field: 1, fn: null } }, undefined]) {
    expect(upgradeModel(withForecast(bad))!.metrics[0]!.forecast).toBeNull();
  }
  const good = { martId: 'f', dateField: 'd', measure: { field: 'v', fn: 'SUM' } };
  expect(upgradeModel(withForecast(good))!.metrics[0]!.forecast).toEqual(good);
  expect(upgradeModel(withForecast({ ...good, measure: { field: 'v', fn: null } }))!.metrics[0]!.forecast).not.toBeNull();
});

test('a saved level ratio with a null fn loads as flow, on both versions', () => {
  const ratio = { ...v1.metrics[0], id: 'a:aov:calc', measure: { field: 'aov', fn: null }, kind: 'level' };
  const col = { ...v1.metrics[0], id: 'a:arr:SUM', measure: { field: 'arr', fn: 'SUM' }, kind: 'level' };
  const from1 = upgradeModel({ ...v1, metrics: [ratio, col] })!;
  expect(from1.metrics.map((m) => m.kind)).toEqual(['flow', 'level']);
  const from2 = upgradeModel({ ...v2, metrics: [{ ...v2.metrics[0], ...ratio, shown: true, forecast: null }] })!;
  expect(from2.metrics[0]!.kind).toBe('flow');
});

test('every metric without a valid format gets number, on both versions', () => {
  const v1m = upgradeModel(v1)!.metrics[0]!;
  expect(v1m).toMatchObject({ format: 'number', currency: null });
  const metric = { ...v1.metrics[0], shown: true, forecast: null };
  const load = (extra: object) => upgradeModel({ ...v2, metrics: [{ ...metric, ...extra }] })!.metrics[0]!;
  expect(load({})).toMatchObject({ format: 'number', currency: null });
  expect(load({ format: 'weird', currency: 'USD' })).toMatchObject({ format: 'number', currency: null });
  expect(load({ format: 'currency', currency: 'EUR' })).toMatchObject({ format: 'currency', currency: 'EUR' });
  expect(load({ format: 'currency', currency: 'nope' })).toMatchObject({ format: 'currency', currency: null });
  expect(load({ format: 'percent', currency: 'USD' })).toMatchObject({ format: 'percent', currency: null });
});

test('a saved key metric that is not first moves to the front once; the rest keep their order', () => {
  const metric = (id: string, shown = true) => ({ ...v1.metrics[0], id, shown, forecast: null });
  const doc = (keyMetricId: string) => ({ ...v2, classes: [{ ...v2.classes[0], keyMetricId, metricIds: ['x', 'y', 'z'] }], metrics: [metric('x'), metric('y'), metric('z')] });
  expect(upgradeModel(doc('z'))!.classes[0]!.metricIds).toEqual(['z', 'x', 'y']);
  expect(upgradeModel(doc('x'))!.classes[0]!.metricIds).toEqual(['x', 'y', 'z']);
  const moved = upgradeModel(doc('z'))!;
  expect(upgradeModel(moved)!.classes[0]!.metricIds).toEqual(['z', 'x', 'y']);
  // v1 too
  const old = { ...v1, classes: [{ ...v1.classes[0], keyMetricId: 'q', metricIds: ['p', 'q'] }], metrics: [{ ...v1.metrics[0], id: 'p' }, { ...v1.metrics[0], id: 'q' }] };
  expect(upgradeModel(old)!.classes[0]!.metricIds).toEqual(['q', 'p']);
});

test('a key that is already the first shown metric leaves the order alone', () => {
  const metric = (id: string, shown: boolean) => ({ ...v1.metrics[0], id, shown, forecast: null });
  const doc = { ...v2, classes: [{ ...v2.classes[0], keyMetricId: 'b', metricIds: ['a', 'b', 'c'] }], metrics: [metric('a', false), metric('b', true), metric('c', true)] };
  expect(upgradeModel(doc)!.classes[0]!.metricIds).toEqual(['a', 'b', 'c']);
});

const v2Doc = () => ({ ...v2, classes: [...v2.classes, { ...v2.classes[0]!, id: 'b', martId: 'b', title: 'B', depth: 1 }] });

test('a v2 doc becomes v3 with no core classes and no editor', () => {
  const m = upgradeModel(v2Doc())!;
  expect(m.version).toBe(3);
  expect(m.editedBy).toBeNull();
  expect(m.classes.every((c) => c.core === false && c.inbound === 0)).toBe(true);
});
test('a v3 doc keeps its core flags', () => {
  const v3 = { ...v2Doc(), version: 3, editedBy: 'u1', classes: v2Doc().classes.map((c, i) => ({ ...c, core: i === 1, inbound: 4 })) };
  const m = upgradeModel(v3)!;
  expect(m.classes.map((c) => c.core)).toEqual(v3.classes.map((c) => c.core));
  expect(m.editedBy).toBe('u1');
});
test('a v3 doc with a non-boolean core is rejected', () => {
  const bad = { ...v2Doc(), version: 3, editedBy: null, classes: v2Doc().classes.map((c) => ({ ...c, core: 'yes', inbound: 0 })) };
  expect(upgradeModel(bad)).toBeNull();
});
