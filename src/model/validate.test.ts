import { uniqueCountMetric, validate } from './validate';
import type { AiOutput } from './interpret';

const arrMart = { id: 'm1', title: 'ARR Daily', fields: [
  { name: 'date', type: 'DATE', isPrimaryKey: true }, { name: 'customerId', type: 'STRING', isPrimaryKey: true },
  { name: 'arr', type: 'FLOAT', isPrimaryKey: false, allowedAggregations: ['SUM', 'AVG'] },
] };
const links = [
  { index: 0, source: 'project', text: 'ARR', url: 'u0', martId: 'm1', field: 'arr', placeholder: false },
  { index: 1, source: 'project', text: 'Plan', url: 'u1', martId: null, field: 'arr', placeholder: true },
];
const ai = (over: Partial<AiOutput['metrics'][number]> = {}, goal: Partial<AiOutput['goal']> = {}): AiOutput => ({
  goal: { status: 'ok', metricRef: 'm1', note: '', ...goal },
  metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'ARR', factLink: 0, planLink: null, kind: 'level', planShape: null, factDateField: 'date', planDateField: null, aggregation: null, ...over }],
});
const details = new Map([['m1', arrMart]]);
const visible = new Set(['m1']);

test('happy path builds a level SUM metric', () => {
  const r = validate({ ai: ai(), links, details, visible });
  expect(r.ok && r.metrics[0]).toMatchObject({ martId: 'm1', measure: { field: 'arr', fn: 'SUM' }, kind: 'level', dateField: 'date', role: 'critical' });
});

test.each([
  [ai({}, { status: 'missing' }), 'NO_GOAL'],
  [ai({}, { status: 'placeholder' }), 'GOAL_PLACEHOLDER'],
  [ai({ factLink: 1 }), 'GOAL_PLACEHOLDER'],
  [ai({ factLink: null }), 'GOAL_PLACEHOLDER'],
] as const)('blocked %#', (out, code) => {
  const r = validate({ ai: out, links, details, visible });
  expect(!r.ok && r.blocked.code).toBe(code);
});

test('goal field missing and no primary key', () => {
  const badField = [{ ...links[0]!, field: 'arr_total' }, links[1]!];
  expect(validate({ ai: ai(), links: badField, details, visible })).toMatchObject({ ok: false, blocked: { code: 'GOAL_FIELD_NOT_FOUND' } });
  const noPk = new Map([['m1', { ...arrMart, fields: arrMart.fields.map((f) => ({ ...f, isPrimaryKey: false })) }]]);
  expect(validate({ ai: ai(), links, details: noPk, visible })).toMatchObject({ ok: false, blocked: { code: 'GOAL_NO_PRIMARY_KEY' } });
});

test('wrong date field or aggregation is a mismatch', () => {
  const r = validate({ ai: ai({ factDateField: 'customerId', aggregation: 'MAX' }), links, details, visible });
  expect(r).toMatchObject({ ok: false, blocked: { code: 'AI_INVALID' } });
  expect(!r.ok && r.blocked.mismatches).toHaveLength(2);
});

test('composite primary key has no unique count; single key does', () => {
  expect(uniqueCountMetric(arrMart, { availableSources: [], mainUniqueCountKeyFields: ['date', 'customerId'] })).toBeNull();
  const customers = { id: 'c', title: 'Customers', fields: [{ name: 'id', type: 'STRING', isPrimaryKey: true }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }] };
  expect(uniqueCountMetric(customers, { availableSources: [], mainUniqueCountKeyFields: ['id'] })).toMatchObject({
    alias: 'Customers', measure: { field: 'id', fn: 'COUNT_DISTINCT' }, dateField: 'created_at', isUniqueCount: true,
  });
});

test('plan field mismatch and missing plan date field', () => {
  const planLinks = [...links, { index: 2, source: 'project', text: 'P', url: 'u2', martId: 'm1', field: 'nope', placeholder: false }];
  const r = validate({ ai: ai({ planLink: 2, planDateField: 'date', planShape: 'daily' }), links: planLinks, details, visible });
  expect(!r.ok && r.blocked.mismatches).toEqual(['ARR → plan field "nope" not found in ARR Daily']);
  const okLinks = [...links, { index: 2, source: 'project', text: 'P', url: 'u2', martId: 'm1', field: 'arr', placeholder: false }];
  const r2 = validate({ ai: ai({ planLink: 2, planDateField: null, planShape: 'daily' }), links: okLinks, details, visible });
  expect(!r2.ok && r2.blocked.mismatches).toEqual(['ARR → plan date field missing for ARR Daily']);
});

test('metric on a hidden fact mart is dropped without mismatch', () => {
  const l = [links[0]!, { ...links[0]!, index: 1, martId: 'h' }];
  const out = ai();
  out.metrics.push({ ...out.metrics[0]!, ref: 'm2', role: 'leading', factLink: 1 });
  const r = validate({ ai: out, links: l, details, visible });
  expect(r.ok && r.metrics).toHaveLength(1);
});
