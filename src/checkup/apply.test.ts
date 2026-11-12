import { expect, test, vi } from 'vitest';
import { applyTarget } from './apply';
import { fakeOwox } from '../owox/fake';
import { memoryCollections, loadProjectSettings, saveProjectSettings } from '../store/collections';
import type { OwoxLike } from '../owox/sources';

const base = fakeOwox({ projectDescription: 'x', contexts: [], marts: [], details: {}, blendables: {} });
const mk = (owox: OwoxLike, store = memoryCollections()) => ({ owox, store, settings: { thresholdPct: 20, industry: null, coreClasses: null }, onModel: vi.fn() });
const forbidden = () => Object.assign(new Error('Forbidden'), { status: 403 });

test('a refused description write returns the snippet', async () => {
  const owox = { ...base, project: { getSettings: async () => ({ description: 'x' }), updateDescription: vi.fn().mockRejectedValue(forbidden()) } } as OwoxLike;
  expect(await applyTarget({ kind: 'description', mode: 'append', text: 'P' }, mk(owox))).toEqual({ ok: false, refused: true, snippet: 'P' });
});

test('a 403 on the cause chain or payload also refuses', async () => {
  const wrapped = new Error('wrapped', { cause: Object.assign(new Error('x'), { payload: { status: 401 } }) });
  const owox = { ...base, postJson: vi.fn().mockRejectedValue(wrapped) } as unknown as OwoxLike;
  const r = await applyTarget({ kind: 'context_create', name: 'Sales', description: 'd' }, mk(owox));
  expect(r).toMatchObject({ ok: false, refused: true });
});

test('another error is not a refusal', async () => {
  const owox = { ...base, postJson: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as OwoxLike;
  expect(await applyTarget({ kind: 'context_create', name: 'S', description: '' }, mk(owox))).toEqual({ ok: false, refused: false, error: 'boom' });
});

test('append joins to the current description; metrics_table swaps the table', async () => {
  const updateDescription = vi.fn().mockResolvedValue(undefined);
  const owox = { ...base, project: { getSettings: async () => ({ description: 'Intro.' }), updateDescription } } as OwoxLike;
  expect(await applyTarget({ kind: 'description', mode: 'append', text: 'More.' }, mk(owox))).toEqual({ ok: true });
  expect(updateDescription).toHaveBeenLastCalledWith('Intro.\n\nMore.');
  await applyTarget({ kind: 'description', mode: 'metrics_table', text: '| Role | Plan | Fact |\n|---|---|---|\n| Critical | | |' }, mk(owox));
  expect(updateDescription).toHaveBeenLastCalledWith('Intro.\n\n## Metrics\n| Role | Plan | Fact |\n|---|---|---|\n| Critical | | |');
});

test('the description falls back to putJson, and with neither is refused', async () => {
  const putJson = vi.fn().mockResolvedValue({});
  const viaPut = { ...base, putJson, project: { getSettings: async () => ({ description: null }) } } as unknown as OwoxLike;
  await applyTarget({ kind: 'description', mode: 'append', text: 'A' }, mk(viaPut));
  expect(putJson).toHaveBeenCalledWith('/api/projects/settings/description', { description: 'A' });
  const none = { ...base, project: { getSettings: async () => ({ description: null }) } } as OwoxLike;
  expect(await applyTarget({ kind: 'description', mode: 'append', text: 'A' }, mk(none))).toEqual({ ok: false, refused: true, snippet: 'A' });
});

test('contexts and Data Mart contexts use their endpoints', async () => {
  const postJson = vi.fn().mockResolvedValue({}); const putJson = vi.fn().mockResolvedValue({});
  const owox = { ...base, postJson, putJson } as unknown as OwoxLike;
  await applyTarget({ kind: 'context_create', name: 'Sales', description: 'd' }, mk(owox));
  await applyTarget({ kind: 'context_update', id: 'k1', name: 'Sales', description: 'e' }, mk(owox));
  await applyTarget({ kind: 'mart_contexts', martId: 'm1', contextIds: ['a', 'b'] }, mk(owox));
  expect(postJson).toHaveBeenCalledWith('/api/contexts', { name: 'Sales', description: 'd' });
  expect(putJson).toHaveBeenCalledWith('/api/contexts/k1', { name: 'Sales', description: 'e' });
  expect(putJson).toHaveBeenCalledWith('/api/data-marts/m1/contexts', { contextIds: ['a', 'b'] });
});

test('settings apply merges into the project settings', async () => {
  const store = memoryCollections();
  await saveProjectSettings(store, { thresholdPct: 35 });
  const r = await applyTarget({ kind: 'settings', patch: { coreClasses: [{ martId: 'm1', why: '' }] } }, mk(base, store));
  expect(r).toEqual({ ok: true });
  expect(await loadProjectSettings(store)).toEqual({ thresholdPct: 35, industry: null, coreClasses: [{ martId: 'm1', why: '' }] });
});

test('an empty settings patch writes nothing; a model target calls onModel', async () => {
  const store = memoryCollections(); const put = vi.spyOn(store.collections('settings'), 'put');
  const deps = mk(base, store);
  expect(await applyTarget({ kind: 'settings', patch: {} }, deps)).toEqual({ ok: true });
  expect(put).not.toHaveBeenCalled();
  expect(await applyTarget({ kind: 'model', action: 'rebuild' }, deps)).toEqual({ ok: true });
  expect(deps.onModel).toHaveBeenCalledWith('rebuild');
});
