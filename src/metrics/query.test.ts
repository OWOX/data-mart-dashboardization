import { fakeOwox } from '../owox/fake';
import { dailyOptions, queryDaily, queryTotal, toNumber, totalOptions, uniqueDailyOptions, uniqueTotalOptions, valueKey } from './query';

test('value keys follow the http-data labels', () => {
  expect(valueKey({ field: 'revenue', fn: 'SUM' })).toBe('revenue | SUM');
  expect(valueKey({ field: 'id', fn: 'COUNT_DISTINCT' })).toBe('id | COUNTUNIQUE');
  expect(valueKey({ field: 'metrics.cost', fn: 'AVG' })).toBe('metrics_cost | AVG');
  expect(valueKey({ field: 'aov', fn: null })).toBe('aov');
});

test('options', () => {
  expect(totalOptions({ field: 'revenue', fn: 'SUM' }, 'date', { from: '2026-10-01', to: '2026-10-23' })).toEqual({
    column: ['revenue'], aggregation: [{ column: 'revenue', function: 'SUM' }],
    filter: [{ column: 'date', operator: 'gte', value: '2026-10-01' }, { column: 'date', operator: 'lt', value: '2026-10-24' }], limit: 1,
  });
  expect(dailyOptions({ field: 'aov', fn: null }, 'date', { from: '2026-10-01', to: '2026-10-02' })).toMatchObject({
    column: ['date', 'aov'], aggregation: null,
  });
  expect((dailyOptions({ field: 'aov', fn: null }, 'date', { from: '2026-10-01', to: '2026-10-02' }) as { dateTrunc: unknown }).dateTrunc)
    .toEqual([{ column: 'date', unit: 'DAY' }]);
});

test('unique count options ask uniqueCount, with no column or aggregation on a total', () => {
  const w = { from: '2026-10-01', to: '2026-10-23' };
  const total = uniqueTotalOptions('date', w);
  expect(total).toEqual({
    uniqueCount: [''],
    filter: [{ column: 'date', operator: 'gte', value: '2026-10-01' }, { column: 'date', operator: 'lt', value: '2026-10-24' }], limit: 1,
  });
  expect(total).not.toHaveProperty('column');
  expect(total).not.toHaveProperty('aggregation');
  expect(uniqueTotalOptions(null, null)).toEqual({ uniqueCount: [''], filter: null, limit: 1 });
  expect(uniqueDailyOptions('date', w)).toMatchObject({
    column: ['date'], uniqueCount: [''], dateTrunc: [{ column: 'date', unit: 'DAY' }], sort: [{ column: 'date', direction: 'asc' }], limit: 1000,
  });
  expect(uniqueDailyOptions('date', w)).not.toHaveProperty('aggregation');
});

test('unique count values are read from the Unique Count key', async () => {
  const owox = fakeOwox({
    projectDescription: null, contexts: [], marts: [], details: {}, blendables: {},
    rows: (_id, o) => (o.dateTrunc ? [{ date: '2026-10-01T00:00:00Z', 'Unique Count': '7' }, { date: '2026-10-02', 'Unique Count': 9 }] : [{ 'Unique Count': 16 }]),
  });
  const m = { field: 'id', fn: 'COUNT_DISTINCT' as const };
  const w = { from: '2026-10-01', to: '2026-10-02' };
  expect(await queryTotal(owox, 'a', m, 'date', w, true)).toBe(16);
  expect([...(await queryDaily(owox, 'a', m, 'date', w, true))]).toEqual([['2026-10-01', 7], ['2026-10-02', 9]]);
});

test.each([[12, 12], ['1234.50', 1234.5], [null, null], [undefined, null], ['abc', null], [NaN, null], [true, null]] as const)(
  'toNumber(%s)', (v, n) => expect(toNumber(v)).toBe(n),
);
