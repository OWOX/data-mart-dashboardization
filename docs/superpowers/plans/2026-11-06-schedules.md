# Schedules and shared Data Mart cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members set their own cron schedules in Settings → Schedules; a Cloudflare Worker action fills a project cache of Data Mart rows keyed by Data Mart and date range, and the canvas answers its queries from that cache.

**Architecture:** Every metric number comes from `readRows` → `owox.dataMarts.traverseData(martId, options)` (`src/metrics/query.ts:60`). A wrapper around `OwoxLike` (`src/cache/martCache.ts`) answers `traverseData` from the `mart-cache` collection (one doc per `{martId}:{cacheKey}`, bound to the Data Mart) and records misses. The page uses it for every canvas open; the Worker action `warm-cache` runs the existing `refreshCanvas` through it for a member's model snapshot (`schedule-models`).

**Tech Stack:** React 19, TypeScript 5.9, Vitest 4 (happy-dom), `@owox/plugin-sdk` 0.42.0 (`ctx.schedules`, `@owox/plugin-sdk/server`), Cloudflare Workers via `wrangler`.

**Spec:** `docs/superpowers/specs/2026-11-05-schedules-design.md`

## Global Constraints

1. Compatibility line 0.4: `package.json` version `0.4.0`, `plugin.json` `delivery.url` `https://owox.github.io/gyroscope/v4/`.
2. Plugin GitHub repository id: `1297672440`.
3. Action name `warm-cache`, `timeoutSeconds` 300 (the OWOX maximum).
4. At most 5 ranges per schedule; at most 20 schedules per installation (platform limit, shared by all members).
5. Only `persistable` choices (preset range; preset or off comparison) are cached. Custom ranges are never cached.
6. Cache doc size limit: 900,000 characters of JSON; a bigger doc is not written.
7. Code in `src/metrics`, `src/model`, `src/lib`, `src/cache`, `src/schedules` (except UI) must not import React or touch the DOM: the Worker bundles it.
8. JSON Schema for the action input uses no `pattern`, `patternProperties`, `format`, `uniqueItems`, `$async` or `$ref`.
9. Tests: `npx vitest run --maxWorkers=4 <file>`; full suite `npm test` (already capped). Typecheck: `npm run typecheck`.
10. Writing style for comments, copy and commits: plain sentences, no em dashes, sentence-case headings. Match the surrounding code: terse one-line `//` comments that explain why, `/** */` on exported items.
11. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Two refreshes of the same Data Mart and range running in one wrapper at once (several metrics of one mart run in parallel through `runPool`): the doc must be loaded once and no recorded query lost. Test in Task 1.
2. A cached doc from yesterday (anchor differs): no row of it may be served, and the flush must not carry its queries into today's doc. Test in Task 1.
3. A schedule whose parameters were written by another member, or by a future version with an unknown shape: the Schedules tab must not list it and must not crash. Test in Task 6.
4. A member saves a schedule before their model exists (`model` null): the form refuses with a message instead of writing an empty snapshot. Test in Task 6.
5. The Worker run near its deadline: it stops starting ranges with less than 30 s left and still returns a result. Test in Task 4.

---

### Task 1: Data Mart cache wrapper

**Files:**
- Create: `src/cache/martCache.ts`
- Create: `src/cache/martCache.test.ts`
- Modify: `src/store/collections.ts` (`CollectionsLike.put` gains options; `memoryCollections` records `parentId`)
- Test: `src/store/collections.test.ts` (one new test)

**Interfaces:**
- Consumes: `OwoxLike` from `src/owox/sources.ts`; `Day` from `src/types.ts`.
- Produces:
  - `CollectionsLike.put(id: string, doc: T, options?: { parentId?: string }): Promise<unknown>`
  - `memoryCollections(): CollectionsLike & { parentOf(name: string, id: string): string | undefined }`
  - `MART_CACHE = 'mart-cache'`, `MAX_CACHE_CHARS = 900_000`
  - `interface MartCacheDoc { v: 1; anchor: Day; fetchedAt: string; queries: Record<string, { rows: Record<string, unknown>[]; at: string }> }`
  - `stableJson(v: unknown): string`
  - `martCacheId(martId: string, key: string): string` → `` `${martId}:${key}` ``
  - `cachedOwox(args: { owox: OwoxLike; store: CollectionsLike; key: string; anchor: Day; mode: 'read-write' | 'write-only'; now: () => Date }): CachedOwox`
  - `interface CachedOwox { owox: OwoxLike; flush(): Promise<{ written: string[]; failed: string[]; tooLarge: string[] }>; stats(): { hits: number; misses: number; oldestHit: string | null } }`

- [ ] **Step 1: Extend `CollectionsLike` and `memoryCollections`**

In `src/store/collections.ts` change the interface and the in-memory store:

```ts
export interface CollectionsLike {
  collections<T>(name: string): {
    get(id: string): Promise<{ document: T } | null>;
    /** `parentId` is required by collections bound to an entity, such as `mart-cache`. */
    put(id: string, doc: T, options?: { parentId?: string }): Promise<unknown>;
  };
}
```

```ts
export function memoryCollections(): CollectionsLike & { parentOf(name: string, id: string): string | undefined } {
  const store = new Map<string, Map<string, unknown>>();
  const parents = new Map<string, string>();
  return {
    collections<T>(name: string) {
      const col = store.get(name) ?? new Map<string, unknown>();
      store.set(name, col);
      return {
        get: async (id: string) => (col.has(id) ? { document: col.get(id) as T } : null),
        put: async (id: string, doc: T, options?: { parentId?: string }) => {
          col.set(id, doc);
          if (options?.parentId) parents.set(`${name}/${id}`, options.parentId);
        },
      };
    },
    parentOf: (name, id) => parents.get(`${name}/${id}`),
  };
}
```

Add to `src/store/collections.test.ts`:

```ts
test('memoryCollections keeps the parentId of a put', async () => {
  const m = memoryCollections();
  await m.collections('mart-cache').put('a:qtd:off', { x: 1 }, { parentId: 'a' });
  expect(m.parentOf('mart-cache', 'a:qtd:off')).toBe('a');
});
```

Run: `npx vitest run --maxWorkers=4 src/store/collections.test.ts` → PASS. Run `npm run typecheck` → PASS.

- [ ] **Step 2: Write the failing tests for the wrapper**

Create `src/cache/martCache.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --maxWorkers=4 src/cache/martCache.test.ts`
Expected: FAIL, cannot resolve `./martCache`.

- [ ] **Step 4: Implement `src/cache/martCache.ts`**

