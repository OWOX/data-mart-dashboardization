import { checkHealth } from './health';
import { fakeOwox } from '../owox/fake';
import type { MetricDef, Model } from '../types';

const F = (name: string, over = {}) => ({ name, type: 'FLOAT', isPrimaryKey: false, ...over });
const metric = (id: string, over: Partial<MetricDef> = {}): MetricDef => ({
  id, martId: 'o', alias: id, measure: { field: 'revenue', fn: 'SUM' }, kind: 'flow', dateField: 'date', role: 'critical',
  source: 'project', isUniqueCount: false, format: 'number', currency: null, plan: null, shown: true, forecast: null, ...over,
});
const model = (metrics: MetricDef[], extra: string[] = []): Model => ({
  version: 2, inputHash: 'h', builtAt: '', builtBy: 'u', editedAt: null,
  goal: { classId: 'o', metricId: null, goalMartId: 'o', viaFallback: false },
  classes: ['o', ...extra].map((id, depth) => ({ id, martId: id, title: id === 'o' ? 'Orders' : id, contexts: [], depth, keyMetricId: null, metricIds: id === 'o' ? metrics.map((m) => m.id) : [], shown: true })),
  edges: [], metrics,
});
const owox = (details: Record<string, string[]>) => fakeOwox({
  projectDescription: null, contexts: [], marts: [], blendables: {},
  details: Object.fromEntries(Object.entries(details).map(([id, names]) => [id, { id, title: id === 'o' ? 'Orders' : id, fields: names.map((n) => F(n)) }])),
});
const all = new Set(['o', 'p', 'x']);

test('a model that matches its schemas has no issues, and the schemas come back', async () => {
  const { issues, details } = await checkHealth(owox({ o: ['revenue', 'date'] }), model([metric('m')]), all);
  expect(issues).toEqual([]);
  expect([...details.keys()]).toEqual(['o']);
});

test('fact and date fields that are gone', async () => {
  const { issues } = await checkHealth(owox({ o: ['x'] }), model([metric('m')]), all);
  expect(issues.map((i) => [i.kind, i.metricId, i.text])).toEqual([
    ['fact_field_missing', 'm', 'Field revenue no longer exists in Orders'],
    ['date_field_missing', 'm', 'Date field date no longer exists in Orders'],
  ]);
});

test('a calculated field of level metric is checked by path', async () => {
  const m = metric('c', { measure: { field: 'ltv', fn: null }, calculated: true });
  expect((await checkHealth(owox({ o: ['ltv', 'date'] }), model([m]), all)).issues).toEqual([]);
  expect((await checkHealth(owox({ o: ['date'] }), model([m]), all)).issues[0]!.kind).toBe('fact_field_missing');
});

test('a class whose Data Mart is not accessible reports it once, not per metric', async () => {
  const { issues } = await checkHealth(owox({ o: ['revenue', 'date'] }), model([metric('m')]), new Set());
  expect(issues).toEqual([{ kind: 'mart_missing', classId: 'o', martId: 'o', metricId: null, text: 'Data Mart not found or not accessible' }]);
});

test('plan mart and field, forecast mart and field', async () => {
  const src = (martId: string, field = 'rev') => ({ martId, measure: { field, fn: 'SUM' as const }, dateField: 'd' });
  const plan = { ...src('p'), shape: 'daily' as const };
  const m = metric('m', { plan, forecast: src('x') });
  const d = { o: ['revenue', 'date'], p: ['rev'], x: ['rev', 'd'] };
  const a = await checkHealth(owox(d), model([m]), all);
  expect(a.issues.map((i) => i.kind)).toEqual(['plan_field_missing']);
  expect(a.issues[0]!.text).toBe('The plan field d no longer exists in p');
  const b = await checkHealth(owox({ o: d.o }), model([m]), all);
  expect(b.issues.map((i) => i.kind)).toEqual(['plan_mart_missing', 'forecast_mart_missing']);
  const c = await checkHealth(owox({ ...d, x: ['d'], p: ['rev', 'd'] }), model([m]), all);
  expect(c.issues.map((i) => i.kind)).toEqual(['forecast_field_missing']);
});

test('a details fetch that rejects counts as a missing Data Mart and never throws', async () => {
  const { issues, details } = await checkHealth(owox({}), model([metric('m')]), all);
  expect(issues).toEqual([{ kind: 'mart_missing', classId: 'o', martId: 'o', metricId: null, text: 'Data Mart not found or not accessible' }]);
  expect(details.size).toBe(0);
});

test('a hidden-for-reporting key still exists; a disconnected field is missing', async () => {
  const o = fakeOwox({
    projectDescription: null, contexts: [], marts: [], blendables: {},
    details: { o: { id: 'o', title: 'Orders', fields: [
      F('id', { isHiddenForReporting: true, isPrimaryKey: true }), F('date'), F('revenue', { status: 'DISCONNECTED' }),
    ] } },
  });
  const uc = metric('u', { measure: { field: 'id', fn: 'COUNT_DISTINCT' }, isUniqueCount: true });
  const { issues } = await checkHealth(o, model([uc, metric('m')]), all);
  expect(issues.map((i) => [i.metricId, i.kind])).toEqual([['m', 'fact_field_missing']]);
});
