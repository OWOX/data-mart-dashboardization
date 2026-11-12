import { buildModel, currentInputHash, type BuildStep } from './build';
import { fetchInputs } from '../owox/sources';
import { fakeOwox, type FakeOwoxData } from '../owox/fake';

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
      { name: 'revenue', type: 'FLOAT', alias: 'Revenue', isPrimaryKey: false },
      { name: 'cust_ltv', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'AVG({{ref path="customers" field="ltv"}})', level: 'metric' as const } },
    ] },
    c: { id: 'c', title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }] },
  },
  blendables: {
    '11111111-1111-1111-1111-111111111111': { availableSources: [{ aliasPath: 'customers', dataMartId: 'c', title: 'Customers', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['id'] },
    c: { availableSources: [], mainUniqueCountKeyFields: ['id'] },
  },
});

test('builds main on top and a connected class below', async () => {
  const r = await buildModel({ owox: fakeOwox(data()), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.model.classes.map((c) => [c.title, c.depth])).toEqual([['Orders', 0], ['Customers', 1]]);
  expect(r.model.edges).toEqual([{ from: '11111111-1111-1111-1111-111111111111', to: 'c', fields: ['cust_ltv'] }]);
  const orders = r.model.classes[0]!;
  expect(r.model.metrics.find((m) => m.id === orders.keyMetricId)?.alias).toBe('Revenue');
  expect(orders.metricIds).toHaveLength(2); // Revenue, then unique count
});

test('a Data Mart without a primary key is not a class, and the walk stops there', async () => {
  const base = data();
  // Customers lose their primary key and reference Products, which has one
  const d = {
    ...base,
    marts: [...base.marts, mart('p', 'Products')],
    details: {
      ...base.details,
      c: { id: 'c', title: 'Customers', fields: [{ name: 'id', type: 'INTEGER', isPrimaryKey: false }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }, { name: 'top', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'MAX({{ref path="products" field="price"}})', level: 'metric' as const } }] },
      p: { id: 'p', title: 'Products', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'added', type: 'DATE', isPrimaryKey: false }] },
    },
    blendables: {
      ...base.blendables,
      c: { availableSources: [{ aliasPath: 'products', dataMartId: 'p', title: 'Products', isAccessibleForReporting: true }], mainUniqueCountKeyFields: ['id'] },
      p: { availableSources: [], mainUniqueCountKeyFields: ['id'] },
    },
  };
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.model.classes.map((c) => c.title)).toEqual(['Orders']);
  expect(r.model.metrics.some((m) => m.martId === 'c' || m.martId === 'p')).toBe(false);
});

test('a Data Mart with a primary key and no date field is a class with an undated unique count', async () => {
  const d = data();
  d.details.c = { id: 'c', title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }] };
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.model.classes.map((c) => c.title)).toEqual(['Orders', 'Customers']);
  const customers = r.model.classes[1]!;
  expect(customers.metricIds).toHaveLength(1);
  expect(r.model.metrics.find((m) => m.id === customers.metricIds[0])).toMatchObject({ isUniqueCount: true, dateField: null });
});

test('no AI handle blocks', async () => {
  const r = await buildModel({ owox: fakeOwox(data()), generate: null, userId: 'u1', now, existingCore: null, industry: null });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'AI_NOT_CONFIGURED' } });
});

test('null project description reaches NO_GOAL', async () => {
  const d = { ...data(), projectDescription: null };
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => ({ goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] }), userId: 'u1', now, existingCore: null, industry: null });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'NO_GOAL' } });
});

test('no access to the goal Data Mart blocks with GOAL_NO_ACCESS', async () => {
  const d = data();
  d.marts = d.marts.filter((m) => m.id === 'c');
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'GOAL_NO_ACCESS' } });
});

const GID = '11111111-1111-1111-1111-111111111111';

test('main mart blendable fetch failing rejects BUILD_FAILED', async () => {
  const d = data();
  delete (d.blendables as Record<string, unknown>)[GID];
  await expect(buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null })).rejects.toThrow(/^BUILD_FAILED/);
});

test('visible goal mart detail fetch failing rejects BUILD_FAILED', async () => {
  const d = data();
  delete (d.details as Record<string, unknown>)[GID];
  await expect(buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null })).rejects.toThrow(/^BUILD_FAILED/);
});

