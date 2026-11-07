import { upgradeModel } from '../model/upgrade';
import { toDay } from '../lib/dates';
import { DEFAULT_SETTINGS, PRESET_LABELS, type CompareChoice, type ComparePreset, type DateWindow, type Day, type RangeChoice, type Model, type Preset, type Settings } from '../types';

export interface CollectionsLike {
  collections<T>(name: string): {
    get(id: string): Promise<{ document: T } | null>;
    /** `parentId` is required by collections bound to an entity, such as `mart-cache`. */
    put(id: string, doc: T, options?: { parentId?: string }): Promise<unknown>;
  };
}

export async function loadOntology(ctx: CollectionsLike): Promise<Model | null> {
  return upgradeModel((await ctx.collections<unknown>('ontology').get('current'))?.document);
}
export const saveOntology = async (ctx: CollectionsLike, m: Model): Promise<void> => { await ctx.collections<Model>('ontology').put('current', m); };
/** The old project-wide model: read-only, only a source for a member's first ontology. */
export async function loadProjectModel(ctx: CollectionsLike): Promise<Model | null> {
  return upgradeModel((await ctx.collections<unknown>('model').get('current'))?.document);
}

/** The default range is the member's own (`preferences/defaults`, member scope); the project's `defaultPreset` is only the fallback for members who never chose one. */
export async function loadSettings(ctx: CollectionsLike): Promise<Settings> {
  const raw = ((await ctx.collections<Partial<Settings>>('settings').get('project'))?.document ?? {}) as Record<string, unknown>;
  const own = (await ctx.collections<Record<string, unknown>>('preferences').get('defaults').catch(() => null))?.document;
  const d = DEFAULT_SETTINGS;
  const t = raw.thresholdPct;
  return {
    thresholdPct: typeof t === 'number' && Number.isFinite(t) ? Math.min(100, Math.max(1, t)) : d.thresholdPct,
    defaultPreset: presetOf(own?.defaultPreset) ?? presetOf(raw.defaultPreset) ?? d.defaultPreset,
    comparisonDefault: typeof raw.comparisonDefault === 'boolean' ? raw.comparisonDefault : d.comparisonDefault,
    weekStart: raw.weekStart === 'monday' || raw.weekStart === 'sunday' ? raw.weekStart : d.weekStart,
  };
}
/** The preset goes to the member's document; the project document keeps whatever `defaultPreset` it had. */
export async function saveSettings(ctx: CollectionsLike, s: Settings): Promise<void> {
  const { defaultPreset, ...rest } = s;
  await ctx.collections<{ defaultPreset: Preset }>('preferences').put('defaults', { defaultPreset });
  const col = ctx.collections<Record<string, unknown>>('settings');
  const kept = (await col.get('project'))?.document?.defaultPreset;
  await col.put('project', kept === undefined ? rest : { ...rest, defaultPreset: kept });
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
/** The member's last applied choice; a part that fails validation is null and falls back to the settings default. */
export async function loadPreferences(ctx: CollectionsLike): Promise<Preferences | null> {
  const raw = (await ctx.collections<Record<string, unknown>>('preferences').get('current'))?.document;
  if (!raw || typeof raw !== 'object') return null;
  const range = rangeOf(raw.range);
  const compare = compareOf(raw.compare);
  return range || compare ? { range, compare } : null;
}
export const savePreferences = async (ctx: CollectionsLike, p: { range: RangeChoice; compare: CompareChoice }): Promise<void> => { await ctx.collections<unknown>('preferences').put('current', p); };

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
