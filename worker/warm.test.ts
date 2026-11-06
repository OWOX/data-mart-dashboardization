import { warmCache, ActionError } from './warm';
import { cachedOwox } from '../src/cache/martCache';
import { resolveRange } from '../src/lib/dates';
import { cacheKey, refreshCanvas } from '../src/metrics/refresh';
import { DEFAULT_SETTINGS } from '../src/types';
import type { OwoxLike } from '../src/owox/sources';
import { loadOntology, memoryCollections, saveOntology } from '../src/store/collections';
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

// the member's own ontology, which the run reads as that member
async function setup(m: Model = model) {
  const store = memoryCollections();
  await saveOntology(store, m);
  return store;
}
const ctxOf = (store: ReturnType<typeof memoryCollections>, deadline = '2026-11-06T08:05:00Z', o: unknown = owox) =>
  ({ owox: o, collections: store.collections.bind(store), execution: { deadlineAt: deadline } });
const warm = (store: ReturnType<typeof memoryCollections>, ranges: unknown[], deadline?: string, o?: unknown, now: () => Date = () => NOW) =>
  warmCache({ ranges }, ctxOf(store, deadline, o), now);

test('a run writes one cache doc per Data Mart, with the queries of every range', async () => {
  const store = await setup();
  const r = await warm(store, [range('qtd'), range('last_month')]);
  expect(r.ranges).toBe(2);
  expect(r.skipped).toBe(0);
  expect(r.queries).toBeGreaterThan(0);
  const doc = await store.collections<MartCacheDoc>(MART_CACHE).get('a:qtd:off');
  expect(doc?.document.anchor).toBe('2026-11-05'); // the anchor is the last complete day
});

test('an invalid input fails with INVALID_RANGES', async () => {
  await expect(warm(await setup(), [])).rejects.toMatchObject({ code: 'INVALID_RANGES' });
});

test('no model of the member fails with MODEL_MISSING', async () => {
  const err = warm(memoryCollections(), [range('qtd')]);
  await expect(err).rejects.toBeInstanceOf(ActionError);
  await expect(err).rejects.toMatchObject({ code: 'MODEL_MISSING', message: 'Open Gyroscope once so it builds your model.' });
});

test('with under 30 seconds left no new range starts', async () => {
  expect(await warm(await setup(), [range('qtd'), range('mtd')], '2026-11-06T08:00:20Z')).toMatchObject({ ranges: 0, skipped: 2 });
});

test('an unparseable deadline still keeps the 30 second reserve', async () => {
  // with a NaN deadline both ranges would run; the clock jumps 200 s per read, so the fallback deadline must cut the second one
  let t = NOW.getTime();
  const r = await warm(await setup(), [range('qtd'), range('mtd')], 'not a date', undefined, () => { const d = new Date(t); t += 200_000; return d; });
  expect(r.ranges).toBe(1);
  expect(r.skipped).toBe(1);
});

test('nothing written while writes failed or were too large fails with CACHE_NOT_WRITTEN', async () => {
  const store = await setup();
  const failing = { ...store, collections: <T,>(name: string) => {
    const col = store.collections<T>(name);
    return name === 'mart-cache' ? { ...col, put: async () => { throw new Error('boom'); } } : col;
  } };
  await expect(warmCache({ ranges: [range('qtd')] }, { owox, collections: failing.collections as never, execution: { deadlineAt: '2026-11-06T08:05:00Z' } }, () => NOW))
    .rejects.toMatchObject({ code: 'CACHE_NOT_WRITTEN' });
});

test('a run whose Data Marts return no query fails with NO_DATA', async () => {
  const denied = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => { throw new Error('403'); } });
  await expect(warm(await setup(), [range('qtd')], undefined, denied)).rejects.toMatchObject({ code: 'NO_DATA', message: expect.stringContaining('may not be able to read') });
});

test('a model whose classes list no metric is not NO_DATA', async () => {
  const bare: Model = { ...model, classes: [{ ...model.classes[0]!, metricIds: [], keyMetricId: null }] };
  expect(await warm(await setup(bare), [range('qtd')])).toMatchObject({ ranges: 1, queries: 0 });
});

test('the page answers from what the Worker cached, plan Data Mart included', async () => {
  const planned: Model = {
    ...model,
    metrics: [{ ...model.metrics[0]!, plan: { martId: 'b', measure: { field: 'target', fn: 'SUM' }, dateField: 'date', shape: 'daily' } }],
  };
  const store = await setup(planned);
  const worker = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'Unique Count': 5, date: '2026-10-20' }] });
  const r = range('qtd');
  await warm(store, [r], undefined, worker);
  expect(worker.calls.some((c) => c.path === 'traverse:b')).toBe(true);

  // the page: same store, same now, the same ontology
  const page = fakeOwox({ projectDescription: null, contexts: [], marts: [], details: {}, blendables: {}, rows: () => [{ 'Unique Count': 5, date: '2026-10-20' }] });
  const pageModel = (await loadOntology(store))!;
  const spec = resolveRange(r.range as never, r.compare as never, NOW, 'monday');
  const key = cacheKey(r.range as never, r.compare as never, 'monday');
  const src = cachedOwox({ owox: page as OwoxLike, store, key, anchor: spec.anchor, mode: 'read-write', now: () => NOW });
  await refreshCanvas({ owox: src.owox, model: pageModel, spec, key, thresholdPct: DEFAULT_SETTINGS.thresholdPct });
  expect(page.calls.filter((c) => c.path.startsWith('traverse:'))).toHaveLength(0);
  expect(src.stats().hits).toBeGreaterThan(0);
});

test('a member without an ontology falls back to the project model', async () => {
  const store = memoryCollections();
  await store.collections<Model>('model').put('current', model);
  const r = await warm(store, [range('qtd')]);
  expect(r.ranges).toBe(1);
  expect(r.marts).toBe(1);
});
