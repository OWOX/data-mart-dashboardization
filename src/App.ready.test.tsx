import { cleanup, fireEvent, render, screen, waitFor, within } from './test-host';
import { App, type AppDeps } from './App';
import { buildModel } from './model/build';
import { fakeOwox, type FakeOwoxData } from './owox/fake';
import { cacheKey } from './metrics/refresh';
import { rangeFor } from './lib/dates';
import { loadShared, loadPreferences, memoryCollections, saveCache, savePreferences, saveViewSettings, type CollectionsLike } from './store/collections';
import { seedShared } from './test/fixtures';
import { type CacheDoc, type Model } from './types';

const GID = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-10-24T10:00:00Z');
const goalAi = {
  goal: { status: 'ok', metricRef: 'm1', note: '' },
  metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'Revenue', factLink: 0, planLink: null, kind: 'flow', planShape: null, factDateField: null, planDateField: null, aggregation: null }],
};
const missingAi = { goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] };
const mart = (id: string, title: string) => ({ id, title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' });
const CID = 'c';
const data = (): FakeOwoxData => ({
  projectDescription: `| Critical number | Revenue | [Revenue](https://app.owox.com/ui/p/data-marts/${GID}/data-setup?field=revenue) |`,
  contexts: [],
  marts: [mart(GID, 'Orders')],
  details: { [GID]: { id: GID, title: 'Orders', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'revenue', type: 'FLOAT', alias: 'Revenue', isPrimaryKey: false }] } },
  blendables: { [GID]: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
});

async function setup(opts: { generate?: AppDeps['generate']; cache?: 'fresh' | 'stale' | 'none'; store?: CollectionsLike; inputHash?: string; withCustomers?: boolean; range?: 'qtd' | 'none' | 'unset' } = {}) {
  const d = data();
  if (opts.withCustomers) {
    d.marts.push(mart(CID, 'Customers'));
    d.details[CID] = { id: CID, title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }] };
    d.blendables[GID] = { availableSources: [{ aliasPath: 'customers', dataMartId: CID, title: 'Customers', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['id'] };
    d.blendables[CID] = { availableSources: [], mainUniqueCountKeyFields: ['id'] };
    d.details[GID]!.fields.push({ name: 'ltv', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'AVG({{ref path="customers" field="x"}})', level: 'metric' } });
  }
  const owox = fakeOwox(d);
  const store = opts.store ?? memoryCollections();
  const built = await buildModel({ owox, generate: async () => goalAi, userId: 'u1', now: NOW, existingCore: null, industry: null });
  if (!built.ok) throw new Error('fixture');
  const model: Model = { ...built.model, inputHash: opts.inputHash ?? built.model.inputHash };
  await seedShared(store, model);
  const cache = opts.cache ?? 'fresh';
  if (cache !== 'none') {
    const doc: CacheDoc = {
      modelHash: model.inputHash, builtAt: model.builtAt, editedAt: model.editedAt, thresholdPct: 20,
      anchor: cache === 'fresh' ? rangeFor('qtd', NOW).anchor : '2000-01-01',
      refreshedAt: '2026-10-24T09:00:00Z', key: 'qtd:previous_period', comparison: true, cards: {},
    };
    await saveCache(store, cacheKey({ kind: 'preset', preset: 'qtd' }, { kind: 'preset', preset: 'previous_period' }), doc);
  }
  // most tests start on the flow view; 'none' is a member who cleared the range, 'unset' leaves the view settings to decide
  const rangeOpt = opts.range ?? 'qtd';
  if (rangeOpt === 'qtd') await savePreferences(store, { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'preset', preset: 'previous_period' } });
  if (rangeOpt === 'none') await savePreferences(store, { range: null, compare: { kind: 'preset', preset: 'previous_period' } });
  let clock = NOW.getTime();
  const deps: AppDeps = { owox, store, generate: opts.generate === undefined ? async () => goalAi : opts.generate, userId: 'u1', now: () => new Date(clock) };
  const tick = () => { clock += 60_000; };
  const traversals = () => owox.calls.filter((c) => c.path.startsWith('traverse:')).length;
  return { deps, traversals, store, d, owox, tick };
}
const ctxWith = (setRoute = vi.fn()) => ({ ctx: { projectId: 'p', ui: { setRoute } } as never, setRoute });

test('a fresh cache renders at once without refreshing', async () => {
  const { deps, traversals } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText(/Updated 1 h ago/)).toBeInTheDocument();
  expect(traversals()).toBe(0);
});

