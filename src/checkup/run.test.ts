import { expect, test } from 'vitest';
import { runCheckup } from './run';
import { fakeOwox, type FakeOwoxData } from '../owox/fake';
import type { MartDetail, MartSummary } from '../owox/sources';
import type { Check } from './types';
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
    contexts: [{ id: 'k1', name: 'Sales', description: table(`| Leading | Customers | [Plan](${url(P, 'revenue')}) | [Customers](${url(C, 'revenue')}) |`) }],
    marts: [mart(G, 'Orders', [{ id: 'k1', name: 'Sales' }]), mart(C, 'Customers', [{ id: 'k1', name: 'Sales' }]), mart(P, 'Plan')],
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
const run = (d: FakeOwoxData, over: { hasAi?: boolean; model?: typeof savedModel | null } = {}) =>
  runCheckup({ owox: fakeOwox(d), hasAi: over.hasAi ?? true, model: over.model ?? null, projectId: 'p', onUpdate: () => {} });
const byId = (cs: Check[]) => Object.fromEntries(cs.map((c) => [c.id, c]));
const without = <T,>(o: Record<string, T>, k: string) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
const noCalc = (d: MartDetail): MartDetail => ({ ...d, fields: d.fields.filter((f) => !f.calculated) });

test('a complete project passes everything except the saved model, which is skipped', async () => {
  const cs = await run(data());
  for (const c of cs) {
    if (c.id.startsWith('model.')) expect(c).toMatchObject({ status: 'skip', detail: 'No model built yet' });
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
  expect(c['project.table']!.detail).toBe("Needs: The description isn't empty");
});

test('text without a Metrics table fails with the snippet fix', async () => {
  const c = byId(await run(data({ projectDescription: 'We sell things.' })))['project.table']!;
  expect(c.status).toBe('fail');
  expect(c.fix?.kind).toBe('snippet');
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

test('a goal Data Mart you cannot access fails access but the goal stays reachable through a referrer', async () => {
  const base = data();
  const c = byId(await run({ ...base, marts: base.marts.filter((m) => m.id !== G) }));
  expect(c['goal.access']!.status).toBe('fail');
  for (const id of ['goal.field', 'goal.pk', 'goal.date']) expect(c[id]!.status, id).toBe('skip');
  expect(c['connections.reachable']!.status).toBe('ok');
  expect(c['connections.reachable']!.detail).toContain('Customers');
});

test('a goal without a primary key or a date fails both', async () => {
  const c = byId(await run(data({ details: { ...data().details, [G]: { id: G, title: 'Orders', fields: [{ name: 'revenue', type: 'FLOAT', isPrimaryKey: false }] } } })));
  expect(c['goal.pk']!.status).toBe('fail');
  expect(c['goal.date']!.status).toBe('fail');
});

test('contexts that cannot be read fail and skip the model freshness check', async () => {
  const owox = fakeOwox(data());
  const getJson = owox.getJson.bind(owox);
  const wrapped = { ...owox, getJson: (async (path: string, ...rest: unknown[]) => { if (path === '/api/contexts') throw new Error('403'); return (getJson as (...a: unknown[]) => unknown)(path, ...rest); }) as typeof owox.getJson };
  const c = byId(await runCheckup({ owox: wrapped, hasAi: true, model: savedModel, projectId: 'p', onUpdate: () => {} }));
  expect(c['contexts.exist']).toMatchObject({ status: 'fail', detail: "Contexts couldn't be read" });
  expect(c['model.fresh']).toMatchObject({ status: 'skip', detail: "Contexts couldn't be read" });
});

test('per-context checks warn on an empty context and carry the context', async () => {
  const d = data({ contexts: [{ id: 'k1', name: 'Sales', description: table(`| Leading | Customers | [Plan](${url(P, 'revenue')}) | [Customers](${url(C, 'revenue')}) |`) }, { id: 'k2', name: 'Empty', description: null }] });
  const c = byId(await run(d));
  for (const k of ['description', 'fact', 'plan', 'marts']) expect(c[`context:k2.${k}`], k).toMatchObject({ status: 'warn', context: { id: 'k2', name: 'Empty' } });
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
  const cs = await runCheckup({ owox, hasAi: true, model: null, projectId: 'p', onUpdate: () => {} });
  for (const c of cs.filter((x) => x.id !== 'plugin.ai')) expect(c).toMatchObject({ status: 'fail', detail: "Couldn't read the project: boom" });
  expect(cs.find((c) => c.id === 'plugin.ai')!.status).toBe('ok');
});

test('onUpdate starts with running checks and ends with the resolved list', async () => {
  const calls: Check[][] = [];
  const cs = await runCheckup({ owox: fakeOwox(data()), hasAi: true, model: null, projectId: 'p', onUpdate: (l) => calls.push(l) });
  const first = byId(calls[0]!);
  for (const id of ['plugin.ai', 'project.description', 'connections.reachable']) expect(first[id]!.status, id).toBe('running');
  expect(calls.at(-1)).toEqual(cs);
});
