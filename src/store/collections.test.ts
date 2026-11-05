import { isStale, loadCache, loadOntology, loadPreferences, loadProjectModel, loadSettings, memoryCollections, saveCache, saveOntology, savePreferences, saveSettings } from './collections';
import { model } from '../test/fixtures';
import { DEFAULT_SETTINGS, type CacheDoc, type Model } from '../types';

const doc = { modelHash: 'h', anchor: '2026-10-23', builtAt: 'b1', thresholdPct: 20 } as CacheDoc;

test('round trips and defaults', async () => {
  const ctx = memoryCollections();
  expect(await loadOntology(ctx)).toBeNull();
  expect(await loadSettings(ctx)).toEqual(DEFAULT_SETTINGS);
  await saveOntology(ctx, model);
  await saveSettings(ctx, { ...DEFAULT_SETTINGS, thresholdPct: 500 });
  await saveCache(ctx, 'k', doc);
  expect(await loadOntology(ctx)).toEqual(model);
  expect((await loadSettings(ctx)).thresholdPct).toBe(100);
  expect(await loadCache(ctx, 'k')).toEqual(doc);
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
  expect((await loadProjectModel(ctx))?.version).toBe(2);
  expect(await loadOntology(ctx)).toBeNull();
});

test('unknown default preset falls back', async () => {
  const ctx = memoryCollections();
  await saveSettings(ctx, { ...DEFAULT_SETTINGS, defaultPreset: 'next_decade' as never });
  expect((await loadSettings(ctx)).defaultPreset).toBe('qtd');
  await saveSettings(ctx, { ...DEFAULT_SETTINGS, defaultPreset: 'constructor' as never });
  expect((await loadSettings(ctx)).defaultPreset).toBe('qtd');
});

test('weekStart is validated', async () => {
  const ctx = memoryCollections();
  await saveSettings(ctx, { ...DEFAULT_SETTINGS, weekStart: 'sunday' });
  expect((await loadSettings(ctx)).weekStart).toBe('sunday');
  await saveSettings(ctx, { ...DEFAULT_SETTINGS, weekStart: 'friday' as never });
  expect((await loadSettings(ctx)).weekStart).toBe('monday');
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
  const put = (doc: unknown) => ctx.collections<unknown>('preferences').put('current', doc);
  await put({ range: { kind: 'preset', preset: 'next_decade' }, compare: { kind: 'preset', preset: 'previous_period' } });
  expect(await loadPreferences(ctx)).toEqual({ range: null, compare: { kind: 'preset', preset: 'previous_period' } });
  await put({ range: { kind: 'custom', window: { from: '2026-10-09', to: '2026-10-01' } }, compare: { kind: 'custom', window: { from: '2026-13-01', to: '2026-13-02' } } });
  expect(await loadPreferences(ctx)).toBeNull();
  await put({ range: { kind: 'preset', preset: 'constructor' }, compare: { kind: 'preset', preset: 'bogus' } });
  expect(await loadPreferences(ctx)).toBeNull();
  await put('junk');
  expect(await loadPreferences(ctx)).toBeNull();
});

test('a stored this_* preset loads as its to-date id, in settings and in preferences', async () => {
  const ctx = memoryCollections();
  await ctx.collections<unknown>('settings').put('project', { ...DEFAULT_SETTINGS, defaultPreset: 'this_month' });
  expect((await loadSettings(ctx)).defaultPreset).toBe('mtd');
  await ctx.collections<unknown>('preferences').put('current', { range: { kind: 'preset', preset: 'this_week' }, compare: { kind: 'off' } });
  expect(await loadPreferences(ctx)).toEqual({ range: { kind: 'preset', preset: 'wtd' }, compare: { kind: 'off' } });
  await savePreferences(ctx, { range: { kind: 'preset', preset: 'cur_month' }, compare: { kind: 'off' } });
  expect((await loadPreferences(ctx))!.range).toEqual({ kind: 'preset', preset: 'cur_month' });
});