```ts
import type { OwoxLike } from '../owox/sources';
import type { CollectionsLike } from '../store/collections';
import type { Day } from '../types';

/** Rows of Data Mart queries for one range, shared by the project; bound to the Data Mart, so a member reads only the ones they can see. */
export const MART_CACHE = 'mart-cache';
export const MAX_CACHE_CHARS = 900_000;

export interface MartCacheDoc {
  v: 1;
  /** The day the query windows were resolved for; a doc of another day answers nothing. */
  anchor: Day;
  fetchedAt: string;
  queries: Record<string, { rows: Record<string, unknown>[]; at: string }>;
}

export const martCacheId = (martId: string, key: string): string => `${martId}:${key}`;

/** JSON with object keys sorted, so equal options give equal cache keys. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

export interface CachedOwox {
  owox: OwoxLike;
  flush(): Promise<{ written: string[]; failed: string[]; tooLarge: string[] }>;
  stats(): { hits: number; misses: number; oldestHit: string | null };
}

const once = (rows: Record<string, unknown>[]) => ({ async *rowChunks() { yield rows; } });

export function cachedOwox(args: { owox: OwoxLike; store: CollectionsLike; key: string; anchor: Day; mode: 'read-write' | 'write-only'; now: () => Date }): CachedOwox {
  const { owox, store, key, anchor, mode, now } = args;
  const col = store.collections<MartCacheDoc>(MART_CACHE);
  const loaded = new Map<string, Promise<MartCacheDoc | null>>();
  const recorded = new Map<string, MartCacheDoc['queries']>();
  let hits = 0;
  let misses = 0;
  let oldestHit: string | null = null;

  // one read per Data Mart, shared by its parallel queries; a doc of another day or an unreadable one is no doc
  const load = (martId: string) => {
    let p = loaded.get(martId);
    if (!p) {
      p = col.get(martCacheId(martId, key)).then((d) => (d?.document?.v === 1 && d.document.anchor === anchor ? d.document : null), () => null);
      loaded.set(martId, p);
    }
    return p;
  };

  const traverseData: OwoxLike['dataMarts']['traverseData'] = async (martId, options) => {
    const q = stableJson(options);
    if (mode === 'read-write') {
      const hit = (await load(martId))?.queries[q];
      if (hit) {
        hits++;
        if (oldestHit === null || hit.at < oldestHit) oldestHit = hit.at;
        return once(hit.rows);
      }
    }
    const rows: Record<string, unknown>[] = [];
    for await (const chunk of (await owox.dataMarts.traverseData(martId, options)).rowChunks()) rows.push(...chunk);
    misses++;
    const mine = recorded.get(martId) ?? {};
    mine[q] = { rows, at: now().toISOString() };
    recorded.set(martId, mine);
    return once(rows);
  };

  return {
    owox: {
      getJson: (path, query) => owox.getJson(path, query),
      ...(owox.postJson ? { postJson: (path: string, body: unknown) => owox.postJson!(path, body) } : {}),
      ...(owox.markdown ? { markdown: owox.markdown } : {}),
      project: owox.project,
      dataMarts: { list: () => owox.dataMarts.list(), traverseData },
    },
    async flush() {
      const written: string[] = [];
      const failed: string[] = [];
      const tooLarge: string[] = [];
      for (const [martId, queries] of recorded) {
        const id = martCacheId(martId, key);
        // today's queries made by other models stay; a doc of another day is dropped by load()
        const base = await load(martId);
        const doc: MartCacheDoc = { v: 1, anchor, fetchedAt: now().toISOString(), queries: { ...base?.queries, ...queries } };
        if (stableJson(doc).length > MAX_CACHE_CHARS) { tooLarge.push(id); continue; }
        try {
          await col.put(id, doc, { parentId: martId });
          written.push(id);
        } catch {
          failed.push(id);
        }
      }
      recorded.clear();
      return { written, failed, tooLarge };
    },
    stats: () => ({ hits, misses, oldestHit }),
  };
}
```

Note: in `write-only` mode `load()` is still called by `flush()` so that today's queries of other members' models survive.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/cache/martCache.test.ts src/store/collections.test.ts` → PASS. Run `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cache src/store/collections.ts src/store/collections.test.ts
git commit -m "feat: a Data Mart cache that answers traverseData per Data Mart and range

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schedule input, model snapshot and schedule sync

**Files:**
- Create: `src/schedules/input.ts`, `src/schedules/input.test.ts`
- Create: `src/schedules/snapshot.ts`, `src/schedules/snapshot.test.ts`
- Create: `src/schedules/sync.ts`, `src/schedules/sync.test.ts`

**Interfaces:**
- Consumes: `CollectionsLike`, `memoryCollections` (Task 1); `Model`, `ClassNode`, `MetricDef`, `Preset`, `ComparePreset`, `WeekStart`, `Settings`, `PRESET_LABELS` from `src/types.ts`; `PluginSchedules`, `PluginSchedule` from `@owox/plugin-sdk`.
- Produces:
  - `WARM_ACTION = 'warm-cache'`, `MAX_RANGES = 5`, `MAX_MARTS = 200`
  - `interface WarmRange { range: { kind: 'preset'; preset: Preset }; compare: { kind: 'off' } | { kind: 'preset'; preset: ComparePreset }; weekStart: WeekStart }`
  - `interface WarmInput { memberId: string; martIds: string[]; ranges: WarmRange[] }`
  - `WARM_INPUT_SCHEMA` (JSON Schema object)
  - `parseWarmInput(v: unknown): WarmInput | null`
  - `rangesFor(presets: Preset[], settings: Settings): WarmRange[]`
  - `SCHEDULE_MODELS = 'schedule-models'`
  - `interface ModelSlice { v: 1; builtAt: string; editedAt: string | null; classes: ClassNode[]; metrics: MetricDef[] }`
  - `martIdsOf(model: Model): string[]`
  - `writeSnapshot(store: CollectionsLike, model: Model, memberId: string): Promise<string[]>`
  - `readSnapshot(store: CollectionsLike, memberId: string, martIds: string[]): Promise<Model | null>`
  - `ownSchedules(all: readonly PluginSchedule[], memberId: string): PluginSchedule[]`
  - `syncSchedules(args: { schedules: PluginSchedules; store: CollectionsLike; model: Model; memberId: string }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`src/schedules/input.test.ts`:

```ts
import { MAX_RANGES, WARM_INPUT_SCHEMA, parseWarmInput, rangesFor } from './input';
import { DEFAULT_SETTINGS } from '../types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ok = { memberId: 'u1', martIds: ['m1'], ranges: [{ range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'preset', preset: 'previous_period' }, weekStart: 'monday' }] };

test('a valid input parses as is', () => {
  expect(parseWarmInput(ok)).toEqual(ok);
});

test.each([
  ['no member', { ...ok, memberId: '' }],
  ['no ranges', { ...ok, ranges: [] }],
  ['too many ranges', { ...ok, ranges: Array(MAX_RANGES + 1).fill(ok.ranges[0]) }],
  ['a custom range', { ...ok, ranges: [{ ...ok.ranges[0], range: { kind: 'custom', window: { from: '2026-01-01', to: '2026-01-31' } } }] }],
  ['an unknown preset', { ...ok, ranges: [{ ...ok.ranges[0], range: { kind: 'preset', preset: 'forever' } }] }],
  ['a bad week start', { ...ok, ranges: [{ ...ok.ranges[0], weekStart: 'friday' }] }],
  ['mart ids not strings', { ...ok, martIds: [1] }],
  ['not an object', 'x'],
])('%s is refused', (_n, v) => {
  expect(parseWarmInput(v)).toBeNull();
});

test('no presets means the default range; comparison follows the project default', () => {
  expect(rangesFor([], { ...DEFAULT_SETTINGS, defaultPreset: 'mtd', comparisonDefault: false, weekStart: 'sunday' }))
    .toEqual([{ range: { kind: 'preset', preset: 'mtd' }, compare: { kind: 'off' }, weekStart: 'sunday' }]);
  expect(rangesFor(['ytd', 'last_month'], DEFAULT_SETTINGS).map((r) => [r.range.preset, r.compare])).toEqual([
    ['ytd', { kind: 'preset', preset: 'previous_period' }], ['last_month', { kind: 'preset', preset: 'previous_period' }],
  ]);
});

