import { isStale, loadCache, loadPreferences, loadProjectModel, loadProjectSettings, loadSettings, loadShared, loadViewSettings, memoryCollections, ModelConflict, ModelUnreadable, saveCache, savePreferences, saveProjectSettings, saveShared, saveViewSettings } from './collections';
import { model } from '../test/fixtures';
import { DEFAULT_SETTINGS, type CacheDoc, type Model } from '../types';

const doc = { modelHash: 'h', anchor: '2026-10-23', builtAt: 'b1', thresholdPct: 20 } as CacheDoc;

test('round trips and defaults', async () => {
  const ctx = memoryCollections();
  expect(await loadShared(ctx)).toBeNull();
  expect(await loadSettings(ctx)).toEqual(DEFAULT_SETTINGS);
  await saveShared(ctx, null, model);
  await saveProjectSettings(ctx, { thresholdPct: 500 });
  await saveCache(ctx, 'k', doc);
  expect(await loadShared(ctx)).toEqual(model);
  expect((await loadSettings(ctx)).thresholdPct).toBe(100);
  expect(await loadCache(ctx, 'k')).toEqual(doc);
});

const mk = (over: Partial<Model> = {}): Model => ({ ...model, ...over });

test('saveShared refuses to overwrite a newer doc', async () => {
  const store = memoryCollections();
  const a = mk({ builtAt: 't1', editedAt: null });
  await saveShared(store, null, a);
  const b = { ...a, editedAt: 't2', editedBy: 'u2' };
  await saveShared(store, a, b);
  const stale = { ...a, editedAt: 't3', editedBy: 'u1' };
  await expect(saveShared(store, a, stale)).rejects.toMatchObject({ name: 'ModelConflict', by: 'u2', at: 't2' });
  expect((await loadShared(store))!.editedAt).toBe('t2');
});
test('saveShared with no base refuses when a doc exists', async () => {
  const store = memoryCollections();
  await saveShared(store, null, mk({ builtAt: 't1' }));
  await expect(saveShared(store, null, mk({ builtAt: 't9' }))).rejects.toBeInstanceOf(ModelConflict);
});
test('saveShared writes when nothing is stored, even with a base (a failed seed save)', async () => {
  const store = memoryCollections();
  await saveShared(store, mk({ builtAt: 't1' }), mk({ builtAt: 't2' }));
  expect((await loadShared(store))!.builtAt).toBe('t2');
});
test('saveShared throws ModelUnreadable for a stored doc this version cannot read, and leaves it', async () => {
  const store = memoryCollections();
  const bad = { version: 99, builtAt: 't1', builtBy: 'u1' };
  await store.collections<unknown>('ontology_project').put('current', bad);
  const err = await saveShared(store, null, mk()).catch((e) => e);
  expect(err).toBeInstanceOf(ModelUnreadable);
  expect(err).not.toBeInstanceOf(ModelConflict);
  expect(err.message).toBe("The stored model can't be read by this version of Gyroscope.");
  expect((await store.collections<unknown>('ontology_project').get('current'))!.document).toEqual(bad);
});
test('a conflict names the builder when the doc was never edited', async () => {
  const store = memoryCollections();
  await saveShared(store, null, mk({ builtAt: 't1', builtBy: 'u1' }));
  await expect(saveShared(store, null, mk())).rejects.toMatchObject({ by: 'u1', at: 't1' });
});
test('a 0.3 default preset is ignored once; a 0.4 one is kept', async () => {
  const store = memoryCollections();
  await store.collections('preferences').put('defaults', { defaultPreset: 'qtd' });
  expect((await loadViewSettings(store)).defaultPreset).toBeNull();
  await saveViewSettings(store, { defaultPreset: 'mtd', comparisonDefault: false, weekStart: 'sunday' });
  expect(await loadViewSettings(store)).toEqual({ defaultPreset: 'mtd', comparisonDefault: false, weekStart: 'sunday' });
});
test('view settings fall back to the old project fields for comparison and week start', async () => {
  const store = memoryCollections();
  await store.collections('settings').put('project', { thresholdPct: 30, comparisonDefault: false, weekStart: 'sunday' });
  expect(await loadViewSettings(store)).toEqual({ defaultPreset: null, comparisonDefault: false, weekStart: 'sunday' });
  expect((await loadProjectSettings(store)).thresholdPct).toBe(30);
});
test('project settings keep only valid core classes', async () => {
  const store = memoryCollections();
  await store.collections('settings').put('project', { industry: 'saas', coreClasses: [{ martId: 'a', why: 'x' }, { martId: 5 }, null] });
  expect(await loadProjectSettings(store)).toEqual({ thresholdPct: 20, industry: 'saas', coreClasses: [{ martId: 'a', why: 'x' }] });
});
test('project settings cap core classes at 7 and reject an unknown industry', async () => {
  const store = memoryCollections();
  const many = Array.from({ length: 9 }, (_, i) => ({ martId: `m${i}`, why: 'w' }));
  await store.collections('settings').put('project', { industry: 'mining', coreClasses: many });
  const s = await loadProjectSettings(store);
  expect(s.industry).toBeNull();
  expect(s.coreClasses).toHaveLength(7);
});
test('saving the threshold keeps the stored industry, core classes and unknown fields', async () => {
  const store = memoryCollections();
  const stored = { thresholdPct: 20, industry: 'mining', coreClasses: [{ martId: 'a', why: 'x' }], extra: 1 };
  await store.collections('settings').put('project', stored);
  await saveProjectSettings(store, { thresholdPct: 30 });
  expect((await store.collections('settings').get('project'))!.document).toEqual({ ...stored, thresholdPct: 30 });
});
test('preferences from 0.3 are ignored once', async () => {
  const store = memoryCollections();
  await store.collections('preferences').put('current', { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'off' } });
  expect(await loadPreferences(store)).toBeNull();
});
test('a null range is saved and read back', async () => {
  const store = memoryCollections();
  await savePreferences(store, { range: null, compare: { kind: 'off' } });
  expect(await loadPreferences(store)).toEqual({ range: null, compare: { kind: 'off' } });
});

