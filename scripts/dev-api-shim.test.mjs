import { describe, it, expect } from 'vitest';
import {
  AGG_TOKEN,
  aggLabel,
  expectedColumns,
  needsGrandTotal,
  grandTotalFromRow,
  rowsToQueryResult,
  shouldKeepPolling,
} from './dev-api-shim.mjs';

describe('aggLabel', () => {
  it('uses the function name verbatim for most tokens', () => {
    expect(aggLabel('revenue', 'SUM')).toBe('revenue | SUM');
  });
  it('maps COUNT_DISTINCT to COUNTUNIQUE and P50 to MEDIAN', () => {
    expect(aggLabel('user_id', 'COUNT_DISTINCT')).toBe('user_id | COUNTUNIQUE');
    expect(aggLabel('latency', 'P50')).toBe('latency | MEDIAN');
  });
  it('sanitizes dotted columns by replacing dots with underscores', () => {
    expect(aggLabel('metrics.revenue', 'SUM')).toBe('metrics_revenue | SUM');
  });
  it('covers every AggregateFunction the plugin can emit', () => {
    expect(Object.keys(AGG_TOKEN).sort()).toEqual(
      ['AVG', 'COUNT', 'COUNT_DISTINCT', 'MAX', 'MIN', 'P25', 'P50', 'P75', 'P95', 'SUM'].sort()
    );
  });
});

describe('expectedColumns', () => {
  it('keeps a dimension raw and renders an aggregated field as its alias', () => {
    expect(expectedColumns({
      fields: ['channel', 'revenue'],
      aggregationConfig: [{ column: 'revenue', function: 'SUM' }],
    })).toEqual(['channel', 'revenue | SUM']);
  });
});

describe('needsGrandTotal', () => {
  it('is true for a scorecard: aggregation with no grouping dimension', () => {
    expect(needsGrandTotal({ fields: ['revenue'], aggregationConfig: [{ column: 'revenue', function: 'SUM' }] })).toBe(true);
  });
  it('is false for a grouped query (a dimension is present)', () => {
    expect(needsGrandTotal({ fields: ['channel', 'revenue'], aggregationConfig: [{ column: 'revenue', function: 'SUM' }] })).toBe(false);
  });
  it('is false when there is no aggregation at all', () => {
    expect(needsGrandTotal({ fields: ['a', 'b'] })).toBe(false);
  });
});

describe('grandTotalFromRow (fallback)', () => {
  it('uses the single no-grouping row as the total, dropping Row Count', () => {
    const body = { fields: ['revenue'], aggregationConfig: [{ column: 'revenue', function: 'SUM' }] };
    expect(grandTotalFromRow([{ 'revenue | SUM': 1575.93, 'Row Count': 10 }], body)).toEqual({ 'revenue | SUM': 1575.93 });
  });
  it('returns null for a grouped query even if rows exist', () => {
    const body = { fields: ['channel', 'revenue'], aggregationConfig: [{ column: 'revenue', function: 'SUM' }] };
    expect(grandTotalFromRow([{ channel: 'x', 'revenue | SUM': 5 }], body)).toBeNull();
  });
});

describe('rowsToQueryResult', () => {
  const grouped = {
    fields: ['channel_grouping', 'source'],
    aggregationConfig: [{ column: 'source', function: 'COUNT' }],
  };

  it('maps aggregated row objects to columns/rows, dropping the "Row Count" metadata column', () => {
    const objs = [
      { channel_grouping: 'Paid', 'source | COUNT': 7, 'Row Count': 7 },
      { channel_grouping: 'Direct', 'source | COUNT': 1, 'Row Count': 1 },
    ];
    const r = rowsToQueryResult(objs, grouped, 10);
    expect(r.columns).toEqual(['channel_grouping', 'source | COUNT']);
    expect(r.rows).toEqual([['Paid', 7], ['Direct', 1]]);
    expect(r.truncated).toBe(false);
    expect(r.totals).toBeNull();
  });

  it('keeps numeric aggregate values as numbers (already JSON-typed)', () => {
    const r = rowsToQueryResult([{ channel_grouping: 'Paid', 'source | COUNT': 7, 'Row Count': 7 }], grouped, 10);
    expect(r.rows[0][1]).toBe(7);
    expect(typeof r.rows[0][1]).toBe('number');
  });

  it('reports truncated and slices to the asked limit when the over-read row is present', () => {
    const objs = ['a', 'b', 'c'].map(c => ({ channel_grouping: c, 'source | COUNT': 1 }));
    const r = rowsToQueryResult(objs, grouped, 2); // asked 2, got 3 (the +1 over-read)
    expect(r.truncated).toBe(true);
    expect(r.rows.map(row => row[0])).toEqual(['a', 'b']);
  });

  it('passes run totals straight through onto the result', () => {
    const body = { fields: ['revenue'], aggregationConfig: [{ column: 'revenue', function: 'SUM' }] };
    const r = rowsToQueryResult([{ 'revenue | SUM': 42, 'Row Count': 3 }], body, 20, { 'revenue | SUM': 42, 'revenue | AVG': 14 });
    expect(r.totals).toEqual({ 'revenue | SUM': 42, 'revenue | AVG': 14 });
  });

  it('falls back to the plugin-expected column names when the result is empty', () => {
    const r = rowsToQueryResult([], grouped, 10);
    expect(r.columns).toEqual(['channel_grouping', 'source | COUNT']);
    expect(r.rows).toEqual([]);
  });
});

describe('shouldKeepPolling', () => {
  it('keeps polling only while the run is PENDING or RUNNING', () => {
    expect(shouldKeepPolling('PENDING')).toBe(true);
    expect(shouldKeepPolling('RUNNING')).toBe(true);
  });
  it('stops on every terminal status', () => {
    for (const s of ['SUCCESS', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RESTRICTED', undefined]) {
      expect(shouldKeepPolling(s)).toBe(false);
    }
  });
});
