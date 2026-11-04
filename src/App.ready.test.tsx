import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { buildModel } from './model/build';
import { fakeOwox, type FakeOwoxData } from './owox/fake';
import { cacheKey } from './metrics/refresh';
import { rangeFor } from './lib/dates';
import { loadOntology, loadPreferences, memoryCollections, saveCache, saveOntology, savePreferences, saveSettings, type CollectionsLike } from './store/collections';
import { DEFAULT_SETTINGS, type CacheDoc, type Model } from './types';

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
  details: { [GID]: { id: GID, title: 'Orders', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'revenue', type: 'FLOAT', isPrimaryKey: false }] } },
  blendables: { [GID]: { availableSources: [], mainUniqueCountKeyFields: ['id'] } },
});

async function setup(opts: { generate?: AppDeps['generate']; cache?: 'fresh' | 'stale' | 'none'; store?: CollectionsLike; inputHash?: string; withCustomers?: boolean } = {}) {
  const d = data();
  if (opts.withCustomers) {
    d.marts.push(mart(CID, 'Customers'));
    d.details[CID] = { id: CID, title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }] };
    d.blendables[GID] = { availableSources: [{ aliasPath: 'customers', dataMartId: CID, title: 'Customers', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['id'] };
    d.blendables[CID] = { availableSources: [], mainUniqueCountKeyFields: ['id'] };
    d.details[GID]!.fields.push({ name: 'ltv', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'AVG({{ref path="customers" field="x"}})', level: 'metric' } });
  }
  const owox = fakeOwox(d);
  const store = opts.store ?? memoryCollections();
  const built = await buildModel({ owox, generate: async () => goalAi, userId: 'u1', now: NOW });
  if (!built.ok) throw new Error('fixture');
  const model: Model = { ...built.model, inputHash: opts.inputHash ?? built.model.inputHash };
  await saveOntology(store, model);
  const cache = opts.cache ?? 'fresh';
  if (cache !== 'none') {
    const doc: CacheDoc = {
      modelHash: model.inputHash, builtAt: model.builtAt, editedAt: model.editedAt, thresholdPct: 20,
      anchor: cache === 'fresh' ? rangeFor('this_quarter', NOW).anchor : '2000-01-01',
      refreshedAt: '2026-10-24T09:00:00Z', key: 'this_quarter:previous_period', comparison: true, cards: {},
    };
    await saveCache(store, cacheKey({ kind: 'preset', preset: 'this_quarter' }, { kind: 'preset', preset: 'previous_period' }), doc);
  }
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
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
});

test('Rebuild with unchanged inputs still refreshes the canvas', async () => {
  const { deps, traversals, tick } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  const rebuild = screen.getByRole('button', { name: 'Rebuild model' });
  tick();
  fireEvent.click(rebuild);
  await waitFor(() => expect(traversals()).toBeGreaterThan(0));
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
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
  expect(generate).not.toHaveBeenCalled();
});

test('a blocked rebuild can go back to the existing canvas', async () => {
  const { deps } = await setup({ generate: async () => missingAi });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild model' }));
  expect(await screen.findByRole('heading', { name: "Goal can't be tracked" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to canvas' }));
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
});

test('modifiedAt churn alone shows no banner; a class-mart formula change does', async () => {
  const { deps, d } = await setup({ cache: 'none' });
  d.marts = d.marts.map((m) => ({ ...m, modifiedAt: 'later' }));
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByRole('button', { name: 'Date range' });
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText('Descriptions or schemas changed since this model was built.')).toBeNull();
});

test('a formula change in a class mart shows the banner', async () => {
  const { deps, d } = await setup();
  d.details[GID]!.fields.push({ name: 'x', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'SUM(1)', level: 'column' } });
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText('Descriptions or schemas changed since this model was built.')).toBeInTheDocument();
});

test('a refused contexts call skips the out-of-date check', async () => {
  const { deps } = await setup({ inputHash: 'old' });
  const inner = deps.owox;
  deps.owox = { ...inner, getJson: async (path: string, q?: Record<string, unknown>) => { if (path === '/api/contexts') throw new Error('403'); return inner.getJson(path, q); } } as AppDeps['owox'];
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await screen.findByRole('button', { name: 'Date range' });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText('Descriptions or schemas changed since this model was built.')).toBeNull();
});

test('a class whose mart the member cannot see is not rendered or queried', async () => {
  const { deps, d, owox } = await setup({ cache: 'none', withCustomers: true });
  d.marts = d.marts.filter((m) => m.id !== CID);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(owox.calls.some((c) => c.path === `traverse:${GID}`)).toBe(true));
  expect(screen.queryByText('Customers')).toBeNull();
  expect(owox.calls.some((c) => c.path === `traverse:${CID}`)).toBe(false);
});

test('an invisible main shows the no-access card', async () => {
  const { deps, d } = await setup({ cache: 'none', withCustomers: true });
  d.marts = d.marts.filter((m) => m.id !== GID);
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  expect(await screen.findByText("You don't have access to this Data Mart")).toBeInTheDocument();
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
    const { deps, store, traversals } = await setup({ cache: 'none' });
    await saveSettings(store, { ...DEFAULT_SETTINGS, defaultPreset: 'this_week', comparisonDefault: false, weekStart });
    // a fresh doc under the Monday key only
    const monday = cacheKey({ kind: 'preset', preset: 'this_week' }, { kind: 'off' });
    const m = (await loadOntology(store))!;
    await saveCache(store, monday, { modelHash: m.inputHash, builtAt: m.builtAt, editedAt: m.editedAt, thresholdPct: 20, anchor: rangeFor('this_week', NOW).anchor, refreshedAt: '2026-10-24T09:00:00Z', key: monday, comparison: false, cards: {} });
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

test('opens on the saved range and comparison', async () => {
  const { deps, store } = await setup({ cache: 'none' });
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
  const { deps } = await setup({ store, cache: 'none' });
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
  expect(line()).not.toHaveAttribute('aria-valuenow');
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
  expect(line()).toHaveAttribute('aria-valuenow', '0');
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
  expect(container.querySelector(`[data-class-id="${CID}"]`)).toHaveTextContent('—');
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
  expect(card()).toHaveTextContent('—');
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

test('a failed access check shows no class rather than every class', async () => {
  const s = await setup({ withCustomers: true });
  const o = s.deps.owox;
  const owox = { ...o, dataMarts: { ...o.dataMarts, list: async () => { throw new Error('boom'); } } } as AppDeps['owox'];
  render(<App ctx={ctxWith().ctx} deps={{ ...s.deps, owox }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check which Data Marts you can access");
  expect(screen.queryByText('Customers', { selector: '.gy-card-title' })).toBeNull();
  expect(screen.getAllByText("You don't have access to this Data Mart").length).toBeGreaterThan(0);
});
