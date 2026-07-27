import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rawClient } from './rawClient';
import { listMarts, getMartFields, queryDataMart } from './api';

describe('api', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('queryDataMart traverses via the typed client with the configs, over-reading by one', async () => {
    const spy = vi.spyOn(rawClient, 'traverseData').mockResolvedValue({
      runId: undefined,
      rows: async () => [
        { channel: 'Paid', 'cost | SUM': 7, 'Row Count': 7 },
        { channel: 'Direct', 'cost | SUM': 1, 'Row Count': 1 },
      ],
    } as any);

    const out = await queryDataMart('dm1', {
      fields: ['channel', 'cost'],
      aggregationConfig: [{ column: 'cost', function: 'SUM' }],
      sortConfig: [{ column: 'cost', direction: 'desc' }],
      limit: 2,
    });

    expect(spy).toHaveBeenCalledOnce();
    const [id, opts] = spy.mock.calls[0];
    expect(id).toBe('dm1');
    expect(opts).toEqual({
      column: ['channel', 'cost'],
      aggregation: [{ column: 'cost', function: 'SUM' }],
      dateTrunc: undefined,
      filter: undefined,
      sort: [{ column: 'cost', direction: 'desc' }],
      limit: 3, // asked 2, over-read by one
    });
    // aggregated alias dropped "Row Count"; values stay numeric
    expect(out.columns).toEqual(['channel', 'cost | SUM']);
    expect(out.rows).toEqual([['Paid', 7], ['Direct', 1]]);
    expect(out.totals).toBeNull(); // grouped -> no grand total
  });

  it('queryDataMart fetches scorecard totals via the run id (getRun)', async () => {
    vi.spyOn(rawClient, 'traverseData').mockResolvedValue({
      runId: 'run-9',
      rows: async () => [{ 'cost | SUM': 42, 'Row Count': 3 }],
    } as any);
    const runSpy = vi.spyOn(rawClient, 'getRun').mockResolvedValue({ status: 'SUCCESS', totals: { 'cost | SUM': 42, 'cost | AVG': 14 }, sql: null });

    const out = await queryDataMart('dm1', {
      fields: ['cost'],
      aggregationConfig: [{ column: 'cost', function: 'SUM' }],
      limit: 1,
    });

    expect(runSpy).toHaveBeenCalledWith('dm1', 'run-9');
    expect(out.totals).toEqual({ 'cost | SUM': 42, 'cost | AVG': 14 });
  });

  it('queryDataMart returns null totals when the run reports none — no client-side fallback', async () => {
    // Strict getRunById-only: even though the streamed row carries the aggregate, totals come ONLY
    // from the run. A run with null totals ⇒ null totals (scorecard shows its empty state).
    vi.spyOn(rawClient, 'traverseData').mockResolvedValue({
      runId: 'run-9',
      rows: async () => [{ 'cost | SUM': 42, 'Row Count': 3 }],
    } as any);
    vi.spyOn(rawClient, 'getRun').mockResolvedValue({ status: 'SUCCESS', totals: null, sql: null });

    const out = await queryDataMart('dm1', {
      fields: ['cost'],
      aggregationConfig: [{ column: 'cost', function: 'SUM' }],
      limit: 1,
    });

    expect(out.totals).toBeNull();
  });

  it('listMarts keeps only published, reportable marts', async () => {
    const spy = vi.spyOn(rawClient, 'list').mockResolvedValue([
      { id: '1', title: 'A', status: 'PUBLISHED', availableForReporting: true },
      { id: '2', title: 'B', status: 'DRAFT', availableForReporting: true },
      { id: '3', title: 'C', status: 'PUBLISHED', availableForReporting: false },
    ] as any);
    const result = await listMarts();
    expect(spy).toHaveBeenCalledOnce();
    expect(result).toEqual([{ id: '1', title: 'A' }]);
  });

  it('getMartFields maps schema fields to roles and allowed aggregations, dropping hidden ones', async () => {
    const spy = vi.spyOn(rawClient, 'getById').mockResolvedValue({
      schema: {
        fields: [
          { name: 'Date', type: 'DATE', aggregationRole: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
          { name: 'Cost', type: 'FLOAT', aggregationRole: 'metric', allowedAggregations: ['SUM', 'AVG'] },
          { name: 'Src', type: 'STRING' },
          // Hidden-for-reporting fields 400 on the HTTP Data endpoint, so they must be dropped.
          { name: 'pk_id', type: 'INTEGER', isHiddenForReporting: true },
        ],
      },
    } as any);
    const result = await getMartFields('dm1');
    expect(spy).toHaveBeenCalledWith('dm1');
    expect(result).toEqual([
      { name: 'Date', type: 'DATE', role: 'dimension', allowedAggregations: ['MIN', 'MAX'] },
      { name: 'Cost', type: 'FLOAT', role: 'metric', allowedAggregations: ['SUM', 'AVG'] },
      // Falls back by type when the schema omits governance: string -> dimension.
      { name: 'Src', type: 'STRING', role: 'dimension', allowedAggregations: ['COUNT', 'COUNT_DISTINCT'] },
    ]);
  });
});