test('a cache from another anchor triggers a refresh', async () => {
  const { deps, traversals } = await setup({ cache: 'stale' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
});

test('changed inputs show the issues icon, and its layer the out-of-date group', async () => {
  const { deps } = await setup({ inputHash: 'old' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: '1 issue' }));
  expect(screen.getByText('The descriptions changed since this model was built.')).toBeInTheDocument();
});

test('Settings and Back set the route', async () => {
  const { deps } = await setup();
  const { ctx, setRoute } = ctxWith();
  render(<App ctx={ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  expect(setRoute).toHaveBeenCalledWith('/settings');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(setRoute).toHaveBeenLastCalledWith('/');
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
});

const openOntology = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
};
// the metric's name is the field's alias, so a rebuild can no longer rename it; a changed kind is a difference it still proposes
const changedAi = { ...goalAi, metrics: [{ ...goalAi.metrics[0]!, kind: 'level' }] };

test('Rebuild with nothing new says the model matches and saves nothing', async () => {
  const { deps, store } = await setup();
  const before = await loadShared(store);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await openOntology();
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  expect(await screen.findByText('The model already matches the descriptions.')).toBeInTheDocument();
  expect(await loadShared(store)).toEqual(before);
});

test('Rebuild with nothing new still draws a ref the stored model is missing when closed', async () => {
  const { deps, store } = await setup({ withCustomers: true });
  const built = (await loadShared(store))!;
  expect(built.edges).toContainEqual(expect.objectContaining({ from: GID, to: CID }));
  await seedShared(store, { ...built, edges: [], classes: built.classes.map((c) => (c.id === CID ? { ...c, depth: 5 } : c)) });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await openOntology();
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  expect(await screen.findByText('The model already matches the descriptions.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(async () => expect((await loadShared(store))?.edges).toEqual(built.edges));
  const saved = (await loadShared(store))!;
  expect(saved.classes.find((c) => c.id === CID)?.depth).toBe(1);
  expect(saved.editedAt).toBe(built.editedAt);
});

test('a declined row does not keep a moved ref off the canvas: Apply with nothing selected draws it', async () => {
  const { deps, store } = await setup({ withCustomers: true });
  const built = (await loadShared(store))!;
  await seedShared(store, { ...built, edges: [] });
  render(<App ctx={ctxWith().ctx} deps={{ ...deps, generate: async () => changedAi }} />);
  await openOntology();
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Revenue: kind' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));
  await waitFor(async () => expect((await loadShared(store))?.edges).toEqual(built.edges));
  expect((await loadShared(store))?.metrics.find((m) => m.alias === 'Revenue')?.kind).toBe('flow');
});

test('Rebuild from Settings shows the build progress', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { deps } = await setup();
  render(<App ctx={ctxWith().ctx} deps={{ ...deps, generate: async () => { await gate; return goalAi; } }} />);
  await openOntology();
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  await waitFor(() => expect(screen.getByText('AI read the descriptions').closest('li')).toHaveAttribute('data-state', 'running'));
  expect(screen.getByRole('progressbar')).toHaveAttribute('data-determinate', 'false');
  release();
  expect(await screen.findByText('The model already matches the descriptions.')).toBeInTheDocument();
});

test('Rebuild proposes changes; Apply selected saves them and returns to the canvas', async () => {
  const { deps, store } = await setup();
  const before = await loadShared(store);
  render(<App ctx={ctxWith().ctx} deps={{ ...deps, generate: async () => changedAi }} />);
  await openOntology();
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  const row = await screen.findByRole('checkbox', { name: 'Revenue: kind' });
  expect(row).toBeChecked();
  expect(screen.getByText('flow → level')).toBeInTheDocument();
  // nothing is saved while the proposal is open
  expect(await loadShared(store)).toEqual(before);
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
  const saved = await loadShared(store);
  expect(saved?.metrics.find((m) => m.alias === 'Revenue')?.kind).toBe('level');
  expect(saved?.editedAt).toBe(NOW.toISOString());
});

test('Discard leaves the stored model as it was', async () => {
  const { deps, store } = await setup();
  const before = await loadShared(store);
  render(<App ctx={ctxWith().ctx} deps={{ ...deps, generate: async () => changedAi }} />);
  await openOntology();
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  await screen.findByRole('checkbox', { name: 'Revenue: kind' });
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(await screen.findByRole('button', { name: 'Rebuild model' })).toBeEnabled();
  expect(await loadShared(store)).toEqual(before);
});

test('Rebuild is off while the draft has unsaved edits', async () => {
  const { deps } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await openOntology();
  const rebuild = await screen.findByRole('button', { name: 'Rebuild model' });
  fireEvent.click(within(screen.getAllByRole('region').find((r) => r.classList.contains('gy-onto-class'))!).getAllByRole('button')[0]!);
  fireEvent.click(screen.getAllByLabelText('Format')[0]!);
  fireEvent.click(screen.getByRole('option', { name: 'Percent' }));
  expect(rebuild).toBeDisabled();
  expect(screen.getByText('Save or cancel your edits first')).toBeInTheDocument();
});

test('Closing a rebuild with no differences stores the new input hash, keeps editedAt and clears the notice', async () => {
  const { deps, store } = await setup({ inputHash: 'old' });
  const before = await loadShared(store);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: '1 issue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild to see proposed changes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  await screen.findByText('The model already matches the descriptions.');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await screen.findByRole('button', { name: 'Date range' });
  const saved = await loadShared(store);
  expect(saved?.inputHash).not.toBe('old');
  expect(saved).toEqual({ ...before, inputHash: saved?.inputHash });
  expect(saved?.editedAt).toBe(before?.editedAt);
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('button', { name: /issue/ })).toBeNull();
});

test('Discard hides the out-of-date notice for this session without touching the doc', async () => {
  const { deps, store } = await setup({ inputHash: 'old' });
  const before = await loadShared(store);
  render(<App ctx={ctxWith().ctx} deps={{ ...deps, generate: async () => changedAi }} />);
  fireEvent.click(await screen.findByRole('button', { name: '1 issue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild to see proposed changes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  await screen.findByRole('checkbox', { name: 'Revenue: kind' });
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
  await screen.findByRole('button', { name: 'Date range' });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('button', { name: /issue/ })).toBeNull();
  expect(await loadShared(store)).toEqual(before);
});

/** A saved model without the Customers class, so a rebuild proposes adding it and its hash covers one mart fewer. */
async function dropCustomers(store: CollectionsLike) {
  const m = (await loadShared(store))!;
  const keep = m.classes.filter((c) => c.martId !== CID);
  await seedShared(store, {
    ...m, inputHash: 'old', classes: keep, edges: [],
    metrics: m.metrics.filter((x) => keep.some((c) => c.id === x.martId)),
  });
}

test('Discarding a proposal that adds a class hides the notice', async () => {
  const { deps, store } = await setup({ withCustomers: true });
  await dropCustomers(store);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: '1 issue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild to see proposed changes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  await screen.findByRole('checkbox', { name: 'Add class Customers' });
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
  await screen.findByRole('button', { name: 'Date range' });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('button', { name: /issue/ })).toBeNull();
});

test('a partial Apply that leaves a new class unchecked does not bring the notice back', async () => {
  const { deps, store } = await setup({ withCustomers: true });
  await dropCustomers(store);
  render(<App ctx={ctxWith().ctx} deps={{ ...deps, generate: async () => changedAi }} />);
  fireEvent.click(await screen.findByRole('button', { name: '1 issue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild to see proposed changes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Add class Customers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected' }));
  await screen.findByRole('button', { name: 'Date range' });
  const saved = await loadShared(store);
  expect(saved?.classes.some((c) => c.martId === CID)).toBe(false);
  expect(saved?.inputHash).not.toBe('old');
  await new Promise((r) => setTimeout(r, 100));
  expect(screen.queryByRole('button', { name: /issue/ })).toBeNull();
});

test('saving a changed threshold refreshes; an unchanged one does not', async () => {
  const { deps, traversals } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(/Updated 1 h ago/);
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
  fireEvent.change(screen.getByLabelText(/Red when below plan/), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText("Couldn't save settings: boom")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
});

test('saving a changed threshold keeps the stored industry and core classes', async () => {
  const { deps, store } = await setup();
  const stored = { thresholdPct: 20, industry: 'saas', coreClasses: [{ martId: 'a', why: 'x' }] };
  await store.collections('settings').put('project', stored);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.change(screen.getByLabelText(/Red when below plan/), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(async () => expect((await store.collections('settings').get('project'))!.document).toEqual({ ...stored, thresholdPct: 15 }));
});

test('saving with an unchanged threshold writes nothing to the settings collection', async () => {
  const mem = memoryCollections();
  const puts: string[] = [];
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return { ...c, put: async (id: string, doc: T) => { if (name === 'settings') puts.push(id); return c.put(id, doc); } };
    },
  };
  const { deps } = await setup({ store });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(/Updated 1 h ago/);
  expect(puts).toEqual([]);
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
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
  expect(generate).not.toHaveBeenCalled();
});

test('a blocked rebuild shows inside the tab and keeps the current model', async () => {
  const { deps, store } = await setup({ generate: async () => missingAi });
  const before = await loadShared(store);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Rebuild model' }));
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to the model' }));
  expect(await screen.findByRole('button', { name: 'Rebuild model' })).toBeEnabled();
  expect(await loadShared(store)).toEqual(before);
});

test('modifiedAt churn alone shows no banner; a class-mart formula change does', async () => {
  const { deps, d } = await setup({ cache: 'none' });
  d.marts = d.marts.map((m) => ({ ...m, modifiedAt: 'later' }));
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByRole('button', { name: 'Date range' });
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('button', { name: /issue/ })).toBeNull();
});

test('a formula change in a class mart shows the banner', async () => {
  const { deps, d } = await setup();
  d.details[GID]!.fields.push({ name: 'x', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'SUM(1)', level: 'column' } });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: '1 issue' })).toBeInTheDocument();
});

