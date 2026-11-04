import { render, screen, waitFor } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { buildModel } from './model/build';
import { fakeOwox, type FakeOwoxData } from './owox/fake';
import { loadOntology, memoryCollections } from './store/collections';
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
  const built = await buildModel({ owox, generate: async () => goalAi, userId: 'u1', now: NOW });
  if (!built.ok) throw new Error('fixture');
  const deps: AppDeps = { owox, store, generate: async () => goalAi, userId: 'u1', now: () => NOW };
  return { deps, store, model: built.model };
}

const ctx = { projectId: 'p1' } as never;

test('an ontology doc wins over the project model', async () => {
  const { deps, store, model } = await setup();
  await store.collections<Model>('ontology').put('current', { ...model, builtBy: 'mine' });
  await store.collections<Model>('model').put('current', { ...model, builtBy: 'project' });
  render(<App ctx={ctx} deps={deps} />);
  expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
  expect((await loadOntology(store))!.builtBy).toBe('mine');
});

test('with no ontology the project model seeds it, without an AI call', async () => {
  const { deps, store, model } = await setup();
  const generate = vi.fn(deps.generate!);
  await store.collections<unknown>('model').put('current', { ...model, version: 1, builtBy: 'project' });
  render(<App ctx={ctx} deps={{ ...deps, generate }} />);
  expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
  const saved = (await loadOntology(store))!;
  expect(saved.version).toBe(2);
  expect(saved.builtBy).toBe('project');
  expect(generate).not.toHaveBeenCalled();
  // the project doc is left alone
  expect((await store.collections<Model>('model').get('current'))!.document.version).toBe(1);
});

test('with neither, the build starts on open and shows its progress', async () => {
  const { deps } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  render(<App ctx={ctx} deps={{ ...deps, generate: async () => { await gate; return goalAi; } }} />);
  expect(await screen.findByText('AI reading descriptions…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Build model' })).toBeNull();
  release();
  expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
});

test('seeding drops classes the member cannot access and rehashes for the kept ones', async () => {
  const { deps, store, model } = await setup();
  const ghost = { ...model.classes[0]!, id: 'ghost', martId: 'ghost', title: 'Ghost', depth: 1 };
  await store.collections<unknown>('model').put('current', {
    ...model, inputHash: 'project-hash', classes: [...model.classes, ghost],
    edges: [...model.edges, { from: model.goal.classId, to: 'ghost' }],
    metrics: [...model.metrics, { ...model.metrics[0]!, id: 'ghost:k', martId: 'ghost' }],
  });
  render(<App ctx={ctx} deps={deps} />);
  expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
  const saved = (await loadOntology(store))!;
  expect(saved.classes.map((c) => c.id)).toEqual(model.classes.map((c) => c.id));
  expect(saved.edges.some((e) => e.to === 'ghost')).toBe(false);
  expect(saved.metrics.some((x) => x.martId === 'ghost')).toBe(false);
  expect(saved.inputHash).toBe(model.inputHash);
  await waitFor(() => expect(screen.queryByText('Descriptions or schemas changed since this model was built.')).toBeNull());
});

test('if the hash cannot be recomputed the project hash is kept', async () => {
  const { deps, store, model } = await setup();
  await store.collections<unknown>('model').put('current', { ...model, inputHash: 'project-hash' });
  const owox = { ...deps.owox, getJson: async () => { throw new Error('nope'); } } as AppDeps['owox'];
  render(<App ctx={ctx} deps={{ ...deps, owox }} />);
  expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
  expect((await loadOntology(store))!.inputHash).toBe('project-hash');
});

test('seeding with unreadable contexts keeps the project hash', async () => {
  const { deps, store, model } = await setup();
  await store.collections<unknown>('model').put('current', { ...model, inputHash: 'project-hash' });
  const base = deps.owox;
  const owox = { ...base, getJson: (async (path: string) => { if (path === '/api/contexts') throw new Error('403'); return base.getJson(path); }) as typeof base.getJson };
  render(<App ctx={ctx} deps={{ ...deps, owox }} />);
  expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
  expect((await loadOntology(store))!.inputHash).toBe('project-hash');
});

test('dataMarts.list rejecting while seeding shows the error view', async () => {
  const { deps, store, model } = await setup();
  await store.collections<unknown>('model').put('current', model);
  const owox = { ...deps.owox, dataMarts: { ...deps.owox.dataMarts, list: async () => { throw new Error('LIST_FAILED'); } } } as AppDeps['owox'];
  render(<App ctx={ctx} deps={{ ...deps, owox }} />);
  expect(await screen.findByText(/LIST_FAILED/)).toBeInTheDocument();
  expect(await loadOntology(store)).toBeNull();
});