test('duplicate metrics dedupe keeping the higher rank', async () => {
  const d = data();
  d.contexts = [{ id: 'cx', name: 'X', description: `| Leading | Rev | [Rev](https://app.owox.com/ui/p/data-marts/${GID}/data-setup?field=revenue) |` }] as never;
  const ai = { ...goalAi, metrics: [
    { ...goalAi.metrics[0]! },
    { ...goalAi.metrics[0]!, ref: 'm2', role: 'leading', source: 'cx', alias: 'Rev', factLink: 1 },
  ] };
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => ai, userId: 'u1', now, existingCore: null, industry: null });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const rev = r.model.metrics.filter((m) => m.measure.field === 'revenue');
  expect(rev).toHaveLength(1);
  expect(rev[0]).toMatchObject({ role: 'critical', source: 'project' });
});

test('a failed AI request is AI_REQUEST_FAILED with the provider message, and the ai point fails', async () => {
  const steps: BuildStep[] = [];
  const generate = async () => { throw new Error('AI provider request could not be completed'); };
  const r = await buildModel({ owox: fakeOwox(data()), generate, userId: 'u1', now, existingCore: null, industry: null, onStep: (s) => steps.push(s) });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'AI_REQUEST_FAILED', detail: "The request to the AI provider failed or timed out.", mismatches: ['AI provider request could not be completed'] } });
  expect(lastChecks(steps).get('ai')).toMatchObject({ state: 'failed' });
});

test('output failing the schema is still AI_INVALID', async () => {
  const r = await buildModel({ owox: fakeOwox(data()), generate: async () => ({ nope: 1 }) as never, userId: 'u1', now, existingCore: null, industry: null });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'AI_INVALID' } });
});

test.each(['AI_NoObjectGeneratedError', 'AI_TypeValidationError', 'AI_JSONParseError'])('SDK %s is AI_INVALID', async (name) => {
  const generate = async () => { throw Object.assign(new Error('bad output'), { name }); };
  const r = await buildModel({ owox: fakeOwox(data()), generate, userId: 'u1', now, existingCore: null, industry: null });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'AI_INVALID', mismatches: ['bad output'] } });
});

test('abort is rethrown', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await expect(buildModel({ owox: fakeOwox(data()), generate: async () => { throw abort; }, userId: 'u1', now, existingCore: null, industry: null })).rejects.toThrow('aborted');
});

test('non-main mart whose fetch fails is dropped', async () => {
  const d = data();
  delete (d.blendables as Record<string, unknown>)['c'];
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null });
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
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => ai, userId: 'u1', now, existingCore: null, industry: null });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const aliases = r.model.classes[0]!.metricIds.map((id) => r.model.metrics.find((m) => m.id === id)!.alias);
  // named after their fields, not the AI's aliases
  expect(aliases).toEqual(['Revenue', 'date', 'Revenue', 'id', 'Orders']);
});

test('inputHash ignores modifiedAt churn but changes with a class-mart formula', async () => {
  const base = await buildModel({ owox: fakeOwox(data()), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null });
  const churned = data();
  churned.marts = churned.marts.map((m) => ({ ...m, modifiedAt: 'later' }));
  const same = await buildModel({ owox: fakeOwox(churned), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null });
  const edited = data();
  edited.details[GID]!.fields[3]!.calculated!.formula = 'SUM({{ref path="customers" field="ltv"}})';
  const changed = await buildModel({ owox: fakeOwox(edited), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null });
  if (!base.ok || !same.ok || !changed.ok) throw new Error('fixture');
  expect(same.model.inputHash).toBe(base.model.inputHash);
  expect(changed.model.inputHash).not.toBe(base.model.inputHash);
});

