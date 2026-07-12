import { describe, it, expect, vi } from 'vitest';
import { collections } from '@owox/plugin-sdk';
import { saveDashboard, duplicateDashboard, listDashboards, deleteDashboard, getDashboard } from './dashboards';
import { emptyDashboard } from './types';

// Automock the SDK module: `collections` is a plain exported function in ui/sdk-mock.ts, so Vitest
// replaces it with a vi.fn() whose return value each test controls via mockReturnValue.
vi.mock('@owox/plugin-sdk');

describe('dashboards', () => {
  it('saveDashboard bumps configVersion and keeps the $entity mart binding', async () => {
    const put = vi.fn().mockImplementation((_id, doc) => Promise.resolve(doc));
    vi.mocked(collections).mockReturnValue({ put } as never);

    const d = { ...emptyDashboard('d1', 'mart1', 'A'), configVersion: 3 };
    const saved = await saveDashboard(d);

    expect(collections).toHaveBeenCalledWith('dashboards');
    expect(put).toHaveBeenCalledWith('d1', expect.objectContaining({
      id: 'd1',
      $entity: { type: 'data-mart', id: 'mart1' },
      configVersion: 4,
    }));
    expect(saved.configVersion).toBe(4);
  });

  it('duplicateDashboard produces a new id and a copied name', async () => {
    const put = vi.fn().mockImplementation((_id, doc) => Promise.resolve(doc));
    vi.mocked(collections).mockReturnValue({ put } as never);

    const source = emptyDashboard('d1', 'mart1', 'Sales');
    const copy = await duplicateDashboard(source);

    expect(copy.id).not.toBe('d1');
    expect(copy.name).toBe('Sales (copy)');
    expect(copy.$entity).toEqual({ type: 'data-mart', id: 'mart1' });
  });

  it('duplicateDashboard never sends host-owned $-prefixed fields from source dashboard on a write', async () => {
    const put = vi.fn().mockImplementation((_id, doc) => Promise.resolve(doc));
    vi.mocked(collections).mockReturnValue({ put } as never);

    const source = {
      ...emptyDashboard('d1', 'mart1', 'Sales'),
      $createdAt: '2020-01-01T00:00:00Z',
      $updatedAt: '2020-01-02T00:00:00Z',
    };
    await duplicateDashboard(source);

    const [, sentDoc] = put.mock.calls[0];
    expect(sentDoc.$createdAt).toBeUndefined();
    expect(sentDoc.$updatedAt).toBeUndefined();
    expect('$createdBy' in sentDoc).toBe(false);
  });

  it('listDashboards returns whatever the host made visible', async () => {
    const list = vi.fn().mockResolvedValue([emptyDashboard('d1', 'm1', 'A')]);
    vi.mocked(collections).mockReturnValue({ list } as never);
    expect(await listDashboards()).toHaveLength(1);
  });

  it('deleteDashboard calls delete on the collection with the given id', async () => {
    const del = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(collections).mockReturnValue({ delete: del } as never);

    await deleteDashboard('d1');

    expect(del).toHaveBeenCalledWith('d1');
  });

  it('getDashboard returns null when the host has no such doc', async () => {
    const get = vi.fn().mockResolvedValue(null);
    vi.mocked(collections).mockReturnValue({ get } as never);

    expect(await getDashboard('missing')).toBeNull();
    expect(get).toHaveBeenCalledWith('missing');
  });

  it('saveDashboard never sends host-owned $-prefixed fields back on a write', async () => {
    const put = vi.fn().mockImplementation((_id, doc) => Promise.resolve(doc));
    vi.mocked(collections).mockReturnValue({ put } as never);

    const d = {
      ...emptyDashboard('d1', 'mart1', 'A'),
      $createdAt: '2020-01-01T00:00:00Z',
      $updatedAt: '2020-01-02T00:00:00Z',
    };
    await saveDashboard(d);

    const [, sentDoc] = put.mock.calls[0];
    expect(sentDoc.$createdAt).toBeUndefined();
    expect(sentDoc.$updatedAt).toBeUndefined();
    expect('$createdBy' in sentDoc).toBe(false);
  });
});
