import { upgradeModel } from './upgrade';
import { model as v2 } from '../test/fixtures';

const v1 = {
  version: 1, inputHash: 'h', builtAt: 'b', builtBy: 'u',
  goal: { classId: 'a', metricId: 'a:id:COUNT_DISTINCT', goalMartId: 'a', viaFallback: false },
  classes: [{ id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: 'a:id:COUNT_DISTINCT', metricIds: ['a:id:COUNT_DISTINCT'] }],
  edges: [{ from: 'a', to: 'a' }],
  metrics: [{ id: 'a:id:COUNT_DISTINCT', martId: 'a', alias: 'A', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, plan: null }],
};

test('v1 becomes v2 with everything shown, no forecast, never edited', () => {
  const m = upgradeModel(v1)!;
  expect(m.version).toBe(2);
  expect(m.editedAt).toBeNull();
  expect(m.classes[0]!.shown).toBe(true);
  expect(m.metrics[0]!.shown).toBe(true);
  expect(m.metrics[0]!.forecast).toBeNull();
  expect(m.metrics[0]!.alias).toBe('A');
});

test('a valid v2 passes through', () => {
  expect(upgradeModel(v2)).toEqual(v2);
});

test('junk is rejected', () => {
  for (const junk of [null, undefined, 3, 'x', [], {}, { version: 3 }, { ...v1, version: 0 }, { ...v1, classes: 'no' }, { ...v1, goal: null }, { ...v1, metrics: [{}] }, { ...v2, editedAt: 5 },
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
