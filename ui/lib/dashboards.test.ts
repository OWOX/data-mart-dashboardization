import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPluginContext } from './plugin-runtime';
import {
  deleteDashboard,
  duplicateDashboard,
  getDashboard,
  listDashboards,
  saveDashboard,
} from './dashboards';
import { emptyDashboard } from './types';

vi.mock('./plugin-runtime');

const collections = vi.fn();

function envelope(id: string, parentId: string, document: Record<string, unknown>) {
  return {
    id,
    parentId,
    document,
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T11:00:00.000Z',
  };
}

describe('dashboards collection adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPluginContext).mockResolvedValue({ collections } as never);
  });

  it('saves only the document body and maps $entity to parentId', async () => {
    const put = vi.fn().mockImplementation((id, document, options) =>
      Promise.resolve(envelope(id, options.parentId, document)),
    );
    collections.mockReturnValue({ put });
    const dashboard = { ...emptyDashboard('d1', 'mart1', 'A'), configVersion: 3 };

    const saved = await saveDashboard(dashboard);

    expect(collections).toHaveBeenCalledWith('dashboards');
    expect(put).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ name: 'A', configVersion: 4 }),
      { parentId: 'mart1' },
    );
    const [, sentDocument] = put.mock.calls[0];
    expect(sentDocument).not.toHaveProperty('id');
    expect(sentDocument).not.toHaveProperty('$entity');
    expect(saved).toMatchObject({
      id: 'd1',
      $entity: { type: 'data-mart', id: 'mart1' },
      configVersion: 4,
      $createdAt: '2026-08-05T10:00:00.000Z',
      $updatedAt: '2026-08-05T11:00:00.000Z',
    });
  });

  it('never stores timestamps owned by the host envelope', async () => {
    const put = vi.fn().mockImplementation((id, document, options) =>
      Promise.resolve(envelope(id, options.parentId, document)),
    );
    collections.mockReturnValue({ put });
    const dashboard = {
      ...emptyDashboard('d1', 'mart1', 'A'),
      $createdAt: 'old-created',
      $updatedAt: 'old-updated',
    };

    await saveDashboard(dashboard);

    const [, sentDocument] = put.mock.calls[0];
    expect(sentDocument).not.toHaveProperty('$createdAt');
    expect(sentDocument).not.toHaveProperty('$updatedAt');
  });

  it('duplicates through the same parent-bound collection mapping', async () => {
    const put = vi.fn().mockImplementation((id, document, options) =>
      Promise.resolve(envelope(id, options.parentId, document)),
    );
    collections.mockReturnValue({ put });

    const copy = await duplicateDashboard(emptyDashboard('d1', 'mart1', 'Sales'));

    expect(copy.id).not.toBe('d1');
    expect(copy.name).toBe('Sales (copy)');
    expect(copy.$entity).toEqual({ type: 'data-mart', id: 'mart1' });
    expect(put).toHaveBeenCalledWith(
      copy.id,
      expect.objectContaining({ name: 'Sales (copy)', configVersion: 0 }),
      { parentId: 'mart1' },
    );
  });

  it('loads every collection page and rebuilds the existing Dashboard model', async () => {
    const firstDocument = { ...emptyDashboard('ignored', 'ignored', 'A') } as Record<string, unknown>;
    delete firstDocument.id;
    delete firstDocument.$entity;
    const secondDocument = { ...firstDocument, name: 'B' };
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        items: [envelope('d1', 'mart1', firstDocument)],
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({
        items: [envelope('d2', 'mart2', secondDocument)],
        nextCursor: null,
      });
    collections.mockReturnValue({ list });

    const result = await listDashboards();

    expect(list).toHaveBeenNthCalledWith(1, { limit: 100 });
    expect(list).toHaveBeenNthCalledWith(2, { limit: 100, cursor: 'next' });
    expect(result).toEqual([
      expect.objectContaining({ id: 'd1', name: 'A', $entity: { type: 'data-mart', id: 'mart1' } }),
      expect.objectContaining({ id: 'd2', name: 'B', $entity: { type: 'data-mart', id: 'mart2' } }),
    ]);
  });

  it('rejects a dashboard envelope without the required Data Mart binding', async () => {
    const document = { ...emptyDashboard('ignored', 'ignored', 'A') } as Record<string, unknown>;
    delete document.id;
    delete document.$entity;
    collections.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        ...envelope('d1', 'unused', document),
        parentId: undefined,
      }),
    });

    await expect(getDashboard('d1')).rejects.toThrow('has no Data Mart binding');
  });

  it('returns null for a missing dashboard', async () => {
    const get = vi.fn().mockResolvedValue(null);
    collections.mockReturnValue({ get });
    await expect(getDashboard('missing')).resolves.toBeNull();
    expect(get).toHaveBeenCalledWith('missing');
  });

  it('deletes through the collection client', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    collections.mockReturnValue({ delete: del });
    await deleteDashboard('d1');
    expect(del).toHaveBeenCalledWith('d1');
  });
});
