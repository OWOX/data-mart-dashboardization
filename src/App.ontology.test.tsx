import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App, type AppDeps } from './App';
import { buildModel } from './model/build';
import { fakeOwox, type FakeOwoxData } from './owox/fake';
import { loadOntology, memoryCollections, saveOntology } from './store/collections';
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
  const built = await buildModel({ owox, generate: async () => goalAi, userId: 'u1', now: NOW });
  if (!built.ok) throw new Error('fixture');
  await saveOntology(store, built.model);
  const puts: Model[] = [];
  const spy = { collections: <T,>(name: string) => { const c = store.collections<T>(name); return { ...c, put: async (id: string, doc: T) => { if (name === 'ontology') puts.push(doc as Model); return c.put(id, doc); } }; } };
  const deps: AppDeps = { owox, store: spy, generate: async () => goalAi, userId: 'u1', now: () => NOW };
  return { deps, store, puts, model: built.model };
}
const ctxWith = (route?: string) => { const setRoute = vi.fn(); return { ctx: { projectId: 'p', route, ui: { setRoute } } as never, setRoute }; };
const customersCard = () => screen.queryByText('Customers', { selector: '.gy-card-title' });

afterEach(cleanup);

test('a reload at /settings/ontology opens the tab; /settings opens General; others open the canvas', async () => {
  const { deps } = await setup();
  const a = render(<App ctx={ctxWith('/settings/ontology').ctx} deps={deps} />);
  expect(await screen.findByRole('tab', { name: 'Metrics', selected: true })).toBeInTheDocument();
  // the tab waits for the Data Mart list, then shows the editor
  expect(await screen.findByText('Your model. Changes here only affect what you see.')).toBeInTheDocument();
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
  fireEvent.click(await screen.findByRole('tab', { name: 'Metrics' }));
  expect(setRoute).toHaveBeenLastCalledWith('/settings/ontology');
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  expect(setRoute).toHaveBeenLastCalledWith('/settings');
});

test('unchecking a class and saving hides it on the canvas and stamps editedAt', async () => {
  const { deps, store, puts } = await setup();
  const { ctx, setRoute } = ctxWith();
  render(<App ctx={ctx} deps={deps} />);
  await waitFor(() => expect(customersCard()).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
  const box = await screen.findByRole('checkbox', { name: 'Customers' });
  fireEvent.click(box);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Date range' });
  expect(setRoute).toHaveBeenLastCalledWith('/');
  expect(customersCard()).toBeNull();
  expect(puts).toHaveLength(1);
  const saved = (await loadOntology(store))!;
  expect(saved.editedAt).toBe(NOW.toISOString());
  expect(saved.classes.find((c) => c.id === CID)!.shown).toBe(false);
});

test('Cancel on the Ontology tab writes nothing and returns to the canvas', async () => {
  const { deps, puts } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('button', { name: 'Date range' });
  expect(puts).toHaveLength(0);
  expect(within(document.body).queryByRole('tablist')).toBeNull();
});

test('switching tabs keeps the draft', async () => {
  const { deps } = await setup();
  render(<App ctx={ctxWith().ctx} deps={deps} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
  const box = await screen.findByRole('checkbox', { name: 'Customers' });
  fireEvent.click(box);
  fireEvent.click(screen.getByRole('tab', { name: 'General' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
  expect(screen.getByRole('checkbox', { name: 'Customers' })).not.toBeChecked();
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
  fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
  expect(screen.getByText("No model yet. It's built when you go back to the canvas.")).toBeInTheDocument();
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

const range = { range: { kind: 'preset', preset: 'qtd' }, compare: { kind: 'off' }, weekStart: 'monday' };
async function saveWithSchedules(schedules: unknown) {
  const { deps } = await setup();
  const { ctx } = ctxWith();
  render(<App ctx={{ ...(ctx as object), schedules } as never} deps={deps} />);
  await waitFor(() => expect(customersCard()).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Customers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Date range' });
}

test('a failing schedule sync leaves a note that outlives the refresh', async () => {
  await saveWithSchedules({ list: vi.fn(async () => { throw new Error('down'); }) });
  expect(await screen.findByText(/Couldn't update your schedules for the new model/)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/Loading metrics/)).toBeNull());
  expect(screen.getByText(/Couldn't update your schedules for the new model/)).toBeInTheDocument();
});

test('saving the ontology updates the member schedules with the new Data Marts', async () => {
  const mine = { id: 's1', name: null, action: 'warm-cache', parameters: { memberId: 'u1', martIds: ['stale'], ranges: [range] }, cron: '0 9 * * *', timeZone: 'UTC', enabled: true, disabledReason: null, nextRunAt: null, lastRun: null, createdAt: '', modifiedAt: '' };
  const update = vi.fn(async () => mine);
  await saveWithSchedules({ list: vi.fn(async () => [mine]), update });
  await waitFor(() => expect(update).toHaveBeenCalled());
  const [id, patch] = update.mock.calls[0] as unknown as [string, { parameters: { martIds: string[] } }];
  expect(id).toBe('s1');
  expect(patch.parameters.martIds).not.toContain('stale');
  expect(patch.parameters.martIds.length).toBeGreaterThan(0);
});
