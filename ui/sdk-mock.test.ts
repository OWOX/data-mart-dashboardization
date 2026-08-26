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

  it('serves sample marts with a schema so the generator has something to build on', async () => {
    const ctx = await connect();
    const marts = await ctx.owox.dataMarts.list();

    expect(marts.length).toBeGreaterThan(0);
    expect(marts[0]).toMatchObject({ status: 'PUBLISHED', availableForReporting: true });

    const detail = await ctx.owox.getJson<{ schema: { fields: { name: string }[] } }>(
      `/api/data-marts/${marts[0].id}`,
    );
    expect(detail.schema.fields.map(f => f.name)).toContain('sessions');
  });

  it('groups, labels and orders rows the way the query service does', async () => {
    const ctx = await connect();
    const traversal = await ctx.owox.dataMarts.traverseData('sample-web-traffic', {
      column: ['channel', 'sessions'],
      aggregation: [{ column: 'sessions', function: 'SUM' }],
      sort: [{ column: 'sessions', direction: 'desc' }],
      limit: 3,
    });

    const rows: Record<string, unknown>[] = [];
    for await (const chunk of traversal.rowChunks()) rows.push(...chunk);

    expect(rows).toHaveLength(3);
    // Grouping keys are distinct — a repeated category would mean no GROUP BY happened.
    expect(new Set(rows.map(r => r.channel)).size).toBe(3);
    const values = rows.map(r => r['sessions | SUM'] as number);
    expect(values.every(v => typeof v === 'number')).toBe(true);
    expect([...values].sort((a, b) => b - a)).toEqual(values); // ORDER BY ran before LIMIT
  });

  it('reports a scorecard grand total on the run, not in the rows', async () => {
    const ctx = await connect();
    const traversal = await ctx.owox.dataMarts.traverseData('sample-orders', {
      column: ['orders'],
      aggregation: [{ column: 'orders', function: 'SUM' }],
      limit: 1,
    });

    const run = await ctx.owox.runs.forDataMart('sample-orders').get(traversal.runId);

    expect(run.status).toBe('SUCCESS');
    expect(run.totals?.['orders | SUM']).toBeTypeOf('number');
  });

  it('folds the date domain into the requested bucket', async () => {
    const ctx = await connect();
    const traversal = await ctx.owox.dataMarts.traverseData('sample-web-traffic', {
      column: ['date', 'sessions'],
      aggregation: [{ column: 'sessions', function: 'SUM' }],
      dateTrunc: [{ column: 'date', unit: 'MONTH' }],
      limit: 1000,
    });

    const rows: Record<string, unknown>[] = [];
    for await (const chunk of traversal.rowChunks()) rows.push(...chunk);

    // The 90-day window spans 3 months, so a MONTH bucket must yield 3 groups, not 90.
    expect(rows).toHaveLength(3);
    expect(rows.every(r => String(r.date).endsWith('-01'))).toBe(true);
  });

  it('returns null for a missing document and delete resolves void', async () => {
    const db = (await connect()).collections('dashboard-missing-test');
    await expect(db.get('missing')).resolves.toBeNull();
    await expect(db.delete('missing')).resolves.toBeUndefined();
  });
});
