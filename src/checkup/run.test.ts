import { expect, test } from 'vitest';
import { LABELS, PURPOSES, runCheckup } from './run';
import { fakeOwox, type FakeOwoxData } from '../owox/fake';
import type { MartDetail, MartSummary } from '../owox/sources';
import { GROUPS, type Check } from './types';
import type { ProjectSettings } from '../types';
import { model as savedModel } from '../test/fixtures';

const G = '11111111-0000-0000-0000-000000000001'; // goal: Orders
const C = '11111111-0000-0000-0000-000000000002'; // Customers, references Orders
const P = '11111111-0000-0000-0000-000000000003'; // Plan
const url = (id: string, f: string) => `https://app.owox.com/ui/p/data-marts/${id}/data-setup?field=${f}`;
const table = (rows: string) => `## Metrics\n| Role | Metric | Plan | Fact |\n|---|---|---|---|\n${rows}`;
const mart = (id: string, title: string, contexts: { id: string; name: string }[] = []): MartSummary => ({ id, title, status: 'PUBLISHED', description: null, contexts, modifiedAt: 'x' });
const detail = (id: string, title: string, extra: MartDetail['fields'] = []): MartDetail => ({ id, title, fields: [
  { name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false }, { name: 'revenue', type: 'FLOAT', isPrimaryKey: false }, ...extra] });
const calc = (name: string, formula: string) => ({ name, type: 'FLOAT', isPrimaryKey: false, calculated: { formula } });

// Orders references Customers too: the main Data Mart (Orders) reaches Customers, as classDepths walks outward from it.
function data(over: Partial<FakeOwoxData> = {}): FakeOwoxData {
  return {
    projectDescription: table(`| Critical number | Revenue | [Plan](${url(P, 'revenue')}) | [Revenue](${url(G, 'revenue')}) |`),
    contexts: [
      { id: 'k1', name: 'Sales', description: table(`| Critical number | Customers | [Plan](${url(P, 'revenue')}) | [Customers](${url(C, 'revenue')}) |`) },
      { id: 'k3', name: 'Orders', description: table(`| Critical number | Orders | [Plan](${url(P, 'revenue')}) | [Orders](${url(G, 'revenue')}) |`) },
    ],
    marts: [mart(G, 'Orders', [{ id: 'k1', name: 'Sales' }, { id: 'k3', name: 'Orders' }]), mart(C, 'Customers', [{ id: 'k1', name: 'Sales' }]), mart(P, 'Plan')],
    details: {
      [G]: detail(G, 'Orders', [calc('customers_n', 'SUM({{ref path="customers" field="revenue"}})')]),
      [C]: detail(C, 'Customers', [calc('orders_total', 'SUM({{ref path="orders" field="revenue"}})')]),
      [P]: detail(P, 'Plan'),
    },
    blendables: {
      [G]: { availableSources: [{ aliasPath: 'customers', dataMartId: C, title: 'Customers', isAccessibleForReporting: true }], mainUniqueCountKeyFields: [] },
      [C]: { availableSources: [{ aliasPath: 'orders', dataMartId: G, title: 'Orders', isAccessibleForReporting: true }], mainUniqueCountKeyFields: [] },
      [P]: { availableSources: [], mainUniqueCountKeyFields: [] },
    },
    ...over,
  };
}
const S0: ProjectSettings = { thresholdPct: 20, industry: null, coreClasses: null };
const run = (d: FakeOwoxData, over: { hasAi?: boolean; model?: typeof savedModel | null; settings?: ProjectSettings } = {}) =>
  runCheckup({ owox: fakeOwox(d), hasAi: over.hasAi ?? true, settings: over.settings ?? S0, model: over.model ?? null, projectId: 'p', onUpdate: () => {} });
const byId = (cs: Check[]) => Object.fromEntries(cs.map((c) => [c.id, c]));
const without = <T,>(o: Record<string, T>, k: string) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
const noCalc = (d: MartDetail): MartDetail => ({ ...d, fields: d.fields.filter((f) => !f.calculated) });

