import { buildPrompt, interpret } from './interpret';

const input = {
  projectDescription: '| Critical number | ARR | [ARR](x) |',
  contexts: [{ id: 'c1', name: 'Growth', description: 'Visitors are unique per period.' }, { id: 'c2', name: 'HR', description: null }],
  links: [{ index: 0, source: 'project', text: 'ARR', url: 'u', martId: 'm1', field: 'arr', placeholder: false }],
  dateFields: { m1: ['date'] },
  marts: [{ id: 'm1', title: 'Orders', description: 'All orders\nmore' }, { id: 'm2', title: 'Customers', description: null }],
};

test('prompt lists links, date fields and skips empty contexts', () => {
  const p = buildPrompt(input);
  expect(p).toContain('0: [ARR] mart=m1 field=arr source=project');
  expect(p).toContain('m1: date');
  expect(p).toContain('CONTEXT c1 (Growth):');
  expect(p).not.toContain('CONTEXT c2');
});

test('valid output passes, invalid output throws AI_INVALID', async () => {
  const good = { goal: { status: 'ok', metricRef: 'm1', note: '' }, metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'ARR', factLink: 0, planLink: null, kind: 'level', planShape: null, factDateField: 'date', planDateField: null, aggregation: null }] };
  await expect(interpret(async () => good, input)).resolves.toEqual({ ...good, coreClasses: [], metrics: [{ ...good.metrics[0], format: 'number', currency: null }] });
  await expect(interpret(async () => ({ goal: {} }), input)).rejects.toThrow(/^AI_INVALID/);
});

test('format parses leniently: missing or unknown is number, a bad currency code is null', async () => {
  const one = (extra: object) => ({ goal: { status: 'ok', metricRef: 'm1', note: '' }, metrics: [{ ref: 'm1', role: 'critical', source: 'project', alias: 'ARR', factLink: 0, planLink: null, kind: 'level', planShape: null, factDateField: 'date', planDateField: null, aggregation: null, ...extra }] });
  const read = async (extra: object) => (await interpret(async () => one(extra), input)).metrics[0]!;
  expect(await read({})).toMatchObject({ format: 'number', currency: null });
  expect(await read({ format: 'bogus', currency: 'USD' })).toMatchObject({ format: 'number', currency: null });
  expect(await read({ format: 'percent', currency: 'USD' })).toMatchObject({ format: 'percent', currency: null });
  expect(await read({ format: 'currency', currency: 'usd' })).toMatchObject({ format: 'currency', currency: 'USD' });
  expect(await read({ format: 'currency', currency: 'dollars' })).toMatchObject({ format: 'currency', currency: null });
  expect(await read({ format: 'currency', currency: 5 })).toMatchObject({ format: 'currency', currency: null });
  expect(buildPrompt(input)).toContain('"percent" for rates');
});

test('prompt lists the Data Marts with the first line of each description', () => {
  const p = buildPrompt(input);
  expect(p).toContain('DATA MARTS:');
  expect(p).toContain('m1: Orders - All orders');
  expect(p).not.toContain('more');
  expect(p).toContain('\nm2: Customers\n');
  expect(p).toContain('10. coreClasses lists the Data Marts');
});

test('coreClasses parses, and a missing or malformed list is empty', async () => {
  const base = { goal: { status: 'ok', metricRef: 'm1', note: '' }, metrics: [] };
  expect((await interpret(async () => ({ ...base, coreClasses: [{ martId: 'm1', why: 'Who buys' }] }), input)).coreClasses).toEqual([{ martId: 'm1', why: 'Who buys' }]);
  expect((await interpret(async () => base, input)).coreClasses).toEqual([]);
  expect((await interpret(async () => ({ ...base, coreClasses: 'x' }), input)).coreClasses).toEqual([]);
});
