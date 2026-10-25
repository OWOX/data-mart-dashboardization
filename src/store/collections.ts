import { DEFAULT_SETTINGS, PRESET_LABELS, type CacheDoc, type Day, type Model, type Preset, type Settings } from '../types';

export interface CollectionsLike {
  collections<T>(name: string): {
    get(id: string): Promise<{ document: T } | null>;
    put(id: string, doc: T): Promise<unknown>;
  };
}

export async function loadModel(ctx: CollectionsLike): Promise<Model | null> {
  const r = await ctx.collections<Model>('model').get('current');
  return r?.document?.version === 1 ? r.document : null;
}
export const saveModel = async (ctx: CollectionsLike, m: Model): Promise<void> => { await ctx.collections<Model>('model').put('current', m); };

export async function loadSettings(ctx: CollectionsLike): Promise<Settings> {
  const raw = ((await ctx.collections<Partial<Settings>>('settings').get('project'))?.document ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const t = raw.thresholdPct;
  return {
    thresholdPct: typeof t === 'number' && Number.isFinite(t) ? Math.min(100, Math.max(1, t)) : d.thresholdPct,
    defaultPreset: typeof raw.defaultPreset === 'string' && Object.hasOwn(PRESET_LABELS, raw.defaultPreset) ? (raw.defaultPreset as Preset) : d.defaultPreset,
    comparisonDefault: typeof raw.comparisonDefault === 'boolean' ? raw.comparisonDefault : d.comparisonDefault,
  };
}
export const saveSettings = async (ctx: CollectionsLike, s: Settings): Promise<void> => { await ctx.collections<Settings>('settings').put('project', s); };

export async function loadCache(ctx: CollectionsLike, key: string): Promise<CacheDoc | null> {
  return (await ctx.collections<CacheDoc>('cache').get(key))?.document ?? null;
}
export const saveCache = async (ctx: CollectionsLike, key: string, doc: CacheDoc): Promise<void> => { await ctx.collections<CacheDoc>('cache').put(key, doc); };

export const isStale = (doc: CacheDoc | null, model: Model, anchor: Day, thresholdPct: number): boolean =>
  !doc || doc.anchor !== anchor || doc.modelHash !== model.inputHash || doc.builtAt !== model.builtAt || doc.thresholdPct !== thresholdPct;

export function memoryCollections(): CollectionsLike {
  const store = new Map<string, Map<string, unknown>>();
  return {
    collections<T>(name: string) {
      const col = store.get(name) ?? new Map<string, unknown>();
      store.set(name, col);
      return {
        get: async (id: string) => (col.has(id) ? { document: col.get(id) as T } : null),
        put: async (id: string, doc: T) => { col.set(id, doc); },
      };
    },
  };
}
