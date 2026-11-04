import { upgradeModel } from './upgrade';
import { model as v2 } from '../store/collections.test';

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
  for (const junk of [null, undefined, 3, 'x', [], {}, { version: 3 }, { ...v1, version: 0 }, { ...v1, classes: 'no' }, { ...v1, goal: null }, { ...v1, metrics: [{}] }, { ...v2, editedAt: 5 }, { ...v2, classes: [{ ...v2.classes[0], shown: 'yes' }] }]) {
    expect(upgradeModel(junk)).toBeNull();
  }
});
