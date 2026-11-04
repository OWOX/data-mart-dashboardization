import { render, screen } from '@testing-library/react';
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

test('with neither, the intro shows', async () => {
  const { deps } = await setup();
  render(<App ctx={ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: 'Build model' })).toBeInTheDocument();
});
