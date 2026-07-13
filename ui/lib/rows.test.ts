import { describe, it, expect } from 'vitest';
import { toPoints, toSeries } from './rows';
import type { QueryResult } from './types';

const data: QueryResult = {
  columns: ['Source', 'Cost | SUM', 'Row Count'],
  rows: [['google', 30, 3], ['meta', 20, 2]],
  truncated: false, totals: null,
};

describe('toPoints', () => {
  it('maps rows positionally by column name', () => {
    expect(toPoints(data, 'Source', 'Cost | SUM')).toEqual([
      { label: 'google', value: 30, raw: 'google' },
      { label: 'meta', value: 20, raw: 'meta' },
    ]);
  });

  it('preserves server order — it must NOT re-sort', () => {
    const unsorted: QueryResult = { ...data, rows: [['meta', 20, 2], ['google', 30, 3]] };
    expect(toPoints(unsorted, 'Source', 'Cost | SUM').map(p => p.label)).toEqual(['meta', 'google']);
  });

  it('returns [] when a column is missing rather than throwing', () => {
    expect(toPoints(data, 'Nope', 'Cost | SUM')).toEqual([]);
  });

  it('coerces a null metric to 0 for plotting', () => {
    const withNull: QueryResult = { ...data, rows: [['x', null, 1]] };
    expect(toPoints(withNull, 'Source', 'Cost | SUM')).toEqual([{ label: 'x', value: 0, raw: 'x' }]);
  });

  it('returns [] for empty rows', () => {
    expect(toPoints({ ...data, rows: [] }, 'Source', 'Cost | SUM')).toEqual([]);
  });

  it('coerces a non-numeric metric to 0', () => {
    const weird: QueryResult = { ...data, rows: [['x', 'not-a-number', 1]] };
    expect(toPoints(weird, 'Source', 'Cost | SUM')).toEqual([{ label: 'x', value: 0, raw: 'x' }]);
  });

  it('renders a single data point', () => {
    expect(toPoints({ ...data, rows: [['google', 30, 3]] }, 'Source', 'Cost | SUM')).toEqual([
      { label: 'google', value: 30, raw: 'google' },
    ]);
  });

  // Cross-filtering (Task 16 follow-up fix): a dimension isn't required to be a string (e.g. a
  // numeric rating, day_of_week, store_id are legal dimensions — see ComponentEditor.tsx, which
  // only filters on `role === 'dimension'`). `label` is a display-only stringification; the raw,
  // uncoerced cell must also survive so a server-side `eq` filter can send the correctly-typed
  // value instead of a string that silently zero-matches a numeric column.
  it('preserves the raw, uncoerced dimension value alongside the stringified display label', () => {
    const numericDim: QueryResult = {
      columns: ['Rating', 'Cost | SUM'],
      rows: [[5, 30], [4, 20]],
      truncated: false, totals: null,
    };
    expect(toPoints(numericDim, 'Rating', 'Cost | SUM')).toEqual([
      { label: '5', value: 30, raw: 5 },
      { label: '4', value: 20, raw: 4 },
    ]);
  });
});

describe('toSeries', () => {
  const breakdownData: QueryResult = {
    columns: ['Day', 'Source', 'Cost | SUM'],
    rows: [
      ['2024-01-01', 'google', 10],
      ['2024-01-01', 'meta', 5],
      ['2024-01-02', 'google', 12],
      ['2024-01-02', 'meta', 6],
    ],
    truncated: false, totals: null,
  };

  it('pivots long rows into one object per x with one key per series, preserving x order', () => {
    expect(toSeries(breakdownData, 'Day', 'Source', 'Cost | SUM')).toEqual({
      rows: [
        { x: '2024-01-01', google: 10, meta: 5 },
        { x: '2024-01-02', google: 12, meta: 6 },
      ],
      seriesKeys: ['google', 'meta'],
    });
  });

  it('returns empty when any column is missing', () => {
    expect(toSeries(breakdownData, 'Nope', 'Source', 'Cost | SUM')).toEqual({ rows: [], seriesKeys: [] });
  });

  it('returns empty for empty rows', () => {
    expect(toSeries({ ...breakdownData, rows: [] }, 'Day', 'Source', 'Cost | SUM')).toEqual({
      rows: [], seriesKeys: [],
    });
  });

  it('coerces null/non-numeric values to 0 without crashing', () => {
    const withBad: QueryResult = {
      ...breakdownData,
      rows: [['2024-01-01', 'google', null], ['2024-01-01', 'meta', 'x']],
    };
    expect(toSeries(withBad, 'Day', 'Source', 'Cost | SUM')).toEqual({
      rows: [{ x: '2024-01-01', google: 0, meta: 0 }],
      seriesKeys: ['google', 'meta'],
    });
  });

  it('does not crash with more series than chart colors — enumerates all distinct series keys', () => {
    const many: QueryResult = {
      columns: ['Day', 'Source', 'Cost | SUM'],
      rows: Array.from({ length: 8 }, (_, i) => ['2024-01-01', `src-${i}`, i]),
      truncated: false, totals: null,
    };
    const { seriesKeys } = toSeries(many, 'Day', 'Source', 'Cost | SUM');
    expect(seriesKeys.length).toBe(8);
  });
});