test('plugin.json declares the same input schema', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'plugin.json'), 'utf8'));
  expect(manifest.backend.actions['warm-cache'].input).toEqual(WARM_INPUT_SCHEMA);
});
```

The last test fails until Task 4 adds the backend to `plugin.json`. Mark it `test.skip` in this task and remove `.skip` in Task 4.

`src/schedules/snapshot.test.ts`:

```ts
import { SCHEDULE_MODELS, martIdsOf, readSnapshot, writeSnapshot, type ModelSlice } from './snapshot';
import { memoryCollections } from '../store/collections';
import { model as fixtureModel } from '../test/fixtures';
```

Before writing it, open `src/test/fixtures.ts` and use the exported model fixture it has (if its name differs from `model`, import that name). The test body:

```ts
test('a snapshot is one doc per Data Mart, bound to it, and reads back the same classes and metrics', async () => {
  const store = memoryCollections();
  const m = fixtureModel;
  const ids = await writeSnapshot(store, m, 'u1');
  expect(ids).toEqual(martIdsOf(m));
  for (const id of ids) {
    const doc = (await store.collections<ModelSlice>(SCHEDULE_MODELS).get(`u1:${id}`))!.document;
    expect(doc.classes.every((c) => c.martId === id)).toBe(true);
    expect(doc.metrics.every((x) => x.martId === id)).toBe(true);
    expect(store.parentOf(SCHEDULE_MODELS, `u1:${id}`)).toBe(id);
  }
  const back = (await readSnapshot(store, 'u1', ids))!;
  expect(back.classes.map((c) => c.id).sort()).toEqual(m.classes.map((c) => c.id).sort());
  expect(back.metrics.map((x) => x.id).sort()).toEqual(m.metrics.filter((x) => ids.includes(x.martId)).map((x) => x.id).sort());
});

test('missing slices are skipped; none at all is null', async () => {
  const store = memoryCollections();
  const ids = await writeSnapshot(store, fixtureModel, 'u1');
  expect(await readSnapshot(store, 'u2', ids)).toBeNull();
  const one = await readSnapshot(store, 'u1', [ids[0]!, 'gone']);
  expect(one!.classes.map((c) => c.martId)).toEqual([ids[0]]);
});
```

`src/schedules/sync.test.ts`:

```ts
import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { ownSchedules, syncSchedules } from './sync';
import { martIdsOf } from './snapshot';
import { memoryCollections } from '../store/collections';
import { model as fixtureModel } from '../test/fixtures';

const sched = (id: string, parameters: unknown): PluginSchedule => ({
  id, name: null, action: 'warm-cache', parameters, cron: '0 9 * * *', timeZone: 'UTC', enabled: true,
  disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '',
});
const range = { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'off' }, weekStart: 'monday' };

test('ownSchedules keeps only valid warm-cache schedules of the member', () => {
  const all = [
    sched('a', { memberId: 'u1', martIds: [], ranges: [range] }),
    sched('b', { memberId: 'u2', martIds: [], ranges: [range] }),
    sched('c', { something: 'else' }),
    { ...sched('d', { memberId: 'u1', martIds: [], ranges: [range] }), action: 'other' },
  ];
  expect(ownSchedules(all, 'u1').map((s) => s.id)).toEqual(['a']);
});

test('syncSchedules rewrites the snapshot and the mart ids of own schedules only when they changed', async () => {
  const store = memoryCollections();
  const ids = martIdsOf(fixtureModel);
  const list = [sched('a', { memberId: 'u1', martIds: ['old'], ranges: [range] }), sched('b', { memberId: 'u1', martIds: ids, ranges: [range] }), sched('c', { memberId: 'u2', martIds: ['old'], ranges: [range] })];
  const update = vi.fn(async (id: string) => list.find((s) => s.id === id)!);
  const schedules = { list: async () => list, update } as unknown as PluginSchedules;
  await syncSchedules({ schedules, store, model: fixtureModel, memberId: 'u1' });
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith('a', { parameters: { memberId: 'u1', martIds: ids, ranges: [range] } });
  expect(await store.collections('schedule-models').get(`u1:${ids[0]}`)).not.toBeNull();
});

test('syncSchedules writes nothing for a member without schedules', async () => {
  const store = memoryCollections();
  const schedules = { list: async () => [], update: vi.fn() } as unknown as PluginSchedules;
  await syncSchedules({ schedules, store, model: fixtureModel, memberId: 'u1' });
  expect(await store.collections('schedule-models').get(`u1:${martIdsOf(fixtureModel)[0]}`)).toBeNull();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --maxWorkers=4 src/schedules` → FAIL, modules missing.

- [ ] **Step 3: Implement `src/schedules/input.ts`**

```ts
import { PRESET_LABELS, type ComparePreset, type Preset, type Settings, type WeekStart } from '../types';

export const WARM_ACTION = 'warm-cache';
export const MAX_RANGES = 5;
export const MAX_MARTS = 200;

export interface WarmRange {
  range: { kind: 'preset'; preset: Preset };
  compare: { kind: 'off' } | { kind: 'preset'; preset: ComparePreset };
  weekStart: WeekStart;
}
/** What a schedule passes to the warm-cache action. `memberId` marks whose schedule it is; OWOX keeps no creator. */
export interface WarmInput { memberId: string; martIds: string[]; ranges: WarmRange[] }

const PRESETS = Object.keys(PRESET_LABELS) as Preset[];
const COMPARES: ComparePreset[] = ['previous_period', 'preceding_days', 'year_before'];

/** The action's input schema; plugin.json carries a copy and a test keeps them equal. */
export const WARM_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['memberId', 'martIds', 'ranges'],
  properties: {
    memberId: { type: 'string', minLength: 1, maxLength: 200 },
    martIds: { type: 'array', maxItems: MAX_MARTS, items: { type: 'string', minLength: 1, maxLength: 200 } },
    ranges: {
      type: 'array', minItems: 1, maxItems: MAX_RANGES,
      items: {
        type: 'object', additionalProperties: false, required: ['range', 'compare', 'weekStart'],
        properties: {
          range: { type: 'object', additionalProperties: false, required: ['kind', 'preset'], properties: { kind: { const: 'preset' }, preset: { enum: PRESETS } } },
          compare: {
            oneOf: [
              { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'off' } } },
              { type: 'object', additionalProperties: false, required: ['kind', 'preset'], properties: { kind: { const: 'preset' }, preset: { enum: COMPARES } } },
            ],
          },
          weekStart: { enum: ['monday', 'sunday'] },
        },
      },
    },
  },
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

function rangeOf(v: unknown): WarmRange | null {
  if (!isObj(v) || !isObj(v.range) || !isObj(v.compare)) return null;
  const { range, compare, weekStart } = v;
  if (range.kind !== 'preset' || !PRESETS.includes(range.preset as Preset)) return null;
  if (weekStart !== 'monday' && weekStart !== 'sunday') return null;
  const c = compare.kind === 'off' ? { kind: 'off' as const }
    : compare.kind === 'preset' && COMPARES.includes(compare.preset as ComparePreset) ? { kind: 'preset' as const, preset: compare.preset as ComparePreset } : null;
  return c ? { range: { kind: 'preset', preset: range.preset as Preset }, compare: c, weekStart } : null;
}

