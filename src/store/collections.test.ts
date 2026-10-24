import { isStale, loadCache, loadModel, loadSettings, memoryCollections, saveCache, saveModel, saveSettings } from './collections';
import { DEFAULT_SETTINGS, type CacheDoc, type Model } from '../types';

const model = { version: 1, inputHash: 'h' } as Model;
const doc = { modelHash: 'h', anchor: '2026-10-23' } as CacheDoc;

test('round trips and defaults', async () => {
  const ctx = memoryCollections();
  expect(await loadModel(ctx)).toBeNull();
  expect(await loadSettings(ctx)).toEqual(DEFAULT_SETTINGS);
  await saveModel(ctx, model);
  await saveSettings(ctx, { ...DEFAULT_SETTINGS, thresholdPct: 500 });
  await saveCache(ctx, 'k', doc);
  expect(await loadModel(ctx)).toEqual(model);
  expect((await loadSettings(ctx)).thresholdPct).toBe(100);
  expect(await loadCache(ctx, 'k')).toEqual(doc);
});

test('staleness', () => {
  expect(isStale(null, model, '2026-10-23')).toBe(true);
  expect(isStale(doc, model, '2026-10-23')).toBe(false);
  expect(isStale(doc, model, '2026-10-24')).toBe(true);
  expect(isStale(doc, { ...model, inputHash: 'x' }, '2026-10-23')).toBe(true);
});
