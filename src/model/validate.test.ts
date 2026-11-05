import { uniqueCountMetric, validate } from './validate';
import { allowsAggregation } from './aggregations';
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
  metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'ARR', factLink: 0, planLink: null, kind: 'level', planShape: null, factDateField: 'date', planDateField: null, aggregation: null, format: 'number', currency: null, ...over }],
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

test('aggregation fallback only picks a supported function', () => {
  const only = (allowed: string[]) => new Map([['m1', { ...arrMart, fields: arrMart.fields.map((f) => (f.name === 'arr' ? { ...f, allowedAggregations: allowed } : f)) }]]);
  const r = validate({ ai: ai(), links, details: only(['MEDIAN', 'AVG']), visible });
  expect(r.ok && r.metrics[0]!.measure.fn).toBe('AVG');
  const none = validate({ ai: ai(), links, details: only(['MEDIAN', 'STRING_AGG']), visible });
  expect(!none.ok && none.blocked.mismatches).toEqual(['ARR → no supported aggregation for arr']);
});

test('composite primary key counts too; a mart with no key yields none', () => {
  expect(uniqueCountMetric(arrMart, { availableSources: [], mainUniqueCountKeyFields: ['date', 'customerId'] })).toMatchObject({
    measure: { field: 'date', fn: 'COUNT_DISTINCT' }, isUniqueCount: true,
  });
  expect(uniqueCountMetric(arrMart, { availableSources: [], mainUniqueCountKeyFields: [] })).toBeNull();
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

test('an INTEGER primary key gives a unique-count metric like a STRING key', () => {
  const mart = (type: string) => ({ id: 'c', title: 'Customers', fields: [{ name: 'id', type, isPrimaryKey: true, isHiddenForReporting: true }, { name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false }] });
  const b = { availableSources: [], mainUniqueCountKeyFields: ['id'] };
  expect(uniqueCountMetric(mart('INTEGER'), b)).toMatchObject({ measure: { field: 'id', fn: 'COUNT_DISTINCT' }, isUniqueCount: true });
  expect(uniqueCountMetric(mart('STRING'), b)).toMatchObject({ measure: { field: 'id', fn: 'COUNT_DISTINCT' } });
});

describe('a metric-level calculated field is a flow', () => {
  const calc = { id: 'm1', title: 'ARR Daily', fields: [
    { name: 'date', type: 'DATE', isPrimaryKey: true },
    { name: 'aov', type: 'FLOAT', isPrimaryKey: false, calculated: { formula: 'a / b', level: 'metric' as const } },
    { name: 'arr', type: 'FLOAT', isPrimaryKey: false },
  ] };
  const run = (field: string, over = {}) => validate({
    ai: ai({ kind: 'level', planLink: 2, planDateField: 'date', planShape: 'level', ...over }),
    links: [{ ...links[0]!, field }, links[1]!, { index: 2, source: 'project', text: 'P', url: 'u2', martId: 'm1', field, placeholder: false }],
    details: new Map([['m1', calc]]), visible,
  });
  test('the AI says level, the plan keeps its shape, the kind comes out flow', () => {
    const r = run('aov');
    expect(r.ok && r.metrics[0]).toMatchObject({ measure: { field: 'aov', fn: null }, kind: 'flow', plan: { shape: 'level' } });
  });
  test('a stored column the AI marks level stays level', () => {
    const r = run('arr');
    expect(r.ok && r.metrics[0]).toMatchObject({ measure: { field: 'arr', fn: 'SUM' }, kind: 'level' });
  });
});

test('allowsAggregation: explicit list wins, else the OWOX default of the type', () => {
  const f = (type: string, allowedAggregations?: string[]) => ({ name: 'x', type, isPrimaryKey: false, allowedAggregations });
  expect(allowsAggregation(f('INTEGER'), 'SUM')).toBe(true);
  expect(allowsAggregation(f('INTEGER'), 'COUNT_DISTINCT')).toBe(false);
  expect(allowsAggregation(f('INTEGER', ['COUNT_DISTINCT']), 'COUNT_DISTINCT')).toBe(true);
  expect(allowsAggregation(f('STRING'), 'COUNT_DISTINCT')).toBe(true);
  expect(allowsAggregation(f('STRING'), 'SUM')).toBe(false);
  expect(allowsAggregation(f('BOOLEAN'), 'COUNT')).toBe(true);
  expect(allowsAggregation(f('DATE'), 'MAX')).toBe(true);
  expect(allowsAggregation(f('DATE'), 'SUM')).toBe(false);
  expect(allowsAggregation(f('numeric'), 'AVG')).toBe(true);
  expect(allowsAggregation(f('BPCHAR'), 'COUNT_DISTINCT')).toBe(true);
  expect(allowsAggregation(f('TIMESTAMP WITH TIME ZONE'), 'MIN')).toBe(true);
  expect(allowsAggregation(f('TIMESTAMPTZ'), 'MAX')).toBe(true);
  expect(allowsAggregation(f('TIMETZ'), 'MIN')).toBe(true);
  expect(allowsAggregation(f('JSON'), 'COUNT')).toBe(true);
  expect(allowsAggregation(f('JSON'), 'SUM')).toBe(false);
  expect(allowsAggregation({ ...f('FLOAT'), calculated: { formula: 'a/b', level: 'metric' } }, null)).toBe(true);
  expect(allowsAggregation(f('FLOAT'), null)).toBe(false);
});

test('the AI format reaches the metric, and currency only rides with currency', () => {
  const r = validate({ ai: ai({ format: 'currency', currency: 'USD' }), links, details, visible });
  expect(r.ok && r.metrics[0]).toMatchObject({ format: 'currency', currency: 'USD' });
  const p = validate({ ai: ai({ format: 'percent', currency: 'USD' }), links, details, visible });
  expect(p.ok && p.metrics[0]).toMatchObject({ format: 'percent', currency: null });
});

test('a metric is named after its field: the alias when set, else the field name, not the AI alias', () => {
  const named = new Map([['m1', { ...arrMart, fields: arrMart.fields.map((f) => (f.name === 'arr' ? { ...f, alias: ' Annual revenue ' } : f)) }]]);
  const a = validate({ ai: ai(), links, details: named, visible });
  expect(a.ok && a.metrics[0]!.alias).toBe('Annual revenue');
  const b = validate({ ai: ai(), links, details, visible });
  expect(b.ok && b.metrics[0]!.alias).toBe('arr');
});
