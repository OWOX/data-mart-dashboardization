import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { buildModel } from './model/build';
import { fakeOwox } from './owox/fake';
import { cacheKey } from './metrics/refresh';
import { rangeFor } from './lib/dates';
import { memoryCollections, saveCache, saveModel, type CollectionsLike } from './store/collections';
import type { CacheDoc, Model } from './types';

const GID = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-10-24T10:00:00Z');
const goalAi = {
  goal: { status: 'ok', metricRef: 'm1', note: '' },
  metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'Revenue', factLink: 0, planLink: null, kind: 'flow', planShape: null, factDateField: null, planDateField: null, aggregation: null }],
};
const missingAi = { goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] };
const mart = (id: string, title: string) => ({ id, title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' });
const data = () => ({
  projectDescription: `| Critical number | Revenue | [Revenue](https://app.owox.com/ui/p/data-marts/${GID}/data-setup?field=revenue) |`,
  contexts: [],
  marts: [mart(GID, 'Orders')],
  details: { [GID]: { id: GID, title: 'Orders', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'revenue', type: 'FLOAT', isPrimaryKey: false }] } },
  blendables: { [GID]: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
});

async function setup(opts: { generate?: AppDeps['generate']; cache?: 'fresh' | 'stale' | 'none'; store?: CollectionsLike; inputHash?: string } = {}) {
  const owox = fakeOwox(data());
  const store = opts.store ?? memoryCollections();
  const built = await buildModel({ owox, generate: async () => goalAi, userId: 'u1', now: NOW });
  if (!built.ok) throw new Error('fixture');
  const model: Model = { ...built.model, inputHash: opts.inputHash ?? built.model.inputHash };
  await saveModel(store, model);
  const cache = opts.cache ?? 'fresh';
  if (cache !== 'none') {
    const doc: CacheDoc = {
      modelHash: model.inputHash,
      anchor: cache === 'fresh' ? rangeFor('this_quarter', NOW).anchor : '2000-01-01',
      refreshedAt: '2026-10-24T09:00:00Z', preset: 'this_quarter', comparison: true, cards: {},
    };
    await saveCache(store, cacheKey('this_quarter', true), doc);
  }
  const deps: AppDeps = { owox, store, generate: opts.generate === undefined ? async () => goalAi : opts.generate, userId: 'u1', now: () => NOW };
  const traversals = () => owox.calls.filter((c) => c.path.startsWith('traverse:')).length;
  return { deps, traversals, store };
}
const ctxWith = (setRoute = vi.fn()) => ({ ctx: { projectId: 'p', ui: { setRoute } } as never, setRoute });

test('a fresh cache renders at once without refreshing', async () => {
  const { deps, traversals } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText('Updated 1 h ago')).toBeInTheDocument();
  expect(traversals()).toBe(0);
});

test('a cache from another anchor triggers a refresh', async () => {
  const { deps, traversals } = await setup({ cache: 'stale' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
});

test('changed inputs show the out-of-date banner', async () => {
  const { deps } = await setup({ inputHash: 'old' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText('Descriptions or schemas changed since this model was built.')).toBeInTheDocument();
});

test('Settings and Back set the route', async () => {
  const { deps } = await setup();
  const { ctx, setRoute } = ctxWith();
  render(<App ctx={ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  expect(setRoute).toHaveBeenCalledWith('/settings');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(setRoute).toHaveBeenLastCalledWith('/');
  expect(await screen.findByRole('combobox', { name: 'Date range' })).toBeInTheDocument();
});

test('Rebuild with unchanged inputs still refreshes the canvas', async () => {
  const { deps, traversals } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
});

test('saving a changed threshold refreshes; an unchanged one does not', async () => {
  const { deps, traversals } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Updated 1 h ago');
  expect(traversals()).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.change(screen.getByLabelText(/Red when below plan/), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
});

test('a failed settings save shows an error and stays on the page', async () => {
  const mem = memoryCollections();
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return name === 'settings' ? { ...c, put: async () => { throw new Error('boom'); } } : c;
    },
  };
  const { deps } = await setup({ store });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText("Couldn't save settings: boom")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
});

test('retry after a failed initial load re-runs the load, not the AI build', async () => {
  const mem = memoryCollections();
  let failed = false;
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return { ...c, get: async (id: string) => { if (!failed) { failed = true; throw new Error('boom'); } return c.get(id); } };
    },
  };
  const generate = vi.fn(async () => goalAi);
  const { deps } = await setup({ store, generate, cache: 'none' });
  failed = false;
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText('boom')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('combobox', { name: 'Date range' })).toBeInTheDocument();
  expect(generate).not.toHaveBeenCalled();
});

test('a blocked rebuild can go back to the existing canvas', async () => {
  const { deps } = await setup({ generate: async () => missingAi });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to canvas' }));
  expect(await screen.findByRole('combobox', { name: 'Date range' })).toBeInTheDocument();
});
