import { describe, it, expect } from 'vitest';
import { compile, aggLabel } from './compile';
import type { Component, FilterRule, QueryRequest } from './types';

const filters: FilterRule[] = [{ column: 'country', operator: 'eq', value: 'US' }];
const slices: FilterRule[] = [{ column: 'date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 } }];
const base = { id: 'c1', title: 'T', width: 1, height: 1 };

describe('aggLabel', () => {
  it('matches the backend label format', () => {
    expect(aggLabel('revenue', 'SUM')).toBe('revenue | SUM');
  });
  it('maps P50 to MEDIAN like the backend does', () => {
    expect(aggLabel('x', 'P50')).toBe('x | MEDIAN');
  });
});

describe('compile', () => {
  it('merges global filters (post-join) and slices (pre-join) into one filterConfig', () => {
    const c: Component = { ...base, type: 'scorecard', config: { metric: 'revenue', aggregation: 'SUM' } };
    const q = compile(c, filters, slices);
    expect(q.filterConfig).toEqual([
      { column: 'country', operator: 'eq', value: 'US', placement: 'post-join' },
      { column: 'date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 }, placement: 'pre-join' },
    ]);
  });

  it('scorecard: projects only the metric and aggregates it', () => {
    const c: Component = { ...base, type: 'scorecard', config: { metric: 'revenue', aggregation: 'SUM' } };
    const q = compile(c, [], []);
    expect(q.fields).toEqual(['revenue']);
    expect(q.aggregationConfig).toEqual([{ column: 'revenue', function: 'SUM' }]);
    expect(q.limit).toBe(1);
  });

  it('timeseries: buckets the date field and aggregates the metric', () => {
    const c: Component = {
      ...base, type: 'timeseries',
      config: { dateField: 'date', metric: 'cost', aggregation: 'SUM', unit: 'MONTH' },
    };
    const q = compile(c, [], []);
    expect(q.fields).toEqual(['date', 'cost']);
    expect(q.aggregationConfig).toEqual([{ column: 'cost', function: 'SUM' }]);
    expect(q.dateTruncConfig).toEqual([{ column: 'date', unit: 'MONTH' }]);
  });

  it('timeseries: includes the breakdown as an extra grouping key', () => {
    const c: Component = {
      ...base, type: 'timeseries',
      config: { dateField: 'date', metric: 'cost', aggregation: 'SUM', unit: 'DAY', breakdown: 'source' },
    };
    expect(compile(c, [], []).fields).toEqual(['date', 'cost', 'source']);
  });

  it('bar: groups by the dimension and honours the limit', () => {
    const c: Component = {
      ...base, type: 'bar',
      config: { dimension: 'source', metric: 'cost', aggregation: 'SUM', orientation: 'vertical', limit: 10 },
    };
    const q = compile(c, [], []);
    expect(q.fields).toEqual(['source', 'cost']);
    expect(q.aggregationConfig).toEqual([{ column: 'cost', function: 'SUM' }]);
    expect(q.limit).toBe(10);
    expect(q.dateTruncConfig).toBeNull();
  });

  it('pie: limits to maxCategories', () => {
    const c: Component = {
      ...base, type: 'pie',
      config: { dimension: 'country', metric: 'cost', aggregation: 'SUM', maxCategories: 6 },
    };
    expect(compile(c, [], []).limit).toBe(6);
  });

  it('table: projects the columns with NO aggregation (raw rows)', () => {
    const c: Component = {
      ...base, type: 'table',
      config: { columns: ['date', 'source', 'cost'], limit: 100 },
    };
    const q = compile(c, [], []);
    expect(q.fields).toEqual(['date', 'source', 'cost']);
    expect(q.aggregationConfig).toBeNull();   // no aggregations => no GROUP BY => raw rows
    expect(q.limit).toBe(100);
  });

  it('clamps limit to the service maximum of 1000', () => {
    const c: Component = { ...base, type: 'table', config: { columns: ['a'], limit: 99999 } };
    expect(compile(c, [], []).limit).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Adversarial cases beyond the brief. Anything the query service would REJECT,
// or any number the client would have to compute itself, is a bug here.
// ---------------------------------------------------------------------------

/** Every component shape, so invariants can be asserted across all of them. */
const allComponents: Component[] = [
  { ...base, type: 'scorecard', config: { metric: 'revenue', aggregation: 'P50' } },
  { ...base, type: 'timeseries', config: { dateField: 'date', metric: 'cost', aggregation: 'AVG', unit: 'DAY' } },
  { ...base, type: 'timeseries', config: { dateField: 'date', metric: 'cost', aggregation: 'SUM', unit: 'WEEK', breakdown: 'source' } },
  { ...base, type: 'bar', config: { dimension: 'source', metric: 'cost', aggregation: 'SUM', orientation: 'horizontal', limit: 25 } },
  { ...base, type: 'pie', config: { dimension: 'country', metric: 'cost', aggregation: 'SUM', maxCategories: 8 } },
  { ...base, type: 'donut', config: { dimension: 'country', metric: 'cost', aggregation: 'SUM', maxCategories: 8 } },
  { ...base, type: 'table', config: { columns: ['date', 'cost'], limit: 50 } },
];

describe('compile: service-limit invariants (violating these = REJECTED query)', () => {
  it.each(allComponents.map(c => [c.type, c] as const))(
    '%s: emits a limit within 1..1000 and no pagination/offset',
    (_type, c) => {
      const q = compile(c, filters, slices) as QueryRequest & Record<string, unknown>;
      expect(q.limit).toBeGreaterThanOrEqual(1);
      expect(q.limit).toBeLessThanOrEqual(1000);
      expect(Number.isInteger(q.limit)).toBe(true);
      expect(q).not.toHaveProperty('offset');
      expect(q).not.toHaveProperty('page');
    },
  );

  it.each(allComponents.map(c => [c.type, c] as const))(
    '%s: never emits an HOUR date bucket (DAY is the finest grain)',
    (_type, c) => {
      for (const rule of compile(c, [], []).dateTruncConfig ?? []) {
        expect(rule.unit).not.toBe('HOUR');
        expect(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']).toContain(rule.unit);
      }
    },
  );

  it.each(allComponents.map(c => [c.type, c] as const))(
    '%s: every aggregated/bucketed column is also projected in fields',
    (_type, c) => {
      const q = compile(c, [], []);
      for (const a of q.aggregationConfig ?? []) expect(q.fields).toContain(a.column);
      for (const d of q.dateTruncConfig ?? []) expect(q.fields).toContain(d.column);
    },
  );

  it.each(allComponents.map(c => [c.type, c] as const))(
    '%s: projects no duplicate fields (a dup column would break the group-by)',
    (_type, c) => {
      const { fields } = compile(c, [], []);
      expect(new Set(fields).size).toBe(fields.length);
    },
  );

  it('timeseries never asks for more than the 1000-row maximum', () => {
    const c: Component = {
      ...base, type: 'timeseries',
      config: { dateField: 'date', metric: 'cost', aggregation: 'SUM', unit: 'DAY' },
    };
    expect(compile(c, [], []).limit).toBe(1000);
  });
});

describe('compile: limit clamping', () => {
  const withLimit = (limit: number): Component =>
    ({ ...base, type: 'table', config: { columns: ['a'], limit } });

  it('keeps a limit sitting exactly on the 1000 boundary', () => {
    expect(compile(withLimit(1000), [], []).limit).toBe(1000);
  });
  it('rejects 1001 down to 1000', () => {
    expect(compile(withLimit(1001), [], []).limit).toBe(1000);
  });
  it('raises 0 to the minimum of 1 (a limit of 0 is rejected by the service)', () => {
    expect(compile(withLimit(0), [], []).limit).toBe(1);
  });
  it('raises a negative limit to 1', () => {
    expect(compile(withLimit(-5), [], []).limit).toBe(1);
  });
  it('truncates a fractional limit to an integer', () => {
    expect(compile(withLimit(10.7), [], []).limit).toBe(10);
  });
  it('falls back to the maximum when the stored limit is missing or not a number', () => {
    // A hand-edited / older dashboard doc can carry a missing limit. NaN would serialise to
    // `null` and be rejected, so it must never reach the wire.
    const c = { ...base, type: 'table', config: { columns: ['a'] } } as unknown as Component;
    expect(compile(c, [], []).limit).toBe(1000);
    expect(compile(withLimit(NaN), [], []).limit).toBe(1000);
  });
});

describe('compile: filters', () => {
  const scorecard: Component = { ...base, type: 'scorecard', config: { metric: 'revenue', aggregation: 'SUM' } };

  it('emits null (not []) when there are no filters and no slices', () => {
    expect(compile(scorecard, [], []).filterConfig).toBeNull();
  });

  it('applies the same global filters to every component type', () => {
    for (const c of allComponents) {
      expect(compile(c, filters, slices).filterConfig).toHaveLength(2);
    }
  });

  it('keeps both rules when a filter and a slice collide on the same column', () => {
    const sameColumnFilter: FilterRule[] = [{ column: 'date', operator: 'gte', value: '2026-01-01' }];
    const q = compile(scorecard, sameColumnFilter, slices);
    expect(q.filterConfig).toEqual([
      { column: 'date', operator: 'gte', value: '2026-01-01', placement: 'post-join' },
      { column: 'date', operator: 'relative_date', value: { kind: 'last_n_days', n: 30 }, placement: 'pre-join' },
    ]);
  });

  it('overrides any placement already present on the incoming rule', () => {
    const mislabelled: FilterRule[] = [{ column: 'country', operator: 'eq', value: 'US', placement: 'pre-join' }];
    const q = compile(scorecard, mislabelled, []);
    expect(q.filterConfig?.[0].placement).toBe('post-join');
  });

  it('does not mutate the caller\'s filter or slice arrays', () => {
    const f: FilterRule[] = [{ column: 'country', operator: 'eq', value: 'US' }];
    const s: FilterRule[] = [{ column: 'date', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } }];
    compile(scorecard, f, s);
    expect(f).toEqual([{ column: 'country', operator: 'eq', value: 'US' }]);
    expect(s).toEqual([{ column: 'date', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } }]);
  });

  it('passes filter values through verbatim, inventing no operators of its own', () => {
    const q = compile(scorecard, filters, slices);
    expect(q.filterConfig?.map(r => r.operator)).toEqual(['eq', 'relative_date']);
  });
});

describe('compile: per-type query shape', () => {
  it('scorecard reads its number from server-computed totals, so it need fetch only one row', () => {
    const c: Component = { ...base, type: 'scorecard', config: { metric: 'revenue', aggregation: 'COUNT_DISTINCT' } };
    const q = compile(c, [], []);
    expect(q.limit).toBe(1);
    expect(q.dateTruncConfig).toBeNull();
    expect(q.aggregationConfig).toEqual([{ column: 'revenue', function: 'COUNT_DISTINCT' }]);
  });

  it('timeseries: the breakdown is a grouping key, never an aggregation', () => {
    const c: Component = {
      ...base, type: 'timeseries',
      config: { dateField: 'date', metric: 'cost', aggregation: 'SUM', unit: 'DAY', breakdown: 'source' },
    };
    const q = compile(c, [], []);
    expect(q.aggregationConfig).toEqual([{ column: 'cost', function: 'SUM' }]);
    expect(q.dateTruncConfig).toEqual([{ column: 'date', unit: 'DAY' }]);
  });

  it('timeseries: a breakdown that repeats the date field is projected once, not twice', () => {
    // A duplicated projection would corrupt the implied GROUP BY.
    const c: Component = {
      ...base, type: 'timeseries',
      config: { dateField: 'date', metric: 'cost', aggregation: 'SUM', unit: 'DAY', breakdown: 'date' },
    };
    expect(compile(c, [], []).fields).toEqual(['date', 'cost']);
  });

  it('donut compiles exactly like pie', () => {
    const cfg = { dimension: 'country', metric: 'cost', aggregation: 'SUM' as const, maxCategories: 6 };
    const pie: Component = { ...base, type: 'pie', config: cfg };
    const donut: Component = { ...base, type: 'donut', config: cfg };
    expect(compile(donut, filters, slices)).toEqual(compile(pie, filters, slices));
  });

  it('table: an empty column list still produces a structurally valid query', () => {
    const c: Component = { ...base, type: 'table', config: { columns: [], limit: 20 } };
    const q = compile(c, [], []);
    expect(q.fields).toEqual([]);
    expect(q.aggregationConfig).toBeNull();
    expect(q.limit).toBe(20);
  });

  it('throws on an unknown component type rather than emitting a malformed query', () => {
    const c = { ...base, type: 'sankey', config: {} } as unknown as Component;
    expect(() => compile(c, [], [])).toThrow(/sankey/);
  });
});

// ---------------------------------------------------------------------------
// sortConfig: `limit` alone returns an ARBITRARY N rows. Every component that
// implies ranking must emit a server-side ORDER BY on the aggregated alias,
// applied before LIMIT. See docs/superpowers/plans/2026-07-12-data-mart-dashboards.md, Task 6.
// ---------------------------------------------------------------------------

describe('compile: sortConfig', () => {
  it('bar: sorts by the aggregated metric alias, descending by default', () => {
    const c: Component = {
      ...base, type: 'bar',
      config: { dimension: 'source', metric: 'cost', aggregation: 'SUM', orientation: 'vertical', limit: 10 },
    };
    expect(compile(c, [], []).sortConfig).toEqual([{ column: 'cost | SUM', direction: 'desc' }]);
  });

  it('bar: honours an explicit ascending sort from config', () => {
    const c: Component = {
      ...base, type: 'bar',
      config: { dimension: 'source', metric: 'cost', aggregation: 'SUM', orientation: 'vertical', limit: 10, sort: 'asc' },
    };
    expect(compile(c, [], []).sortConfig).toEqual([{ column: 'cost | SUM', direction: 'asc' }]);
  });

  it('pie: sorts by the aggregated metric alias, always descending (maxCategories keeps the biggest slices)', () => {
    const c: Component = {
      ...base, type: 'pie',
      config: { dimension: 'country', metric: 'cost', aggregation: 'SUM', maxCategories: 6 },
    };
    expect(compile(c, [], []).sortConfig).toEqual([{ column: 'cost | SUM', direction: 'desc' }]);
  });

  it('donut: sorts identically to pie', () => {
    const c: Component = {
      ...base, type: 'donut',
      config: { dimension: 'country', metric: 'cost', aggregation: 'SUM', maxCategories: 6 },
    };
    expect(compile(c, [], []).sortConfig).toEqual([{ column: 'cost | SUM', direction: 'desc' }]);
  });

  it('table: maps config.sort straight through, already-shaped SortRule[]', () => {
    const c: Component = {
      ...base, type: 'table',
      config: { columns: ['date', 'cost'], sort: [{ column: 'cost', direction: 'desc' }], limit: 50 },
    };
    expect(compile(c, [], []).sortConfig).toEqual([{ column: 'cost', direction: 'desc' }]);
  });

  it('table: omits sortConfig entirely when the user set no sort', () => {
    const c: Component = { ...base, type: 'table', config: { columns: ['date', 'cost'], limit: 50 } };
    expect(compile(c, [], [])).not.toHaveProperty('sortConfig');
  });

  it('scorecard: emits no sortConfig — a single aggregate row has nothing to order', () => {
    const c: Component = { ...base, type: 'scorecard', config: { metric: 'revenue', aggregation: 'SUM' } };
    expect(compile(c, [], [])).not.toHaveProperty('sortConfig');
  });

  it('timeseries: emits no sortConfig — a full series over buckets is not a ranking', () => {
    const c: Component = {
      ...base, type: 'timeseries',
      config: { dateField: 'date', metric: 'cost', aggregation: 'SUM', unit: 'DAY' },
    };
    expect(compile(c, [], [])).not.toHaveProperty('sortConfig');
  });
});
