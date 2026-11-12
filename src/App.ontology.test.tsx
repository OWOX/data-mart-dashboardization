import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { buildModel } from './model/build';
import { fakeOwox, type FakeOwoxData } from './owox/fake';
import { loadShared, memoryCollections, saveProjectSettings, saveViewSettings } from './store/collections';
import { seedShared } from './test/fixtures';
import { type Model } from './types';

const GID = '11111111-1111-1111-1111-111111111111';
const CID = 'c';
const NOW = new Date('2026-10-24T10:00:00Z');
const goalAi = {
  goal: { status: 'ok', metricRef: 'm1', note: '' },
  metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'Revenue', factLink: 0, planLink: null, kind: 'flow', planShape: null, factDateField: null, planDateField: null, aggregation: null }],
};
const mart = (id: string, title: string) => ({ id, title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' });
const data = (): FakeOwoxData => ({
  projectDescription: `| Critical number | Revenue | [Revenue](https://app.owox.com/ui/p/data-marts/${GID}/data-setup?field=revenue) |`,
  contexts: [],
  marts: [mart(GID, 'Orders'), mart(CID, 'Customers')],
  details: {
    [GID]: { id: GID, title: 'Orders', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'revenue', type: 'FLOAT', isPrimaryKey: false }, { name: 'ltv', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'AVG({{ref path="customers" field="x"}})', level: 'metric' } }] },
    [CID]: { id: CID, title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }] },
  },
  blendables: {
    [GID]: { availableSources: [{ aliasPath: 'customers', dataMartId: CID, title: 'Customers', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['id'] },
    [CID]: { availableSources: [], mainUniqueCountKeyFields: ['id'] },
  },
});

async function setup() {
  const owox = fakeOwox(data());
  const store = memoryCollections();
  const built = await buildModel({ owox, generate: async () => goalAi, userId: 'u1', now: NOW, existingCore: null, industry: null });
  if (!built.ok) throw new Error('fixture');
  await seedShared(store, built.model);
  // these tests look at the flow view
  await saveViewSettings(store, { defaultPreset: 'qtd', comparisonDefault: true, weekStart: 'monday' });
  const puts: Model[] = [];
  const spy = { collections: <T,>(name: string) => { const c = store.collections<T>(name); return { ...c, put: async (id: string, doc: T) => { if (name === 'ontology_project') puts.push(doc as Model); return c.put(id, doc); } }; } };
  const deps: AppDeps = { owox, store: spy, generate: async () => goalAi, userId: 'u1', now: () => NOW };
  return { deps, store, puts, model: built.model };
}
const ctxWith = (route?: string) => { const setRoute = vi.fn(); return { ctx: { projectId: 'p', route, ui: { setRoute } } as never, setRoute }; };
const customersCard = () => screen.queryByText('Customers', { selector: '.gy-card-title' });

/** Settings is open: goes to the Checkup tab and opens the Metrics section once the first run has settled. */
async function openMetrics() {
  fireEvent.click(screen.getByRole('tab', { name: 'Checkup' }));
  await screen.findByText(/^Checked /);
  // the card applies its first fold in an effect; let it land before a click
  await act(async () => {});
  const toggle = screen.getByRole('button', { name: 'Metrics' });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
}

afterEach(cleanup);

