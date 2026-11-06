import { warmCache, ActionError } from './warm';
import { memoryCollections } from '../src/store/collections';
import { writeSnapshot } from '../src/schedules/snapshot';
import { MART_CACHE, type MartCacheDoc } from '../src/cache/martCache';
import { fakeOwox } from '../src/owox/fake';
import { model as fixtureModel } from '../src/test/fixtures';
import type { Model } from '../src/types';

const metricId = 'a:id:COUNT_DISTINCT';
const model: Model = {
  ...fixtureModel,
  classes: [{ id: 'a', martId: 'a', title: 'A', contexts: [], depth: 0, keyMetricId: metricId, metricIds: [metricId], shown: true }],
  metrics: [{ id: metricId, martId: 'a', alias: 'A', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, kind: 'flow', dateField: 'date', role: 'unique', source: 'schema', isUniqueCount: true, format: 'number', currency: null, plan: null, shown: true, forecast: null }],
};
const owox = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'Unique Count': 5, date: '2026-10-20' }] });

const NOW = new Date('2026-11-06T08:00:00Z');
const range = (preset: string) => ({ range: { kind: 'preset', preset }, compare: { kind: 'off' }, weekStart: 'monday' });

async function setup() {
  const store = memoryCollections();
  const martIds = await writeSnapshot(store, model, 'u1');
  return { store, martIds };
}
const ctxOf = (store: ReturnType<typeof memoryCollections>, deadline = '2026-11-06T08:05:00Z') =>
  ({ owox, collections: store.collections.bind(store), execution: { deadlineAt: deadline } });

test('a run writes one cache doc per Data Mart and range', async () => {
  const { store, martIds } = await setup();
  const r = await warmCache({ memberId: 'u1', martIds, ranges: [range('qtd'), range('last_month')] }, ctxOf(store), () => NOW);
  expect(r.ranges).toBe(2);
  expect(r.skipped).toBe(0);
  expect(r.queries).toBeGreaterThan(0);
  const doc = await store.collections<MartCacheDoc>(MART_CACHE).get(`${martIds[0]}:qtd:off`);
  expect(doc?.document.anchor).toBe('2026-11-05'); // the anchor is the last complete day
});

test('an invalid input fails with INVALID_RANGES', async () => {
  const { store } = await setup();
  await expect(warmCache({ memberId: 'u1', martIds: [], ranges: [] }, ctxOf(store), () => NOW)).rejects.toMatchObject({ code: 'INVALID_RANGES' });
});

test('no snapshot fails with MODEL_MISSING', async () => {
  const { store, martIds } = await setup();
  await expect(warmCache({ memberId: 'u2', martIds, ranges: [range('qtd')] }, ctxOf(store), () => NOW)).rejects.toBeInstanceOf(ActionError);
  await expect(warmCache({ memberId: 'u2', martIds, ranges: [range('qtd')] }, ctxOf(store), () => NOW)).rejects.toMatchObject({ code: 'MODEL_MISSING' });
});

test('with under 30 seconds left no new range starts', async () => {
  const { store, martIds } = await setup();
  const r = await warmCache({ memberId: 'u1', martIds, ranges: [range('qtd'), range('mtd')] }, ctxOf(store, '2026-11-06T08:00:20Z'), () => NOW);
  expect(r).toMatchObject({ ranges: 0, skipped: 2 });
});
