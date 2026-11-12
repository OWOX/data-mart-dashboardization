import { upgradeModel } from '../model/upgrade';
import { toDay } from '../lib/dates';
import { DEFAULT_SETTINGS, PRESET_LABELS, type CacheDoc, type CompareChoice, type ComparePreset, type CoreClass, type DateWindow, type Day, type Industry, type RangeChoice, type Model, type Preset, type ProjectSettings, type Settings, type ViewSettings, type WeekStart } from '../types';

export interface CollectionsLike {
  collections<T>(name: string): {
    get(id: string): Promise<{ document: T } | null>;
    put(id: string, doc: T): Promise<unknown>;
  };
}

/** The project's shared model: `ontology_project/current`. */
export async function loadShared(ctx: CollectionsLike): Promise<Model | null> {
  return upgradeModel((await ctx.collections<unknown>('ontology_project').get('current'))?.document);
}
export class ModelConflict extends Error {
  constructor(public by: string | null, public at: string) {
    super('The model changed since it was loaded');
    this.name = 'ModelConflict';
  }
}
/** A model is stored but this version can't read it. Nothing is written over it. */
export class ModelUnreadable extends Error {
  constructor() {
    super("The stored model can't be read by this version of Gyroscope.");
    this.name = 'ModelUnreadable';
  }
}
/** Writes `next` only when the stored doc still has `base`'s builtAt and editedAt; else throws ModelConflict. base null: only when nothing is stored. */
export async function saveShared(ctx: CollectionsLike, base: Model | null, next: Model): Promise<void> {
  const col = ctx.collections<unknown>('ontology_project');
  const raw = (await col.get('current'))?.document;
  if (raw !== undefined && raw !== null) {
    const stored = upgradeModel(raw);
    if (!stored) throw new ModelUnreadable();
    const same = !!base && stored.builtAt === base.builtAt && (stored.editedAt ?? null) === (base.editedAt ?? null);
    if (!same) {
      throw new ModelConflict(stored.editedBy ?? stored.builtBy ?? null, stored.editedAt ?? stored.builtAt);
    }
  }
  await col.put('current', next);
}
/** The old project-wide model: read-only, only a source for a member's first ontology. */
export async function loadProjectModel(ctx: CollectionsLike): Promise<Model | null> {
  return upgradeModel((await ctx.collections<unknown>('model').get('current'))?.document);
}

const INDUSTRY_IDS: readonly Industry[] = ['ecommerce', 'saas', 'marketplace', 'media', 'b2b', 'apps', 'finance', 'other'];
const coreOf = (v: unknown): CoreClass[] | null => {
  if (!Array.isArray(v)) return null;
  const out: CoreClass[] = [];
  for (const e of v) {
    const c = (e ?? {}) as Record<string, unknown>;
    if (typeof c.martId === 'string' && typeof c.why === 'string') out.push({ martId: c.martId, why: c.why });
  }
  return out.slice(0, 7);
};
const readProject = async (ctx: CollectionsLike): Promise<Record<string, unknown>> => {
  const doc = (await ctx.collections<unknown>('settings').get('project'))?.document;
  return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : {};
};
export async function loadProjectSettings(ctx: CollectionsLike): Promise<ProjectSettings> {
  const raw = await readProject(ctx);
  const t = raw.thresholdPct;
  return {
    thresholdPct: typeof t === 'number' && Number.isFinite(t) ? Math.min(100, Math.max(1, t)) : DEFAULT_SETTINGS.thresholdPct,
    industry: INDUSTRY_IDS.includes(raw.industry as Industry) ? (raw.industry as Industry) : null,
    coreClasses: coreOf(raw.coreClasses),
  };
}
/** Merges `patch` onto the raw stored doc, so fields the patch omits (and ones settings don't know) are never rewritten. */
export async function saveProjectSettings(ctx: CollectionsLike, patch: Partial<ProjectSettings>): Promise<void> {
  await ctx.collections<unknown>('settings').put('project', { ...(await readProject(ctx)), ...patch });
}