test('a reload at /settings/ontology opens Checkup with the Metrics section open; /settings opens General; others open the canvas', async () => {
  const { deps } = await setup();
  const a = render(<App ctx={ctxWith('/settings/ontology').ctx} deps={deps} />);
  expect(await screen.findByRole('tab', { name: 'Checkup', selected: true })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Metrics' })).toBeNull();
  await screen.findByText(/^Checked /);
  expect(screen.getByRole('button', { name: 'Metrics' })).toHaveAttribute('aria-expanded', 'true');
  // the tab waits for the Data Mart list, then shows the editor
  expect(await screen.findByText('The model of this project. Changes apply to everyone in the project.')).toBeInTheDocument();
  a.unmount();
  const b = render(<App ctx={ctxWith('/settings').ctx} deps={deps} />);
  expect(await screen.findByRole('tab', { name: 'General', selected: true })).toBeInTheDocument();
  b.unmount();
  render(<App ctx={ctxWith('/').ctx} deps={deps} />);
  expect(await screen.findByRole('button', { name: 'Date range' })).toBeInTheDocument();
});

test('switching tabs sets the route', async () => {
  const { deps } = await setup();
  const { ctx, setRoute } = ctxWith('/settings');
  render(<App ctx={ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Checkup' }));
  expect(setRoute).toHaveBeenLastCalledWith('/settings/checkup');
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  expect(setRoute).toHaveBeenLastCalledWith('/settings');
});

test('unchecking a class and saving hides it on the canvas and stamps editedAt', async () => {
  const { deps, store, puts } = await setup();
  const { ctx, setRoute } = ctxWith();
  render(<App ctx={ctx} deps={deps} />);
  await waitFor(() => expect(customersCard()).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await openMetrics();
  const box = await screen.findByRole('checkbox', { name: 'Customers' });
  fireEvent.click(box);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Date range' });
  expect(setRoute).toHaveBeenLastCalledWith('/');
  expect(customersCard()).toBeNull();
  expect(puts).toHaveLength(1);
  const saved = (await loadShared(store))!;
  expect(saved.editedAt).toBe(NOW.toISOString());
  expect(saved.classes.find((c) => c.id === CID)!.shown).toBe(false);
});

test('Cancel on the Ontology tab writes nothing and returns to the canvas', async () => {
  const { deps, puts } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  await openMetrics();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('button', { name: 'Date range' });
  expect(puts).toHaveLength(0);
  expect(within(document.body).queryByRole('tablist')).toBeNull();
});

test('a failed access check shows the note and flags nothing', async () => {
  const s = await setup();
  const o = s.deps.owox;
  const owox = { ...o, dataMarts: { ...o.dataMarts, list: async () => { throw new Error('boom'); } } } as AppDeps['owox'];
  render(<App ctx={ctxWith('/settings/ontology').ctx} deps={{ ...s.deps, owox }} />);
  expect(await screen.findByText(/references aren't verified/)).toBeInTheDocument();
  expect(document.querySelectorAll('.gy-bad')).toHaveLength(0);
});

test('a saved unique count on an INTEGER key shows no card metric and sends no COUNT_DISTINCT query for it', async () => {
  const { deps, model } = await setup();
  const sent: { id: string; o: Record<string, unknown> }[] = [];
  const d = data();
  d.details[CID]!.fields = [{ name: 'id', type: 'INTEGER', isPrimaryKey: true }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }];
  d.rows = (id, o) => { sent.push({ id, o }); return []; };
  const owox = fakeOwox(d);
  const unique = model.metrics.find((m) => m.martId === CID && m.measure.fn === 'COUNT_DISTINCT');
  expect(unique).toBeTruthy();
  render(<App ctx={ctxWith().ctx} deps={{ ...deps, owox }} />);
  await screen.findByRole('button', { name: 'Date range' });
  await waitFor(() => expect(owox.calls.some((c) => c.path === `traverse:${GID}`)).toBe(true));
  await waitFor(() => expect(screen.queryByText(unique!.alias, { selector: '.gy-metric-name, .gy-card-metric' })).toBeNull());
  expect(sent.some((x) => x.id === GID)).toBe(true);
  expect(sent.filter((x) => x.id === CID && JSON.stringify(x.o.aggregation ?? []).includes('"COUNT_DISTINCT"'))).toEqual([]);
});

test('/settings/checkup opens the Checkup tab and runs the checks; clicking the tab sets the route', async () => {
  const { deps } = await setup();
  const owox = fakeOwox(data());
  const a = render(<App ctx={ctxWith('/settings/checkup').ctx} deps={{ ...deps, owox }} />);
  expect(await screen.findByRole('tab', { name: 'Checkup', selected: true })).toBeInTheDocument();
  await waitFor(() => expect(owox.calls.map((c) => c.path)).toContain('/api/contexts'));
  a.unmount();
  const { ctx, setRoute } = ctxWith('/settings');
  render(<App ctx={ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Checkup' }));
  expect(setRoute).toHaveBeenLastCalledWith('/settings/checkup');
});

test('with no model, /settings/checkup opens Checkup without a build; Metrics says no model; Back builds', async () => {
  const generate = vi.fn(async () => goalAi);
  const owox = fakeOwox(data());
  const deps: AppDeps = { owox, store: memoryCollections(), generate, userId: 'u1', now: () => NOW };
  const { ctx, setRoute } = ctxWith('/settings/checkup');
  render(<App ctx={ctx} deps={deps} />);
  expect(await screen.findByRole('tab', { name: 'Checkup', selected: true })).toBeInTheDocument();
  expect(generate).not.toHaveBeenCalled();
  await openMetrics();
  expect(await screen.findByText("No model yet. It's built when you go back to the canvas.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(setRoute).toHaveBeenLastCalledWith('/');
  await waitFor(() => expect(generate).toHaveBeenCalled());
});

test('the blocked view offers Run checkup, which opens the tab and sets the route', async () => {
  const noGoal = { ...data(), projectDescription: 'nothing here' };
  const deps: AppDeps = { owox: fakeOwox(noGoal), store: memoryCollections(), generate: async () => goalAi, userId: 'u1', now: () => NOW };
  const { ctx, setRoute } = ctxWith('/');
  render(<App ctx={ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run checkup' }));
  expect(await screen.findByRole('tab', { name: 'Checkup', selected: true })).toBeInTheDocument();
  expect(setRoute).toHaveBeenLastCalledWith('/settings/checkup');
});

test('two members with different access see the same classes', async () => {
  const { deps } = await setup();
  const admin = render(<App ctx={ctxWith().ctx} deps={deps} />);
  await waitFor(() => expect(customersCard()).toBeInTheDocument());
  const titles = (c: HTMLElement) => [...c.querySelectorAll('.gy-card-title')].map((e) => e.textContent);
  const a = titles(admin.container);
  admin.unmount();
  const narrow = fakeOwox({ ...data(), marts: [mart(GID, 'Orders')], roles: ['viewer'] });
  const member = render(<App ctx={ctxWith().ctx} deps={{ ...deps, owox: narrow }} />);
  await waitFor(() => expect(customersCard()).toBeInTheDocument());
  expect(titles(member.container)).toEqual(a);
  expect(a).toContain('Customers');
});

test('a member sees the Metrics tab read-only', async () => {
  const { deps } = await setup();
  const owox = fakeOwox({ ...data(), roles: ['viewer'] });
  render(<App ctx={ctxWith('/settings/ontology').ctx} deps={{ ...deps, owox }} />);
  expect(await screen.findByText('Only a project admin can change the model')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});

test('a save over a newer shared doc shows who changed it and when, and Reload reads theirs', async () => {
  const { deps, store } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  await openMetrics();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers' }));
  const theirs = { ...(await loadShared(store))!, editedAt: '2026-10-24T11:30:00Z', editedBy: 'Anna' };
  await seedShared(store, theirs);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/^Anna changed the model at \d\d:\d\d\. Reload to see their changes\.$/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  await screen.findByRole('button', { name: 'Date range' });
  // the reloaded model is the base now, so a second save goes through
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await openMetrics();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Date range' });
  expect((await loadShared(store))!.editedBy).toBe('Test Admin');
});

test('core classes that fail to save leave the saved model in place with a note, and a later save does not conflict', async () => {
  const store = memoryCollections();
  const flaky: AppDeps['store'] = {
    collections: <T,>(name: string) => {
      const col = store.collections<T>(name);
      return { get: col.get, put: async (id: string, doc: T) => { if (name === 'settings') throw new Error('SETTINGS_DOWN'); return col.put(id, doc); } };
    },
  };
  render(<App ctx={ctxWith().ctx} deps={{ owox: fakeOwox(data()), store: flaky, generate: async () => goalAi, userId: 'u1', now: () => NOW }} />);
  expect(await screen.findByText(/Couldn't save the core classes: SETTINGS_DOWN/)).toBeInTheDocument();
  expect(screen.queryByText(/Something went wrong/)).toBeNull();
  expect(await loadShared(store)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await openMetrics();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Date range' });
  expect((await loadShared(store))!.classes.find((c) => c.id === CID)!.shown).toBe(false);
});

test('a first build stores the core classes and the editor name', async () => {
  const store = memoryCollections();
  const owox = fakeOwox(data());
  render(<App ctx={ctxWith().ctx} deps={{ owox, store, generate: async () => goalAi, userId: 'u1', now: () => NOW }} />);
  await screen.findByRole('button', { name: 'Date range' });
  const saved = (await loadShared(store))!;
  expect(saved.editedBy).toBe('Test Admin');
  const stored = (await store.collections<{ coreClasses: unknown[] }>('settings').get('project'))!.document.coreClasses;
  expect(stored.length).toBeGreaterThan(0);
  expect(saved.classes.filter((c) => c.core).length).toBe(stored.length);
});

test('applying a core list from Checkup stores it and updates the core flags of the shared model', async () => {
  const { deps: base, store, model } = await setup();
  const fact = `[Revenue](https://app.owox.com/ui/p/data-marts/${GID}/data-setup?field=revenue)`;
  const owox = fakeOwox({ ...data(), projectDescription: `## Metrics\n| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Revenue | | ${fact} |` });
  const deps = { ...base, owox };
  await seedShared(store, { ...model, classes: model.classes.map((c) => ({ ...c, core: false })) });
  await saveProjectSettings(store, { coreClasses: null });
  render(<App ctx={ctxWith('/settings/checkup').ctx} deps={deps} />);
  const section = await screen.findByRole('group', { name: 'Core classes' });
  await screen.findByText(/^Checked /);
  fireEvent.click(await within(section).findByRole('button', { name: 'Apply' }));
  await waitFor(async () => expect((await loadShared(store))!.classes.some((c) => c.core)).toBe(true));
  const stored = (await store.collections<{ coreClasses: { martId: string }[] }>('settings').get('project'))!.document.coreClasses;
  expect(stored.length).toBeGreaterThan(0);
  const coreIds = (await loadShared(store))!.classes.filter((c) => c.core).map((c) => c.martId);
  expect(coreIds.sort()).toEqual(stored.map((c) => c.martId).sort());
});

test('a member never sees Apply or Suggest an answer in Checkup', async () => {
  const { deps } = await setup();
  const owox = fakeOwox({ ...data(), roles: ['viewer'] });
  render(<App ctx={ctxWith('/settings/checkup').ctx} deps={{ ...deps, owox }} />);
  await screen.findByText(/^Checked /);
  expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Suggest an answer' })).toBeNull();
});

test('switching to General and back keeps the Metrics draft', async () => {
  const { deps } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  await openMetrics();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers' }));
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  await openMetrics();
  expect(screen.getByRole('checkbox', { name: 'Customers' })).not.toBeChecked();
});

async function coreSetup() {
  const { deps: base, store, model } = await setup();
  const fact = `[Revenue](https://app.owox.com/ui/p/data-marts/${GID}/data-setup?field=revenue)`;
  const owox = fakeOwox({ ...data(), projectDescription: `## Metrics\n| Role | Metric | Plan | Fact |\n|---|---|---|---|\n| Critical number | Revenue | | ${fact} |` });
  await seedShared(store, { ...model, classes: model.classes.map((c) => ({ ...c, core: false })) });
  await saveProjectSettings(store, { coreClasses: null });
  return { deps: { ...base, owox }, store };
}

test('a core Apply keeps a clean Metrics editor mounted, with no loading placeholder', async () => {
  const { deps, store } = await coreSetup();
  render(<App ctx={ctxWith('/settings/ontology').ctx} deps={deps} />);
  const box = await screen.findByRole('checkbox', { name: 'Customers' });
  await screen.findByText(/^Checked /);
  const section = screen.getByRole('group', { name: 'Core classes' });
  fireEvent.click(within(section).getByRole('button', { name: 'Apply' }));
  expect(screen.queryByText('Reading Data Marts…')).toBeNull();
  await waitFor(async () => expect((await loadShared(store))!.classes.some((c) => c.core)).toBe(true));
  expect(screen.queryByText('Reading Data Marts…')).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'Customers' })).toBe(box);
});

test('a core Apply over a newer shared model writes nothing: the settings keep their old list', async () => {
  const { deps, store } = await coreSetup();
  render(<App ctx={ctxWith('/settings/checkup').ctx} deps={deps} />);
  const section = await screen.findByRole('group', { name: 'Core classes' });
  await screen.findByText(/^Checked /);
  // another admin saves between the load and the click
  await seedShared(store, { ...(await loadShared(store))!, editedAt: '2026-10-24T11:30:00Z', editedBy: 'Anna' });
  fireEvent.click(await within(section).findByRole('button', { name: 'Apply' }));
  expect(await screen.findByText(/Anna changed the model at/)).toBeInTheDocument();
  const stored = (await store.collections<{ coreClasses: unknown }>('settings').get('project'))?.document.coreClasses ?? null;
  expect(stored).toBeNull();
  expect((await loadShared(store))!.classes.some((c) => c.core)).toBe(false);
});

test('a core Apply waits for unsaved Metrics edits', async () => {
  const { deps } = await coreSetup();
  render(<App ctx={ctxWith('/settings/ontology').ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers' }));
  await screen.findByText(/^Checked /);
  const section = screen.getByRole('group', { name: 'Core classes' });
  expect(within(section).getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(within(section).getByText('Save or discard your Metrics edits first')).toBeInTheDocument();
});

/** An owox whose second Data Mart list waits for `release`: the first is the Checkup's, the second the app's own read of the inputs. */
function gated(base: AppDeps['owox']) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let n = 0;
  const list = base.dataMarts.list.bind(base.dataMarts);
  const owox = { ...base, dataMarts: { ...base.dataMarts, list: async () => { if (n++ === 1) await gate; return list(); } } } as AppDeps['owox'];
  return { owox, release };
}

test('a core Apply before the Data Marts have loaded still ends with the Metrics editor and a refresh', async () => {
  const { deps, store } = await coreSetup();
  const { owox, release } = gated(deps.owox);
  render(<App ctx={ctxWith('/settings/ontology').ctx} deps={{ ...deps, owox }} />);
  await screen.findByText(/^Checked /);
  const section = screen.getByRole('group', { name: 'Core classes' });
  expect(screen.getByText('Reading Data Marts…')).toBeInTheDocument();
  fireEvent.click(await within(section).findByRole('button', { name: 'Apply' }));
  await waitFor(async () => expect((await loadShared(store))!.classes.some((c) => c.core)).toBe(true));
  // the saved model is read again without waiting for the slow read of the old one
  expect(await screen.findByRole('checkbox', { name: 'Customers' })).toBeInTheDocument();
  await act(async () => { release(); });
  expect(screen.getByRole('checkbox', { name: 'Customers' })).toBeInTheDocument();
  expect(screen.queryByText('Reading Data Marts…')).toBeNull();
});

async function staleSetup(over: Partial<AppDeps> = {}) {
  const { deps, store, model } = await setup();
  await seedShared(store, { ...model, inputHash: 'stale' });
  return { deps: { ...deps, ...over }, store };
}
const applyRebuild = async () => {
  await screen.findByText(/^Checked /);
  const section = screen.getByRole('group', { name: 'Metrics' });
  fireEvent.click(await within(section).findByRole('button', { name: 'Apply' }));
};

test('a rebuild answer without an AI credential says to map one', async () => {
  const { deps } = await staleSetup({ generate: null });
  render(<App ctx={ctxWith('/settings/ontology').ctx} deps={deps} />);
  await screen.findByRole('checkbox', { name: 'Customers' });
  await applyRebuild();
  expect(await screen.findByText('Map an AI credential to rebuild')).toBeInTheDocument();
});

test('a rebuild answer with unsaved Metrics edits says to save or discard them', async () => {
  const { deps } = await staleSetup();
  render(<App ctx={ctxWith('/settings/ontology').ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers' }));
  await applyRebuild();
  expect(await screen.findByText('Save or discard your Metrics edits first')).toBeInTheDocument();
});

test('a rebuild answer before the editor has loaded says it is still loading', async () => {
  const { deps } = await staleSetup();
  const { owox, release } = gated(deps.owox);
  render(<App ctx={ctxWith('/settings/ontology').ctx} deps={{ ...deps, owox }} />);
  await applyRebuild();
  expect(await screen.findByText('The Metrics editor is still loading. Try again in a moment.')).toBeInTheDocument();
  await act(async () => { release(); });
});