test('onStep reports reading, marts counting up to the total, and what was found', async () => {
  const steps: BuildStep[] = [];
  const r = await buildModel({ owox: fakeOwox(data()), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null, onStep: (s) => steps.push(s) });
  expect(r.ok).toBe(true);
  const reads = steps.filter((s) => s.kind === 'read');
  expect(reads.map((s) => s.what).filter((w, i, a) => a.indexOf(w) === i)).toEqual(['project', 'contexts', 'marts', 'ai']);
  expect(reads.find((s) => s.what === 'project' && s.finished)).toBeDefined();
  expect(reads.find((s) => s.what === 'contexts')).toMatchObject({ done: 0, total: 0, finished: true });
  const marts = reads.filter((s) => s.what === 'marts');
  expect(marts[0]).toMatchObject({ done: 0, total: 2, finished: false });
  expect(marts.map((s) => s.done)).toEqual([...marts.map((s) => s.done)].sort((a, b) => a - b));
  expect(marts.at(-1)).toMatchObject({ done: 2, total: 2, finished: true });
  expect(reads.at(-1)).toMatchObject({ what: 'marts', finished: true });
  expect(reads.find((s) => s.what === 'ai' && s.finished)).toBeDefined();
  expect(steps.filter((s) => s.kind === 'found')[0]).toEqual({ kind: 'found', goal: 'Revenue (Orders)', classes: [], metrics: 0 });
  expect(steps.at(-1)).toEqual({ kind: 'found', goal: 'Revenue (Orders)', classes: ['Orders', 'Customers'], metrics: 3 });
});

test('the hash changes when a hidden field gains or loses the primary key flag', async () => {
  const d = data();
  const inputs = await fetchInputs(fakeOwox(d));
  const hidden = (pk: boolean) => ({ ...d, details: { ...d.details, c: { ...d.details.c, fields: [{ name: 'id', type: 'STRING', isPrimaryKey: pk, isHiddenForReporting: true }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }] } } });
  const withKey = await currentInputHash(fakeOwox(hidden(true)), inputs, [GID, 'c']);
  expect(await currentInputHash(fakeOwox(hidden(false)), inputs, [GID, 'c'])).not.toBe(withKey);
});

test('a mart whose primary keys are all visible hashes as it did in 0.3.8', async () => {
  const d = data();
  const inputs = await fetchInputs(fakeOwox(d));
  const hash = await currentInputHash(fakeOwox(d), inputs, [GID, 'c']);
  // computed on 270be5d (release 0.3.8) from this fixture; a change here re-proposes a rebuild to every member
  expect(hash).toBe('b9be9f95');
});

test('currentInputHash leaves a Data Mart that fails to fetch out, so the hash changes instead of throwing', async () => {
  const owox = fakeOwox(data());
  const inputs = await fetchInputs(owox);
  const full = await currentInputHash(owox, inputs, [GID, 'c']);
  const gone = data();
  delete (gone.details as Record<string, unknown>).c;
  const owoxGone = fakeOwox(gone);
  const partial = await currentInputHash(owoxGone, inputs, [GID, 'c']);
  expect(partial).not.toBe(full);
  // schemas already read are reused, not fetched again
  const calls = owox.calls.length;
  const known = new Map([[GID, { id: GID, title: 'Orders', fields: data().details[GID]!.fields }], ['c', data().details.c!]]);
  expect(await currentInputHash(owox, inputs, [GID, 'c'], known)).toBe(full);
  expect(owox.calls.slice(calls).every((c) => c.path.endsWith('blendable-schema'))).toBe(true);
});

test('currentInputHash leaves out a mart missing from the access list, and throws on a transient failure', async () => {
  const owox = fakeOwox(data());
  const inputs = await fetchInputs(owox);
  const full = await currentInputHash(owox, inputs, [GID, 'c']);
  // not in the access list: left out without a fetch
  const calls = owox.calls.length;
  const hidden = await currentInputHash(owox, { ...inputs, marts: inputs.marts.filter((m) => m.id !== 'c') }, [GID, 'c']);
  expect(hidden).not.toBe(full);
  expect(owox.calls.slice(calls).some((c) => c.path.includes('/c'))).toBe(false);
  // not found: left out
  const notFound = { ...owox, getJson: (async (path: string) => { if (path === '/api/data-marts/c') throw new Error('Data Mart not found'); return owox.getJson(path); }) as typeof owox.getJson };
  expect(await currentInputHash(notFound, inputs, [GID, 'c'])).not.toBe(full);
  // anything else: can't tell
  const flaky = { ...owox, getJson: (async (path: string) => { if (path === '/api/data-marts/c') throw new Error('503 unavailable'); return owox.getJson(path); }) as typeof owox.getJson };
  await expect(currentInputHash(flaky, inputs, [GID, 'c'])).rejects.toThrow('503');
});