test('a complete project passes everything except the saved model, which is skipped', async () => {
  const cs = await run(data());
  // core.*, project.shape and model.history have their own tests
  for (const c of cs.filter((x) => !x.id.startsWith('core.') && !['project.shape', 'model.history'].includes(x.id))) {
    if (c.id === 'model.built') expect(c).toMatchObject({ status: 'fail', detail: 'No model built yet' });
    else if (c.id.startsWith('model.')) expect(c).toMatchObject({ status: 'skip', detail: 'No model built yet' });
    else expect(c, c.id).toMatchObject({ status: 'ok' });
  }
});

test('no AI credential fails the plugin check', async () => {
  const c = byId(await run(data(), { hasAi: false }))['plugin.ai']!;
  expect(c.status).toBe('fail');
  expect(c.fix).toMatchObject({ kind: 'owox', path: '/ui/p/plugins' });
});

test('an empty description fails and skips what needs it', async () => {
  const c = byId(await run(data({ projectDescription: '  ' })));
  expect(c['project.description']!.status).toBe('fail');
  for (const id of ['project.table', 'project.critical', 'project.fact', 'project.plan', 'goal.access', 'goal.field', 'goal.pk', 'goal.date']) expect(c[id]!.status, id).toBe('skip');
  for (const id of ['reachable', 'any', 'facts', 'pk', 'date']) expect(c[`connections.${id}`]!.status, id).toBe('skip');
  expect(c['project.table']!.detail).toBe("Needs: The description isn't empty");
});

test('text without a Metrics table fails with the snippet fix', async () => {
  const c = byId(await run(data({ projectDescription: 'We sell things.' })))['project.table']!;
  expect(c.status).toBe('fail');
  // the snippet to copy, and the page to paste it into
  expect([c.fix].flat().map((f) => f?.kind === 'owox' ? f.path : f?.kind)).toEqual(['snippet', expect.stringMatching(/\/project-settings$/)]);
});

test('a placeholder fact link fails project.fact', async () => {
  const d = data({ projectDescription: table(`| Critical number | Revenue | | [Revenue](https://app.owox.com/ui/p/data-marts/<id>/data-setup?field=revenue) |`) });
  expect(byId(await run(d))['project.fact']!.status).toBe('fail');
});

test('no plan cell is a warning', async () => {
  const d = data({ projectDescription: table(`| Critical number | Revenue | | [Revenue](${url(G, 'revenue')}) |`) });
  expect(byId(await run(d))['project.plan']!.status).toBe('warn');
});

test('a fact field missing from the schema fails the goal and the links', async () => {
  const d = data({ projectDescription: table(`| Critical number | Revenue | | [Revenue](${url(G, 'nope')}) |`) });
  const c = byId(await run(d));
  expect(c['goal.field']!.status).toBe('fail');
  expect(c['project.links']).toMatchObject({ status: 'fail', detail: "Revenue: field nope isn't in Orders" });
});

test('a goal Data Mart you cannot access fails access and reachability', async () => {
  const base = data();
  const c = byId(await run({ ...base, marts: base.marts.filter((m) => m.id !== G) }));
  expect(c['goal.access']!.status).toBe('fail');
  for (const id of ['goal.field', 'goal.pk', 'goal.date']) expect(c[id]!.status, id).toBe('skip');
  expect(c['connections.reachable']).toMatchObject({ status: 'fail', detail: "You can't access the goal Data Mart" });
  expect(c['connections.facts']!.status).toBe('skip');
});

test('a goal Data Mart you can access is reachable', async () => {
  expect(byId(await run(data()))['connections.reachable']!.status).toBe('ok');
});

test('a goal without a primary key or a date fails both', async () => {
  const c = byId(await run(data({ details: { ...data().details, [G]: { id: G, title: 'Orders', fields: [{ name: 'revenue', type: 'FLOAT', isPrimaryKey: false }] } } })));
  expect(c['goal.pk']!.status).toBe('fail');
  expect(c['goal.date']!.status).toBe('fail');
  // reported by the goal checks only: the main class stays on the canvas
  expect(c['connections.pk']!.status).toBe('ok');
  expect(c['connections.date']!.status).toBe('ok');
});

