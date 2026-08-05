import { describe, expect, it } from 'vitest';
import { connect } from './sdk-mock';

describe('sdk-mock', () => {
  it('exposes capabilities through connect() like the real SDK', async () => {
    const ctx = await connect();
    expect(ctx.owox).toBeDefined();
    expect(ctx.collections).toBeTypeOf('function');
  });

  it('stores collection envelopes with parent metadata', async () => {
    const ctx = await connect();
    const db = ctx.collections<{ name: string }>('dashboard-envelope-test');

    const saved = await db.put('d1', { name: 'A' }, { parentId: 'mart-1' });

    expect(saved).toMatchObject({
      id: 'd1',
      parentId: 'mart-1',
      document: { name: 'A' },
    });
    expect(saved.createdAt).toBeTruthy();
    await expect(db.get('d1')).resolves.toEqual(saved);
  });

  it('paginates list() using the collection cursor contract', async () => {
    const db = (await connect()).collections<{ order: number }>('dashboard-pagination-test');
    await db.put('a', { order: 1 });
    await db.put('b', { order: 2 });

    const first = await db.list({ limit: 1 });
    const second = await db.list({ limit: 1, cursor: first.nextCursor! });

    expect(first.items.map(item => item.id)).toEqual(['a']);
    expect(second.items.map(item => item.id)).toEqual(['b']);
    expect(second.nextCursor).toBeNull();
  });

  it('returns null for a missing document and delete resolves void', async () => {
    const db = (await connect()).collections('dashboard-missing-test');
    await expect(db.get('missing')).resolves.toBeNull();
    await expect(db.delete('missing')).resolves.toBeUndefined();
  });
});
