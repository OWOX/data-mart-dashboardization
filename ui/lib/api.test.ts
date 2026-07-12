import { describe, it, expect, vi, beforeEach } from 'vitest';
import { owox } from '@owox/plugin-sdk';
import { listMarts, getMartFields, queryDataMart } from './api';

describe('api', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('queryDataMart POSTs to the query endpoint and returns the result', async () => {
    const result = { columns: ['a'], rows: [[1]], truncated: false, totals: null };
    const spy = vi.spyOn(owox, 'request').mockResolvedValue(result);

    const out = await queryDataMart('dm1', { fields: ['a'], limit: 10 });

    expect(spy).toHaveBeenCalledWith('POST', '/api/data-marts/dm1/query', { fields: ['a'], limit: 10 });
    expect(out).toEqual(result);
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