test('a fact Data Mart without a date field warns once, under the date check', async () => {
  const d = data();
  const undated = { ...d.details[C]!, fields: d.details[C]!.fields.filter((f) => f.name !== 'date') };
  const c = byId(await run({ ...d, details: { ...d.details, [C]: undated } }));
  expect(c['connections.date']).toMatchObject({ status: 'recommend', detail: 'No date field: shows in the ontology view, with no numbers: Customers' });
  expect(c['connections.facts']!.status).toBe('ok');
  expect(c['connections.pk']!.status).toBe('ok');
});

test('a hidden date field does not count', async () => {
  const d = data();
  const hidden = { ...d.details[C]!, fields: d.details[C]!.fields.map((f) => (f.name === 'date' ? { ...f, isHiddenForReporting: true } : f)) };
  const c = byId(await run({ ...d, details: { ...d.details, [C]: hidden } }));
  expect(c['connections.date']!.status).toBe('recommend');
});

test('the goal Data Mart without a date field fails the goal check only: it stays on the canvas', async () => {
  const d = data();
  const undated = { ...d.details[G]!, fields: d.details[G]!.fields.filter((f) => f.name !== 'date') };
  const c = byId(await run({ ...d, details: { ...d.details, [G]: undated } }));
  expect(c['goal.date']!.status).toBe('fail');
  expect(c['connections.date']!.status).toBe('ok');
});

test('contexts that cannot be read fail and skip the model freshness check', async () => {
  const owox = fakeOwox(data());
  const getJson = owox.getJson.bind(owox);
  const wrapped = { ...owox, getJson: (async (path: string, ...rest: unknown[]) => { if (path === '/api/contexts') throw new Error('403'); return (getJson as (...a: unknown[]) => unknown)(path, ...rest); }) as typeof owox.getJson };
  const c = byId(await runCheckup({ owox: wrapped, hasAi: true, settings: S0, model: savedModel, projectId: 'p', onUpdate: () => {} }));
  expect(c['contexts.exist']).toMatchObject({ status: 'fail', detail: "Contexts couldn't be read" });
  expect(c['model.fresh']).toMatchObject({ status: 'skip', detail: "Contexts couldn't be read" });
});

test('two contexts pass; fewer warn', async () => {
  expect(byId(await run(data()))['contexts.exist']).toMatchObject({ status: 'ok', detail: '2 contexts' });
  const sales = data().contexts![0]!;
  expect(byId(await run(data({ contexts: [sales] })))['contexts.exist']).toMatchObject({ status: 'warn', detail: 'Only 1 context' });
  // OWOX moved contexts under Project settings; the old /contexts page is a 404
  expect(byId(await run(data({ contexts: [sales] })))['contexts.exist']!.fix).toMatchObject({ kind: 'owox', path: expect.stringMatching(/\/project-settings\/contexts$/) });
  expect(byId(await run(data({ contexts: [] })))['contexts.exist']).toMatchObject({ status: 'warn', detail: 'No contexts' });
});

test('per-context checks warn on an empty context and carry the context', async () => {
  const d = data({ contexts: [{ id: 'k1', name: 'Sales', description: table(`| Critical number | Customers | [Plan](${url(P, 'revenue')}) | [Customers](${url(C, 'revenue')}) |`) }, { id: 'k2', name: 'Empty', description: null }] });
  const c = byId(await run(d));
  for (const k of ['fact', 'marts']) expect(c[`context:k2.${k}`], k).toMatchObject({ status: 'warn', context: { id: 'k2', name: 'Empty' } });
  for (const k of ['description', 'plan']) expect(c[`context:k2.${k}`], k).toMatchObject({ status: 'recommend', context: { id: 'k2', name: 'Empty' } });
  expect(c['context:k1.marts']).toMatchObject({ status: 'ok', detail: '2 Data Marts' });
});