/** The member's own view settings; a stored default preset counts only from a 0.4 doc (`v: 4`), so a 0.3 choice is ignored once. */
export async function loadViewSettings(ctx: CollectionsLike): Promise<ViewSettings> {
  const raw = await readProject(ctx);
  const own = (await ctx.collections<Record<string, unknown>>('preferences').get('defaults').catch(() => null))?.document;
  const mine = own && typeof own === 'object' ? own : {};
  const d = DEFAULT_SETTINGS;
  const pick = <T,>(ok: (v: unknown) => v is T, key: string, fallback: T): T => (ok(mine[key]) ? mine[key] : ok(raw[key]) ? raw[key] : fallback);
  const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
  const isWeek = (v: unknown): v is WeekStart => v === 'monday' || v === 'sunday';
  return {
    defaultPreset: mine.v === 4 ? presetOf(mine.defaultPreset) : null,
    comparisonDefault: pick(isBool, 'comparisonDefault', d.comparisonDefault),
    weekStart: pick(isWeek, 'weekStart', d.weekStart),
  };
}
export async function saveViewSettings(ctx: CollectionsLike, s: ViewSettings): Promise<void> {
  await ctx.collections<unknown>('preferences').put('defaults', { ...s, v: 4 });
}
export async function loadSettings(ctx: CollectionsLike): Promise<Settings> {
  const [p, v] = await Promise.all([loadProjectSettings(ctx), loadViewSettings(ctx)]);
  return { ...p, ...v };
}

const COMPARE_PRESETS: readonly ComparePreset[] = ['previous_period', 'preceding_days', 'year_before'];
const isDay = (v: unknown): v is Day => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && toDay(Date.parse(`${v}T00:00:00Z`)) === v;
function windowOf(v: unknown): DateWindow | null {
  const w = (v ?? {}) as Record<string, unknown>;
  return isDay(w.from) && isDay(w.to) && w.from <= w.to ? { from: w.from, to: w.to } : null;
}
/** The `this_*` presets used to mean actual-to-date; that is what the `*td` ids mean now, so a saved choice keeps its numbers. */
const RENAMED: Record<string, Preset> = { this_year: 'ytd', this_quarter: 'qtd', this_month: 'mtd', this_week: 'wtd' };
const presetOf = (v: unknown): Preset | null => {
  if (typeof v !== 'string') return null;
  if (Object.hasOwn(RENAMED, v)) return RENAMED[v]!;
  return Object.hasOwn(PRESET_LABELS, v) ? (v as Preset) : null;
};
function rangeOf(v: unknown): RangeChoice | null {
  const r = (v ?? {}) as Record<string, unknown>;
  if (r.kind === 'preset') { const preset = presetOf(r.preset); return preset ? { kind: 'preset', preset } : null; }
  const window = r.kind === 'custom' ? windowOf(r.window) : null;
  return window ? { kind: 'custom', window } : null;
}
function compareOf(v: unknown): CompareChoice | null {
  const c = (v ?? {}) as Record<string, unknown>;
  if (c.kind === 'off') return { kind: 'off' };
  if (c.kind === 'preset') return COMPARE_PRESETS.includes(c.preset as ComparePreset) ? { kind: 'preset', preset: c.preset as ComparePreset } : null;
  const window = c.kind === 'custom' ? windowOf(c.window) : null;
  return window ? { kind: 'custom', window } : null;
}

export interface Preferences { range: RangeChoice | null; compare: CompareChoice | null }
/** The member's last applied choice; a part that fails validation is null. A doc without `v: 4` (written by 0.3) is ignored. */
export async function loadPreferences(ctx: CollectionsLike): Promise<Preferences | null> {
  const raw = (await ctx.collections<Record<string, unknown>>('preferences').get('current'))?.document;
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).v !== 4) return null;
  const range = rangeOf(raw.range);
  const compare = compareOf(raw.compare);
  return range || compare ? { range, compare } : null;
}
export const savePreferences = async (ctx: CollectionsLike, p: { range: RangeChoice | null; compare: CompareChoice }): Promise<void> => { await ctx.collections<unknown>('preferences').put('current', { ...p, v: 4 }); };

export async function loadCache(ctx: CollectionsLike, key: string): Promise<CacheDoc | null> {
  return (await ctx.collections<CacheDoc>('cache').get(key))?.document ?? null;
}
export const saveCache = async (ctx: CollectionsLike, key: string, doc: CacheDoc): Promise<void> => { await ctx.collections<CacheDoc>('cache').put(key, doc); };

/** The model version is builtAt + editedAt: every content change sets one of them; inputHash can move alone and doesn't touch the numbers. */
export const isStale = (doc: CacheDoc | null, model: Model, anchor: Day, thresholdPct: number): boolean =>
  !doc || doc.anchor !== anchor || doc.builtAt !== model.builtAt || (doc.editedAt ?? null) !== model.editedAt || doc.thresholdPct !== thresholdPct;

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
