import { cachedOwox, martCacheId, stableJson, MART_CACHE, MAX_CACHE_CHARS, type MartCacheDoc } from './martCache';
import { memoryCollections } from '../store/collections';
import type { OwoxLike } from '../owox/sources';

const NOW = new Date('2026-11-06T08:00:00Z');
const ANCHOR = '2026-11-06';
const KEY = 'qtd:previous_period';

function fakeSource(rows: (martId: string, options: Record<string, unknown>) => Record<string, unknown>[]) {
  const calls: { martId: string; options: Record<string, unknown> }[] = [];
  const owox: OwoxLike = {
    getJson: async () => { throw new Error('unused'); },
    project: { getSettings: async () => ({ description: null }) },
    dataMarts: {
      list: async () => [],
      traverseData: async (martId, options) => {
        calls.push({ martId, options });
        const r = rows(martId, options);
        return { async *rowChunks() { yield r.slice(0, 1); yield r.slice(1); } };
      },
    },
  };
  return { owox, calls };
}

async function read(o: OwoxLike, martId: string, options: Record<string, unknown>) {
  const out: Record<string, unknown>[] = [];
  for await (const c of (await o.dataMarts.traverseData(martId, options)).rowChunks()) out.push(...c);
  return out;
}

const opts = { column: ['amount'], aggregation: [{ column: 'amount', function: 'SUM' }], limit: 1 };

test('stableJson ignores key order', () => {
  expect(stableJson({ b: 1, a: { d: 2, c: [1, { f: 1, e: 2 }] } })).toBe(stableJson({ a: { c: [1, { e: 2, f: 1 }], d: 2 }, b: 1 }));
});

test('a miss queries live, and the flush writes the rows under the Data Mart and range with its parentId', async () => {
  const store = memoryCollections();
  const src = fakeSource(() => [{ v: 1 }, { v: 2 }]);
  const c = cachedOwox({ owox: src.owox, store, key: KEY, anchor: ANCHOR, mode: 'read-write', now: () => NOW });
  expect(await read(c.owox, 'm1', opts)).toEqual([{ v: 1 }, { v: 2 }]);
  const r = await c.flush();
  expect(r).toEqual({ written: ['m1:' + KEY], failed: [], tooLarge: [] });
  const doc = (await store.collections<MartCacheDoc>(MART_CACHE).get(martCacheId('m1', KEY)))!.document;
  expect(doc.anchor).toBe(ANCHOR);
  expect(doc.queries[stableJson(opts)]!.rows).toEqual([{ v: 1 }, { v: 2 }]);
  expect(store.parentOf(MART_CACHE, 'm1:' + KEY)).toBe('m1');
  expect(c.stats()).toEqual({ hits: 0, misses: 1, oldestHit: null });
});

test('a hit answers from the cache without a live query', async () => {
  const store = memoryCollections();
  const at = '2026-11-06T06:00:00.000Z';
  await store.collections<MartCacheDoc>(MART_CACHE).put('m1:' + KEY, { v: 1, anchor: ANCHOR, fetchedAt: at, queries: { [stableJson(opts)]: { rows: [{ v: 9 }], at } } }, { parentId: 'm1' });
  const src = fakeSource(() => [{ v: 1 }]);
  const c = cachedOwox({ owox: src.owox, store, key: KEY, anchor: ANCHOR, mode: 'read-write', now: () => NOW });
  expect(await read(c.owox, 'm1', { limit: 1, aggregation: opts.aggregation, column: opts.column })).toEqual([{ v: 9 }]);
  expect(src.calls).toHaveLength(0);
  expect(c.stats()).toEqual({ hits: 1, misses: 0, oldestHit: at });
  expect((await c.flush()).written).toEqual([]);
});

test('a doc of another day serves nothing, and its queries are dropped on flush', async () => {
  const store = memoryCollections();
  const old = { other: { rows: [{ v: 0 }], at: '2026-11-05T06:00:00.000Z' }, [stableJson(opts)]: { rows: [{ v: 0 }], at: '2026-11-05T06:00:00.000Z' } };
  await store.collections<MartCacheDoc>(MART_CACHE).put('m1:' + KEY, { v: 1, anchor: '2026-11-05', fetchedAt: '2026-11-05T06:00:00.000Z', queries: old });
  const src = fakeSource(() => [{ v: 5 }]);
  const c = cachedOwox({ owox: src.owox, store, key: KEY, anchor: ANCHOR, mode: 'read-write', now: () => NOW });
  expect(await read(c.owox, 'm1', opts)).toEqual([{ v: 5 }]);
  await c.flush();
  const doc = (await store.collections<MartCacheDoc>(MART_CACHE).get('m1:' + KEY))!.document;
  expect(Object.keys(doc.queries)).toEqual([stableJson(opts)]);
});

