import { warmCache, ActionError } from './warm';
import { cachedOwox } from '../src/cache/martCache';
import { resolveRange } from '../src/lib/dates';
import { cacheKey, refreshCanvas } from '../src/metrics/refresh';
import { readSnapshot } from '../src/schedules/snapshot';
import { DEFAULT_SETTINGS } from '../src/types';
import type { OwoxLike } from '../src/owox/sources';
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

test('an unparseable deadline still keeps the 30 second reserve', async () => {
  const { store, martIds } = await setup();
  // with a NaN deadline both ranges would run; the clock jumps 200 s per read, so the fallback deadline must cut the second one
  let t = NOW.getTime();
  const clock = () => new Date(t);
  const r = await warmCache({ memberId: 'u1', martIds, ranges: [range('qtd'), range('mtd')] }, ctxOf(store, 'not a date'), () => { const d = clock(); t += 200_000; return d; });
  expect(r.ranges).toBe(1);
  expect(r.skipped).toBe(1);
});

test('nothing written while writes failed or were too large fails with CACHE_NOT_WRITTEN', async () => {
  const { store, martIds } = await setup();
  const failing = { ...store, collections: <T,>(name: string) => {
    const col = store.collections<T>(name);
    return name === 'mart-cache' ? { ...col, put: async () => { throw new Error('boom'); } } : col;
  } };
  await expect(warmCache({ memberId: 'u1', martIds, ranges: [range('qtd')] }, { owox, collections: failing.collections as never, execution: { deadlineAt: '2026-11-06T08:05:00Z' } }, () => NOW))
    .rejects.toMatchObject({ code: 'CACHE_NOT_WRITTEN' });
});

test('a run whose Data Marts return no query fails with NO_DATA', async () => {
  const { store, martIds } = await setup();
  const denied = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => { throw new Error('403'); } });
  await expect(warmCache({ memberId: 'u1', martIds, ranges: [range('qtd')] }, { ...ctxOf(store), owox: denied }, () => NOW))
    .rejects.toMatchObject({ code: 'NO_DATA', message: expect.stringContaining('may not be able to read') });
});

test('the page answers from what the Worker cached, plan Data Mart included', async () => {
  const planned: Model = {
    ...model,
    metrics: [{ ...model.metrics[0]!, plan: { martId: 'b', measure: { field: 'target', fn: 'SUM' }, dateField: 'date', shape: 'daily' } }],
  };
  const store = memoryCollections();
  const martIds = await writeSnapshot(store, planned, 'u1');
  const worker = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'Unique Count': 5, date: '2026-10-20' }] });
  const r = range('qtd');
  await warmCache({ memberId: 'u1', martIds, ranges: [r] }, { owox: worker, collections: store.collections.bind(store), execution: { deadlineAt: '2026-11-06T08:05:00Z' } }, () => NOW);
  expect(worker.calls.some((c) => c.path === 'traverse:b')).toBe(true);

  // the page: same store, same now, a model of its own built from the same slices
  const page = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'Unique Count': 5, date: '2026-10-20' }] });
  const pageModel = (await readSnapshot(store, 'u1', martIds))!;
  const spec = resolveRange(r.range as never, r.compare as never, NOW, 'monday');
  const key = cacheKey(r.range as never, r.compare as never, 'monday');
  const src = cachedOwox({ owox: page as OwoxLike, store, key, anchor: spec.anchor, mode: 'read-write', now: () => NOW });
  await refreshCanvas({ owox: src.owox, model: pageModel, spec, key, thresholdPct: DEFAULT_SETTINGS.thresholdPct });
  expect(page.calls.filter((c) => c.path.startsWith('traverse:'))).toHaveLength(0);
  expect(src.stats().hits).toBeGreaterThan(0);
});