test('a failing project read says what failed', async () => {
  const owox = { ...fakeOwox(data()), project: { getSettings: async () => { throw new Error('boom'); } } };
  await expect(buildModel({ owox, generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null })).rejects.toThrow("Couldn't read the project description and Data Marts: boom");
});

test('onStep emits the checklist points in order for a project with one context and no plan', async () => {
  const d = { ...data(), contexts: [{ id: 'ctx', name: 'Sales', description: 'Sales team' }] };
  const steps: BuildStep[] = [];
  const r = await buildModel({ owox: fakeOwox(d), generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null, onStep: (s) => steps.push(s) });
  expect(r.ok).toBe(true);
  expect(steps.find((s) => s.kind === 'contexts')).toEqual({ kind: 'contexts', list: [{ id: 'ctx', name: 'Sales' }] });
  const checks = steps.flatMap((s) => (s.kind === 'check' ? [s] : []));
  const last = (id: string) => checks.filter((c) => c.id === id).at(-1);
  expect(last('project.description')).toMatchObject({ state: 'done' });
  expect(last('context:ctx.description')).toMatchObject({ state: 'done' });
  expect(last('marts')).toMatchObject({ state: 'done' });
  expect(last('ai')).toMatchObject({ state: 'done' });
  expect(last('project.fact')).toMatchObject({ state: 'done' });
  expect(last('project.plan')).toMatchObject({ state: 'missing' });
  expect(last('project.forecast')).toMatchObject({ state: 'done', detail: 'Extrapolated from the fact' });
  expect(last('context:ctx.fact')).toMatchObject({ state: 'missing' });
  expect(last('classes')).toMatchObject({ state: 'done' });
  const order = (id: string, state: string) => checks.findIndex((c) => c.id === id && c.state === state);
  expect(order('project.description', 'done')).toBeLessThan(order('marts', 'running'));
  expect(order('marts', 'running')).toBeLessThan(order('ai', 'running'));
  expect(order('ai', 'done')).toBeLessThan(order('project.fact', 'done'));
  expect(order('marts', 'done')).toBeLessThan(order('classes', 'running'));
  expect(steps.findIndex((s) => s.kind === 'contexts')).toBeLessThan(steps.findIndex((s) => s.kind === 'check'));
});

test('a blocked build marks the matching required point failed with the blocked detail', async () => {
  const steps: BuildStep[] = [];
  const r = await buildModel({ owox: fakeOwox({ ...data(), projectDescription: null }), generate: async () => ({ goal: { status: 'missing', metricRef: null, note: '' }, metrics: [] }), userId: 'u1', now, existingCore: null, industry: null, onStep: (s) => steps.push(s) });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'NO_GOAL' } });
  const checks = steps.flatMap((s) => (s.kind === 'check' ? [s] : []));
  expect(checks.find((c) => c.id === 'project.description')).toMatchObject({ state: 'missing' });
  expect(checks.at(-1)).toMatchObject({ id: 'project.fact', state: 'failed', detail: 'The project description has no Critical number in its metrics table.' });
});

const ctxData = () => ({ ...data(), contexts: [{ id: 'ctx', name: 'Sales', description: 'Sales team' }] });
const lastChecks = (steps: BuildStep[]) => {
  const m = new Map<string, unknown>();
  for (const s of steps) if (s.kind === 'check') m.set(s.id, s);
  return m;
};
const metric = (o: object) => ({ ref: 'm1', role: 'critical', source: 'project', alias: 'Revenue', factLink: 0, planLink: null, kind: 'flow', planShape: null, factDateField: 'date', planDateField: null, aggregation: null, ...o });

