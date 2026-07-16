import { describe, it, expect } from 'vitest';
import {
  AGG_TOKEN,
  aggLabel,
  expectedColumns,
  buildHttpDataQuery,
  ndjsonToQueryResult,
} from './dev-api-shim.mjs';

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
  it('covers every AggregateFunction the plugin can emit', () => {
    expect(Object.keys(AGG_TOKEN).sort()).toEqual(
      ['AVG', 'COUNT', 'COUNT_DISTINCT', 'MAX', 'MIN', 'P25', 'P50', 'P75', 'P95', 'SUM'].sort()
    );
  });
});

describe('expectedColumns', () => {
  it('keeps a dimension raw and renders an aggregated field as its alias', () => {
    const body = {
      fields: ['channel', 'revenue'],
      aggregationConfig: [{ column: 'revenue', function: 'SUM' }],
    };
    expect(expectedColumns(body)).toEqual(['channel', 'revenue | SUM']);
  });
  it('handles a pure-total query (the projected field is itself the metric)', () => {
    const body = { fields: ['source'], aggregationConfig: [{ column: 'source', function: 'COUNT' }] };
    expect(expectedColumns(body)).toEqual(['source | COUNT']);
  });
});

describe('buildHttpDataQuery', () => {
  it('emits repeated column params, base64url configs, and the over-read limit', () => {
    const body = {
      fields: ['channel', 'source'],
      aggregationConfig: [{ column: 'source', function: 'COUNT' }],
      sortConfig: [{ column: 'source', direction: 'desc' }],
      filterConfig: [{ column: 'is_paid', operator: 'eq', value: true }],
      dateTruncConfig: [{ column: 'ts', unit: 'MONTH', timeZone: 'UTC' }],
      limit: 5,
    };
    const p = new URLSearchParams(buildHttpDataQuery(body, 6));
    expect(p.getAll('column')).toEqual(['channel', 'source']);
    expect(p.get('limit')).toBe('6');
    // each config round-trips through base64url back to our compile.ts output verbatim
    const dec = k => JSON.parse(Buffer.from(p.get(k), 'base64url').toString());
    expect(dec('aggregation')).toEqual([{ column: 'source', function: 'COUNT' }]);
    expect(dec('sort')).toEqual([{ column: 'source', direction: 'desc' }]);
    expect(dec('filter')).toEqual([{ column: 'is_paid', operator: 'eq', value: true }]);
    expect(dec('dateTrunc')).toEqual([{ column: 'ts', unit: 'MONTH', timeZone: 'UTC' }]);
  });

  it('omits absent/empty configs and omits limit when null', () => {
    const p = new URLSearchParams(buildHttpDataQuery({ fields: ['a'] }, null));
    expect(p.getAll('column')).toEqual(['a']);
    expect(p.has('aggregation')).toBe(false);
    expect(p.has('sort')).toBe(false);
    expect(p.has('limit')).toBe(false);
  });
});

describe('ndjsonToQueryResult', () => {
  const grouped = {
    fields: ['channel_grouping', 'source'],
    aggregationConfig: [{ column: 'source', function: 'COUNT' }],
  };

  it('maps grouped NDJSON rows to columns/rows, dropping the "Row Count" metadata column', () => {
    const text =
      '{"channel_grouping":"Paid","source | COUNT":7,"Row Count":7}\n' +
      '{"channel_grouping":"Direct","source | COUNT":1,"Row Count":1}\n';
    const r = ndjsonToQueryResult(text, grouped, 10);
    expect(r.columns).toEqual(['channel_grouping', 'source | COUNT']);
    expect(r.rows).toEqual([['Paid', 7], ['Direct', 1]]);
    expect(r.truncated).toBe(false);
    expect(r.totals).toBeNull(); // grouped query has a dimension → no grand total
  });

  it('keeps numeric aggregate values as numbers (JSON, not TSV — no coercion needed)', () => {
    const text = '{"channel_grouping":"Paid","source | COUNT":7,"Row Count":7}\n';
    const r = ndjsonToQueryResult(text, grouped, 10);
    expect(r.rows[0][1]).toBe(7);
    expect(typeof r.rows[0][1]).toBe('number');
  });

  it('reports truncated and slices to the asked limit when the server returns the over-read row', () => {
    const text = ['a', 'b', 'c'].map(c => `{"channel_grouping":"${c}","source | COUNT":1,"Row Count":1}`).join('\n');
    const r = ndjsonToQueryResult(text, grouped, 2); // asked 2, server returned 3 (the +1 over-read)
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.map(row => row[0])).toEqual(['a', 'b']);
  });

  it('builds totals for a grand-total query (aggregation, no grouping dimension)', () => {
    const body = { fields: ['source'], aggregationConfig: [{ column: 'source', function: 'COUNT' }] };
    const r = ndjsonToQueryResult('{"source | COUNT":10,"Row Count":10}\n', body, 20);
    expect(r.totals).toEqual({ 'source | COUNT': 10 }); // the scorecard reads this
  });

  it('falls back to the plugin-expected column names when the result is empty', () => {
    const r = ndjsonToQueryResult('', grouped, 10);
    expect(r.columns).toEqual(['channel_grouping', 'source | COUNT']);
    expect(r.rows).toEqual([]);
    expect(r.truncated).toBe(false);
  });
});