test('without calculated fields nothing connects', async () => {
  const d = data();
  const c = byId(await run({ ...d, details: { ...d.details, [G]: noCalc(d.details[G]!), [C]: noCalc(d.details[C]!) } }));
  expect(c['connections.any']!.status).toBe('warn');
  expect(c['connections.facts']!.status).toBe('warn');
  expect(c['connections.facts']!.detail).toContain('Customers');
});

test('a failed schema request fails only its links and the run still resolves', async () => {
  const d = data();
  const c = byId(await run({ ...d, details: without(d.details, C) }));
  expect(c['context:k1.links']!.status).toBe('fail');
  expect(c['context:k1.links']!.detail).toContain('Customers');
  expect(c['goal.field']!.status).toBe('ok');
  expect(c['project.links']!.status).toBe('ok');
});

test('a saved model with a missing class warns on health and freshness', async () => {
  const m = { ...savedModel, classes: [{ ...savedModel.classes[0]!, id: 'zz', martId: 'zz' }] };
  const c = byId(await run(data(), { model: m }));
  expect(c['model.health']).toMatchObject({ status: 'warn', detail: '1 broken reference', fix: { kind: 'tab', tab: 'ontology' } });
  expect(c['model.fresh']).toMatchObject({ status: 'warn', detail: 'The descriptions changed since the model was built' });
});

test('an unreadable project fails every check but the plugin one', async () => {
  const owox = fakeOwox(data());
  owox.project.getSettings = async () => { throw new Error('boom'); };
  const cs = await runCheckup({ owox, hasAi: true, settings: S0, model: null, projectId: 'p', onUpdate: () => {} });
  for (const c of cs.filter((x) => x.id !== 'plugin.ai')) expect(c).toMatchObject({ status: 'fail', detail: "Couldn't read the project: boom" });
  expect(cs.find((c) => c.id === 'plugin.ai')!.status).toBe('ok');
});

test('onUpdate starts with running checks and ends with the resolved list', async () => {
  const calls: Check[][] = [];
  const cs = await runCheckup({ owox: fakeOwox(data()), hasAi: true, settings: S0, model: null, projectId: 'p', onUpdate: (l) => calls.push(l) });
  const first = byId(calls[0]!);
  for (const id of ['plugin.ai', 'project.description', 'connections.reachable']) expect(first[id]!.status, id).toBe('running');
  expect(calls.at(-1)).toEqual(cs);
});

test('each Data Mart schema is requested once per run, with a saved model', async () => {
  const owox = fakeOwox(data());
  const paths: string[] = [];
  const getJson = owox.getJson.bind(owox) as (...a: unknown[]) => Promise<unknown>;
  const counting = { ...owox, getJson: ((path: string, ...rest: unknown[]) => { paths.push(path); return getJson(path, ...rest); }) as typeof owox.getJson };
  const m = { ...savedModel, classes: [G, C, P].map((id) => ({ ...savedModel.classes[0]!, id, martId: id })) };
  await runCheckup({ owox: counting, hasAi: true, settings: S0, model: m, projectId: 'p', onUpdate: () => {} });
  for (const id of [G, C, P]) {
    expect(paths.filter((p) => p === `/api/data-marts/${id}`), id).toHaveLength(1);
    expect(paths.filter((p) => p === `/api/data-marts/${id}/blendable-schema`), id).toHaveLength(1);
  }
});

test('works with a class-instance client whose methods use this', async () => {
  const inner = fakeOwox(data());
  class Client {
    private readonly transport = inner;
    getJson<T>(path: string): Promise<T> { return this.transport.getJson<T>(path); }
    get project() { return this.transport.project; }
    get dataMarts() { return this.transport.dataMarts; }
  }
  const cs = await runCheckup({ owox: new Client() as never, hasAi: true, settings: S0, model: null, projectId: 'p', onUpdate: () => {} });
  expect(byId(cs)['project.description']!.status).toBe('ok');
  expect(byId(cs)['goal.field']!.status).toBe('ok');
});

