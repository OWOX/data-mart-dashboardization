import { buildModel } from './build';
import { fakeOwox } from '../owox/fake';

const now = new Date('2026-10-24T10:00:00Z');
const goalAi = {
  goal: { status: 'ok', metricRef: 'm1', note: '' },
  metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'Revenue', factLink: 0, planLink: null, kind: 'flow', planShape: null, factDateField: 'date', planDateField: null, aggregation: null }],
};
const mart = (id: string, title: string) => ({ id, title, status: 'PUBLISHED', description: null, contexts: [], modifiedAt: 't' });
const data = () => ({
  projectDescription: '| Critical number | Revenue | [Revenue](https://app.owox.com/ui/p/data-marts/11111111-1111-1111-1111-111111111111/data-setup?field=revenue) |',
  contexts: [],
  marts: [mart('11111111-1111-1111-1111-111111111111', 'Orders'), mart('c', 'Customers')],
  details: {
    '11111111-1111-1111-1111-111111111111': { id: '11111111-1111-1111-1111-111111111111', title: 'Orders', fields: [
      { name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'date', type: 'DATE', isPrimaryKey: false },
      { name: 'revenue', type: 'FLOAT', isPrimaryKey: false },
      { name: 'cust_ltv', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'AVG({{ref path="customers" field="ltv"}})', level: 'metric' as const } },
    ] },
    c: { id: 'c', title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }] },
  },
  blendables: {
    '11111111-1111-1111-1111-111111111111': { availableSources: [{ aliasPath: 'customers', dataMartId: 'c', title: 'Customers', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['id'] },
    c: { availableSources: [], mainUniqueCountKeyFields: ['id'] },
  },
});

test('builds main on top and a connected class below', async () => {
  const r = await buildModel({ owox: fakeOwox(data()), generate: async () => goalAi, userId: 'u1', now });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.model.classes.map((c) => [c.title, c.depth])).toEqual([['Orders', 0], ['Customers', 1]]);
  expect(r.model.edges).toEqual([{ from: '11111111-1111-1111-1111-111111111111', to: 'c' }]);
  const orders = r.model.classes[0]!;
  expect(r.model.metrics.find((m) => m.id === orders.keyMetricId)?.alias).toBe('Revenue');
  expect(orders.metricIds).toHaveLength(2); // Revenue, then unique count
});

test('no AI handle blocks', async () => {
  const r = await buildModel({ owox: fakeOwox(data()), generate: null, userId: 'u1', now });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'AI_NOT_CONFIGURED' } });
});

test('null project description reaches NO_GOAL', async () => {
  const d = { ...data(), projectDescription: null };
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => ({ goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] }), userId: 'u1', now });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'NO_GOAL' } });
});

test('hidden goal with no referencing mart is GOAL_NOT_CONNECTED', async () => {
  const d = data();
  d.marts = d.marts.filter((m) => m.id === 'c');
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'GOAL_NOT_CONNECTED' } });
});

const GID = '11111111-1111-1111-1111-111111111111';

test('main mart blendable fetch failing rejects BUILD_FAILED', async () => {
  const d = data();
  delete (d.blendables as Record<string, unknown>)[GID];
  await expect(buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now })).rejects.toThrow(/^BUILD_FAILED/);
});

test('visible goal mart detail fetch failing rejects BUILD_FAILED', async () => {
  const d = data();
  delete (d.details as Record<string, unknown>)[GID];
  await expect(buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now })).rejects.toThrow(/^BUILD_FAILED/);
});

test('duplicate metrics dedupe keeping the higher rank', async () => {
  const d = data();
  d.contexts = [{ id: 'cx', name: 'X', description: `| Leading | Rev | [Rev](https://app.owox.com/ui/p/data-marts/${GID}/data-setup?field=revenue) |` }] as never;
  const ai = { ...goalAi, metrics: [
    { ...goalAi.metrics[0]! },
    { ...goalAi.metrics[0]!, ref: 'm2', role: 'leading', source: 'cx', alias: 'Rev', factLink: 1 },
  ] };
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => ai, userId: 'u1', now });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const rev = r.model.metrics.filter((m) => m.measure.field === 'revenue');
  expect(rev).toHaveLength(1);
  expect(rev[0]).toMatchObject({ role: 'critical', source: 'project' });
});

test('generate throwing is AI_INVALID, abort is rethrown', async () => {
  const r = await buildModel({ owox: fakeOwox(data()), generate: async () => { throw new Error('boom'); }, userId: 'u1', now });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'AI_INVALID', mismatches: ['boom'] } });
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await expect(buildModel({ owox: fakeOwox(data()), generate: async () => { throw abort; }, userId: 'u1', now })).rejects.toThrow('aborted');
});

test('non-main mart whose fetch fails is dropped', async () => {
  const d = data();
  delete (d.blendables as Record<string, unknown>)['c'];
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now });
  expect(r.ok && r.model.classes.map((c) => c.title)).toEqual(['Orders']);
});

test('metrics sort by role rank across sources', async () => {
  const d = data();
  const url = (f: string) => `https://app.owox.com/ui/p/data-marts/${GID}/data-setup?field=${f}`;
  d.projectDescription = `[a](${url('revenue')}) [b](${url('cust_ltv')}) [c](${url('revenue')}) [d](${url('id')}) [e](${url('date')})`;
  const mk = (ref: string, role: string, source: string, link: number, agg: string | null) =>
    ({ ref, role, source, alias: ref, factLink: link, planLink: null, kind: 'flow', planShape: null, factDateField: 'date', planDateField: null, aggregation: agg });
  const ai = { goal: { status: 'ok', metricRef: 'm1', note: '' }, metrics: [
    mk('m3', 'lagging', 'project', 3, 'MAX'), mk('m2', 'leading', 'project', 2, 'MIN'),
    mk('m4', 'critical', 'cx', 4, 'MAX'), mk('m1', 'critical', 'project', 0, null),
  ] };
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => ai, userId: 'u1', now });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const aliases = r.model.classes[0]!.metricIds.map((id) => r.model.metrics.find((m) => m.id === id)!.alias);
  expect(aliases).toEqual(['m1', 'm4', 'm2', 'm3', 'Orders']);
});