/** The input checked again in code: a schedule's parameters may come from another version. */
export function parseWarmInput(v: unknown): WarmInput | null {
  if (!isObj(v) || !isId(v.memberId) || !Array.isArray(v.martIds) || !Array.isArray(v.ranges)) return null;
  if (v.martIds.length > MAX_MARTS || !v.martIds.every(isId)) return null;
  if (v.ranges.length < 1 || v.ranges.length > MAX_RANGES) return null;
  const ranges = v.ranges.map(rangeOf);
  if (ranges.some((r) => r === null)) return null;
  return { memberId: v.memberId, martIds: [...v.martIds] as string[], ranges: ranges as WarmRange[] };
}

/** The ranges a schedule warms; none chosen means the member's default range. Comparison and week start come from the settings at save time. */
export function rangesFor(presets: Preset[], s: Settings): WarmRange[] {
  const compare: WarmRange['compare'] = s.comparisonDefault ? { kind: 'preset', preset: 'previous_period' } : { kind: 'off' };
  return (presets.length ? presets : [s.defaultPreset]).slice(0, MAX_RANGES).map((preset) => ({ range: { kind: 'preset', preset }, compare, weekStart: s.weekStart }));
}
```

- [ ] **Step 4: Implement `src/schedules/snapshot.ts`**

```ts
import type { CollectionsLike } from '../store/collections';
import type { ClassNode, MetricDef, Model } from '../types';

/** A member's model split by Data Mart, for scheduled runs, which act as the installer and can't read the member's own ontology. */
export const SCHEDULE_MODELS = 'schedule-models';

export interface ModelSlice { v: 1; builtAt: string; editedAt: string | null; classes: ClassNode[]; metrics: MetricDef[] }

export const martIdsOf = (m: Model): string[] => [...new Set(m.classes.map((c) => c.martId))].sort();

export async function writeSnapshot(store: CollectionsLike, model: Model, memberId: string): Promise<string[]> {
  const col = store.collections<ModelSlice>(SCHEDULE_MODELS);
  const ids = martIdsOf(model);
  for (const martId of ids) {
    await col.put(`${memberId}:${martId}`, {
      v: 1, builtAt: model.builtAt, editedAt: model.editedAt,
      classes: model.classes.filter((c) => c.martId === martId),
      metrics: model.metrics.filter((x) => x.martId === martId),
    }, { parentId: martId });
  }
  return ids;
}

/** The model rebuilt from the slices that exist; only what refreshCanvas reads is filled. */
export async function readSnapshot(store: CollectionsLike, memberId: string, martIds: string[]): Promise<Model | null> {
  const col = store.collections<ModelSlice>(SCHEDULE_MODELS);
  const slices = (await Promise.all(martIds.map((id) => col.get(`${memberId}:${id}`).catch(() => null))))
    .map((d) => d?.document).filter((d): d is ModelSlice => d?.v === 1);
  const first = slices[0]?.classes[0];
  if (!first) return null;
  return {
    version: 2, inputHash: '', builtAt: slices[0]!.builtAt, builtBy: memberId, editedAt: slices[0]!.editedAt,
    goal: { classId: first.id, metricId: null, goalMartId: first.martId, viaFallback: true },
    classes: slices.flatMap((s) => s.classes), edges: [], metrics: slices.flatMap((s) => s.metrics),
  };
}
```

- [ ] **Step 5: Implement `src/schedules/sync.ts`**

```ts
import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import type { CollectionsLike } from '../store/collections';
import type { Model } from '../types';
import { WARM_ACTION, parseWarmInput } from './input';
import { writeSnapshot } from './snapshot';

/** The member's own schedules: OWOX lists every schedule of the installation, so the member id in the parameters tells them apart. */
export const ownSchedules = (all: readonly PluginSchedule[], memberId: string): PluginSchedule[] =>
  all.filter((s) => s.action === WARM_ACTION && parseWarmInput(s.parameters)?.memberId === memberId);

