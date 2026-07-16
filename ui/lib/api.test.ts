import { describe, it, expect, vi, beforeEach } from 'vitest';
import { owox } from '@owox/plugin-sdk';
import { listMarts, getMartFields, queryDataMart } from './api';

describe('api', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('queryDataMart GETs the HTTP Data stream with encoded configs, over-reading by one', async () => {
    const spy = vi.spyOn(owox, 'requestWithHeaders').mockResolvedValue({
      headers: {},
      body: '{"channel":"Paid","cost | SUM":7,"Row Count":7}\n{"channel":"Direct","cost | SUM":1,"Row Count":1}\n',
    });

    const out = await queryDataMart('dm1', {
      fields: ['channel', 'cost'],
      aggregationConfig: [{ column: 'cost', function: 'SUM' }],
      sortConfig: [{ column: 'cost', direction: 'desc' }],
      limit: 2,
    });

    expect(spy).toHaveBeenCalledOnce();
    const [method, path] = spy.mock.calls[0];
    expect(method).toBe('GET');
    const url = new URL(path, 'http://x');
    expect(url.pathname).toBe('/api/external/http-data/data-marts/dm1.ndjson');
    expect(url.searchParams.getAll('column')).toEqual(['channel', 'cost']);
    expect(url.searchParams.get('limit')).toBe('3'); // asked 2, over-read by one
    expect(JSON.parse(atob(url.searchParams.get('aggregation')!.replace(/-/g, '+').replace(/_/g, '/'))))
      .toEqual([{ column: 'cost', function: 'SUM' }]);
    // aggregated alias dropped "Row Count"; values stay numeric
    expect(out.columns).toEqual(['channel', 'cost | SUM']);
    expect(out.rows).toEqual([['Paid', 7], ['Direct', 1]]);
    expect(out.totals).toBeNull(); // grouped -> no grand total
  });

  it('queryDataMart fetches scorecard totals via x-owox-run-id', async () => {
    vi.spyOn(owox, 'requestWithHeaders').mockResolvedValue({
      headers: { 'x-owox-run-id': 'run-9' },
      body: '{"cost | SUM":42,"Row Count":3}\n',
    });
    const reqSpy = vi.spyOn(owox, 'request').mockResolvedValue({ status: 'SUCCESS', totals: { 'cost | SUM': 42, 'cost | AVG': 14 } });

    const out = await queryDataMart('dm1', {
      fields: ['cost'],
      aggregationConfig: [{ column: 'cost', function: 'SUM' }],
      limit: 1,
    });

    expect(reqSpy).toHaveBeenCalledWith('GET', '/api/data-marts/dm1/runs/run-9');
    expect(out.totals).toEqual({ 'cost | SUM': 42, 'cost | AVG': 14 });
  });

  it('queryDataMart falls back to the single streamed row when the run yields no totals', async () => {
    vi.spyOn(owox, 'requestWithHeaders').mockResolvedValue({
      headers: { 'x-owox-run-id': 'run-9' },
      body: '{"cost | SUM":42,"Row Count":3}\n',
    });
    vi.spyOn(owox, 'request').mockResolvedValue({ status: 'SUCCESS', totals: null });

    const out = await queryDataMart('dm1', {
      fields: ['cost'],
      aggregationConfig: [{ column: 'cost', function: 'SUM' }],
      limit: 1,
    });

    expect(out.totals).toEqual({ 'cost | SUM': 42 });
  });

  it('listMarts keeps only published, reportable marts', async () => {
    const spy = vi.spyOn(owox, 'request').mockResolvedValue([
      { id: '1', title: 'A', status: 'PUBLISHED', availableForReporting: true },
      { id: '2', title: 'B', status: 'DRAFT', availableForReporting: true },
      { id: '3', title: 'C', status: 'PUBLISHED', availableForReporting: false },
    ]);
    const result = await listMarts();
    expect(spy).toHaveBeenCalledWith('GET', '/api/data-marts');
    expect(result).toEqual([{ id: '1', title: 'A' }]);
  });

  it('listMarts unwraps an { items } envelope', async () => {
    const spy = vi.spyOn(owox, 'request').mockResolvedValue({
      items: [{ id: '1', title: 'A', status: 'PUBLISHED', availableForReporting: true }],
    });
    const result = await listMarts();
    expect(spy).toHaveBeenCalledWith('GET', '/api/data-marts');
    expect(result).toEqual([{ id: '1', title: 'A' }]);
  });

  it('getMartFields maps schema fields to roles and allowed aggregations', async () => {
    const spy = vi.spyOn(owox, 'request').mockResolvedValue({
      schema: {
        fields: [
          { name: 'Date', type: 'DATE', aggregationRole: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
          { name: 'Cost', type: 'FLOAT', aggregationRole: 'metric', allowedAggregations: ['SUM', 'AVG'] },
          { name: 'Src', type: 'STRING' },
        ],
      },
    });
    const result = await getMartFields('dm1');
    expect(spy).toHaveBeenCalledWith('GET', '/api/data-marts/dm1');
    expect(result).toEqual([
      { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
      { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM', 'AVG'] },
      // Falls back by type when the schema omits governance: string -> dimension.
      { name: 'Src', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
    ]);
  });
});