// Core classes: Orders (goal) references Customers, Plan-less Composite (two keys) and Products;
// Customers, Stores and Orders reference Products too, so Products has 3 inbound.
const Cp = '11111111-0000-0000-0000-000000000004'; // composite key
const Pr = '11111111-0000-0000-0000-000000000005'; // Products
const St = '11111111-0000-0000-0000-000000000006'; // Stores
const calcRef = (path: string) => calc(`${path}_n`, `SUM({{ref path="${path}" field="revenue"}})`);
const src = (aliasPath: string, id: string, title: string) => ({ aliasPath, dataMartId: id, title, isAccessibleForReporting: true });
function rich(): FakeOwoxData {
  const d = data();
  return {
    ...d,
    marts: [...d.marts, mart(Cp, 'Composite'), mart(Pr, 'Products'), mart(St, 'Stores')],
    details: {
      [G]: detail(G, 'Orders', [calcRef('customers'), calcRef('composite'), calcRef('products')]),
      [C]: detail(C, 'Customers', [calcRef('orders'), calcRef('products')]),
      [Cp]: { id: Cp, title: 'Composite', fields: [{ name: 'a', type: 'STRING', isPrimaryKey: true }, { name: 'b', type: 'STRING', isPrimaryKey: true }, { name: 'revenue', type: 'FLOAT', isPrimaryKey: false }] },
      [Pr]: detail(Pr, 'Products'),
      [St]: detail(St, 'Stores', [calcRef('products'), calcRef('orders')]),
      [P]: detail(P, 'Plan'),
    },
    blendables: {
      [G]: { availableSources: [src('customers', C, 'Customers'), src('composite', Cp, 'Composite'), src('products', Pr, 'Products')], mainUniqueCountKeyFields: [] },
      [C]: { availableSources: [src('orders', G, 'Orders'), src('products', Pr, 'Products')], mainUniqueCountKeyFields: [] },
      [St]: { availableSources: [src('products', Pr, 'Products'), src('orders', G, 'Orders')], mainUniqueCountKeyFields: [] },
      [Cp]: { availableSources: [], mainUniqueCountKeyFields: [] }, [Pr]: { availableSources: [], mainUniqueCountKeyFields: [] }, [P]: { availableSources: [], mainUniqueCountKeyFields: [] },
    },
  };
}
const core = (...ids: string[]) => ids.map((martId) => ({ martId, why: '' }));
const withCore = (ids: string[], industry: ProjectSettings['industry'] = null): { settings: ProjectSettings } => ({ settings: { thresholdPct: 20, industry, coreClasses: core(...ids) } });

test('every check has a purpose and a known section', async () => {
  const checks = await run(data(), { model: savedModel });
  for (const c of checks) { expect(c.purpose.length, c.id).toBeGreaterThan(10); expect(GROUPS.map((g) => g.id)).toContain(c.group); }
});

test('every label has a purpose, and every section one', () => {
  for (const id of Object.keys(LABELS)) expect(PURPOSES[id]?.length, id).toBeGreaterThan(10);
  for (const g of GROUPS) expect(g.purpose.length, g.id).toBeGreaterThan(10);
});

test('the core section warns when no core classes are set', async () => {
  const c = byId(await run(data()));
  expect(c['core.set']).toMatchObject({ status: 'warn', detail: 'No core classes set' });
  expect(c['core.industry']!.status).toBe('warn');
  expect(c['core.business']).toMatchObject({ status: 'warn', detail: "The project description doesn't describe the business model" });
});

test('core checks skip when the critical number has no fact', async () => {
  const c = byId(await run(data({ projectDescription: 'We sell things.' })));
  for (const id of ['business', 'industry', 'set', 'keys', 'toGoal', 'linked', 'count', 'missing']) expect(c[`core.${id}`], id).toMatchObject({ status: 'skip', detail: "Needs: The Critical number's fact links a Data Mart field" });
});

