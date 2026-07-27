import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @owox/api-client so we control the traversal and never hit the network.
const traverseData = vi.fn();
const list = vi.fn();
vi.mock('@owox/api-client', () => ({
  // Vitest v4 constructs mocks via Reflect.construct when invoked with `new`, which requires a
  // constructible implementation — an arrow function throws "is not a constructor" there.
  OWOXApiClient: vi.fn().mockImplementation(function () { return { dataMarts: { list, traverseData } }; }),
}));

import { rawClient, toProxyUrl } from './rawClient';

describe('toProxyUrl', () => {
  it('rewrites any origin to the same-origin /host/owox-raw mount, keeping path + query', () => {
    expect(toProxyUrl('http://localhost/api/data-marts/dm1?x=1'))
      .toBe(`${location.origin}/host/owox-raw/api/data-marts/dm1?x=1`);
  });
});

describe('rawClient', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

  it('traverseData delegates to api-client and flattens rowChunks into rows()', async () => {
    traverseData.mockResolvedValue({
      runId: 'run-1',
      async *rowChunks() { yield [{ a: 1 }]; yield [{ a: 2 }]; },
    });
    const t = await rawClient.traverseData('dm1', { column: ['a'], aggregation: [{ column: 'a', function: 'SUM' }] });
    expect(traverseData).toHaveBeenCalledWith('dm1', { column: ['a'], aggregation: [{ column: 'a', function: 'SUM' }] });
    expect(t.runId).toBe('run-1');
    expect(await t.rows()).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('getById fetches the mart detail through the proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'dm1', schema: { fields: [] } }), { status: 200 }),
    );
    const mart = await rawClient.getById('dm1');
    expect(fetchSpy).toHaveBeenCalledWith(`${location.origin}/host/owox-raw/api/data-marts/dm1`);
    expect(mart).toMatchObject({ id: 'dm1' });
  });

  it('getRun reads totals + sql from the run through the proxy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'SUCCESS', totals: { 'cost | SUM': 9 },
      additionalParams: { httpData: { executionSqlQuery: 'SELECT 1' } },
    }), { status: 200 }));
    const run = await rawClient.getRun('dm1', 'run-1');
    expect(run).toEqual({ status: 'SUCCESS', totals: { 'cost | SUM': 9 }, sql: 'SELECT 1' });
  });

  it('list delegates to api-client', async () => {
    list.mockResolvedValue([{ id: 'dm1', title: 'A' }]);
    expect(await rawClient.list()).toEqual([{ id: 'dm1', title: 'A' }]);
  });
});