test('staleness', () => {
  expect(isStale(null, model, '2026-10-23', 20)).toBe(true);
  expect(isStale(doc, model, '2026-10-23', 20)).toBe(false);
  expect(isStale(doc, model, '2026-10-24', 20)).toBe(true);
  // the model version is builtAt + editedAt: a hash that moves alone keeps the cache
  expect(isStale(doc, { ...model, inputHash: 'x' }, '2026-10-23', 20)).toBe(false);
  expect(isStale({ ...doc, editedAt: null }, { ...model, inputHash: 'x', editedAt: '2026-11-04T10:00:00Z' }, '2026-10-23', 20)).toBe(true);
});

test('a rebuild or a threshold change makes the cache stale', () => {
  expect(isStale(doc, { ...model, builtAt: 'b2' }, '2026-10-23', 20)).toBe(true);
  expect(isStale(doc, model, '2026-10-23', 15)).toBe(true);
});

test('an edit makes the cache stale', () => {
  expect(isStale({ ...doc, editedAt: null }, { ...model, editedAt: '2026-11-04T10:00:00Z' }, '2026-10-23', 20)).toBe(true);
  expect(isStale({ ...doc, editedAt: '2026-11-04T10:00:00Z' }, { ...model, editedAt: '2026-11-04T10:00:00Z' }, '2026-10-23', 20)).toBe(false);
  // a doc written before editedAt existed counts as never edited
  expect(isStale(doc, model, '2026-10-23', 20)).toBe(false);
});

