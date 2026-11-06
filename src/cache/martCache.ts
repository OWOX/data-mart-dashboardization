import type { OwoxLike } from '../owox/sources';
import type { CollectionsLike } from '../store/collections';
import type { Day } from '../types';

/** One doc per Data Mart holding its queries of the day, shared by the project; bound to the Data Mart, so a member reads only the ones they can see. */
export const MART_CACHE = 'mart-cache';
export const MAX_CACHE_CHARS = 900_000;

export interface MartCacheDoc {
  v: 1;
  /** The day the query windows were resolved for; a doc of another day answers nothing. */
  anchor: Day;
  fetchedAt: string;
  queries: Record<string, { rows: Record<string, unknown>[]; at: string }>;
}

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

export function cachedOwox(args: { owox: OwoxLike; store: CollectionsLike; anchor: Day; mode: 'read-write' | 'write-only'; now: () => Date }): CachedOwox {
  const { owox, store, anchor, mode, now } = args;
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
      p = col.get(martId).then((d) => (d?.document?.v === 1 && d.document.anchor === anchor && typeof d.document.queries === 'object' && d.document.queries !== null ? d.document : null), () => null);
      loaded.set(martId, p);
    }
    return p;
  };

  const traverseData: OwoxLike['dataMarts']['traverseData'] = async (martId, options) => {
    const q = stableJson(options);
    if (mode === 'read-write') {
      const hit = (await load(martId))?.queries?.[q];
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
        // today's queries made by other runs stay; a doc of another day is dropped by load()
        const base = await load(martId);
        const doc: MartCacheDoc = { v: 1, anchor, fetchedAt: now().toISOString(), queries: { ...base?.queries, ...queries } };
        // over the limit: the oldest entries this flush did not record go first
        const stale = Object.keys(doc.queries).filter((q) => !(q in queries)).sort((a, b) => (doc.queries[a]!.at < doc.queries[b]!.at ? -1 : 1));
        while (stableJson(doc).length > MAX_CACHE_CHARS && stale.length) delete doc.queries[stale.shift()!];
        if (stableJson(doc).length > MAX_CACHE_CHARS) { tooLarge.push(martId); continue; }
        try {
          await col.put(martId, doc, { parentId: martId });
          written.push(martId);
        } catch {
          failed.push(martId);
        }
      }
      recorded.clear();
      return { written, failed, tooLarge };
    },
    stats: () => ({ hits, misses, oldestHit }),
  };
}
