import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from './plugin-runtime';
import { pluginClient } from './plugin-client';

const list = vi.fn();
const getJson = vi.fn();
const traverseData = vi.fn();
const getRun = vi.fn();
const forDataMart = vi.fn(() => ({ get: getRun }));

describe('pluginClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    list.mockReset();
    getJson.mockReset();
    traverseData.mockReset();
    getRun.mockReset();
    forDataMart.mockClear();
    vi.spyOn(runtime, 'getPluginContext').mockResolvedValue({
      owox: { getJson, dataMarts: { list, traverseData }, runs: { forDataMart } },
    } as never);
  });

  it('flattens SDK traversal chunks into the dashboard rows shape', async () => {
    traverseData.mockResolvedValue({
      runId: 'run-1',
      async *rowChunks() {
        yield [{ a: 1 }];
        yield [{ a: 2 }];
      },
    });

    const traversal = await pluginClient.traverseData('dm1', {
      column: ['a'],
      aggregation: [{ column: 'a', function: 'SUM' }],
    });

    expect(traverseData).toHaveBeenCalledWith('dm1', {
      column: ['a'],
      aggregation: [{ column: 'a', function: 'SUM' }],
    });
    expect(traversal.runId).toBe('run-1');
    expect(await traversal.rows()).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('gets Data Mart details through the host-owned SDK client', async () => {
    getJson.mockResolvedValue({ id: 'dm1', schema: { fields: [] } });

    await expect(pluginClient.getById('dm1')).resolves.toMatchObject({ id: 'dm1' });
    expect(getJson).toHaveBeenCalledWith('/api/data-marts/dm1');
  });

  it('gets run totals through the SDK runs facade, not a raw path', async () => {
    getRun.mockResolvedValue({
      status: 'SUCCESS',
      totals: { 'cost | SUM': 9 },
      additionalParams: { httpData: { executionSqlQuery: 'SELECT 1' } },
    });

    await expect(pluginClient.getRun('dm1', 'run-1')).resolves.toEqual({
      status: 'SUCCESS',
      totals: { 'cost | SUM': 9 },
      sql: 'SELECT 1',
    });
    expect(forDataMart).toHaveBeenCalledWith('dm1');
    expect(getRun).toHaveBeenCalledWith('run-1');
    expect(getJson).not.toHaveBeenCalled();
  });

  it('lists Data Marts through ctx.owox', async () => {
    list.mockResolvedValue([{ id: 'dm1', title: 'A' }]);
    await expect(pluginClient.list()).resolves.toEqual([{ id: 'dm1', title: 'A' }]);
  });
});
