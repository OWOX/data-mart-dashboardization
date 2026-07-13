import { describe, it, expect } from 'vitest';
import {
  coerceCell,
  parseTsv,
  AGG_TOKEN,
  aggLabel,
  mapQueryRequestToMcpArgs,
  resolveSortPlan,
  sortAndTruncateRows,
} from './dev-mcp-shim.mjs';

describe('coerceCell', () => {
  it('coerces integer-looking cells to numbers', () => {
    expect(coerceCell('42')).toBe(42);
  });
  it('coerces decimal and negative cells to numbers', () => {
    expect(coerceCell('-3.5')).toBe(-3.5);
  });
  it('leaves non-numeric text unchanged', () => {
    expect(coerceCell('Los Angeles')).toBe('Los Angeles');
  });
  it('leaves empty cells as empty strings', () => {
    expect(coerceCell('')).toBe('');
  });
});

describe('parseTsv', () => {
  it('returns [] for empty input', () => {
    expect(parseTsv('')).toEqual([]);
  });
  it('parses tab-separated cells into rows with numeric coercion', () => {
    expect(parseTsv('US\t120\nCA\t45')).toEqual([
      ['US', 120],
      ['CA', 45],
    ]);
  });
  it('drops exactly one trailing newline without producing a bogus empty row', () => {
    expect(parseTsv('US\t120\n')).toEqual([['US', 120]]);
  });
});

describe('aggLabel', () => {
  it('uses the function name verbatim for most tokens', () => {
    expect(aggLabel('revenue', 'SUM')).toBe('revenue | SUM');
  });
  it('maps COUNT_DISTINCT to COUNTUNIQUE', () => {
    expect(aggLabel('user_id', 'COUNT_DISTINCT')).toBe('user_id | COUNTUNIQUE');
  });
  it('maps P50 to MEDIAN', () => {
    expect(aggLabel('latency', 'P50')).toBe('latency | MEDIAN');
  });
  it('sanitizes dotted columns by replacing dots with underscores', () => {
    expect(aggLabel('metrics.revenue', 'SUM')).toBe('metrics_revenue | SUM');
  });
});

describe('mapQueryRequestToMcpArgs', () => {
  it('maps fields, aggregationConfig, dateTruncConfig, filterConfig, limit', () => {
    const body = {
      fields: ['country', 'revenue'],
      aggregationConfig: [{ column: 'revenue', function: 'SUM' }],
      dateTruncConfig: [{ column: 'ts', unit: 'MONTH', timeZone: 'UTC' }],
      filterConfig: [{ column: 'country', operator: 'eq', value: 'US' }],
      limit: 10,
    };
    expect(mapQueryRequestToMcpArgs('mart-1', body)).toEqual({
      data_mart_id: 'mart-1',
      fields: ['country', 'revenue'],
      aggregations: [{ field: 'revenue', function: 'SUM' }],
      date_buckets: [{ field: 'ts', unit: 'MONTH', time_zone: 'UTC' }],
      filters: [{ field: 'country', operator: 'eq', value: 'US' }],
      limit: 10,
    });
  });

  it('omits aggregations/date_buckets/filters keys when null, and omits limit when absent', () => {
    const body = { fields: ['a'], aggregationConfig: null, dateTruncConfig: null, filterConfig: null };
    expect(mapQueryRequestToMcpArgs('mart-1', body)).toEqual({
      data_mart_id: 'mart-1',
      fields: ['a'],
    });
  });

  it('applies an explicit limit override over body.limit', () => {
    const body = { fields: ['a'], limit: 10 };
    expect(mapQueryRequestToMcpArgs('mart-1', body, { limit: 1000 })).toEqual({
      data_mart_id: 'mart-1',
      fields: ['a'],
      limit: 1000,
    });
  });

  it('never forwards sortConfig', () => {
    const body = { fields: ['a'], sortConfig: [{ column: 'a', direction: 'asc' }] };
    expect(mapQueryRequestToMcpArgs('mart-1', body)).not.toHaveProperty('sortConfig');
  });
});

describe('resolveSortPlan', () => {
  it('resolves a raw column present verbatim in columns', () => {
    const result = resolveSortPlan(
      [{ column: 'revenue', direction: 'desc' }],
      ['country', 'revenue'],
      null
    );
    expect(result).toEqual({ plan: [{ index: 1, direction: 'desc' }] });
  });

  it('resolves via the aggregated alias, incl. COUNT_DISTINCT -> COUNTUNIQUE and dotted columns', () => {
    const result = resolveSortPlan(
      [{ column: 'metrics.user_id', direction: 'desc' }],
      ['country', 'metrics_user_id | COUNTUNIQUE'],
      [{ column: 'metrics.user_id', function: 'COUNT_DISTINCT' }]
    );
    expect(result).toEqual({ plan: [{ index: 1, direction: 'desc' }] });
  });

  it('returns an unresolved result (not a partial/arbitrary plan) when a column cannot be found', () => {
    const result = resolveSortPlan(
      [{ column: 'nonexistent', direction: 'asc' }],
      ['country', 'revenue'],
      []
    );
    expect(result).toEqual({ plan: null, unresolvedColumn: 'nonexistent' });
  });

  it('fails the whole plan if any one of multiple sort keys is unresolved', () => {
    const result = resolveSortPlan(
      [{ column: 'country', direction: 'asc' }, { column: 'nonexistent', direction: 'desc' }],
      ['country', 'revenue'],
      []
    );
    expect(result.plan).toBeNull();
  });
});

describe('sortAndTruncateRows', () => {
  it('sorts numerically descending and truncates to limit', () => {
    const rows = [['a', 3], ['b', 10], ['c', 1]];
    const result = sortAndTruncateRows(rows, [{ index: 1, direction: 'desc' }], 2);
    expect(result).toEqual([['b', 10], ['a', 3]]);
  });

  it('sorts nulls last regardless of direction', () => {
    const rows = [['a', null], ['b', 5]];
    expect(sortAndTruncateRows(rows, [{ index: 1, direction: 'desc' }], 2)).toEqual([['b', 5], ['a', null]]);
    expect(sortAndTruncateRows(rows, [{ index: 1, direction: 'asc' }], 2)).toEqual([['b', 5], ['a', null]]);
  });

  it('does not mutate the input array', () => {
    const rows = [['a', 3], ['b', 10]];
    sortAndTruncateRows(rows, [{ index: 1, direction: 'desc' }], 2);
    expect(rows).toEqual([['a', 3], ['b', 10]]);
  });

  it('applies a secondary sort key as a tiebreaker', () => {
    const rows = [['b', 1], ['a', 1], ['c', 2]];
    const result = sortAndTruncateRows(
      rows,
      [{ index: 1, direction: 'desc' }, { index: 0, direction: 'asc' }],
      3
    );
    expect(result).toEqual([['c', 2], ['a', 1], ['b', 1]]);
  });
});