test('the industry check passes with its label; the set check needs 3 to 7', async () => {
  const ok = byId(await run(rich(), { settings: { thresholdPct: 20, industry: 'saas', coreClasses: core(C, Pr, St) } }));
  expect(ok['core.industry']).toMatchObject({ status: 'ok', detail: 'SaaS, subscriptions' });
  expect(ok['core.set']).toMatchObject({ status: 'ok', detail: 'Customers, Products, Stores' });
  expect(byId(await run(rich(), withCore([C, Pr])))['core.set']!.status).toBe('warn');
  expect(byId(await run(rich(), withCore([C, Pr, St, Cp, P, G, C].filter((x, i, a) => a.indexOf(x) === i).concat(['x', 'y', 'z']))))['core.set']!.status).toBe('warn');
});

test('the description passes core.business when it names a core Data Mart or links it', async () => {
  const named = rich(); named.projectDescription += '\nWe sell to customers online.';
  expect(byId(await run(named, withCore([C, Pr, St])))['core.business']!.status).toBe('ok');
  const linked = rich(); linked.projectDescription += `\nSee https://app.owox.com/ui/p/data-marts/${Pr}/data-setup`;
  expect(byId(await run(linked, withCore([Pr, St, Cp])))['core.business']!.status).toBe('ok');
  expect(byId(await run(rich(), withCore([Pr, St, Cp])))['core.business']!.status).toBe('warn');
});

test('a core class without a single primary key is a warning naming it', async () => {
  const c = byId(await run(rich(), withCore([C, Cp, Pr])));
  expect(c['core.keys']!.status).toBe('warn');
  expect(c['core.keys']!.detail).toContain('Composite');
  expect(c['core.keys']!.detail).not.toContain('Customers');
  expect(byId(await run(rich(), withCore([C, Pr, St])))['core.keys']!.status).toBe('ok');
});

test('a core class with no direct reference to the goal is a warning naming it', async () => {
  const c = byId(await run(rich(), withCore([C, P, St])));
  expect(c['core.toGoal']!.status).toBe('warn');
  expect(c['core.toGoal']!.detail).toContain('Plan');
  expect(c['core.toGoal']!.detail).not.toContain('Customers');
  expect(byId(await run(rich(), withCore([C, Pr, St])))['core.toGoal']!.status).toBe('ok');
});

test('core classes with no reference between them are a recommendation listing the pairs', async () => {
  const c = byId(await run(rich(), withCore([C, St, P])));
  expect(c['core.linked']!.status).toBe('recommend');
  expect(c['core.linked']!.detail).toContain('Customers and Stores');
  expect(byId(await run(rich(), withCore([C, Pr])))['core.linked']!.status).toBe('ok');
});

test('the core count is judged against the industry', async () => {
  expect(byId(await run(rich(), withCore([C, Pr, St])))['core.count']).toMatchObject({ status: 'skip', detail: 'Needs: The industry is set' });
  expect(byId(await run(rich(), withCore([C, Pr, St], 'ecommerce')))['core.count']!.status).toBe('recommend');
  expect(byId(await run(rich(), withCore([C, Pr, St], 'other')))['core.count']!.status).toBe('ok');
});

test('a dictionary Data Mart with 3 inbound references that is not core is a recommendation', async () => {
  const c = byId(await run(rich(), withCore([C, St, Cp])));
  expect(c['core.missing']!.status).toBe('recommend');
  expect(c['core.missing']!.detail).toContain('Products');
  expect(byId(await run(rich(), withCore([C, St, Pr])))['core.missing']!.status).toBe('ok');
});

test('with no core list the ranking stands in for it', async () => {
  const c = byId(await run(rich()));
  expect(c['core.toGoal']!.status).toBe('ok');
  expect(c['core.keys']!.status).toBe('ok');
});

test('a context with no description is a recommendation', async () => {
  const d = data({ contexts: [{ id: 'k2', name: 'Empty', description: null }] });
  expect(byId(await run(d))['context:k2.description']!.status).toBe('recommend');
});

test('no model is a blocker in the metrics section', async () => {
  const c = byId(await run(data()));
  expect(c['model.built']).toMatchObject({ status: 'fail', group: 'metrics', detail: 'No model built yet' });
  for (const id of ['model.keys', 'model.plans', 'model.history']) expect(c[id]!.status, id).toBe('skip');
});