test('project points follow the goal metric, not the first critical project metric', async () => {
  const steps: BuildStep[] = [];
  const ai = {
    goal: { status: 'ok', metricRef: 'm2', note: '' },
    metrics: [metric({ ref: 'm1', alias: 'Other', factLink: null }), metric({ ref: 'm2' })],
  };
  const r = await buildModel({ owox: fakeOwox(data()), generate: async () => ai, userId: 'u1', now, existingCore: null, industry: null, onStep: (s) => steps.push(s) });
  expect(r.ok).toBe(true);
  expect(lastChecks(steps).get('project.fact')).toMatchObject({ state: 'done' });
});

test('forecast is missing when the fact has no date field', async () => {
  const steps: BuildStep[] = [];
  const ai = { goal: { status: 'ok', metricRef: 'm1', note: '' }, metrics: [metric({ factDateField: null })] };
  await buildModel({ owox: fakeOwox(data()), generate: async () => ai, userId: 'u1', now, existingCore: null, industry: null, onStep: (s) => steps.push(s) });
  expect(lastChecks(steps).get('project.forecast')).toMatchObject({ state: 'missing' });
});

test('a context with a critical metric gets fact and plan done, and stays pending until the AI answers', async () => {
  const steps: BuildStep[] = [];
  const d = ctxData();
  d.projectDescription += ' [Plan](https://app.owox.com/ui/p/data-marts/11111111-1111-1111-1111-111111111111/data-setup?field=revenue)';
  const ai = {
    goal: { status: 'ok', metricRef: 'm1', note: '' },
    metrics: [metric({}), metric({ ref: 'm2', source: 'ctx', alias: 'Ctx', factLink: 0, planLink: 1 })],
  };
  await buildModel({ owox: fakeOwox(d), generate: async () => ai, userId: 'u1', now, existingCore: null, industry: null, onStep: (s) => steps.push(s) });
  const ctxChecks = steps.flatMap((s) => (s.kind === 'check' && s.id.startsWith('context:ctx.') && s.id !== 'context:ctx.description' ? [s] : []));
  expect(ctxChecks.map((c) => c.state)).not.toContain('running');
  const l = lastChecks(steps);
  expect(l.get('context:ctx.fact')).toMatchObject({ state: 'done' });
  expect(l.get('context:ctx.plan')).toMatchObject({ state: 'done' });
});

test('unreadable contexts are reported as failed', async () => {
  const steps: BuildStep[] = [];
  const owox = fakeOwox(data());
  const getJson = owox.getJson.bind(owox);
  owox.getJson = (async (path: string, ...a: unknown[]) => { if (path === '/api/contexts') throw new Error('403'); return (getJson as (p: string, ...r: unknown[]) => unknown)(path, ...a); }) as typeof owox.getJson;
  await buildModel({ owox, generate: async () => goalAi, userId: 'u1', now, existingCore: null, industry: null, onStep: (s) => steps.push(s) });
  expect(steps.find((s) => s.kind === 'contexts')).toMatchObject({ list: [], failed: true });
});

// Orders (goal) references Customers, Products and a keyless mart; Sessions references Orders; Stores is only reachable through Customers
const calc = (name: string, path: string) => ({ name, type: 'FLOAT', isPrimaryKey: false, calculated: { formula: `MAX({{ref path="${path}" field="x"}})`, level: 'metric' as const } });
const pk = { name: 'id', type: 'STRING', isPrimaryKey: true };
const bl = (srcs: [string, string][]) => ({ availableSources: srcs.map(([aliasPath, dataMartId]) => ({ aliasPath, dataMartId, title: dataMartId, isAccessibleForReporting: true })), mainUniqueCountKeyFields: ['id'] });
function coreData() {
  const d: FakeOwoxData = data();
  d.marts = [...d.marts, mart('p', 'Products'), mart('nokey', 'Nokey'), mart('s', 'Sessions'), mart('st', 'Stores')];
  d.details[GID]!.fields = [
    pk, { name: 'date', type: 'DATE', isPrimaryKey: false }, { name: 'revenue', type: 'FLOAT', alias: 'Revenue', isPrimaryKey: false },
    calc('c1', 'customers'), calc('p1', 'products'), calc('n1', 'nokey'),
  ];
  d.blendables[GID] = bl([['customers', 'c'], ['products', 'p'], ['nokey', 'nokey']]);
  d.details.c = { id: 'c', title: 'Customers', fields: [pk, calc('st1', 'stores')] };
  d.blendables.c = bl([['stores', 'st']]);
  d.details.p = { id: 'p', title: 'Products', fields: [pk] };
  d.blendables.p = bl([]);
  d.details.nokey = { id: 'nokey', title: 'Nokey', fields: [{ name: 'a', type: 'STRING', isPrimaryKey: false }] };
  d.blendables.nokey = bl([]);
  d.details.s = { id: 's', title: 'Sessions', fields: [pk, calc('o1', 'orders')] };
  d.blendables.s = bl([['orders', GID]]);
  d.details.st = { id: 'st', title: 'Stores', fields: [pk] };
  d.blendables.st = bl([]);
  return d;
}
const withPicks = (coreClasses: { martId: string; why: string }[]) => ({ ...goalAi, coreClasses });
const build = (picks: { martId: string; why: string }[], over: { existingCore?: { martId: string; why: string }[] | null; industry?: 'other' | null } = {}, d = coreData()) =>
  buildModel({ owox: fakeOwox(d), generate: async () => withPicks(picks), userId: 'u1', now, existingCore: over.existingCore ?? null, industry: over.industry ?? null });