test('a refused contexts call skips the out-of-date check', async () => {
  const { deps } = await setup({ inputHash: 'old' });
  const inner = deps.owox;
  deps.owox = { ...inner, getJson: async (path: string, q?: Record<string, unknown>) => { if (path === '/api/contexts') throw new Error('403'); return inner.getJson(path, q); } } as AppDeps['owox'];
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByRole('button', { name: 'Date range' });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('button', { name: /issue/ })).toBeNull();
});

test('a class whose mart the member cannot see renders as a no-access card and is not queried', async () => {
  const { deps, d, owox } = await setup({ cache: 'none', withCustomers: true });
  d.marts = d.marts.filter((m) => m.id !== CID);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(owox.calls.some((c) => c.path === `traverse:${GID}`)).toBe(true));
  expect(screen.getByText('Customers', { selector: '.gy-card-title' })).toBeInTheDocument();
  expect(owox.calls.some((c) => c.path === `traverse:${CID}`)).toBe(false);
});

test('an invisible main shows the no-access card', async () => {
  const { deps, d } = await setup({ cache: 'none', withCustomers: true });
  d.marts = d.marts.filter((m) => m.id !== GID);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText('Data Mart not found or not accessible')).toBeInTheDocument();
});

test('a failed cache save keeps the new values on screen and shows a note', async () => {
  const mem = memoryCollections();
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return name === 'cache' ? { ...c, put: async () => { throw new Error('too big'); } } : c;
    },
  };
  const { deps, d } = await setup({ store, cache: 'none' });
  d.rows = () => [{ 'revenue | SUM': 1234 }];
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText("Couldn't save the refreshed data: too big")).toBeInTheDocument();
  expect(screen.getByText('1.23K')).toBeInTheDocument();
});