test('core classes without a key metric and shown metrics without a plan are recommendations', async () => {
  const cls = (id: string, over = {}) => ({ ...savedModel.classes[0]!, id, martId: id, title: id, ...over });
  const met = (i: number, over = {}) => ({ id: `m${i}`, martId: 'a', alias: `Metric ${i}`, shown: true, plan: null, ...over }) as never;
  const m = { ...savedModel, classes: [cls('a'), cls('b', { core: true, keyMetricId: null }), cls('c', { core: true, keyMetricId: 'x' })], metrics: [1, 2, 3, 4, 5, 6, 7].map((i) => met(i)) };
  const c = byId(await run(data(), { model: m }));
  expect(c['model.built']!.status).toBe('ok');
  expect(c['model.keys']).toMatchObject({ status: 'recommend' });
  expect(c['model.keys']!.detail).toContain('b');
  expect(c['model.plans']!.status).toBe('recommend');
  expect(c['model.plans']!.detail).toBe('No plan: Metric 1, Metric 2, Metric 3, Metric 4, Metric 5 and 2 more');
});

test('history names the last editor, or the builder when nobody edited', async () => {
  const edited = { ...savedModel, builtBy: 'Ann', editedBy: 'Bob', editedAt: '2026-11-11T12:00:00Z' };
  expect(byId(await run(data(), { model: edited }))['model.history']).toMatchObject({ status: 'ok', group: 'housekeeping', detail: 'Last edited by Bob, Nov 11, 2026' });
  const built = { ...savedModel, builtBy: 'Ann', builtAt: '2026-11-10T12:00:00Z', editedBy: null, editedAt: null };
  expect(byId(await run(data(), { model: built }))['model.history']!.detail).toBe('Built by Ann, Nov 10, 2026');
});

test('the plan shape is known once the model holds the goal plan', async () => {
  expect(byId(await run(data()))['project.shape']!.status).toBe('recommend');
  const plan = { martId: P, measure: { field: 'revenue' }, dateField: 'date', shape: 'daily' } as never;
  const m = { ...savedModel, goal: { ...savedModel.goal, metricId: 'm1' }, metrics: [{ id: 'm1', martId: G, alias: 'Revenue', shown: true, plan }] as never };
  expect(byId(await run(data(), { model: m }))['project.shape']).toMatchObject({ status: 'ok', detail: 'daily' });
  const none = data({ projectDescription: table(`| Critical number | Revenue | | [Revenue](${url(G, 'revenue')}) |`) });
  expect(byId(await run(none))['project.shape']!.status).toBe('skip');
});

test('the plan label says it covers the goal and core classes', () => {
  expect(LABELS['model.plans']).toBe('Each shown metric of the goal and core classes has a plan');
});

test('a context needs a Critical number row with a fact', async () => {
  const leading = data({ contexts: [{ id: 'k1', name: 'Sales', description: table(`| Leading | Customers | | [Customers](${url(C, 'revenue')}) |`) }] });
  expect(byId(await run(leading))['context:k1.fact']).toMatchObject({ status: 'warn', detail: 'No Critical number row with a fact' });
  const noFact = data({ contexts: [{ id: 'k1', name: 'Sales', description: table('| Critical number | Customers | | |') }] });
  expect(byId(await run(noFact))['context:k1.fact']!.status).toBe('warn');
  expect(byId(await run(data()))['context:k1.fact']!.status).toBe('ok');
});

test('an unknown shape with a model says rebuild and links Metrics', async () => {
  const m = { ...savedModel, goal: { ...savedModel.goal, metricId: null }, metrics: [] };
  expect(byId(await run(data(), { model: m }))['project.shape']).toMatchObject({ status: 'recommend', detail: 'Not known yet: rebuild the model to detect it', fix: { kind: 'tab', tab: 'ontology' } });
});

test('an unknown industry id falls back to Other', async () => {
  const s = { thresholdPct: 20, industry: 'nope' as never, coreClasses: core(C, Pr, St) };
  expect(byId(await run(rich(), { settings: s }))['core.count']!.status).toBe('ok');
});
