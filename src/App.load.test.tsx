import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { buildModel } from './model/build';
import { fakeOwox, type FakeOwoxData } from './owox/fake';
import { loadSettings, loadShared, memoryCollections } from './store/collections';
import { seedShared } from './test/fixtures';
import type { Model } from './types';

const GID = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-10-24T10:00:00Z');
const goalAi = {
  goal: { status: 'ok', metricRef: 'm1', note: '' },
  metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'Revenue', factLink: 0, planLink: null, kind: 'flow', planShape: null, factDateField: null, planDateField: null, aggregation: null }],
};
const mart = (id: string, title: string) => ({ id, title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' });
const data = (): FakeOwoxData => ({
  projectDescription: `| Critical number | Revenue | [Revenue](https://app.owox.com/ui/p/data-marts/${GID}/data-setup?field=revenue) |`,
  contexts: [],
  marts: [mart(GID, 'Orders')],
  details: { [GID]: { id: GID, title: 'Orders', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'revenue', type: 'FLOAT', isPrimaryKey: false }] } },
  blendables: { [GID]: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
});

async function setup() {
  const owox = fakeOwox(data());
  const store = memoryCollections();
  const built = await buildModel({ owox, generate: async () => goalAi, userId: 'u1', now: NOW, existingCore: null, industry: null });
  if (!built.ok) throw new Error('fixture');
  const deps: AppDeps = { owox, store, generate: async () => goalAi, userId: 'u1', now: () => NOW };
  return { deps, store, model: built.model };
}

const ctx = { projectId: 'p1' } as never;

test('an ontology doc wins over the project model', async () => {
  const { deps, store, model } = await setup();
  await store.collections<Model>('ontology_project').put('current', { ...model, builtBy: 'mine' });
  await store.collections<Model>('model').put('current', { ...model, builtBy: 'project' });
  render(<App ctx={ctx} deps={deps} />);
  expect(await screen.findByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
  expect((await loadShared(store))!.builtBy).toBe('mine');
});

test('an admin migrates the 0.3 project model without an AI call', async () => {
  const { deps, store, model } = await setup();
  const generate = vi.fn(deps.generate!);
  await store.collections<unknown>('model').put('current', { ...model, version: 1, builtBy: 'project' });
  render(<App ctx={ctx} deps={{ ...deps, generate }} />);
  expect(await screen.findByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
  const saved = (await loadShared(store))!;
  expect(saved.version).toBe(3);
  expect(saved.builtBy).toBe('project');
  expect(saved.editedBy).toBe('Test Admin');
  expect(generate).not.toHaveBeenCalled();
  // the project doc is left alone
  expect((await store.collections<Model>('model').get('current'))!.document.version).toBe(1);
});

test('an admin migration saves the chosen core classes to the project settings', async () => {
  const { deps, store, model } = await setup();
  const two = { ...model, version: 1, classes: [...model.classes, { ...model.classes[0]!, id: 'b', martId: 'b', title: 'B' }], edges: [{ from: model.goal.classId, to: 'b' }] };
  await store.collections<unknown>('model').put('current', two);
  render(<App ctx={ctx} deps={deps} />);
  expect(await screen.findByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
  const core = (await loadShared(store))!.classes.filter((c) => c.core).map((c) => c.martId);
  expect(core.length).toBeGreaterThan(0);
  const settings = await loadSettings(store);
  expect(settings.coreClasses?.map((c) => c.martId)).toEqual(core);
});

test('the migration takes core classes from the settings when they are set', async () => {
  const { deps, store, model } = await setup();
  await store.collections<unknown>('model').put('current', model);
  await store.collections<unknown>('settings').put('project', { thresholdPct: 20, industry: 'saas', coreClasses: [{ martId: GID, why: 'Revenue' }] });
  render(<App ctx={ctx} deps={deps} />);
  expect(await screen.findByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
  expect((await loadShared(store))!.classes.find((c) => c.martId === GID)!.core).toBe(true);
});

test('a member opening the 0.3 project model sees it and writes nothing', async () => {
  const { deps, store, model } = await setup();
  const generate = vi.fn(deps.generate!);
  await store.collections<unknown>('model').put('current', model);
  const owox = fakeOwox({ ...data(), roles: ['viewer'] });
  render(<App ctx={ctx} deps={{ ...deps, owox, generate }} />);
  expect(await screen.findByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
  expect(await loadShared(store)).toBeNull();
  expect(await store.collections<unknown>('settings').get('project')).toBeNull();
  expect(generate).not.toHaveBeenCalled();
});

test('a member with no shared and no project model sees the not-set-up screen and no AI runs', async () => {
  const { deps } = await setup();
  const generate = vi.fn(deps.generate!);
  const owox = fakeOwox({ ...data(), roles: ['viewer'] });
  const setRoute = vi.fn();
  render(<App ctx={{ projectId: 'p1', ui: { setRoute } } as never} deps={{ ...deps, owox, generate }} />);
  expect(await screen.findByText("An admin hasn't set up Gyroscope yet")).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Run checkup' }));
  expect(setRoute).toHaveBeenCalledWith('/settings/checkup');
  expect(generate).not.toHaveBeenCalled();
});

test('a member can save view settings but not the threshold', async () => {
  const { deps, store, model } = await setup();
  await seedShared(store, model);
  const owox = fakeOwox({ ...data(), roles: ['viewer'] });
  render(<App ctx={{ projectId: 'p1', route: '/settings' } as never} deps={{ ...deps, owox }} />);
  const threshold = await screen.findByLabelText('Red when below plan by more than (%)');
  expect(threshold).toBeDisabled();
  expect(screen.getByText('Only a project admin can change this')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Week starts on'), { target: { value: 'sunday' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Date range' });
  expect(await store.collections<unknown>('settings').get('project')).toBeNull();
  expect((await store.collections<{ weekStart: string }>('preferences').get('defaults'))!.document.weekStart).toBe('sunday');
});

test('with neither, the build starts on open and shows its progress', async () => {
  const { deps } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  render(<App ctx={ctx} deps={{ ...deps, generate: async () => { await gate; return goalAi; } }} />);
  await waitFor(() => expect(screen.getByText('AI read the descriptions').closest('li')).toHaveAttribute('data-state', 'running'));
  expect(screen.queryByRole('button', { name: 'Build model' })).toBeNull();
  release();
  expect(await screen.findByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
});

test('the first build failing to read the project says what failed', async () => {
  const { deps } = await setup();
  const owox = { ...deps.owox, project: { getSettings: async () => { throw new Error('boom'); } } } as AppDeps['owox'];
  render(<App ctx={ctx} deps={{ ...deps, owox }} />);
  expect(await screen.findByText(/Couldn't read the project description and Data Marts: boom/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('a first-open build starts from the stored core classes', async () => {
  const d = data();
  d.marts.push(mart('c', 'Customers'));
  // Customers references Orders and nothing references Customers, so the ranking never picks it
  d.details.c = { id: 'c', title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'o', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'MAX({{ref path="orders" field="revenue"}})', level: 'metric' } }] };
  d.blendables.c = { availableSources: [{ aliasPath: 'orders', dataMartId: GID, title: 'Orders', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['id'] };
  const store = memoryCollections();
  await store.collections<unknown>('settings').put('project', { thresholdPct: 20, industry: 'saas', coreClasses: [{ martId: 'c', why: 'Who buys' }] });
  render(<App ctx={ctx} deps={{ owox: fakeOwox(d), store, generate: async () => goalAi, userId: 'u1', now: () => NOW }} />);
  expect(await screen.findByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
  const saved = (await loadShared(store))!;
  // the AI named no core class, so the flag can only come from the stored list
  expect(saved.classes.find((c) => c.id === 'c')!.core).toBe(true);
});

test('an admin opening a model whose core flags differ from the settings list reconciles the model once', async () => {
  const { deps, store, model } = await setup();
  await seedShared(store, { ...model, classes: model.classes.map((c) => ({ ...c, core: false })) });
  await store.collections<unknown>('settings').put('project', { thresholdPct: 20, industry: 'saas', coreClasses: [{ martId: GID, why: 'Revenue' }] });
  render(<App ctx={ctx} deps={deps} />);
  expect(await screen.findByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
  await waitFor(async () => expect((await loadShared(store))!.classes.find((c) => c.martId === GID)!.core).toBe(true));
  // the edit history and the cache key are untouched
  expect((await loadShared(store))!.editedAt).toBe(model.editedAt);
});

test('a member never writes the reconciled model', async () => {
  const { deps, store, model } = await setup();
  await seedShared(store, { ...model, classes: model.classes.map((c) => ({ ...c, core: false })) });
  await store.collections<unknown>('settings').put('project', { thresholdPct: 20, industry: 'saas', coreClasses: [{ martId: GID, why: 'Revenue' }] });
  const owox = fakeOwox({ ...data(), roles: ['viewer'] });
  render(<App ctx={ctx} deps={{ ...deps, owox }} />);
  expect(await screen.findByRole('heading', { name: 'Gyroscope' })).toBeInTheDocument();
  expect((await loadShared(store))!.classes.find((c) => c.martId === GID)!.core).toBe(false);
});

test('an admin build over an unreadable stored model shows why, with no Reload, and leaves the doc', async () => {
  const { deps, store } = await setup();
  const bad = { version: 99, builtAt: 't1', builtBy: 'u1' };
  await store.collections<unknown>('ontology_project').put('current', bad);
  render(<App ctx={ctx} deps={deps} />);
  expect(await screen.findByText("The stored model can't be read by this version of Gyroscope.")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Reload|Retry/ })).toBeNull();
  expect(screen.queryByText(/Another admin changed/)).toBeNull();
  expect((await store.collections<unknown>('ontology_project').get('current'))!.document).toEqual(bad);
});
