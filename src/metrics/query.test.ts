import { dailyOptions, toNumber, totalOptions, valueKey } from './query';

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

test.each([[12, 12], ['1234.50', 1234.5], [null, null], [undefined, null], ['abc', null], [NaN, null], [true, null]] as const)(
  'toNumber(%s)', (v, n) => expect(toNumber(v)).toBe(n),
);
