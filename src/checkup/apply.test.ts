import { expect, test, vi } from 'vitest';
import { applyTarget } from './apply';
import { fakeOwox, type FakeOwoxData } from '../owox/fake';
import { memoryCollections, loadProjectSettings, saveProjectSettings } from '../store/collections';
import type { OwoxLike } from '../owox/sources';

const empty: FakeOwoxData = { projectDescription: 'x', contexts: [], marts: [], details: {}, blendables: {} };
const base = fakeOwox(empty);
const mk = (owox: OwoxLike, store = memoryCollections()) => ({ owox, store, settings: { thresholdPct: 20, industry: null, coreClasses: null }, onModel: vi.fn() });
const forbidden = () => Object.assign(new Error('Forbidden'), { status: 403 });
const withPut = (data: FakeOwoxData) => { const putJson = vi.fn().mockResolvedValue({}); return { owox: { ...fakeOwox(data), putJson } as OwoxLike, putJson }; };
const PH = '[Revenue](https://app.owox.com/ui/p/data-marts/<id>/data-setup?field=revenue)';
const FACT = '[Revenue](https://app.owox.com/ui/p/data-marts/m1/data-setup?field=revenue)';
const DESC = `Intro.\n\n| Role | Metric | Owner | Plan | Fact |\n|---|---|---|---|---|\n| Critical number | Revenue | Ann | | ${PH} |\n| Leading | Leads | Bo | | x |\n| Lagging | Churn | Cy | | y |\n\nOutro.`;

test('a refused description write returns the snippet', async () => {
  const owox = { ...base, project: { getSettings: async () => ({ description: 'x' }), updateDescription: vi.fn().mockRejectedValue(forbidden()) } } as OwoxLike;
  expect(await applyTarget({ kind: 'description_append', scope: 'project', text: 'P' }, mk(owox))).toEqual({ ok: false, refused: true, snippet: 'P' });
});

test('a 401 on the cause chain or payload also refuses', async () => {
  const wrapped = new Error('wrapped', { cause: Object.assign(new Error('x'), { payload: { status: 401 } }) });
  const owox = { ...base, postJson: vi.fn().mockRejectedValue(wrapped) } as unknown as OwoxLike;
  expect(await applyTarget({ kind: 'context_create', name: 'Sales', description: 'd' }, mk(owox))).toMatchObject({ ok: false, refused: true });
});