test('the project model is read through the upgrade, never written by the ontology', async () => {
  const ctx = memoryCollections();
  const { version: _v, editedAt: _e, ...v1 } = model;
  await ctx.collections<unknown>('model').put('current', { ...v1, version: 1, classes: model.classes.map(({ shown: _s, ...c }) => c) });
  expect((await loadProjectModel(ctx))?.version).toBe(3);
  expect(await loadShared(ctx)).toBeNull();
});

test('an unknown default preset reads as null', async () => {
  const ctx = memoryCollections();
  await saveViewSettings(ctx, { defaultPreset: 'next_decade' as never, comparisonDefault: true, weekStart: 'monday' });
  expect((await loadViewSettings(ctx)).defaultPreset).toBeNull();
  await saveViewSettings(ctx, { defaultPreset: 'constructor' as never, comparisonDefault: true, weekStart: 'monday' });
  expect((await loadViewSettings(ctx)).defaultPreset).toBeNull();
});

test('weekStart is validated', async () => {
  const ctx = memoryCollections();
  await saveViewSettings(ctx, { defaultPreset: null, comparisonDefault: true, weekStart: 'sunday' });
  expect((await loadViewSettings(ctx)).weekStart).toBe('sunday');
  await saveViewSettings(ctx, { defaultPreset: null, comparisonDefault: true, weekStart: 'friday' as never });
  expect((await loadViewSettings(ctx)).weekStart).toBe('monday');
});

test('preferences round trip', async () => {
  const ctx = memoryCollections();
  expect(await loadPreferences(ctx)).toBeNull();
  const p = { range: { kind: 'custom', window: { from: '2026-10-01', to: '2026-10-09' } }, compare: { kind: 'preset', preset: 'year_before' } } as const;
  await savePreferences(ctx, p);
  expect(await loadPreferences(ctx)).toEqual(p);
  await savePreferences(ctx, { range: { kind: 'preset', preset: 'last_month' }, compare: { kind: 'off' } });
  expect(await loadPreferences(ctx)).toEqual({ range: { kind: 'preset', preset: 'last_month' }, compare: { kind: 'off' } });
});

test('invalid preference parts fall back to null', async () => {
  const ctx = memoryCollections();
  const put = (doc: unknown) => ctx.collections<unknown>('preferences').put('current', typeof doc === 'object' ? { ...(doc as object), v: 4 } : doc);
  await put({ range: { kind: 'preset', preset: 'next_decade' }, compare: { kind: 'preset', preset: 'previous_period' } });
  expect(await loadPreferences(ctx)).toEqual({ range: null, compare: { kind: 'preset', preset: 'previous_period' } });
  await put({ range: { kind: 'custom', window: { from: '2026-10-09', to: '2026-10-01' } }, compare: { kind: 'custom', window: { from: '2026-13-01', to: '2026-13-02' } } });
  expect(await loadPreferences(ctx)).toBeNull();
  await put({ range: { kind: 'preset', preset: 'constructor' }, compare: { kind: 'preset', preset: 'bogus' } });
  expect(await loadPreferences(ctx)).toBeNull();
  await put('junk');
  expect(await loadPreferences(ctx)).toBeNull();
});

test('a stored this_* preset loads as its to-date id, in view settings and in preferences', async () => {
  const ctx = memoryCollections();
  await ctx.collections<unknown>('preferences').put('defaults', { v: 4, defaultPreset: 'this_month' });
  expect((await loadViewSettings(ctx)).defaultPreset).toBe('mtd');
  await ctx.collections<unknown>('preferences').put('current', { v: 4, range: { kind: 'preset', preset: 'this_week' }, compare: { kind: 'off' } });
  expect(await loadPreferences(ctx)).toEqual({ range: { kind: 'preset', preset: 'wtd' }, compare: { kind: 'off' } });
  await savePreferences(ctx, { range: { kind: 'preset', preset: 'cur_month' }, compare: { kind: 'off' } });
  expect((await loadPreferences(ctx))!.range).toEqual({ kind: 'preset', preset: 'cur_month' });
});
