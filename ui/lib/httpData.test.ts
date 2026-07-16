import { describe, it, expect } from 'vitest';
import {
  aggLabel, buildHttpDataQuery, parseNdjson, expectedColumns,
  needsGrandTotal, grandTotalFromRow, rowsToQueryResult, shouldKeepPolling,
} from './httpData';

const decode = (v: string) => JSON.parse(atob(v.replace(/-/g, '+').replace(/_/g, '/')));

describe('aggLabel', () => {
  it('matches the backend output-column naming', () => {
    expect(aggLabel('revenue', 'SUM')).toBe('revenue | SUM');
    expect(aggLabel('user_id', 'COUNT_DISTINCT')).toBe('user_id | COUNTUNIQUE');
    expect(aggLabel('latency', 'P50')).toBe('latency | MEDIAN');
    expect(aggLabel('metrics.revenue', 'SUM')).toBe('metrics_revenue | SUM');
  });
});

describe('buildHttpDataQuery', () => {
  it('emits repeated columns, base64url configs, and the over-read limit', () => {
    const p = new URLSearchParams(buildHttpDataQuery({
      fields: ['channel', 'cost'],
      aggregationConfig: [{ column: 'cost', function: 'SUM' }],
      sortConfig: [{ column: 'cost', direction: 'desc' }],
      filterConfig: [{ column: 'paid', operator: 'eq', value: true }],
      dateTruncConfig: [{ column: 'ts', unit: 'MONTH', timeZone: 'UTC' }],
      limit: 5,
    }, 6));
    expect(p.getAll('column')).toEqual(['channel', 'cost']);
    expect(p.get('limit')).toBe('6');
    expect(decode(p.get('aggregation')!)).toEqual([{ column: 'cost', function: 'SUM' }]);
    expect(decode(p.get('sort')!)).toEqual([{ column: 'cost', direction: 'desc' }]);
    expect(decode(p.get('filter')!)).toEqual([{ column: 'paid', operator: 'eq', value: true }]);
    expect(decode(p.get('dateTrunc')!)).toEqual([{ column: 'ts', unit: 'MONTH', timeZone: 'UTC' }]);
  });

  it('omits empty configs and the limit when unset', () => {
    const p = new URLSearchParams(buildHttpDataQuery({ fields: ['a'] }));
    expect(p.getAll('column')).toEqual(['a']);
    expect(p.has('aggregation')).toBe(false);
    expect(p.has('limit')).toBe(false);
  });
});

describe('parseNdjson', () => {
  it('parses one JSON object per non-blank line', () => {
    expect(parseNdjson('{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseNdjson('')).toEqual([]);
  });
});

describe('expectedColumns / needsGrandTotal / grandTotalFromRow', () => {
  const scorecard = { fields: ['revenue'], aggregationConfig: [{ column: 'revenue', function: 'SUM' as const }] };
  const grouped = { fields: ['channel', 'revenue'], aggregationConfig: [{ column: 'revenue', function: 'SUM' as const }] };

  it('renders aggregated fields as their alias', () => {
    expect(expectedColumns(grouped)).toEqual(['channel', 'revenue | SUM']);
  });
  it('flags a scorecard (aggregation, no grouping) but not a grouped query', () => {
    expect(needsGrandTotal(scorecard)).toBe(true);
    expect(needsGrandTotal(grouped)).toBe(false);
    expect(needsGrandTotal({ fields: ['a'] })).toBe(false);
  });
  it('uses the single no-grouping row as the total, dropping Row Count', () => {
    expect(grandTotalFromRow([{ 'revenue | SUM': 1575.93, 'Row Count': 10 }], scorecard)).toEqual({ 'revenue | SUM': 1575.93 });
    expect(grandTotalFromRow([{ channel: 'x', 'revenue | SUM': 5 }], grouped)).toBeNull();
  });
});

describe('rowsToQueryResult', () => {
  const grouped = { fields: ['channel', 'src'], aggregationConfig: [{ column: 'src', function: 'COUNT' as const }] };

  it('maps rows to columns, dropping Row Count and keeping numbers', () => {
    const r = rowsToQueryResult([{ channel: 'Paid', 'src | COUNT': 7, 'Row Count': 7 }], grouped, 10);
    expect(r.columns).toEqual(['channel', 'src | COUNT']);
    expect(r.rows).toEqual([['Paid', 7]]);
    expect(r.rows[0][1]).toBe(7);
    expect(r.truncated).toBe(false);
  });
  it('detects truncation from the over-read row and slices back', () => {
    const objs = ['a', 'b', 'c'].map(c => ({ channel: c, 'src | COUNT': 1 }));
    const r = rowsToQueryResult(objs, grouped, 2);
    expect(r.truncated).toBe(true);
    expect(r.rows.map(row => row[0])).toEqual(['a', 'b']);
  });
  it('passes totals through and falls back to expected columns when empty', () => {
    expect(rowsToQueryResult([], grouped, 10).columns).toEqual(['channel', 'src | COUNT']);
    expect(rowsToQueryResult([{ 'src | COUNT': 1 }], grouped, 10, { 'src | COUNT': 1 }).totals).toEqual({ 'src | COUNT': 1 });
  });
});

describe('shouldKeepPolling', () => {
  it('continues only for PENDING/RUNNING', () => {
    expect(shouldKeepPolling('PENDING')).toBe(true);
    expect(shouldKeepPolling('RUNNING')).toBe(true);
    for (const s of ['SUCCESS', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RESTRICTED', undefined]) {
      expect(shouldKeepPolling(s)).toBe(false);
    }
  });
});