/** After an ontology save: the snapshot follows the new model, and each own schedule names its Data Marts. */
export async function syncSchedules(args: { schedules: PluginSchedules; store: CollectionsLike; model: Model; memberId: string }): Promise<void> {
  const { schedules, store, model, memberId } = args;
  const mine = ownSchedules(await schedules.list(), memberId);
  if (!mine.length) return;
  const martIds = await writeSnapshot(store, model, memberId);
  for (const s of mine) {
    const input = parseWarmInput(s.parameters)!;
    if (input.martIds.join() === martIds.join()) continue;
    await schedules.update(s.id, { parameters: { ...input, martIds } });
  }
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run --maxWorkers=4 src/schedules` → PASS (the plugin.json test skipped). `npm run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/schedules
git commit -m "feat: schedule input, per-Data-Mart model snapshots and schedule sync

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cron builder and parser

**Files:**
- Create: `src/schedules/cron.ts`, `src/schedules/cron.test.ts`

**Interfaces:**
- Produces:
  - `type Cadence = { type: 'daily'; time: string } | { type: 'weekly'; time: string; weekdays: number[] } | { type: 'monthly'; time: string; days: number[] } | { type: 'interval'; unit: 'minutes' | 'hours'; every: number }` (`time` is `HH:MM`; weekdays 0 = Sunday … 6 = Saturday, like cron)
  - `MINUTE_INTERVALS = [5, 10, 15, 30]`, `HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12]`
  - `WEEKDAYS: { value: number; label: string }[]` Monday first: Mon 1 … Sat 6, Sun 0
  - `CADENCE_PRESETS: { label: string; cadence: Cadence }[]` = Weekdays 9:00, Every hour, Every 6 hours
  - `toCron(c: Cadence): string`
  - `fromCron(cron: string): Cadence | null`
  - `describeCadence(c: Cadence): string`

The cron strings match Data Mart schedules (`owox-data-marts` `ScheduleConfig.tsx`): weekly `0 9 * * 1,2,3,4,5`, interval hours `0 */6 * * *`, interval minutes `*/15 * * * *`.

- [ ] **Step 1: Write the failing tests**

```ts
import { CADENCE_PRESETS, describeCadence, fromCron, toCron, type Cadence } from './cron';

test.each<[Cadence, string]>([
  [{ type: 'daily', time: '09:30' }, '30 9 * * *'],
  [{ type: 'weekly', time: '09:00', weekdays: [5, 1, 3] }, '0 9 * * 1,3,5'],
  [{ type: 'monthly', time: '00:05', days: [15, 1] }, '5 0 1,15 * *'],
  [{ type: 'interval', unit: 'minutes', every: 15 }, '*/15 * * * *'],
  [{ type: 'interval', unit: 'hours', every: 6 }, '0 */6 * * *'],
])('%o is %s and parses back', (c, cron) => {
  expect(toCron(c)).toBe(cron);
  const back = fromCron(cron)!;
  expect(toCron(back)).toBe(cron);
});

test('the presets are the Data Mart ones', () => {
  expect(CADENCE_PRESETS.map((p) => [p.label, toCron(p.cadence)])).toEqual([
    ['Weekdays 9:00', '0 9 * * 1,2,3,4,5'], ['Every hour', '0 */1 * * *'], ['Every 6 hours', '0 */6 * * *'],
  ]);
});

test.each(['', '0 9 * *', '0 9 * 1 *', '0 9 1 * 1', '*/7 * * * *', '0 */5 * * *', '61 9 * * *', '0 24 * * *', '0 9 * * 8', '0 9 32 * *', 'a b c d e'])('%s is not a cadence', (cron) => {
  expect(fromCron(cron)).toBeNull();
});

test('a weekly cadence without weekdays or a monthly one without days has no cron', () => {
  expect(() => toCron({ type: 'weekly', time: '09:00', weekdays: [] })).toThrow();
  expect(() => toCron({ type: 'monthly', time: '09:00', days: [] })).toThrow();
});

test('cadences read in words', () => {
  expect(describeCadence({ type: 'daily', time: '09:30' })).toBe('Every day at 09:30');
  expect(describeCadence({ type: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] })).toBe('Mon, Tue, Wed, Thu, Fri at 09:00');
  expect(describeCadence({ type: 'monthly', time: '09:00', days: [1, 15] })).toBe('Day 1, 15 of each month at 09:00');
  expect(describeCadence({ type: 'interval', unit: 'hours', every: 1 })).toBe('Every hour');
  expect(describeCadence({ type: 'interval', unit: 'minutes', every: 30 })).toBe('Every 30 minutes');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --maxWorkers=4 src/schedules/cron.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/schedules/cron.ts`**

```ts
/** The cadences the Schedules form offers, the same as Data Mart schedules; anything else stays raw cron. */
export type Cadence =
  | { type: 'daily'; time: string }
  | { type: 'weekly'; time: string; weekdays: number[] }
  | { type: 'monthly'; time: string; days: number[] }
  | { type: 'interval'; unit: 'minutes' | 'hours'; every: number };

export const MINUTE_INTERVALS = [5, 10, 15, 30];
export const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12];
// cron numbers the days from Sunday = 0; the form lists Monday first
export const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

export const CADENCE_PRESETS: { label: string; cadence: Cadence }[] = [
  { label: 'Weekdays 9:00', cadence: { type: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] } },
  { label: 'Every hour', cadence: { type: 'interval', unit: 'hours', every: 1 } },
  { label: 'Every 6 hours', cadence: { type: 'interval', unit: 'hours', every: 6 } },
];

const hm = (time: string): [number, number] => {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) throw new Error(`Invalid time ${time}`);
  return [h, min];
};
const list = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b).join(',');

export function toCron(c: Cadence): string {
  if (c.type === 'interval') return c.unit === 'minutes' ? `*/${c.every} * * * *` : `0 */${c.every} * * *`;
  const [h, m] = hm(c.time);
  if (c.type === 'daily') return `${m} ${h} * * *`;
  if (c.type === 'weekly') { if (!c.weekdays.length) throw new Error('Pick at least one day'); return `${m} ${h} * * ${list(c.weekdays)}`; }
  if (!c.days.length) throw new Error('Pick at least one day');
  return `${m} ${h} ${list(c.days)} * *`;
}

const num = (s: string, lo: number, hi: number): number | null => (/^\d{1,2}$/.test(s) && Number(s) >= lo && Number(s) <= hi ? Number(s) : null);
const nums = (s: string, lo: number, hi: number): number[] | null => {
  const xs = s.split(',').map((x) => num(x, lo, hi));
  return xs.every((x) => x !== null) ? (xs as number[]) : null;
};
const pad = (n: number) => String(n).padStart(2, '0');

export function fromCron(cron: string): Cadence | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, ho, dom, mon, dow] = f as [string, string, string, string, string];
  if (mon !== '*') return null;
  const every = /^\*\/(\d+)$/;
  const em = every.exec(mi);
  if (em && ho === '*' && dom === '*' && dow === '*') { const n = Number(em[1]); return MINUTE_INTERVALS.includes(n) ? { type: 'interval', unit: 'minutes', every: n } : null; }
  const eh = every.exec(ho);
  if (eh && mi === '0' && dom === '*' && dow === '*') { const n = Number(eh[1]); return HOUR_INTERVALS.includes(n) ? { type: 'interval', unit: 'hours', every: n } : null; }
  const m = num(mi, 0, 59);
  const h = num(ho, 0, 23);
  if (m === null || h === null) return null;
  const time = `${pad(h)}:${pad(m)}`;
  if (dom === '*' && dow === '*') return { type: 'daily', time };
  if (dom === '*') { const weekdays = nums(dow, 0, 6); return weekdays ? { type: 'weekly', time, weekdays } : null; }
  if (dow === '*') { const days = nums(dom, 1, 31); return days ? { type: 'monthly', time, days } : null; }
  return null;
}

export function describeCadence(c: Cadence): string {
  if (c.type === 'interval') return c.every === 1 ? `Every ${c.unit === 'hours' ? 'hour' : 'minute'}` : `Every ${c.every} ${c.unit}`;
  if (c.type === 'daily') return `Every day at ${c.time}`;
  if (c.type === 'weekly') return `${WEEKDAYS.filter((d) => c.weekdays.includes(d.value)).map((d) => d.label).join(', ')} at ${c.time}`;
  return `Day ${[...c.days].sort((a, b) => a - b).join(', ')} of each month at ${c.time}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/schedules/cron.test.ts` → PASS. `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schedules/cron.ts src/schedules/cron.test.ts
git commit -m "feat: cron builder and parser for the Data Mart schedule cadences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Worker action, manifest and deploy

**Files:**
- Create: `worker/warm.ts`, `worker/warm.test.ts`, `worker/index.ts`, `worker/wrangler.toml`
- Create: `.github/workflows/deploy-worker.yml`
- Modify: `plugin.json`, `package.json` (version, devDependency `wrangler`, script `deploy:worker`), `tsconfig.json` (`include` adds `worker`), `src/manifest.test.ts`, `src/schedules/input.test.ts` (un-skip the plugin.json test), `README.md`

**Interfaces:**
- Consumes: `cachedOwox` (Task 1); `parseWarmInput`, `WarmInput` (Task 2); `readSnapshot` (Task 2); `refreshCanvas`, `cacheKey` from `src/metrics/refresh.ts`; `resolveRange` from `src/lib/dates.ts`; `DEFAULT_SETTINGS` from `src/types.ts`; `createBackend` from `@owox/plugin-sdk/server`.
- Produces:
  - `class ActionError extends Error { code: string }`
  - `interface WarmContext { owox: unknown; collections: CollectionsLike['collections']; execution: { deadlineAt: string } }`
  - `interface WarmResult { ranges: number; marts: number; queries: number; skipped: number; failed: string[]; tooLarge: string[] }`
  - `warmCache(input: unknown, ctx: WarmContext, now?: () => Date): Promise<WarmResult>`

- [ ] **Step 1: Write the failing tests**

`worker/warm.test.ts`:

```ts
import { warmCache, ActionError } from './warm';
import { memoryCollections } from '../src/store/collections';
import { writeSnapshot } from '../src/schedules/snapshot';
import { MART_CACHE, type MartCacheDoc } from '../src/cache/martCache';
import { fakeOwox } from '../src/owox/fake';
import { model as fixtureModel } from '../src/test/fixtures';
```

Open `src/test/fixtures.ts` and `src/metrics/refresh.test.ts` first: reuse how they build a `fakeOwox` whose `rows` answers the fixture model's queries (copy that setup into a `const owox = fakeOwox({...})` here). Then:

```ts
const NOW = new Date('2026-11-06T08:00:00Z');
const range = (preset: string) => ({ range: { kind: 'preset', preset }, compare: { kind: 'off' }, weekStart: 'monday' });

async function setup() {
  const store = memoryCollections();
  const martIds = await writeSnapshot(store, fixtureModel, 'u1');
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
  expect(doc?.document.anchor).toBe('2026-11-06');
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
```

- [ ] **Step 2: Run them to see them fail**

Add `"worker"` to `tsconfig.json` `include` first. Run: `npx vitest run --maxWorkers=4 worker` → FAIL, `./warm` missing.

- [ ] **Step 3: Implement `worker/warm.ts`**

```ts
import { cachedOwox } from '../src/cache/martCache';
import { resolveRange } from '../src/lib/dates';
import { cacheKey, refreshCanvas } from '../src/metrics/refresh';
import type { OwoxLike } from '../src/owox/sources';
import { parseWarmInput } from '../src/schedules/input';
import { readSnapshot } from '../src/schedules/snapshot';
import type { CollectionsLike } from '../src/store/collections';
import { DEFAULT_SETTINGS } from '../src/types';

/** OWOX shows `code` as the run's error code; it must match ^[A-Z][A-Z0-9_]{0,63}$. */
export class ActionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface WarmContext { owox: unknown; collections: CollectionsLike['collections']; execution: { deadlineAt: string } }
export interface WarmResult { ranges: number; marts: number; queries: number; skipped: number; failed: string[]; tooLarge: string[] }

// a range is a full canvas refresh; one that starts this close to the deadline would be cut off mid-way
const RESERVE_MS = 30_000;

export async function warmCache(raw: unknown, ctx: WarmContext, now: () => Date = () => new Date()): Promise<WarmResult> {
  const input = parseWarmInput(raw);
  if (!input) throw new ActionError('INVALID_RANGES', 'The schedule parameters are not valid; save the schedule again.');
  const store: CollectionsLike = { collections: ctx.collections };
  const model = await readSnapshot(store, input.memberId, input.martIds);
  if (!model) throw new ActionError('MODEL_MISSING', "The schedule's model snapshot is missing; save the schedule again.");
  const owox = ctx.owox as OwoxLike;
  const deadline = Date.parse(ctx.execution.deadlineAt);
  const out: WarmResult = { ranges: 0, marts: input.martIds.length, queries: 0, skipped: 0, failed: [], tooLarge: [] };
  for (const r of input.ranges) {
    if (deadline - now().getTime() < RESERVE_MS) { out.skipped++; continue; }
    const spec = resolveRange(r.range, r.compare, now(), r.weekStart);
    const key = cacheKey(r.range, r.compare, r.weekStart);
    // write-only: a scheduled run exists to replace what is cached
    const src = cachedOwox({ owox, store, key, anchor: spec.anchor, mode: 'write-only', now });
    await refreshCanvas({ owox: src.owox, model, spec, key, thresholdPct: DEFAULT_SETTINGS.thresholdPct });
    const f = await src.flush();
    out.ranges++;
    out.queries += src.stats().misses;
    out.failed.push(...f.failed);
    out.tooLarge.push(...f.tooLarge);
  }
  return out;
}
```

Check `resolveRange`'s exact signature in `src/lib/dates.ts` (`resolveRange(range, compare, now, ws)` is how `App.tsx:225` calls it).

- [ ] **Step 4: Implement `worker/index.ts` and `worker/wrangler.toml`**

```ts
import { createBackend } from '@owox/plugin-sdk/server';
import { warmCache } from './warm';

// the page stays on GitHub Pages; this Worker only runs the scheduled cache refresh
export default createBackend({
  repositoryId: '1297672440',
  actions: { 'warm-cache': (input, ctx) => warmCache(input, { owox: ctx.owox, collections: (name) => ctx.collections(name), execution: ctx.execution }) },
});
```

If `ctx.collections(name)` does not satisfy `CollectionsLike['collections']` in the typecheck, wrap it with an explicit adapter `(name) => { const c = ctx.collections(name); return { get: (id) => c.get(id), put: (id, doc, o) => c.put(id, doc, o) }; }` and cast only the generic.

`worker/wrangler.toml`:

```toml
name = "gyroscope"
main = "index.ts"
compatibility_date = "2026-10-01"
workers_dev = true
```

- [ ] **Step 5: Manifest, version and package**

1. `package.json`: `"version": "0.4.0"`; add devDependency `wrangler` (run `npm install -D wrangler@4` and keep the resolved version); add script `"deploy:worker": "wrangler deploy --config worker/wrangler.toml"`.
2. `plugin.json`: `delivery.url` → `https://owox.github.io/gyroscope/v4/`; add collections

   ```json
   { "name": "mart-cache", "scope": "project", "entityBinding": { "type": "data-mart", "actions": { "read": "SEE", "create": "SEE", "update": "SEE", "delete": "SEE" } } },
   { "name": "schedule-models", "scope": "project", "entityBinding": { "type": "data-mart", "actions": { "read": "SEE", "create": "SEE", "update": "SEE", "delete": "SEE" } } }
   ```

   and

   ```json
   "backend": {
     "url": "https://gyroscope.owox.workers.dev",
     "actions": { "warm-cache": { "timeoutSeconds": 300, "input": <WARM_INPUT_SCHEMA as JSON> } }
   }
   ```

   Generate the input JSON from the TS constant so it is exact: `npx tsx -e "import('./src/schedules/input.ts').then(m => console.log(JSON.stringify(m.WARM_INPUT_SCHEMA, null, 2)))"` (use `node --experimental-strip-types` if `tsx` is not available). `gyroscope.owox.workers.dev` assumes the Cloudflare account subdomain is `owox`; the owner confirms it before release (README step).
3. `src/manifest.test.ts`: add

   ```ts
   test('the backend runs the warm-cache action within the OWOX limit, and both cache collections are bound to the Data Mart', () => {
     const m = read('plugin.json');
     expect(m.backend.url).toMatch(/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/);
     expect(m.backend.actions['warm-cache'].timeoutSeconds).toBe(300);
     for (const name of ['mart-cache', 'schedule-models']) {
       expect(m.collections.find((c: { name: string }) => c.name === name)).toMatchObject({ scope: 'project', entityBinding: { type: 'data-mart' } });
     }
   });
   ```

4. `src/schedules/input.test.ts`: change the skipped plugin.json test back to `test`.

- [ ] **Step 6: Deploy workflow**

`.github/workflows/deploy-worker.yml`:

```yaml
name: Deploy the Gyroscope Worker

on:
  push:
    branches: [main]
    paths: ['worker/**', 'src/cache/**', 'src/lib/**', 'src/metrics/**', 'src/model/**', 'src/owox/**', 'src/schedules/**', 'src/store/**', 'src/types.ts', 'package-lock.json']
  workflow_dispatch:

concurrency:
  group: gyroscope-worker
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run deploy:worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 7: README**

Under "Release", add steps: the Worker deploys from `worker/` with `npm run deploy:worker` or the `deploy-worker.yml` workflow, which needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; `plugin.json` `backend.url` must be the Worker's `workers.dev` URL before the first 0.4 release, and it cannot change within 0.4. Under "How it works", add a step: "Schedules: each member's schedules run the `warm-cache` action on the Worker, which stores Data Mart rows per Data Mart and range in `mart-cache`; the canvas answers from it (spec `docs/superpowers/specs/2026-11-05-schedules-design.md`)."

- [ ] **Step 8: Verify the Worker bundles**

Run: `npx wrangler deploy --dry-run --outdir tmp/worker-dry --config worker/wrangler.toml` → exits 0 (no Cloudflare login needed for a dry run). If it fails on a Node built-in or React import, find the import chain and fix it (Global Constraint 7).

Run: `npm test` and `npm run typecheck` → PASS.

- [ ] **Step 9: Commit**

```bash
git add worker .github/workflows/deploy-worker.yml plugin.json package.json package-lock.json tsconfig.json src/manifest.test.ts src/schedules/input.test.ts README.md
git commit -m "feat: warm-cache action on a Cloudflare Worker; 0.4 line with the backend and the Data Mart bound collections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The canvas reads the Data Mart cache

**Files:**
- Modify: `src/App.tsx` (the `refresh` callback, about lines 220-262, and the probe effect about lines 266-281; imports)
- Modify: `src/store/collections.ts` only if `loadCache`/`saveCache`/`isStale` become unused (delete them and their tests in `src/store/collections.test.ts`)
- Test: `src/App.load.test.tsx` or `src/App.ready.test.tsx` (whichever covers refresh; read both first and update tests that relied on the member `cache` collection)

**Interfaces:**
- Consumes: `cachedOwox` (Task 1); `cacheKey`, `persistable`, `refreshCanvas` (existing).
- Produces: nothing new for later tasks.

Behavior to implement in `refresh(force)`:

1. `persistable(range, compare)` false: as today, compute live with `owox`, keep the doc in state only.
2. Persistable: `const src = cachedOwox({ owox, store, key, anchor: spec.anchor, mode: force ? 'write-only' : 'read-write', now })`; run `refreshCanvas` with `owox: src.owox`; then `setCache({ ...doc, refreshedAt: src.stats().oldestHit ?? doc.refreshedAt })` so the header shows the age of the oldest cached answer; then `const f = await src.flush()`; when `f.failed.length` set `saveNote` to `Couldn't save the refreshed data for ${f.failed.length} Data Mart(s).`.
3. There is no saved card doc any more, so remove the `loadCache` read, the `isStale` early return and `saveCache`. `setLoading(true)` at the start of every refresh; the partial-card merge (`mergePartial`) starts from `cacheNow.current` when its `key` matches, as the custom-range branch does today.
4. The probe effect that read `loadCache` to decide `setLoading(true)` now sets it unconditionally.

- [ ] **Step 1: Write the failing tests**

Add to the App test file that already renders a ready canvas with `fakeOwox` + `memoryCollections` (reuse its setup helper):

```ts
test('a second open on the same day answers every query from the Data Mart cache', async () => {
  // first open: render the app, wait for the cards, unmount
  // count traverseData calls on the fake: wrap fakeOwox's dataMarts.traverseData with vi.fn before passing it in deps
  // second open with the same store: render again, wait for the cards
  // expect the traverseData mock call count to be unchanged by the second open
  // expect the store's 'mart-cache' collection to hold a doc whose id starts with a class martId and ends with the default cacheKey
});

test('Refresh skips the cache and queries live', async () => {
  // open, wait for cards, note the call count, click the Refresh button (accessible name from RangeControls)
  // expect more traverseData calls after the click
});
```

Fill in each comment with the concrete calls from the file's existing helpers (they already render `App` with `deps`, wait for card text, and find the Refresh button). Do not leave comments in the final test.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --maxWorkers=4 src/App.*.test.tsx` → the new tests FAIL (the second open still queries, as the member cache path is different).

- [ ] **Step 3: Implement the change in `src/App.tsx`** as described above.

- [ ] **Step 4: Run the App tests and fix the ones that relied on the member cache**

Run: `npx vitest run --maxWorkers=4 src/App.*.test.tsx src/store`. Tests that seeded `cache` documents must seed `mart-cache` instead, or assert on queries. Do not delete a test's intent; port it.

- [ ] **Step 5: Full suite**

Run: `npm test` and `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.*.test.tsx src/store
git commit -m "feat: the canvas answers its queries from the shared Data Mart cache; Refresh queries live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Schedules tab

**Files:**
- Create: `src/ui/SchedulesTab.tsx`, `src/ui/SchedulesTab.test.tsx`, `src/ui/ScheduleForm.tsx`
- Modify: `src/ui/SettingsPage.tsx` (tab `schedules`, label "Schedules", after Checkup; prop `schedules?: SchedulesProps | null`)
- Modify: `src/App.tsx` (`ROUTES.schedules = '/settings/schedules'`, `tabOf`, pass props; after `saveOntology` call `syncSchedules`)
- Modify: `src/styles.css` (only classes the new UI needs; reuse `gy-form`, `gy-field`, `gy-input`, `gy-select`, `gy-check`, `gy-btn`, `dm-card`, `dm-muted`, `gy-form-error`)

**Interfaces:**
- Consumes: `PluginSchedules`, `PluginSchedule`, `PluginActionError` from `@owox/plugin-sdk`; `Cadence`, `toCron`, `fromCron`, `describeCadence`, `CADENCE_PRESETS`, `WEEKDAYS`, `MINUTE_INTERVALS`, `HOUR_INTERVALS` (Task 3); `WARM_ACTION`, `MAX_RANGES`, `rangesFor`, `parseWarmInput` (Task 2); `writeSnapshot` (Task 2); `ownSchedules`, `syncSchedules` (Task 2); `PRESET_GROUPS`, `PRESET_LABELS`, `Settings`, `Model`, `Preset`.
- Produces: `export interface SchedulesProps { schedules: PluginSchedules | undefined; memberId: string; model: Model | null; settings: Settings; store: CollectionsLike }` and `SchedulesTab(props: SchedulesProps)`.

Behavior:

1. `schedules` undefined: render only `<p className="dm-muted">Schedules need a newer version of OWOX Data Marts.</p>`.
2. On mount call `schedules.list()`. While loading show "Loading schedules…". A failure shows `role="alert"` text `Couldn't load schedules: ${describeError(e)}` and a Retry button.
3. Header line: `${all.length} of 20 schedules used in this project`.
4. List `ownSchedules(all, memberId)`. Each row: name (or the cadence in words), `describeCadence(fromCron(cron))` or `Custom: ${cron}` when it does not parse, time zone, ranges as `PRESET_LABELS` joined by ", ", next run (`nextRunAt` with `toLocaleString()`, or "Not scheduled"), last run (`lastRun.status` plus `errorCode` when set, or "Never run"), `disabledReason === 'PAUSED_BY_ADMIN'` shown as "Paused by a project admin". A checkbox labeled "Enabled" calls `pause`/`resume`; buttons Edit and Delete (Delete asks `window.confirm('Delete this schedule?')`).
5. "Add schedule" opens `ScheduleForm`; Edit opens it filled from the schedule. Add is disabled when `all.length >= 20`, with the hint "The project has 20 schedules, the most OWOX allows."
6. `ScheduleForm` fields: Name (optional, max 200); preset chips from `CADENCE_PRESETS` (buttons that set the cadence); Type select Daily / Weekly / Monthly / Interval; Time (`<input type="time">`) for daily, weekly, monthly; weekday checkboxes from `WEEKDAYS` for weekly; day-of-month checkboxes 1-31 for monthly; for interval a unit select (Minutes, Hours) and a value select from `MINUTE_INTERVALS` or `HOUR_INTERVALS`; Time zone select from `Intl.supportedValuesOf('timeZone')` (fall back to `[browser zone, 'UTC']` when unsupported), default `Intl.DateTimeFormat().resolvedOptions().timeZone`; Enabled checkbox (create only); Data ranges: checkboxes grouped by `PRESET_GROUPS`, at most `MAX_RANGES` (the rest disable once 5 are checked), hint "None picked: your default range, ${PRESET_LABELS[settings.defaultPreset]}". Save and Cancel.
7. On Save: when `model` is null show `role="alert"` "Build the model first: a schedule warms the Data Marts of your model." and stop. Otherwise `const martIds = await writeSnapshot(store, model, memberId)`; `parameters = { memberId, martIds, ranges: rangesFor(picked, settings) }`; create with `{ action: WARM_ACTION, parameters, cron: toCron(cadence), timeZone, name, enabled }` or update with `{ parameters, cron, timeZone, name: name || null }`. Then reload the list and close the form. A rejection shows `role="alert"` with `e.code` when it is a `PluginActionError` (`e.name === 'PluginActionError'`), followed by its message; otherwise `describeError(e)`. `toCron` throwing (no weekday or day) shows its message.
8. A schedule whose cron does not parse opens in the form with the cadence fields replaced by a read-only "Cron: …" line; saving keeps its cron.
9. App: after `saveOntology(store, m)` in `saveOntologyAndLeave`, `if (ctx.schedules) void syncSchedules({ schedules: ctx.schedules, store, model: m, memberId: userId }).catch(() => setSaveNote("Couldn't update your schedules for the new model; open Settings, Schedules and save them again."))`.

- [ ] **Step 1: Write the failing tests** in `src/ui/SchedulesTab.test.tsx`. Use `render` from `../test-host`, `memoryCollections`, and an in-memory `PluginSchedules` fake:

```ts
import type { PluginSchedule, PluginSchedules } from '@owox/plugin-sdk';
import { render, screen, fireEvent, waitFor, within } from '../test-host';
import { SchedulesTab } from './SchedulesTab';
import { memoryCollections } from '../store/collections';
import { DEFAULT_SETTINGS } from '../types';
import { model as fixtureModel } from '../test/fixtures';

function fakeSchedules(initial: PluginSchedule[] = []) {
  let rows = [...initial];
  let n = 0;
  const api: PluginSchedules = {
    list: vi.fn(async () => rows),
    get: vi.fn(async (id: string) => rows.find((r) => r.id === id)!),
    create: vi.fn(async (s) => { const row: PluginSchedule = { id: `s${++n}`, name: s.name ?? null, action: s.action, parameters: s.parameters, cron: s.cron, timeZone: s.timeZone, enabled: s.enabled ?? true, disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '' }; rows.push(row); return row; }),
    update: vi.fn(async (id, patch) => { rows = rows.map((r) => (r.id === id ? { ...r, ...patch, name: patch.name === undefined ? r.name : patch.name } : r)); return rows.find((r) => r.id === id)!; }),
    pause: vi.fn(async (id) => { rows = rows.map((r) => (r.id === id ? { ...r, enabled: false } : r)); return rows.find((r) => r.id === id)!; }),
    resume: vi.fn(async (id) => { rows = rows.map((r) => (r.id === id ? { ...r, enabled: true } : r)); return rows.find((r) => r.id === id)!; }),
    delete: vi.fn(async (id) => { rows = rows.filter((r) => r.id !== id); }),
  };
  return api;
}
const range = { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'off' }, weekStart: 'monday' };
const row = (id: string, memberId: unknown, extra: Partial<PluginSchedule> = {}): PluginSchedule => ({
  id, name: null, action: 'warm-cache', parameters: { memberId, martIds: ['m1'], ranges: [range] }, cron: '0 9 * * 1,2,3,4,5', timeZone: 'UTC',
  enabled: true, disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '', ...extra,
});
const props = (schedules: PluginSchedules | undefined, extra = {}) => ({ schedules, memberId: 'u1', model: fixtureModel, settings: DEFAULT_SETTINGS, store: memoryCollections(), ...extra });

test('without ctx.schedules the tab says OWOX is too old', () => {
  render(<SchedulesTab {...props(undefined)} />);
  expect(screen.getByText(/need a newer version/)).toBeInTheDocument();
});

test('lists only own, well-formed schedules, and counts all of them', async () => {
  render(<SchedulesTab {...props(fakeSchedules([row('a', 'u1'), row('b', 'u2'), { ...row('c', 'u1'), parameters: { junk: true } }]))} />);
  expect(await screen.findByText('3 of 20 schedules used in this project')).toBeInTheDocument();
  expect(screen.getAllByText('Mon, Tue, Wed, Thu, Fri at 09:00')).toHaveLength(1);
});

test('adding a schedule writes the snapshot and creates a warm-cache schedule', async () => {
  const api = fakeSchedules();
  const p = props(api);
  render(<SchedulesTab {...p} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Every 6 hours' }));
  fireEvent.click(screen.getByLabelText('This year to date'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  const arg = (api.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  expect(arg).toMatchObject({ action: 'warm-cache', cron: '0 */6 * * *' });
  expect(arg.parameters.memberId).toBe('u1');
  expect(arg.parameters.ranges.map((r: { range: { preset: string } }) => r.range.preset)).toEqual(['ytd']);
  expect(await p.store.collections('schedule-models').get(`u1:${arg.parameters.martIds[0]}`)).not.toBeNull();
});

test('without a model the form refuses to save', async () => {
  const api = fakeSchedules();
  render(<SchedulesTab {...props(api, { model: null })} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Build the model first');
  expect(api.create).not.toHaveBeenCalled();
});

test('a refusal shows its code', async () => {
  const api = fakeSchedules();
  api.create = vi.fn(async () => { throw Object.assign(new Error('Too many'), { name: 'PluginActionError', code: 'TOO_MANY_SCHEDULES' }); });
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('TOO_MANY_SCHEDULES');
});

test('pause, edit and delete act on the schedule', async () => {
  const api = fakeSchedules([row('a', 'u1')]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<SchedulesTab {...props(api)} />);
  fireEvent.click(await screen.findByLabelText('Enabled'));
  await waitFor(() => expect(api.pause).toHaveBeenCalledWith('a'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Every hour' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith('a', expect.objectContaining({ cron: '0 */1 * * *' })));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith('a'));
});

test('at most five ranges can be picked', async () => {
  render(<SchedulesTab {...props(fakeSchedules())} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add schedule' }));
  for (const l of ['This year to date', 'This quarter to date', 'This month to date', 'Last month', 'Last week']) fireEvent.click(screen.getByLabelText(l));
  expect(screen.getByLabelText('Yesterday')).toBeDisabled();
});
```

Adjust label texts only if `PRESET_LABELS` differs; keep the assertions.

Also add to `src/ui/SettingsPage.test.tsx`: the Schedules tab exists after Checkup and selecting it renders the `SchedulesTab` (pass `schedules={{ ...props(undefined) }}` and expect the "need a newer version" text).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --maxWorkers=4 src/ui/SchedulesTab.test.tsx src/ui/SettingsPage.test.tsx` → FAIL.

- [ ] **Step 3: Implement `ScheduleForm.tsx`, `SchedulesTab.tsx`, the SettingsPage tab and the App wiring** as described in Behavior. Keep the tab component under about 200 lines; put the form state and fields in `ScheduleForm.tsx`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --maxWorkers=4 src/ui src/App.*.test.tsx` → PASS. `npm test`, `npm run typecheck`, `npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui src/App.tsx src/styles.css
git commit -m "feat: Settings, Schedules: each member's own schedules with Data Mart cadences and optional ranges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