test('write-only skips reads but keeps the queries already cached today', async () => {
  const store = memoryCollections();
  const at = '2026-11-06T06:00:00.000Z';
  await store.collections<MartCacheDoc>(MART_CACHE).put('m1:' + KEY, { v: 1, anchor: ANCHOR, fetchedAt: at, queries: { other: { rows: [{ v: 3 }], at }, [stableJson(opts)]: { rows: [{ v: 9 }], at } } });
  const src = fakeSource(() => [{ v: 4 }]);
  const c = cachedOwox({ owox: src.owox, store, key: KEY, anchor: ANCHOR, mode: 'write-only', now: () => NOW });
  expect(await read(c.owox, 'm1', opts)).toEqual([{ v: 4 }]);
  await c.flush();
  const doc = (await store.collections<MartCacheDoc>(MART_CACHE).get('m1:' + KEY))!.document;
  expect(doc.queries.other!.rows).toEqual([{ v: 3 }]);
  expect(doc.queries[stableJson(opts)]!.rows).toEqual([{ v: 4 }]);
  expect(doc.fetchedAt).toBe(NOW.toISOString());
});

test('parallel queries of one Data Mart load its doc once and all land in one write', async () => {
  const store = memoryCollections();
  let gets = 0;
  const counted = { collections<T>(name: string) { const col = store.collections<T>(name); return { get: (id: string) => { gets++; return col.get(id); }, put: col.put }; } };
  const src = fakeSource((_m, o) => [{ v: o.limit }]);
  const c = cachedOwox({ owox: src.owox, store: counted, key: KEY, anchor: ANCHOR, mode: 'read-write', now: () => NOW });
  await Promise.all([1, 2, 3].map((n) => read(c.owox, 'm1', { limit: n })));
  await c.flush();
  expect(gets).toBe(1);
  const doc = (await store.collections<MartCacheDoc>(MART_CACHE).get('m1:' + KEY))!.document;
  expect(Object.keys(doc.queries)).toHaveLength(3);
});

test('a failed live query is not recorded, and a failed read of the doc counts as a miss', async () => {
  const store = memoryCollections();
  const broken = { collections<T>(name: string) { const col = store.collections<T>(name); return { get: async () => { throw new Error('403'); }, put: col.put }; } };
  const owox: OwoxLike = { ...fakeSource(() => []).owox, dataMarts: { list: async () => [], traverseData: async () => { throw new Error('boom'); } } };
  const c = cachedOwox({ owox, store: broken, key: KEY, anchor: ANCHOR, mode: 'read-write', now: () => NOW });
  await expect(read(c.owox, 'm1', opts)).rejects.toThrow('boom');
  expect((await c.flush()).written).toEqual([]);
});

test('a doc over the size limit is not written', async () => {
  const store = memoryCollections();
  const big = 'x'.repeat(MAX_CACHE_CHARS);
  const src = fakeSource(() => [{ big }]);
  const c = cachedOwox({ owox: src.owox, store, key: KEY, anchor: ANCHOR, mode: 'read-write', now: () => NOW });
  await read(c.owox, 'm1', opts);
  expect(await c.flush()).toEqual({ written: [], failed: [], tooLarge: ['m1:' + KEY] });
  expect(await store.collections(MART_CACHE).get('m1:' + KEY)).toBeNull();
});

test('a failed write is reported, not thrown', async () => {
  const store = memoryCollections();
  const readOnly = { collections<T>(name: string) { const col = store.collections<T>(name); return { get: col.get, put: async () => { throw new Error('403'); } }; } };
  const c = cachedOwox({ owox: fakeSource(() => [{ v: 1 }]).owox, store: readOnly, key: KEY, anchor: ANCHOR, mode: 'read-write', now: () => NOW });
  await read(c.owox, 'm1', opts);
  expect(await c.flush()).toEqual({ written: [], failed: ['m1:' + KEY], tooLarge: [] });
});

test('the wrapper delegates every other OwoxLike member', async () => {
  const src = fakeSource(() => []);
  const getJson = vi.fn(async () => 'ok');
  const c = cachedOwox({ owox: { ...src.owox, getJson: getJson as OwoxLike['getJson'] }, store: memoryCollections(), key: KEY, anchor: ANCHOR, mode: 'read-write', now: () => NOW });
  expect(await c.owox.getJson('/api/x')).toBe('ok');
  expect(await c.owox.project.getSettings()).toEqual({ description: null });
});