test('the first build takes core classes from the description', async () => {
  const r = await build([{ martId: 'c', why: 'Who buys' }, { martId: 'nokey', why: 'x' }, { martId: GID, why: 'goal' }, { martId: 'ghost', why: 'y' }, { martId: 'c', why: 'again' }]);
  expect(r.ok && r.core).toEqual({ classes: [{ martId: 'c', why: 'Who buys' }, ...(r.ok ? r.core.classes.slice(1) : [])], fromDescription: true });
  expect(r.ok && r.core.classes[0]).toEqual({ martId: 'c', why: 'Who buys' });
  expect(r.ok && r.model.classes.find((c) => c.id === 'c')!.core).toBe(true);
  expect(r.ok && r.model.classes.find((c) => c.id === GID)!.core).toBe(false);
});

test('a first list under 3 is topped up from the ranking', async () => {
  const r = await build([{ martId: 'c', why: 'Who buys' }]);
  expect(r.ok && r.core.classes.map((c) => c.martId)).toEqual(['c', 'p']);
});

test('without picks the ranking fills the industry count', async () => {
  const r = await build([], { industry: 'other' });
  expect(r.ok && r.core.fromDescription).toBe(false);
  expect(r.ok && r.core.classes.map((c) => c.martId)).toEqual(['c', 'p']);
  expect(r.ok && r.model.classes.find((c) => c.id === 'c')!.inbound).toBe(1);
});

test('a core class the description no longer names stays', async () => {
  const r = await build([{ martId: 'p', why: 'What is sold' }], { existingCore: [{ martId: 'c', why: 'Who buys' }] });
  expect(r.ok && r.core.classes.map((c) => c.martId)).toEqual(['c', 'p']);
  expect(r.ok && r.model.classes.filter((c) => c.core).map((c) => c.id).sort()).toEqual(['c', 'p']);
});

test('a core class without a date field is in the model with its unique count', async () => {
  const r = await build([{ martId: 'p', why: 'What is sold' }]);
  if (!r.ok) throw new Error('blocked');
  const products = r.model.classes.find((c) => c.id === 'p')!;
  expect(products.core).toBe(true);
  expect(r.model.metrics.find((m) => m.id === products.metricIds[0])).toMatchObject({ isUniqueCount: true, dateField: null });
});

test('a core class the walk did not reach but that touches the goal is added at depth 1', async () => {
  // Sessions only references Orders, so the walk from Orders never reaches it
  const r = await build([{ martId: 's', why: 'Where visitors come from' }]);
  if (!r.ok) throw new Error('blocked');
  const sessions = r.model.classes.find((c) => c.id === 's')!;
  expect(sessions).toMatchObject({ depth: 1, core: true });
  expect(r.model.edges).toContainEqual({ from: 's', to: GID, fields: ['o1'] });
  expect(sessions.metricIds.length).toBeGreaterThan(0);
});

test('the viaFallback path is gone: the goal metric stays on the goal class', async () => {
  const r = await build([]);
  expect(r.ok && r.model.goal).toMatchObject({ classId: GID, metricId: expect.any(String), viaFallback: false });
});
