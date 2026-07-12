import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  emptyDashboard,
  type AggregateFunction,
  type DateTruncUnit,
  type FilterRule,
  type QueryRequest,
  type QueryResult,
  type ComponentType,
  type Dashboard,
} from './types';

describe('emptyDashboard', () => {
  it('builds a dashboard scoped to the given data mart with sane defaults', () => {
    const dashboard = emptyDashboard('dash-1', 'mart-1', 'My Dashboard');

    expect(dashboard).toEqual({
      id: 'dash-1',
      $entity: { type: 'data-mart', id: 'mart-1' },
      name: 'My Dashboard',
      gridColumns: 5,
      filters: [],
      slices: [],
      components: [],
      configVersion: 0,
    });
  });

  it('never stamps $createdAt/$updatedAt/$createdBy — those are host-only', () => {
    const dashboard = emptyDashboard('dash-1', 'mart-1', 'My Dashboard');

    expect('$createdAt' in dashboard).toBe(false);
    expect('$updatedAt' in dashboard).toBe(false);
    expect('$createdBy' in dashboard).toBe(false);
  });
});

describe('type-level contracts', () => {
  it('AggregateFunction is exactly the ten query-service functions', () => {
    expectTypeOf<AggregateFunction>().toEqualTypeOf<
      'SUM' | 'COUNT' | 'COUNT_DISTINCT' | 'AVG' | 'MIN' | 'MAX' | 'P25' | 'P50' | 'P75' | 'P95'
    >();
  });

  it('DateTruncUnit excludes HOUR — DAY is the finest grain the service supports', () => {
    expectTypeOf<DateTruncUnit>().toEqualTypeOf<'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR'>();
    expectTypeOf<'HOUR'>().not.toMatchTypeOf<DateTruncUnit>();
  });

  it('FilterRule.operator is a bare string — rejected operators are a runtime concern, not a type one', () => {
    expectTypeOf<FilterRule['operator']>().toEqualTypeOf<string>();
  });

  it('QueryRequest has no pagination/offset field — v1 has none', () => {
    expectTypeOf<QueryRequest>().not.toHaveProperty('offset');
    expectTypeOf<QueryRequest>().not.toHaveProperty('page');
    expectTypeOf<QueryRequest['limit']>().toEqualTypeOf<number | undefined>();
  });

  it('QueryResult carries only server-computed shape: columns, rows, truncated, totals', () => {
    expectTypeOf<QueryResult>().toEqualTypeOf<{
      columns: string[];
      rows: unknown[][];
      truncated: boolean;
      totals: Record<string, number | string | boolean | null> | null;
    }>();
  });

  it('ComponentType is exactly the six supported chart kinds', () => {
    expectTypeOf<ComponentType>().toEqualTypeOf<
      'scorecard' | 'timeseries' | 'bar' | 'pie' | 'donut' | 'table'
    >();
  });

  it('Dashboard has no $createdBy field — the host strips it before the plugin sees the doc', () => {
    expectTypeOf<Dashboard>().not.toHaveProperty('$createdBy');
    expectTypeOf<Dashboard['$createdAt']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Dashboard['$updatedAt']>().toEqualTypeOf<string | undefined>();
  });

  it('Dashboard.filters/slices are global — one array applied to every component, no per-component overrides', () => {
    expectTypeOf<Dashboard['filters']>().toEqualTypeOf<FilterRule[]>();
    expectTypeOf<Dashboard['slices']>().toEqualTypeOf<FilterRule[]>();
  });
});
