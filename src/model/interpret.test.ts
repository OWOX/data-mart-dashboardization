import { buildPrompt, interpret } from './interpret';

const input = {
  projectDescription: '| Critical number | ARR | [ARR](x) |',
  contexts: [{ id: 'c1', name: 'Growth', description: 'Visitors are unique per period.' }, { id: 'c2', name: 'HR', description: null }],
  links: [{ index: 0, source: 'project', text: 'ARR', url: 'u', martId: 'm1', field: 'arr', placeholder: false }],
  dateFields: { m1: ['date'] },
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
  await expect(interpret(async () => good, input)).resolves.toEqual({ ...good, metrics: [{ ...good.metrics[0], format: 'number', currency: null }] });
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