test('a custom range computes the canvas without touching the cache store for its key', async () => {
  const inner = memoryCollections();
  const seen: string[] = [];
  const store: CollectionsLike = {
    collections<T>(name: string) {
      const c = inner.collections<T>(name);
      if (name !== 'cache') return c;
      return { get: async (id: string) => { seen.push(`get:${id}`); return c.get(id); }, put: async (id: string, doc: T) => { seen.push(`put:${id}`); return c.put(id, doc); } };
    },
  };
  const { deps, traversals } = await setup({ store, cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
  seen.length = 0;
  const before = traversals();
  const cal = within(screen.getByRole('group', { name: 'Range calendar' }));
  fireEvent.click(cal.getByRole('button', { name: 'Monday, October 5, 2026' }));
  fireEvent.click(cal.getByRole('button', { name: 'Monday, October 12, 2026' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(traversals()).toBeGreaterThan(before));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled());
  expect(seen.filter((x) => x.includes('c:'))).toEqual([]);
});

test('the toolbar shows the cut windows when a comparison is cut short', async () => {
  const { deps } = await setup({ cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  const cmp = within(screen.getByRole('group', { name: 'Comparison calendar' }));
  fireEvent.click(cmp.getByRole('button', { name: 'Next month' }));
  fireEvent.click(cmp.getByRole('button', { name: 'Next month' }));
  fireEvent.click(cmp.getByRole('button', { name: 'Monday, September 7, 2026' }));
  fireEvent.click(cmp.getByRole('button', { name: 'Wednesday, September 9, 2026' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(document.querySelector('.gy-header-sub')!.textContent).toMatch(/^Oct 1–3 vs Sep 7–9, 2026 · /));
  expect(document.querySelector('.gy-period-shown')).toBeNull();
});

test('the week start setting changes the cache key of a week preset', async () => {
  const mk = async (weekStart: 'monday' | 'sunday') => {
    const { deps, store, traversals } = await setup({ cache: 'none', range: 'unset' });
    await saveViewSettings(store, { defaultPreset: 'wtd', comparisonDefault: false, weekStart });
    // a fresh doc under the Monday key only
    const monday = cacheKey({ kind: 'preset', preset: 'wtd' }, { kind: 'off' });
    const m = (await loadShared(store))!;
    await saveCache(store, monday, { modelHash: m.inputHash, builtAt: m.builtAt, editedAt: m.editedAt, thresholdPct: 20, anchor: rangeFor('wtd', NOW).anchor, refreshedAt: '2026-10-24T09:00:00Z', key: monday, comparison: false, cards: {} });
    render(<App ctx={ctxWith().ctx} deps={deps} />);
    return traversals;
  };
  const monTraversals = await mk('monday');
  await screen.findByText(/Updated 1 h ago/);
  expect(monTraversals()).toBe(0);
  cleanup();
  const sunTraversals = await mk('sunday');
  await waitFor(() => expect(sunTraversals()).toBeGreaterThan(0));
});

test('with a comparison the header shows the days so far, not the whole range', async () => {
  const { deps } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(document.querySelector('.gy-header-sub')!.textContent).toMatch(/^Oct 1–\d+ vs Jul 1–\d+, 2026 · /));
});

test('a projected range shows the whole period against the whole previous one', async () => {
  const { deps, store } = await setup({ cache: 'none', range: 'unset' });
  await saveViewSettings(store, { defaultPreset: 'cur_month', comparisonDefault: true, weekStart: 'monday' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(document.querySelector('.gy-header-sub')!.textContent).toMatch(/^Oct 1–31 vs Sep 1–30, 2026 · /));
});

test('opens on the saved range and comparison', async () => {
  const { deps, store } = await setup({ cache: 'none', range: 'unset' });
  await savePreferences(store, { range: { kind: 'preset', preset: 'last_month' }, compare: { kind: 'off' } });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: 'Date range' })).toHaveTextContent(/^Last month$/);
});

test('applying a range saves it as the member preference', async () => {
  const { deps, store } = await setup({ cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(async () => expect(await loadPreferences(store)).toEqual({ range: { kind: 'preset', preset: 'last_month' }, compare: { kind: 'preset', preset: 'previous_period' } }));
});

test('a failed preferences save leaves the canvas working', async () => {
  const mem = memoryCollections();
  const store: CollectionsLike = {
    collections: <T,>(name: string) => {
      const c = mem.collections<T>(name);
      return name === 'preferences' ? { ...c, put: async () => { throw new Error('boom'); } } : c;
    },
  };
  const { deps } = await setup({ store, cache: 'none', range: 'unset' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('Last month'));
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
});

test('changing the default range in settings resets the choice and saves it', async () => {
  const { deps, store } = await setup({ cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.change(screen.getByLabelText(/Default date range/i), { target: { value: 'last_month' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(async () => expect((await loadPreferences(store))?.range).toEqual({ kind: 'preset', preset: 'last_month' }));
});

// holds the mart list and every traversal until released, so a test can look at the steps in between
function gated(deps: AppDeps) {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  let openList!: () => void;
  const listGate = new Promise<void>((r) => { openList = r; });
  const o = deps.owox;
  const owox = {
    ...o,
    dataMarts: {
      list: async () => { await listGate; return o.dataMarts.list(); },
      traverseData: async (...a: Parameters<typeof o.dataMarts.traverseData>) => { await gate; return o.dataMarts.traverseData(...a); },
    },
  } as AppDeps['owox'];
  return { deps: { ...deps, owox }, openList, open };
}

const line = () => screen.queryByRole('progressbar', { name: 'Loading data' });

test('the initial page is the line with the label under it', async () => {
  const s = await setup({ cache: 'none' });
  const g = gated(s.deps);
  render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  expect(line()).not.toBeNull();
  expect(screen.getByText('Loading settings and model…')).toBeInTheDocument();
  g.openList();
  g.open();
});

test('without a cache the line and step text walk through the steps and go away', async () => {
  const s = await setup({ cache: 'none' });
  const g = gated(s.deps);
  render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  expect(await screen.findByText(/Reading Data Marts…/)).toBeInTheDocument();
  await waitFor(() => expect(line()).toHaveAttribute('data-determinate', 'false'));
  g.openList();
  expect(await screen.findByText(/Loading metrics 0 of \d+/)).toBeInTheDocument();
  g.open();
  await waitFor(() => expect(line()).toBeNull());
  expect(screen.getByText(/Updated just now/)).toBeInTheDocument();
});

test('a fresh cache shows no line', async () => {
  const { deps } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByText(/Updated 1 h ago/);
  expect(line()).toBeNull();
});

test('a stale cache refreshes behind the line, cards stay interactive', async () => {
  const s = await setup({ cache: 'stale' });
  const g = gated(s.deps);
  const { container } = render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  g.openList();
  await waitFor(() => expect(line()).not.toBeNull());
  expect(container.querySelector('.gy-bands')).not.toHaveAttribute('inert');
  g.open();
  await waitFor(() => expect(line()).toBeNull());
});

test('the refresh icon shows the line', async () => {
  const s = await setup();
  const g = gated(s.deps);
  g.openList();
  render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  await screen.findByText(/Updated 1 h ago/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText(/Loading metrics 0 of \d+/)).toBeInTheDocument();
  await waitFor(() => expect(line()).toHaveAttribute('aria-valuenow', '0'));
  g.open();
  await waitFor(() => expect(line()).toBeNull());
});

test('Refresh never says Reading Data Marts', async () => {
  const s = await setup();
  const g = gated(s.deps);
  g.openList();
  render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  await screen.findByText(/Updated 1 h ago/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText(/Loading metrics/)).toBeInTheDocument();
  expect(screen.queryByText(/Reading Data Marts/)).toBeNull();
  g.open();
  await waitFor(() => expect(line()).toBeNull());
});

test('a stale cache starts with Loading metrics, not Reading Data Marts', async () => {
  const s = await setup({ cache: 'stale' });
  const g = gated(s.deps);
  render(<App ctx={ctxWith().ctx} deps={g.deps} />);
  await screen.findByRole('button', { name: 'Date range' });
  expect(screen.queryByText(/Reading Data Marts/)).toBeNull();
  g.openList();
  expect(await screen.findByText(/Loading metrics/)).toBeInTheDocument();
  expect(screen.queryByText(/Reading Data Marts/)).toBeNull();
  g.open();
  await waitFor(() => expect(line()).toBeNull());
});

// traversals of a held mart wait until the returned opener is called; each call keeps the gate and value it started with
function perMart(deps: AppDeps, initial: Record<string, number>) {
  const gates = new Map<string, Promise<void>>();
  const values = { ...initial };
  const started = { count: 0 };
  const o = deps.owox;
  const owox = {
    ...o,
    dataMarts: {
      list: o.dataMarts.list,
      traverseData: async (...a: Parameters<typeof o.dataMarts.traverseData>) => {
        started.count++;
        const gate = gates.get(a[0]);
        const v = values[a[0]] ?? 1;
        await gate;
        return { async *rowChunks() { yield [{ 'revenue | SUM': v, 'id | COUNTUNIQUE': v, date: '2026-10-20' }]; } };
      },
    },
  } as AppDeps['owox'];
  const hold = (id: string) => {
    let open!: () => void;
    gates.set(id, new Promise<void>((r) => { open = r; }));
    return () => { gates.delete(id); open(); };
  };
  return { deps: { ...deps, owox }, hold, values, started };
}

test('a card shows its number before the refresh finishes', async () => {
  const s = await setup({ cache: 'none', withCustomers: true });
  const p = perMart(s.deps, { [GID]: 4242, [CID]: 7 });
  const openC = p.hold(CID);
  const { container } = render(<App ctx={ctxWith().ctx} deps={p.deps} />);
  await waitFor(() => expect(container.querySelector(`[data-class-id="${GID}"]`)).toHaveTextContent('4.24K'));
  expect(line()).not.toBeNull();
  expect(container.querySelector(`[data-class-id="${CID}"]`)).toHaveAttribute('data-status', 'loading');
  openC();
  await waitFor(() => expect(line()).toBeNull());
});

test('old numbers stay until a new one replaces them', async () => {
  const s = await setup({ cache: 'none', withCustomers: true });
  const p = perMart(s.deps, { [GID]: 4242, [CID]: 7 });
  const { container } = render(<App ctx={ctxWith().ctx} deps={p.deps} />);
  await screen.findByText(/Updated just now/);
  const card = () => container.querySelector(`[data-class-id="${GID}"]`)!;
  expect(card()).toHaveTextContent('4.24K');
  p.values[GID] = 9999;
  const openG = p.hold(GID);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(line()).not.toBeNull());
  await new Promise((r) => setTimeout(r, 30));
  expect(card()).toHaveTextContent('4.24K');
  openG();
  await waitFor(() => expect(line()).toBeNull());
  expect(card()).toHaveTextContent('10K');
});

test('a superseded refresh does not apply its partials or its final doc', async () => {
  const s = await setup({ cache: 'none' });
  const p = perMart(s.deps, { [GID]: 1111 });
  const openOld = p.hold(GID);
  const { container } = render(<App ctx={ctxWith().ctx} deps={p.deps} />);
  await waitFor(() => expect(p.started.count).toBeGreaterThan(0));
  const first = p.started.count;
  // a second refresh starts with its own value and stays held
  p.values[GID] = 2222;
  const openNew = p.hold(GID);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(p.started.count).toBeGreaterThan(first));
  openOld();
  await new Promise((r) => setTimeout(r, 30));
  const card = () => container.querySelector(`[data-class-id="${GID}"]`)!;
  expect(card()).not.toHaveTextContent('1.11K');
  expect(card()).toHaveAttribute('data-status', 'loading');
  expect(line()).not.toBeNull();
  openNew();
  await waitFor(() => expect(line()).toBeNull());
  expect(card()).toHaveTextContent('2.22K');
});

test('a custom range already on screen is not blanked by Settings and Back', async () => {
  const s = await setup({ cache: 'none' });
  const p = perMart(s.deps, { [GID]: 4242 });
  const { container } = render(<App ctx={ctxWith().ctx} deps={p.deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  const cal = within(screen.getByRole('group', { name: 'Range calendar' }));
  fireEvent.click(cal.getByRole('button', { name: 'Monday, October 12, 2026' }));
  fireEvent.click(cal.getByRole('button', { name: 'Tuesday, October 20, 2026' }));
  const before = p.started.count;
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(p.started.count).toBeGreaterThan(before));
  await waitFor(() => expect(line()).toBeNull());
  const card = () => container.querySelector(`[data-class-id="${GID}"]`)!;
  expect(card()).toHaveTextContent('4.24K');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  // a new threshold re-runs the refresh for the range on screen; hold it to look at the canvas meanwhile
  fireEvent.change(await screen.findByLabelText('Red when below plan by more than (%)'), { target: { value: '30' } });
  p.values[GID] = 9999;
  const openG = p.hold(GID);
  const again = p.started.count;
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Date range' });
  await waitFor(() => expect(p.started.count).toBeGreaterThan(again));
  expect(card()).toHaveTextContent('4.24K');
  openG();
  await waitFor(() => expect(line()).toBeNull());
  expect(card()).toHaveTextContent('10K');
});

test('a failed access check marks every class no-access rather than queried', async () => {
  const s = await setup({ withCustomers: true });
  const o = s.deps.owox;
  const owox = { ...o, dataMarts: { ...o.dataMarts, list: async () => { throw new Error('boom'); } } } as AppDeps['owox'];
  render(<App ctx={ctxWith().ctx} deps={{ ...s.deps, owox }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check which Data Marts you can access");
  expect(screen.getAllByText("You don't have access to this Data Mart").length).toBeGreaterThan(0);
});

test('a broken reference shows the icon with its count, and the layer link opens Settings', async () => {
  const { deps, d } = await setup();
  d.details[GID]!.fields.splice(1, 1);
  const { ctx, setRoute } = ctxWith();
  render(<App ctx={ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: '1 issue' }));
  expect(screen.getByRole('dialog', { name: 'Issues' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review in Metrics' }));
  expect(setRoute).toHaveBeenCalledWith('/settings/ontology');
  expect(screen.getByRole('tab', { name: 'Metrics' })).toHaveAttribute('aria-selected', 'true');
});

test('no issues icon while the model matches its schemas', async () => {
  const { deps } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByRole('button', { name: 'Date range' });
  expect(screen.queryByRole('button', { name: /issue/ })).toBeNull();
});

describe('data quality icons', () => {
  const summary = { state: 'PASSED', enabledChecks: 4, passedChecks: 4, failedChecks: 0, errorChecks: 0, warningFindings: 0, errorFindings: 0, highestSeverity: null, lastRunAt: null };

  test('one POST for the canvas shows the icon, and a click opens the quality page', async () => {
    const { deps, d } = await setup();
    d.quality = (ids) => ({ items: ids.map((dataMartId) => ({ dataMartId, summary })) });
    const live = fakeOwox(d);
    const navigate = vi.fn();
    render(<App ctx={{ projectId: 'p', ui: { setRoute: vi.fn(), navigate } } as never} deps={{ ...deps, owox: live }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Data quality: all 4 checks passed' }));
    expect(navigate).toHaveBeenCalledWith(`/ui/p/data-marts/${GID}/quality`);
    expect(live.calls.filter((c) => c.path.endsWith('/data-quality/summaries'))).toHaveLength(1);
  });

  test('a refused call shows no icon and no error', async () => {
    const { deps, d } = await setup();
    d.quality = () => { throw Object.assign(new Error('403'), { status: 403 }); };
    const live = fakeOwox(d);
    render(<App ctx={{ projectId: 'p', ui: { setRoute: vi.fn(), navigate: vi.fn() } } as never} deps={{ ...deps, owox: live }} />);
    await screen.findByText(/Updated 1 h ago/);
    await waitFor(() => expect(live.calls.some((c) => c.path.endsWith('/summaries'))).toBe(true));
    expect(screen.queryByRole('button', { name: /Data quality/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

test('the first open shows the ontology view and queries nothing', async () => {
  const { deps, traversals, owox, d } = await setup({ range: 'unset', cache: 'none' });
  d.quality = () => ({ summaries: [] });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: 'Date range' })).toHaveTextContent('Select date range');
  await new Promise((r) => setTimeout(r, 50));
  expect(traversals()).toBe(0);
  expect(owox.calls.some((c) => c.path.includes('data-quality'))).toBe(false);
  expect(document.querySelector('.gy-header-sub')).toBeNull();
  expect(screen.queryByText(/Loading metrics/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
});

test('choosing a range runs the queries; Clear goes back and keeps the comparison', async () => {
  const { deps, traversals, store } = await setup({ range: 'unset', cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  expect(screen.getByLabelText('Compare')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'This month' }));
  expect(screen.getByLabelText('Compare')).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('This month vs previous');
  fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('Select date range');
  await waitFor(async () => expect(await loadPreferences(store)).toEqual({ range: null, compare: { kind: 'preset', preset: 'previous_period' } }));
  expect(document.querySelector('.gy-header-sub')).toBeNull();
  // choosing again restores the comparison
  fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('Last month vs previous');
});

test('a member who cleared the range reopens on the ontology view', async () => {
  const { deps } = await setup({ range: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: 'Date range' })).toHaveTextContent('Select date range');
});

test('with no range an admin still gets the out-of-date notice', async () => {
  const { deps } = await setup({ range: 'unset', cache: 'none', inputHash: 'old' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: '1 issue' }));
  expect(screen.getByText('The descriptions changed since this model was built.')).toBeInTheDocument();
});

test('from no range, a preset applied without touching Compare brings the comparison default', async () => {
  const { deps, store } = await setup({ range: 'unset', cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'This month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent('This month vs previous');
  await waitFor(async () => expect((await loadPreferences(store))?.compare).toEqual({ kind: 'preset', preset: 'previous_period' }));
});

test('from no range, unchecking Compare in the panel keeps it off', async () => {
  const { deps, store } = await setup({ range: 'unset', cache: 'none' });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Date range' }));
  fireEvent.click(screen.getByRole('button', { name: 'This month' }));
  fireEvent.click(screen.getByLabelText('Compare'));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('button', { name: 'Date range' })).toHaveTextContent(/^This month$/);
  await waitFor(async () => expect(await loadPreferences(store)).toEqual({ range: { kind: 'preset', preset: 'cur_month' }, compare: { kind: 'off' } }));
});