test('another error is not a refusal', async () => {
  const owox = { ...base, postJson: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as OwoxLike;
  expect(await applyTarget({ kind: 'context_create', name: 'S', description: '' }, mk(owox))).toEqual({ ok: false, refused: false, error: 'boom' });
});

test('append joins to the description as it is now', async () => {
  const updateDescription = vi.fn().mockResolvedValue(undefined);
  const owox = { ...base, project: { getSettings: async () => ({ description: 'Intro.' }), updateDescription } } as OwoxLike;
  expect(await applyTarget({ kind: 'description_append', scope: 'project', text: 'More.' }, mk(owox))).toEqual({ ok: true });
  expect(updateDescription).toHaveBeenLastCalledWith('Intro.\n\nMore.');
});

test('the description falls back to putJson, and with neither is refused', async () => {
  const putJson = vi.fn().mockResolvedValue({});
  const viaPut = { ...base, putJson, project: { getSettings: async () => ({ description: null }) } } as unknown as OwoxLike;
  await applyTarget({ kind: 'description_append', scope: 'project', text: 'A' }, mk(viaPut));
  expect(putJson).toHaveBeenCalledWith('/api/projects/settings/description', { description: 'A' });
  const none = { ...base, project: { getSettings: async () => ({ description: null }) } } as OwoxLike;
  expect(await applyTarget({ kind: 'description_append', scope: 'project', text: 'A' }, mk(none))).toEqual({ ok: false, refused: true, snippet: 'A' });
});

test('critical_fact changes only the Fact cell; the rest is byte for byte', async () => {
  const updateDescription = vi.fn().mockResolvedValue(undefined);
  const owox = { ...base, project: { getSettings: async () => ({ description: DESC }), updateDescription } } as OwoxLike;
  expect(await applyTarget({ kind: 'critical_fact', scope: 'project', metric: 'Revenue', factLink: FACT }, mk(owox))).toEqual({ ok: true });
  expect(updateDescription).toHaveBeenCalledWith(DESC.replace(PH, FACT));
});

test('critical_fact inserts a row when the table has none, and appends a table when there is none', async () => {
  const updateDescription = vi.fn().mockResolvedValue(undefined);
  const noRow = '| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Leading | Leads | | x |';
  let desc = noRow;
  const owox = { ...base, project: { getSettings: async () => ({ description: desc }), updateDescription } } as OwoxLike;
  await applyTarget({ kind: 'critical_fact', scope: 'project', metric: 'Revenue', factLink: FACT }, mk(owox));
  expect(updateDescription).toHaveBeenLastCalledWith(`| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Revenue | | ${FACT} |\n| Leading | Leads | | x |`);
  desc = 'Just text.';
  await applyTarget({ kind: 'critical_fact', scope: 'project', metric: 'Revenue', factLink: FACT }, mk(owox));
  expect(updateDescription).toHaveBeenLastCalledWith(`Just text.\n\n## Metrics\n| Role | Metric | Owner | Plan | Fact |\n|---|---|---|---|---|\n| Critical number | Revenue | | | ${FACT} |`);
});

test('critical_plan sets the plan cell in a later table; without a Critical row it says to add one', async () => {
  const updateDescription = vi.fn().mockResolvedValue(undefined);
  const md = `| Role | Plan | Fact |\n|---|---|---|\n| Leading | | f |\n\n| Role | Plan | Fact |\n|---|---|---|\n| Critical number | | g |`;
  let desc = md;
  const owox = { ...base, project: { getSettings: async () => ({ description: desc }), updateDescription } } as OwoxLike;
  expect(await applyTarget({ kind: 'critical_plan', scope: 'project', planLink: 'P' }, mk(owox))).toEqual({ ok: true });
  expect(updateDescription).toHaveBeenCalledWith(md.replace('| Critical number | | g |', '| Critical number | P | g |'));
  desc = 'nothing';
  updateDescription.mockClear();
  expect(await applyTarget({ kind: 'critical_plan', scope: 'project', planLink: 'P' }, mk(owox))).toEqual({ ok: false, refused: false, error: 'Add the critical number first' });
  expect(updateDescription).not.toHaveBeenCalled();
});

test('a context edited between the run and Apply keeps its edit and its current name', async () => {
  const data: FakeOwoxData = { ...empty, contexts: [{ id: 'k1', name: 'Old name', description: 'before' }] };
  const { owox, putJson } = withPut(data);
  // the run saw 'before'; someone then renamed the context and edited the text
  data.contexts[0] = { id: 'k1', name: 'New name', description: 'Edited by Ann.' };
  await applyTarget({ kind: 'description_append', scope: { contextId: 'k1' }, text: 'Added.' }, mk(owox));
  expect(putJson).toHaveBeenCalledWith('/api/contexts/k1', { name: 'New name', description: 'Edited by Ann.\n\nAdded.' });
  await applyTarget({ kind: 'critical_fact', scope: { contextId: 'k1' }, metric: 'M', factLink: 'L' }, mk(owox));
  expect(putJson).toHaveBeenLastCalledWith('/api/contexts/k1', { name: 'New name', description: expect.stringContaining('Edited by Ann.') });
  expect(await applyTarget({ kind: 'critical_plan', scope: { contextId: 'gone' }, planLink: 'P' }, mk(owox))).toMatchObject({ ok: false, refused: false });
});

test('mart_add_context keeps a context added after the run', async () => {
  const mart = { id: 'm1', title: 'Leads', status: 'PUBLISHED', description: null, contexts: [{ id: 'a', name: 'A' }], modifiedAt: 'x' };
  const data: FakeOwoxData = { ...empty, marts: [mart], details: { m1: { id: 'm1', title: 'Leads', fields: [] } } };
  const { owox, putJson } = withPut(data);
  mart.contexts = [{ id: 'a', name: 'A' }, { id: 'late', name: 'Late' }];
  await applyTarget({ kind: 'mart_add_context', martId: 'm1', contextId: 'k1', martTitle: 'Leads', contextName: 'Sales' }, mk(owox));
  expect(putJson).toHaveBeenCalledWith('/api/data-marts/m1/contexts', { contextIds: ['a', 'late', 'k1'] });
});

test('mart_add_context with a crafted Data Mart id makes no request', async () => {
  const { owox, putJson } = withPut(empty);
  const r = await applyTarget({ kind: 'mart_add_context', martId: '../../plugins/x', contextId: 'k1', martTitle: 'X', contextName: 'Sales' }, mk(owox));
  expect(r).toMatchObject({ ok: false });
  expect(putJson).not.toHaveBeenCalled();
  expect((owox as unknown as { calls: unknown[] }).calls).toEqual([]);
});

test('a refused mart_add_context names both titles', async () => {
  const owox = { ...base, getJson: async () => ({ contexts: [] }), putJson: vi.fn().mockRejectedValue(forbidden()) } as unknown as OwoxLike;
  expect(await applyTarget({ kind: 'mart_add_context', martId: 'm1', contextId: 'k1', martTitle: 'Leads', contextName: 'Sales' }, mk(owox)))
    .toEqual({ ok: false, refused: true, snippet: 'Add Leads to the context Sales' });
});

test('settings apply merges into the project settings', async () => {
  const store = memoryCollections();
  await saveProjectSettings(store, { thresholdPct: 35 });
  expect(await applyTarget({ kind: 'settings', patch: { coreClasses: [{ martId: 'm1', why: '' }] } }, mk(base, store))).toEqual({ ok: true });
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
