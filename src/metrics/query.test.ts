import { dailyOptions, queryDaily, queryTotal, toNumber, totalOptions, valueKey } from './query';
import type { OwoxLike } from '../owox/sources';

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

// ODM refuses COUNT_DISTINCT on an INTEGER key (gyroscope#5); the unique count falls back to COUNT
const strictMart = (refuse: (fn: string) => boolean) => {
  const fns: string[] = [];
  const owox = {
    dataMarts: {
      traverseData: async (_id: string, o: Record<string, unknown>) => {
        const fn = (o.aggregation as { function: string }[])[0]!.function;
        fns.push(fn);
        if (refuse(fn)) throw Object.assign(new Error('OWOX API request failed with 400 Bad Request: Aggregation not permitted on the requested field(s): COUNT_DISTINCT(customer_id).'), { status: 400, code: 'aggregation_not_allowed' });
        const daily = Array.isArray(o.dateTrunc);
        const row = (fn === 'COUNT' ? { 'customer_id | COUNT': 42 } : { 'customer_id | COUNTUNIQUE': 40 });
        return { async *rowChunks() { yield daily ? [{ date: '2026-10-01', ...row }] : [row]; } };
      },
    },
  } as unknown as OwoxLike;
  return { owox, fns };
};

test('a refused COUNT_DISTINCT is read with COUNT, and the mart is not asked again', async () => {
  const { owox, fns } = strictMart((fn) => fn === 'COUNT_DISTINCT');
  const m = { field: 'customer_id', fn: 'COUNT_DISTINCT' as const };
  expect(await queryTotal(owox, 'cus-int', m, null, null)).toBe(42);
  expect((await queryDaily(owox, 'cus-int', m, 'date', { from: '2026-10-01', to: '2026-10-01' })).get('2026-10-01')).toBe(42);
  expect(fns).toEqual(['COUNT_DISTINCT', 'COUNT', 'COUNT']);
});

test('an allowed COUNT_DISTINCT stays distinct, and other errors still throw', async () => {
  const ok = strictMart(() => false);
  expect(await queryTotal(ok.owox, 'cus-str', { field: 'customer_id', fn: 'COUNT_DISTINCT' }, null, null)).toBe(40);
  const refusesSum = strictMart(() => true);
  await expect(queryTotal(refusesSum.owox, 'cus-sum', { field: 'customer_id', fn: 'SUM' }, null, null)).rejects.toThrow(/not permitted/);
  expect(refusesSum.fns).toEqual(['SUM']);
});
